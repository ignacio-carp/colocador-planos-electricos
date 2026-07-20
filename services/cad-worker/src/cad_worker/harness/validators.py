"""Pure geometric validators: no LLM, no network, no visual judgement.

Each validator returns Check records; the runner aggregates them into the
report. Tolerances are expressed in real mm and converted per fixture through
its ground-truth du_per_m (never through the inference heuristic under test).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

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
SYMBOL_DIAMETER_M = 0.03
SYMBOL_DIAMETER_REL_TOL = 0.5  # scale_sane: within ±50% of 3 cm real


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


def _positions(result: dict[str, Any]) -> list[Point]:
    points: list[Point] = []
    for item in result.get("outlet_placements", []):
        pos = item.get("position", {})
        points.append((float(pos.get("x", 0.0)), float(pos.get("y", 0.0))))
    return points


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

    points = _positions(result)
    walls = _segments(geometry, "paredes")
    openings = _segments(geometry, "aberturas")

    add(
        "count_matches_rule",
        len(points) == truth.expected_outlets,
        f"esperadas {truth.expected_outlets}, colocadas {len(points)}"
        f" (required={result.get('required_outlets')})",
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
) -> list[Check]:
    """Checks over the DXF actually drawn: bbox guard silent and sane scale."""
    fx = fixture.name
    skipped = int(apply_result.get("placements_skipped_out_of_bbox", 0) or 0)
    added = int(apply_result.get("outlets_added", 0) or 0)
    checks = [
        Check(
            fixture=fx,
            check="bbox_guard_zero",
            ok=skipped == 0 and added == placements_sent,
            detail=f"enviadas {placements_sent}, dibujadas {added}, descartadas {skipped}",
        ),
    ]
    radius_du = apply_result.get("symbol_radius_drawing_units")
    if isinstance(radius_du, (int, float)):
        diameter_m = 2.0 * float(radius_du) / fixture.du_per_m
        rel_err = abs(diameter_m - SYMBOL_DIAMETER_M) / SYMBOL_DIAMETER_M
        checks.append(
            Check(
                fixture=fx,
                check="scale_sane",
                ok=rel_err <= SYMBOL_DIAMETER_REL_TOL,
                detail=f"simbolo {diameter_m * 100:.2f} cm reales (objetivo 3 cm ±50%)",
            ),
        )
    else:
        checks.append(
            Check(
                fixture=fx,
                check="scale_sane",
                ok=False,
                detail="apply_electrical_layer no reporto symbol_radius_drawing_units",
            ),
        )
    return checks


def _polygon_area(vertices: list[Point]) -> float:
    n = len(vertices)
    acc = 0.0
    for i in range(n):
        x1, y1 = vertices[i]
        x2, y2 = vertices[(i + 1) % n]
        acc += x1 * y2 - x2 * y1
    return abs(acc) / 2.0
