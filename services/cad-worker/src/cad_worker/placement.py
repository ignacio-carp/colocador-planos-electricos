"""Deterministic outlet placement engine (tomacorrientes v1).

Replaces the LLM in the "where" step of US-008: given a room polygon, extracted
geometry (walls, openings, furniture) and the active normative rule for the
room type, computes exact outlet coordinates. The LLM keeps the semantic step
(room_type classification / rule choice) and never emits x,y.

Behaviour spec: docs/placement-spec/reglas-dormitorio-tomas-v1.md. Every mm
threshold below is converted to drawing units through $INSUNITS (heuristic
inference only as fallback). Output is stable and reproducible: same input →
byte-identical placements.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

from cad_worker.geometry import (
    Point,
    Segment,
    inward_normal,
    point_at,
    point_in_polygon,
    point_seg_distance,
    polygon_edges,
    project_param,
    project_segment_onto_edge,
    seg_length,
    segments_collinear,
    subtract_intervals,
)
from cad_worker.symbol_catalog import drawing_units_per_meter

# --- Spec parameters (mm; converted per plan units). See placement spec §3. ---
DEFAULT_PARAMS_MM: dict[str, float] = {
    "clearance_from_opening_mm": 150.0,
    "tol_on_wall_mm": 50.0,
    "sep_min_tomas_mm": 600.0,
    "offset_cama_mm": 200.0,
    "tol_pared_ambiente_mm": 100.0,
    "min_span_mm": 300.0,
    "inward_nudge_mm": 10.0,
}

BED_BLOCK_TOKENS = ("cama", "bed", "matrim", "single", "queen", "king")

WARN_NO_BED = "NO_BED_DETECTED"
WARN_BED_NOT_AGAINST_WALL = "BED_NOT_AGAINST_WALL"
WARN_INSUFFICIENT_WALL_SPACE = "INSUFFICIENT_WALL_SPACE"
WARN_WALLS_UNMATCHED = "WALLS_UNMATCHED"
WARN_KITCHEN_COUNTER = "KITCHEN-COUNTER-UNVERIFIED"

KITCHEN_ROOM_TYPES = ("cocina", "kitchen", "cocina_comedor")
ERROR_NO_WALLS = "NO_WALLS_FOR_ROOM"
ERROR_NO_RULE = "NO_RULE_FOR_ROOM_TYPE"
ERROR_BAD_POLYGON = "INVALID_ROOM_POLYGON"


class PlacementError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class EdgeSpans:
    """A polygon edge with its usable intervals (drawing units from edge start)."""

    index: int
    a: Point
    b: Point
    length: float
    spans: list[tuple[float, float]] = field(default_factory=list)
    wall_supported: bool = False

    def segment(self) -> Segment:
        return (self.a, self.b)


def _polygon_vertices(polygon: Any) -> list[Point]:
    """Accept {vertices: [{x,y}, ...]} or [[x, y], ...]."""
    raw = polygon.get("vertices") if isinstance(polygon, dict) else polygon
    verts: list[Point] = []
    if isinstance(raw, list):
        for v in raw:
            if isinstance(v, dict) and isinstance(v.get("x"), (int, float)):
                verts.append((float(v["x"]), float(v["y"])))
            elif isinstance(v, (list, tuple)) and len(v) >= 2:
                verts.append((float(v[0]), float(v[1])))
    # Drop a duplicated closing vertex.
    if len(verts) >= 2 and seg_length(verts[0], verts[-1]) < 1e-9:
        verts = verts[:-1]
    return verts


def _segments(items: Any) -> list[Segment]:
    out: list[Segment] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        start, end = item.get("inicio"), item.get("fin")
        if (
            isinstance(start, (list, tuple))
            and isinstance(end, (list, tuple))
            and len(start) >= 2
            and len(end) >= 2
        ):
            out.append(
                (
                    (float(start[0]), float(start[1])),
                    (float(end[0]), float(end[1])),
                ),
            )
    return out


def match_rule_for_room_type(
    rules_bundle: dict[str, Any],
    room_type: str | None,
) -> dict[str, Any] | None:
    """Match reglas_por_habitacion by room_types synonyms; fall back to generic rule."""
    reglas = rules_bundle.get("reglas_por_habitacion")
    if not isinstance(reglas, list):
        return None
    normalized = (room_type or "").strip().lower()
    generic: dict[str, Any] | None = None
    for regla in reglas:
        if not isinstance(regla, dict):
            continue
        types = regla.get("room_types")
        if not isinstance(types, list):
            continue
        lowered = [str(t).strip().lower() for t in types]
        if normalized and normalized in lowered:
            return regla
        if "generico" in lowered or "other" in lowered:
            generic = generic or regla
    return generic


def _rule_defaults(rules_bundle: dict[str, Any]) -> dict[str, Any]:
    estrategia = rules_bundle.get("estrategia_procesamiento")
    if isinstance(estrategia, dict):
        defaults = estrategia.get("defaults")
        if isinstance(defaults, dict):
            return defaults
    return {}


def _resolve_params(
    rules_bundle: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> dict[str, float]:
    params = dict(DEFAULT_PARAMS_MM)
    defaults = _rule_defaults(rules_bundle)
    clearance = defaults.get("clearance_from_opening_mm")
    if isinstance(clearance, (int, float)) and clearance >= 0:
        params["clearance_from_opening_mm"] = float(clearance)
    for key, value in (overrides or {}).items():
        if key in params and isinstance(value, (int, float)) and float(value) >= 0:
            params[key] = float(value)
    return params


def _build_edge_spans(
    vertices: list[Point],
    walls: list[Segment],
    openings: list[Segment],
    *,
    tol_wall: float,
    clearance: float,
    min_span: float,
) -> tuple[list[EdgeSpans], bool]:
    """Usable intervals per polygon edge; walls act as supporting evidence."""
    edges: list[EdgeSpans] = []
    any_supported = False
    for index, (a, b) in enumerate(polygon_edges(vertices)):
        length = seg_length(a, b)
        edge = EdgeSpans(index=index, a=a, b=b, length=length)
        if length < 1e-9:
            edges.append(edge)
            continue

        covered = 0.0
        for wall in walls:
            interval = project_segment_onto_edge(wall, (a, b), max_distance=tol_wall)
            if interval:
                covered += interval[1] - interval[0]
        edge.wall_supported = covered >= length * 0.5
        any_supported = any_supported or edge.wall_supported

        cuts: list[tuple[float, float]] = []
        for opening in openings:
            interval = project_segment_onto_edge(
                opening,
                (a, b),
                max_distance=tol_wall + clearance,
            )
            if interval:
                cuts.append((interval[0] - clearance, interval[1] + clearance))
        spans = subtract_intervals((0.0, length), cuts)
        edge.spans = [s for s in spans if s[1] - s[0] >= min_span]
        edges.append(edge)
    return edges, any_supported


def _detect_bed(
    furniture: Any,
    vertices: list[Point],
) -> dict[str, Any] | None:
    """Largest-footprint furniture whose block name matches bed tokens."""
    if not isinstance(furniture, list):
        return None
    candidates: list[tuple[float, dict[str, Any]]] = []
    for item in furniture:
        if not isinstance(item, dict):
            continue
        name = str(item.get("bloque") or "").lower()
        if not any(token in name for token in BED_BLOCK_TOKENS):
            continue
        footprint = item.get("footprint")
        pos = item.get("posicion")
        inside = False
        area = 0.0
        if isinstance(footprint, dict) and all(
            isinstance(footprint.get(k), (int, float))
            for k in ("min_x", "min_y", "max_x", "max_y")
        ):
            fp = {k: float(footprint[k]) for k in ("min_x", "min_y", "max_x", "max_y")}
            area = max(fp["max_x"] - fp["min_x"], 0.0) * max(fp["max_y"] - fp["min_y"], 0.0)
            cx = (fp["min_x"] + fp["max_x"]) / 2.0
            cy = (fp["min_y"] + fp["max_y"]) / 2.0
            inside = point_in_polygon((cx, cy), vertices)
            if inside:
                candidates.append((area, {**item, "footprint": fp}))
                continue
        if isinstance(pos, (list, tuple)) and len(pos) >= 2:
            if point_in_polygon((float(pos[0]), float(pos[1])), vertices):
                candidates.append((area, dict(item)))
    if not candidates:
        return None
    candidates.sort(key=lambda c: (-c[0], str(c[1].get("bloque") or "")))
    return candidates[0][1]


def _headboard_edge(
    bed_footprint: dict[str, float],
    edges: list[EdgeSpans],
    *,
    tol: float,
) -> EdgeSpans | None:
    """Edge touching the bed footprint with the largest projected overlap."""
    best: tuple[float, EdgeSpans] | None = None
    fp = bed_footprint
    sides: list[Segment] = [
        ((fp["min_x"], fp["min_y"]), (fp["max_x"], fp["min_y"])),
        ((fp["max_x"], fp["min_y"]), (fp["max_x"], fp["max_y"])),
        ((fp["max_x"], fp["max_y"]), (fp["min_x"], fp["max_y"])),
        ((fp["min_x"], fp["max_y"]), (fp["min_x"], fp["min_y"])),
    ]
    for edge in edges:
        if edge.length < 1e-9:
            continue
        overlap = 0.0
        for side in sides:
            mid = point_at(side[0], side[1], 0.5)
            if point_seg_distance(mid, edge.a, edge.b) > tol:
                continue
            interval = project_segment_onto_edge(side, (edge.a, edge.b), max_distance=tol)
            if interval:
                overlap = max(overlap, interval[1] - interval[0])
        if overlap > 0 and (best is None or overlap > best[0]):
            best = (overlap, edge)
    return best[1] if best else None


def _span_containing(edge: EdgeSpans, offset: float) -> tuple[float, float] | None:
    for span in edge.spans:
        if span[0] <= offset <= span[1]:
            return span
    return None


def _place_on_edge(edge: EdgeSpans, offset: float, vertices: list[Point], nudge: float) -> Point:
    """Point at edge offset, nudged toward the room interior (spec §2.4)."""
    t = offset / edge.length if edge.length > 0 else 0.0
    base = point_at(edge.a, edge.b, min(1.0, max(0.0, t)))
    nx, ny = inward_normal(edge.a, edge.b, vertices)
    return (base[0] + nx * nudge, base[1] + ny * nudge)


@dataclass
class _Candidate:
    edge: EdgeSpans
    offset: float
    reason: str


def _headboard_candidates(
    bed: dict[str, Any],
    headboard: EdgeSpans,
    *,
    offset_cama: float,
) -> list[_Candidate]:
    fp = bed.get("footprint")
    if not isinstance(fp, dict):
        return []
    corners = [
        (fp["min_x"], fp["min_y"]),
        (fp["max_x"], fp["min_y"]),
        (fp["max_x"], fp["max_y"]),
        (fp["min_x"], fp["max_y"]),
    ]
    offsets = sorted(
        project_param(corner, headboard.a, headboard.b) * headboard.length for corner in corners
    )
    lo, hi = offsets[0], offsets[-1]
    return [
        _Candidate(headboard, lo - offset_cama, "lado izquierdo de la cama"),
        _Candidate(headboard, hi + offset_cama, "lado derecho de la cama"),
    ]


def _generic_candidates(
    edges: list[EdgeSpans],
    used_edges: list[EdgeSpans],
    needed: int,
) -> list[_Candidate]:
    """Midpoints of the longest usable spans, preferring distinct walls (spec §6.3).

    The used/unused ranking is recomputed after every pick: otherwise a wall
    holding two long spans (e.g. a door splitting a long wall) absorbs two
    outlets while an untouched wall stays empty.
    """
    available: list[tuple[EdgeSpans, tuple[float, float]]] = [
        (edge, span) for edge in edges for span in edge.spans
    ]
    candidates: list[_Candidate] = []
    chosen_edges: list[EdgeSpans] = list(used_edges)

    def is_used(edge: EdgeSpans) -> bool:
        return any(
            other.index == edge.index
            or segments_collinear(
                edge.segment(),
                other.segment(),
                gap_tol=max(edge.length, other.length) * 0.02,
            )
            for other in chosen_edges
        )

    while available and len(candidates) < needed:
        available.sort(
            key=lambda item: (
                0 if not is_used(item[0]) else 1,
                -(item[1][1] - item[1][0]),
                item[0].index,
                item[1][0],
            ),
        )
        edge, span = available.pop(0)
        candidates.append(
            _Candidate(edge, (span[0] + span[1]) / 2.0, "tramo útil de pared"),
        )
        chosen_edges.append(edge)
    return candidates


def _required_outlets(rule: dict[str, Any], usable_perimeter: float, du_per_m: float) -> int:
    minimum = rule.get("min_outlets")
    required = int(minimum) if isinstance(minimum, (int, float)) and minimum > 0 else 1
    spacing = rule.get("spacing_along_wall_m")
    if isinstance(spacing, (int, float)) and spacing > 0 and usable_perimeter > 0:
        by_spacing = math.ceil(usable_perimeter / (float(spacing) * du_per_m))
        required = max(required, by_spacing)
    return required


def place_outlets_for_room(payload: dict[str, Any]) -> dict[str, Any]:
    """Compute deterministic outlet placements for a single room.

    Payload:
      room: { id, room_type, polygon }
      geometry: { paredes[], aberturas[], muebles[] }   (scoped or full plan)
      rules: tomacorrientes bundle (reglas_por_habitacion + estrategia_procesamiento)
      insunits: optional DXF $INSUNITS integer
      params: optional per-call overrides of spec parameters (mm)
    """
    room = payload.get("room") if isinstance(payload.get("room"), dict) else {}
    geometry = payload.get("geometry") if isinstance(payload.get("geometry"), dict) else {}
    rules_bundle = payload.get("rules") if isinstance(payload.get("rules"), dict) else {}
    insunits = payload.get("insunits")
    insunits_int = int(insunits) if isinstance(insunits, (int, float)) and insunits else None

    room_id = str(room.get("id") or "room")
    room_type = room.get("room_type")
    vertices = _polygon_vertices(room.get("polygon"))
    if len(vertices) < 3:
        raise PlacementError(ERROR_BAD_POLYGON, f"Room {room_id} polygon needs >= 3 vertices")

    walls = _segments(geometry.get("paredes"))
    if not walls:
        raise PlacementError(
            ERROR_NO_WALLS,
            f"No walls extracted for room {room_id}; cannot place outlets honestly",
        )
    openings = _segments(geometry.get("aberturas"))

    rule = match_rule_for_room_type(rules_bundle, str(room_type) if room_type else None)
    if not rule:
        raise PlacementError(
            ERROR_NO_RULE,
            f"No rule matches room_type '{room_type}' and no generic rule exists",
        )

    params_mm = _resolve_params(rules_bundle, payload.get("params"))
    du_per_m = drawing_units_per_meter(insunits_int, None, geometry)
    du_per_mm = du_per_m / 1000.0

    tol_wall = params_mm["tol_pared_ambiente_mm"] * du_per_mm
    clearance = params_mm["clearance_from_opening_mm"] * du_per_mm
    min_span = params_mm["min_span_mm"] * du_per_mm
    sep_min = params_mm["sep_min_tomas_mm"] * du_per_mm
    offset_cama = params_mm["offset_cama_mm"] * du_per_mm
    nudge = params_mm["inward_nudge_mm"] * du_per_mm

    warnings: list[str] = []
    edges, any_supported = _build_edge_spans(
        vertices,
        walls,
        openings,
        tol_wall=tol_wall,
        clearance=clearance,
        min_span=min_span,
    )
    if not any_supported:
        warnings.append(WARN_WALLS_UNMATCHED)

    usable_perimeter = sum(s[1] - s[0] for e in edges for s in e.spans)
    required = _required_outlets(rule, usable_perimeter, du_per_m)

    normalized_type = str(room_type or "").strip().lower()
    is_bedroom = normalized_type in ("dormitorio", "bedroom")
    if normalized_type in KITCHEN_ROOM_TYPES:
        # Spec §6.5: v1 has no counter awareness; the plan must say so.
        warnings.append(WARN_KITCHEN_COUNTER)

    candidates: list[_Candidate] = []
    used_edges: list[EdgeSpans] = []

    if is_bedroom:
        bed = _detect_bed(geometry.get("muebles"), vertices)
        if not bed:
            warnings.append(WARN_NO_BED)
        elif not isinstance(bed.get("footprint"), dict):
            warnings.append(WARN_NO_BED)
        else:
            headboard = _headboard_edge(
                bed["footprint"],
                edges,
                tol=tol_wall * 3,
            )
            if not headboard:
                warnings.append(WARN_BED_NOT_AGAINST_WALL)
            else:
                for cand in _headboard_candidates(bed, headboard, offset_cama=offset_cama):
                    if _span_containing(cand.edge, cand.offset):
                        candidates.append(cand)
                        used_edges.append(cand.edge)

    if len(candidates) < required:
        candidates.extend(
            _generic_candidates(edges, used_edges, required - len(candidates)),
        )

    # Enforce minimum separation (headboard pair naturally exceeds sep_min: bed
    # width + 2×offset ≫ 600 mm). Deterministic order: keep earlier candidates.
    placed: list[tuple[Point, _Candidate]] = []
    for cand in candidates:
        point = _place_on_edge(cand.edge, cand.offset, vertices, nudge)
        too_close = any(
            math.hypot(point[0] - other[0][0], point[1] - other[0][1]) < sep_min
            for other in placed
        )
        if too_close:
            continue
        placed.append((point, cand))

    if len(placed) < required:
        warnings.append(
            f"{WARN_INSUFFICIENT_WALL_SPACE}: required={required} placed={len(placed)}",
        )

    height_mm = rule.get("height_mm")
    height = int(height_mm) if isinstance(height_mm, (int, float)) else 300
    rule_id = str(rule.get("id") or "RULE-GENERICO")

    outlet_placements: list[dict[str, Any]] = []
    for seq, (point, cand) in enumerate(placed, start=1):
        outlet_placements.append(
            {
                "id": f"outlet-{room_id.lower()}-{seq:02d}",
                "room_id": room_id,
                "position": {
                    "x": round(point[0], 3),
                    "y": round(point[1], 3),
                    "unit": "drawing_units",
                },
                "outlet_type": "standard",
                "mounting": "wall",
                "height_mm": height,
                "rationale": f"{cand.reason} ({rule_id}, motor determinístico)",
                "rule_ids": [rule_id],
            },
        )

    return {
        "ok": True,
        "room_id": room_id,
        "rule_id": rule_id,
        "required_outlets": required,
        "outlet_placements": outlet_placements,
        "warnings": warnings,
        "drawing_units_per_meter": du_per_m,
        "placement_engine": "deterministic-v1",
    }


def place_elements_cmd(payload_json: str) -> int:
    """CLI entrypoint: JSON payload in, JSON placements out."""
    try:
        payload = json.loads(payload_json)
        result = place_outlets_for_room(payload)
        print(json.dumps(result, sort_keys=True))
        return 0
    except PlacementError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": e.code}))
        return 4
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_PAYLOAD"}))
        return 2
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
