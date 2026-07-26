"""Pure geometric validators: no LLM, no network, no visual judgement.

Each validator returns Check records; the runner aggregates them into the
report. Tolerances are expressed in real mm and converted per fixture through
its ground-truth du_per_m (never through the inference heuristic under test).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox as ezdxf_bbox

from cad_worker.constants import (
    LEGACY_BLOCK_NAMES,
    MAX_SYMBOL_ROOM_MINOR_RATIO,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.electrical_layer import CAMBRE_APPID, CAMBRE_ROOM_GROUP_CODE
from cad_worker.geometry import (
    Point,
    point_in_polygon,
    point_seg_distance,
    segments_collinear,
)
from cad_worker.harness.fixtures import Fixture, RoomTruth

TOL_ON_WALL_MM = 50.0
CLEARANCE_MM = 150.0
SEP_MIN_MM = 600.0
EXPECTED_POINT_TOL_MM = 60.0  # 10 mm inward nudge + rounding headroom
MIN_SYMBOL_DIAMETER_M = 0.15


@dataclass
class Check:
    fixture: str
    check: str
    ok: bool
    detail: str
    room_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        data = {"check": self.check, "ok": self.ok, "detail": self.detail}
        if self.room_id:
            data["room_id"] = self.room_id
        return data


#: A placement list now carries three families of component. Outlet rules
#: (count, spacing, clearance) only ever meant the first one, so the validators
#: read the element instead of assuming everything is a tomacorriente.
OUTLET_ELEMENTS = frozenset({"toma", "toma_doble", "toma_especial"})
SWITCH_ELEMENTS = frozenset(
    {"llave", "llave_2_puntos", "llave_3_puntos", "llave_combinacion"},
)
CEILING_ELEMENTS = frozenset({"centro"})


def _element_of(item: dict[str, Any]) -> str:
    element = item.get("element")
    if isinstance(element, str) and element:
        return element
    return "toma" if item.get("outlet_type") else ""


def _positions(result: dict[str, Any], elements: frozenset[str] | None = None) -> list[Point]:
    points: list[Point] = []
    for item in result.get("outlet_placements", []):
        if elements is not None and _element_of(item) not in elements:
            continue
        pos = item.get("position", {})
        points.append((float(pos.get("x", 0.0)), float(pos.get("y", 0.0))))
    return points


def _placements_of(result: dict[str, Any], elements: frozenset[str]) -> list[dict[str, Any]]:
    return [
        item for item in result.get("outlet_placements", []) if _element_of(item) in elements
    ]


def _segments(geometry: dict[str, Any], key: str) -> list[tuple[Point, Point]]:
    out: list[tuple[Point, Point]] = []
    for item in geometry.get(key, []) or []:
        start, end = item.get("inicio"), item.get("fin")
        if isinstance(start, (list, tuple)) and isinstance(end, (list, tuple)):
            out.append(
                ((float(start[0]), float(start[1])), (float(end[0]), float(end[1]))),
            )
    return out


def _nearest_wall(point: Point, walls: list[tuple[Point, Point]]) -> tuple[float, int]:
    best, best_idx = math.inf, -1
    for idx, (a, b) in enumerate(walls):
        dist = point_seg_distance(point, a, b)
        if dist < best:
            best, best_idx = dist, idx
    return best, best_idx


def validate_room(
    fixture: Fixture,
    truth: RoomTruth,
    result: dict[str, Any] | None,
    error_code: str | None,
    geometry: dict[str, Any],
) -> list[Check]:
    checks: list[Check] = []
    fx, room = fixture.name, truth.id

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append(Check(fixture=fx, check=name, ok=ok, detail=detail, room_id=room))

    # Honest degradation: rooms that must fail explicitly, fail explicitly.
    if truth.expected_error_code:
        add(
            "honest_error",
            error_code == truth.expected_error_code,
            f"esperado {truth.expected_error_code}, obtenido {error_code or 'sin error'}",
        )
        return checks
    if result is None:
        add("count_matches_rule", False, f"el colocador fallo con {error_code}")
        return checks

    points = _positions(result, OUTLET_ELEMENTS)
    walls = _segments(geometry, "paredes")
    openings = _segments(geometry, "aberturas")

    add(
        "count_matches_rule",
        len(points) == truth.expected_outlets,
        f"esperadas {truth.expected_outlets}, colocadas {len(points)}"
        f" (required={result.get('required_outlets')})",
    )

    ceiling = _positions(result, CEILING_ELEMENTS)
    add(
        "lighting_inside_room",
        all(point_in_polygon(point, truth.polygon) for point in ceiling),
        f"{len(ceiling)} centros de luz, todos dentro del polígono"
        if ceiling
        else "sin centros de luz",
    )

    switches = _placements_of(result, SWITCH_ELEMENTS)
    add(
        "switch_beside_door",
        len(switches) == truth.expected_switches,
        f"esperadas {truth.expected_switches} llaves, colocadas {len(switches)}",
    )

    wall_mounted = _placements_of(result, OUTLET_ELEMENTS | SWITCH_ELEMENTS)
    oriented = [item for item in wall_mounted if item.get("wall_normal")]
    add(
        "wall_normal_present",
        len(oriented) == len(wall_mounted),
        f"{len(oriented)}/{len(wall_mounted)} componentes de pared traen normal"
        " (sin ella el símbolo no puede rotarse hacia el ambiente)",
    )
    if fixture.expected_effective_insunits is not None:
        effective = result.get("effective_insunits")
        add(
            "placement_effective_units",
            effective == fixture.expected_effective_insunits,
            f"esperadas INSUNITS={fixture.expected_effective_insunits}, obtenidas={effective}",
        )

    inside = [p for p in points if point_in_polygon(p, truth.polygon)]
    add(
        "inside_polygon",
        len(inside) == len(points),
        f"{len(inside)}/{len(points)} dentro del poligono del ambiente",
    )

    tol_wall = fixture.tol(TOL_ON_WALL_MM)
    wall_hits = [(_nearest_wall(p, walls)) for p in points]
    on_wall_ok = all(dist <= tol_wall for dist, _ in wall_hits)
    worst = max((dist for dist, _ in wall_hits), default=0.0)
    add(
        "on_wall",
        on_wall_ok,
        f"peor distancia a pared {worst:.1f} du (tolerancia {tol_wall:.1f})",
    )

    clearance = fixture.tol(CLEARANCE_MM) * 0.99  # epsilon for boundary placements
    violations = [
        (p, point_seg_distance(p, a, b))
        for p in points
        for a, b in openings
        if point_seg_distance(p, a, b) < clearance
    ]
    add(
        "clearance_openings",
        not violations,
        "sin tomas a menos de 150 mm de aberturas"
        if not violations
        else f"{len(violations)} tomas violan clearance: {violations[:3]}",
    )

    sep_min = fixture.tol(SEP_MIN_MM) * 0.99
    too_close = [
        (i, j)
        for i in range(len(points))
        for j in range(i + 1, len(points))
        if math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) < sep_min
    ]
    add(
        "no_overlap",
        not too_close,
        "separacion minima 600 mm respetada" if not too_close else f"pares {too_close}",
    )

    if truth.expected_points:
        tol_pt = fixture.tol(EXPECTED_POINT_TOL_MM)
        unmatched = []
        for expected in truth.expected_points:
            if not any(
                math.hypot(p[0] - expected[0], p[1] - expected[1]) <= tol_pt for p in points
            ):
                unmatched.append(expected)
        add(
            "expected_points",
            not unmatched,
            "todas las posiciones esperadas matcheadas"
            if not unmatched
            else f"sin match para {unmatched} (obtenidas {points})",
        )

    if len(points) > 1 and truth.expected_distinct_walls > 1:
        used_walls = [walls[idx] for _, idx in wall_hits if idx >= 0]
        distinct: list[tuple[Point, Point]] = []
        for seg in used_walls:
            gap = fixture.tol(200.0)
            if not any(segments_collinear(seg, other, gap_tol=gap) for other in distinct):
                distinct.append(seg)
        add(
            "distinct_walls",
            len(distinct) >= truth.expected_distinct_walls,
            f"{len(distinct)} paredes distintas usadas"
            f" (esperadas >= {truth.expected_distinct_walls})",
        )

    warnings = result.get("warnings", [])
    missing = [w for w in truth.expected_warnings if not any(w in got for got in warnings)]
    unexpected = [
        w
        for w in warnings
        if not any(exp in w for exp in truth.expected_warnings)
    ]
    add(
        "warnings_match",
        not missing and not unexpected,
        f"warnings={warnings}"
        + (f" faltan={missing}" if missing else "")
        + (f" inesperados={unexpected}" if unexpected else ""),
    )
    return checks


def validate_detection(fixture: Fixture, detection: dict[str, Any]) -> list[Check]:
    """Cross-check deterministic room detection against ground-truth polygons."""
    fx = fixture.name
    if fixture.expected_detected_rooms is None:
        return [
            Check(
                fixture=fx,
                check="detect_rooms",
                ok=not detection.get("ok"),
                detail=f"deteccion debia fallar; ok={detection.get('ok')}"
                f" code={detection.get('code')}",
            ),
        ]
    rooms = detection.get("rooms", []) if detection.get("ok") else []
    checks = [
        Check(
            fixture=fx,
            check="detect_rooms_count",
            ok=len(rooms) == fixture.expected_detected_rooms,
            detail=f"esperadas {fixture.expected_detected_rooms}, detectadas {len(rooms)}"
            f" (faces={detection.get('faces_total')})",
        ),
    ]
    if fixture.expected_effective_insunits is not None:
        effective = detection.get("effective_insunits")
        checks.append(
            Check(
                fixture=fx,
                check="detection_effective_units",
                ok=effective == fixture.expected_effective_insunits,
                detail=(
                    f"esperadas INSUNITS={fixture.expected_effective_insunits}, "
                    f"obtenidas={effective}"
                ),
            ),
        )
    # Every truth room must be matched by a detected polygon of ~equal area
    # that contains the truth centroid.
    for truth in fixture.rooms:
        cx = sum(v[0] for v in truth.polygon) / len(truth.polygon)
        cy = sum(v[1] for v in truth.polygon) / len(truth.polygon)
        truth_area_m2 = _polygon_area(truth.polygon) / (fixture.du_per_m**2)
        matched = False
        for room in rooms:
            verts = [(v["x"], v["y"]) for v in room["polygon"]["vertices"]]
            if point_in_polygon((cx, cy), verts) and (
                abs(room["area_m2"] - truth_area_m2) <= max(0.02 * truth_area_m2, 0.05)
            ):
                matched = True
                break
        checks.append(
            Check(
                fixture=fx,
                check="detect_rooms_match",
                ok=matched,
                detail=f"area verdad {truth_area_m2:.2f} m2"
                + (" matcheada" if matched else " SIN match en deteccion"),
                room_id=truth.id,
            ),
        )
    return checks


def validate_drawn_output(
    fixture: Fixture,
    apply_result: dict[str, Any],
    placements_sent: int,
    *,
    second_apply_result: dict[str, Any] | None = None,
) -> list[Check]:
    """Audit unit lineage, footprint, containment, hygiene and idempotence."""
    fx = fixture.name
    skipped = int(apply_result.get("placements_skipped_out_of_bbox", 0) or 0)
    added = int(apply_result.get("outlets_added", 0) or 0)
    rejected = apply_result.get("placements_rejected", [])
    rejected = rejected if isinstance(rejected, list) else []
    expected_rejected = len(fixture.expected_rejection_reasons)
    expected_added = placements_sent - expected_rejected
    checks = [
        Check(
            fixture=fx,
            check="bbox_guard_zero",
            ok=skipped == 0 and added == expected_added,
            detail=(
                f"enviadas {placements_sent}, dibujadas {added}, "
                f"rechazos esperados {expected_rejected}, fuera bbox {skipped}"
            ),
        ),
    ]

    if fixture.expected_effective_insunits is not None:
        effective = apply_result.get("effective_insunits")
        overridden = bool(apply_result.get("insunits_overridden"))
        checks.append(
            Check(
                fixture=fx,
                check="apply_effective_units",
                ok=(
                    effective == fixture.expected_effective_insunits
                    and overridden == fixture.expect_insunits_override
                ),
                detail=(
                    f"effective={effective}, override={overridden}; "
                    f"esperado={fixture.expected_effective_insunits}/"
                    f"{fixture.expect_insunits_override}"
                ),
            ),
        )

    reasons = [item.get("reason") for item in rejected if isinstance(item, dict)]
    checks.append(
        Check(
            fixture=fx,
            check="placement_rejections",
            ok=all(reason in reasons for reason in fixture.expected_rejection_reasons)
            and len(reasons) == expected_rejected,
            detail=f"rechazos={reasons}, esperados={fixture.expected_rejection_reasons}",
        ),
    )

    output = apply_result.get("output")
    output_path = Path(str(output)) if output else None
    doc = ezdxf.readfile(output_path) if output_path and output_path.is_file() else None
    inserts = (
        [
            entity
            for entity in doc.modelspace()
            if entity.dxftype() == "INSERT"
            and entity.dxf.layer == OUTPUT_ELECTRICAL_LAYER_NAME
        ]
        if doc
        else []
    )

    room_by_id = {truth.id: truth.polygon for truth in fixture.rooms}
    contained = 0
    versioned_xdata = 0
    for insert in inserts:
        try:
            xdata = insert.get_xdata(CAMBRE_APPID)
        except Exception:  # noqa: BLE001
            continue
        strings = [str(item.value) for item in xdata if item.code == CAMBRE_ROOM_GROUP_CODE]
        if len(strings) >= 3:
            versioned_xdata += 1
        room_polygon = room_by_id.get(strings[0]) if strings else None
        point = (float(insert.dxf.insert.x), float(insert.dxf.insert.y))
        if room_polygon and point_in_polygon(point, room_polygon):
            contained += 1
    checks.append(
        Check(
            fixture=fx,
            check="xdata_containment",
            ok=contained == len(inserts) and versioned_xdata == len(inserts),
            detail=(
                f"{contained}/{len(inserts)} contenidos; "
                f"{versioned_xdata}/{len(inserts)} con XDATA versionado"
            ),
        ),
    )

    minor_dimensions_m = [
        min(
            max(point[0] for point in truth.polygon) - min(point[0] for point in truth.polygon),
            max(point[1] for point in truth.polygon) - min(point[1] for point in truth.polygon),
        )
        / fixture.du_per_m
        for truth in fixture.rooms
    ]
    minor_dimensions_m.sort()
    median_minor_m = minor_dimensions_m[len(minor_dimensions_m) // 2]
    max_footprint_m = max(
        MIN_SYMBOL_DIAMETER_M,
        MAX_SYMBOL_ROOM_MINOR_RATIO * median_minor_m,
    )
    actual_footprints_m: list[float] = []
    for insert in inserts:
        extents = ezdxf_bbox.extents([insert], fast=True)
        if extents.has_data:
            actual_footprints_m.append(
                max(
                    float(extents.extmax.x - extents.extmin.x),
                    float(extents.extmax.y - extents.extmin.y),
                )
                / fixture.du_per_m,
            )
    scale_ok = bool(actual_footprints_m) and all(
        MIN_SYMBOL_DIAMETER_M - 1e-6 <= value <= max_footprint_m + 1e-6
        for value in actual_footprints_m
    )
    checks.append(
        Check(
            fixture=fx,
            check="footprint_relative",
            ok=scale_ok,
            detail=(
                f"footprints_m={[round(value, 4) for value in actual_footprints_m]}, "
                f"rango=[{MIN_SYMBOL_DIAMETER_M:.2f}, {max_footprint_m:.3f}]"
            ),
        ),
    )

    origin_radius = max(0.5, 10.0 * 0.45)
    room_intersects_origin_disk = any(
        point_in_polygon((0.0, 0.0), truth.polygon)
        or any(
            point_seg_distance((0.0, 0.0), start, end) <= origin_radius * fixture.du_per_m
            for start, end in _polygon_edges(truth.polygon)
        )
        for truth in fixture.rooms
    )
    origin_violations = [
        insert
        for insert in inserts
        if math.hypot(float(insert.dxf.insert.x), float(insert.dxf.insert.y))
        <= origin_radius * fixture.du_per_m
        and not room_intersects_origin_disk
    ]
    checks.append(
        Check(
            fixture=fx,
            check="origin_guard",
            ok=not origin_violations,
            detail=f"inserts prohibidos cerca del origen={len(origin_violations)}",
        ),
    )

    legacy_inserts = [
        insert.dxf.name for insert in inserts if insert.dxf.name in LEGACY_BLOCK_NAMES
    ]
    remaining_legacy_blocks = [name for name in LEGACY_BLOCK_NAMES if doc and name in doc.blocks]
    removed = int(apply_result.get("legacy_entities_removed", 0) or 0)
    checks.append(
        Check(
            fixture=fx,
            check="legacy_cleanup",
            ok=(
                not legacy_inserts
                and not remaining_legacy_blocks
                and removed >= fixture.expected_legacy_entities_removed
            ),
            detail=(
                f"removed={removed}, inserts={legacy_inserts}, "
                f"defs={remaining_legacy_blocks}"
            ),
        ),
    )

    blocks_used = apply_result.get("blocks_used", [])
    poison_ok = not fixture.expect_poison_versioned or "CBR_TOMA__V2" in blocks_used
    checks.append(
        Check(
            fixture=fx,
            check="poisoned_block_defense",
            ok=poison_ok,
            detail=f"blocks_used={blocks_used}",
        ),
    )

    if second_apply_result is not None:
        second_output = Path(str(second_apply_result.get("output")))
        second_doc = ezdxf.readfile(second_output)
        second_inserts = [
            entity
            for entity in second_doc.modelspace()
            if entity.dxftype() == "INSERT"
            and entity.dxf.layer == OUTPUT_ELECTRICAL_LAYER_NAME
        ]
        checks.append(
            Check(
                fixture=fx,
                check="idempotent_reprocess",
                ok=len(second_inserts) == len(inserts) == expected_added,
                detail=(
                    f"primera={len(inserts)}, segunda={len(second_inserts)}, "
                    f"esperada={expected_added}"
                ),
            ),
        )
    return checks


def _polygon_edges(vertices: list[Point]) -> list[tuple[Point, Point]]:
    return [
        (vertices[index], vertices[(index + 1) % len(vertices)])
        for index in range(len(vertices))
    ]


def _polygon_area(vertices: list[Point]) -> float:
    n = len(vertices)
    acc = 0.0
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        acc += x1 * y2 - x2 * y1
    return abs(acc) / 2.0
