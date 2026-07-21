"""Trust-but-verify resolution of architectural DXF drawing units.

The DXF header is useful evidence, but it is not authoritative: exported and
hand-edited files frequently retain a stale ``$INSUNITS`` value.  This module
scores millimetres, centimetres and metres against independent geometric
families and only overrides a supported header when the evidence is decisive.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Any

INSUNITS_DRAWING_UNITS_PER_METER: dict[int, float] = {
    4: 1000.0,
    5: 100.0,
    6: 1.0,
}

_EVIDENCE_SCORE_MIN = 0.65
_OVERRIDE_MARGIN_MIN = 0.18


@dataclass(frozen=True)
class UnitResolution:
    header_insunits: int | None
    effective_insunits: int
    drawing_units_per_meter: float
    overridden: bool
    confidence: float
    scores: dict[int, float]
    evidence: dict[str, Any]
    reason: str


def _finite_positive(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 1e-9 else None


def _percentile(values: list[float], fraction: float) -> float:
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[lower]
    weight = position - lower
    return values[lower] * (1.0 - weight) + values[upper] * weight


def _robust_values(values: list[float]) -> list[float]:
    """Trim percentile and MAD outliers without erasing small fixtures."""
    cleaned = sorted(value for value in values if math.isfinite(value) and value > 1e-9)
    if len(cleaned) < 5:
        return cleaned
    q10 = _percentile(cleaned, 0.10)
    q90 = _percentile(cleaned, 0.90)
    trimmed = [value for value in cleaned if q10 <= value <= q90]
    if len(trimmed) < 3:
        trimmed = cleaned
    median = statistics.median(trimmed)
    mad = statistics.median(abs(value - median) for value in trimmed)
    if mad <= 1e-9:
        return trimmed
    return [value for value in trimmed if abs(value - median) / (1.4826 * mad) <= 3.5]


def _segment_lengths(geometry: dict[str, object], key: str) -> list[float]:
    lengths: list[float] = []
    items = geometry.get(key)
    if not isinstance(items, list):
        return lengths
    for item in items:
        if not isinstance(item, dict):
            continue
        start, end = item.get("inicio"), item.get("fin")
        if not isinstance(start, (list, tuple)) or not isinstance(end, (list, tuple)):
            continue
        if len(start) < 2 or len(end) < 2:
            continue
        try:
            length = math.hypot(float(end[0]) - float(start[0]), float(end[1]) - float(start[1]))
        except (TypeError, ValueError):
            continue
        if math.isfinite(length) and length > 1e-9:
            lengths.append(length)
    return _robust_values(lengths)


def polygon_vertices(raw: object) -> list[tuple[float, float]]:
    """Accept room records, polygon records, or bare vertex arrays."""
    value = raw
    if isinstance(value, dict) and "polygon" in value:
        value = value.get("polygon")
    if isinstance(value, dict):
        value = value.get("vertices")
    vertices: list[tuple[float, float]] = []
    if not isinstance(value, (list, tuple)):
        return vertices
    for vertex in value:
        try:
            if isinstance(vertex, dict):
                x, y = float(vertex["x"]), float(vertex["y"])
            elif isinstance(vertex, (list, tuple)) and len(vertex) >= 2:
                x, y = float(vertex[0]), float(vertex[1])
            else:
                continue
        except (KeyError, TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            vertices.append((x, y))
    if len(vertices) > 1 and vertices[0] == vertices[-1]:
        vertices.pop()
    return vertices


def _polygon_area(vertices: list[tuple[float, float]]) -> float:
    if len(vertices) < 3:
        return 0.0
    return abs(
        sum(
            vertices[index][0] * vertices[(index + 1) % len(vertices)][1]
            - vertices[(index + 1) % len(vertices)][0] * vertices[index][1]
            for index in range(len(vertices))
        )
    ) / 2.0


def _room_statistics(room_polygons: list[object]) -> tuple[list[float], list[float]]:
    areas: list[float] = []
    minor_dimensions: list[float] = []
    for raw in room_polygons:
        vertices = polygon_vertices(raw)
        if len(vertices) < 3:
            continue
        area = _polygon_area(vertices)
        xs = [point[0] for point in vertices]
        ys = [point[1] for point in vertices]
        minor = min(max(xs) - min(xs), max(ys) - min(ys))
        if area > 1e-9:
            areas.append(area)
        if minor > 1e-9:
            minor_dimensions.append(minor)
    return _robust_values(areas), _robust_values(minor_dimensions)


def _range_score(
    value: float,
    optimum: tuple[float, float],
    tolerance: tuple[float, float],
) -> float:
    opt_low, opt_high = optimum
    tol_low, tol_high = tolerance
    if opt_low <= value <= opt_high:
        return 1.0
    if value < tol_low or value > tol_high:
        return 0.0
    if value < opt_low:
        return (value - tol_low) / (opt_low - tol_low)
    return (tol_high - value) / (tol_high - opt_high)


def _candidate_family_scores(
    per_meter: float,
    wall_lengths: list[float],
    opening_lengths: list[float],
    room_areas: list[float],
    room_minors: list[float],
) -> dict[str, float]:
    family_scores: dict[str, float] = {}
    if wall_lengths:
        wall_m = statistics.median(wall_lengths) / per_meter
        family_scores["walls"] = _range_score(wall_m, (1.0, 12.0), (0.3, 30.0))
    if opening_lengths:
        opening_m = statistics.median(opening_lengths) / per_meter
        family_scores["openings"] = _range_score(opening_m, (0.7, 1.2), (0.55, 1.5))
    if room_areas:
        area_m2 = statistics.median(room_areas) / (per_meter * per_meter)
        family_scores["room_areas"] = _range_score(area_m2, (1.5, 60.0), (0.5, 200.0))
    if room_minors:
        minor_m = statistics.median(room_minors) / per_meter
        family_scores["room_minor_dimensions"] = _range_score(
            minor_m,
            (0.8, 10.0),
            (0.3, 30.0),
        )
    return family_scores


def _fallback_candidate(geometry: dict[str, object]) -> int:
    wall_lengths = _segment_lengths(geometry, "paredes")
    if wall_lengths:
        median_wall = statistics.median(wall_lengths)
        if median_wall > 800:
            return 4
        if median_wall > 80:
            return 5
        return 6
    return 4


def resolve_drawing_units(
    header_insunits: int | None,
    geometry: dict[str, object] | None,
    room_polygons: list[object] | None,
) -> UnitResolution:
    """Resolve effective units from the header and robust geometric evidence."""
    geometry = geometry if isinstance(geometry, dict) else {}
    rooms = room_polygons if isinstance(room_polygons, list) else []
    try:
        header = int(header_insunits) if header_insunits else None
    except (TypeError, ValueError):
        header = None

    wall_lengths = _segment_lengths(geometry, "paredes")
    opening_lengths = _segment_lengths(geometry, "aberturas")
    room_areas, room_minors = _room_statistics(rooms)

    family_by_candidate: dict[int, dict[str, float]] = {}
    scores: dict[int, float] = {}
    for candidate, per_meter in INSUNITS_DRAWING_UNITS_PER_METER.items():
        families = _candidate_family_scores(
            per_meter,
            wall_lengths,
            opening_lengths,
            room_areas,
            room_minors,
        )
        family_by_candidate[candidate] = families
        base = sum(families.values()) / len(families) if families else 0.0
        header_prior = 0.03 if header == candidate else 0.0
        scores[candidate] = round(min(1.0, base + header_prior), 6)

    ranked = sorted(scores, key=lambda candidate: (-scores[candidate], candidate))
    best = ranked[0]
    second = ranked[1]
    margin = scores[best] - scores[second]
    strong_families = [
        name for name, score in family_by_candidate[best].items() if score >= _EVIDENCE_SCORE_MIN
    ]
    decisive = len(strong_families) >= 2 and margin >= _OVERRIDE_MARGIN_MIN
    header_supported = header in INSUNITS_DRAWING_UNITS_PER_METER

    if header_supported and header != best and not decisive:
        effective = int(header)
        confidence = min(0.49, 0.20 + max(scores[effective] - scores[second], 0.0))
        reason = "header retained: geometric evidence was not independently decisive"
    elif decisive:
        effective = best
        confidence = min(0.99, 0.62 + 0.08 * len(strong_families) + margin * 0.2)
        reason = (
            f"geometry selected INSUNITS={best} from {len(strong_families)} "
            f"independent evidence families (margin={margin:.3f})"
        )
    elif header_supported:
        effective = int(header)
        confidence = min(0.55, 0.28 + scores[effective] * 0.2)
        reason = "header retained with low confidence: evidence was incomplete"
    elif family_by_candidate[best]:
        effective = best
        confidence = min(0.59, 0.22 + 0.1 * len(strong_families) + max(margin, 0.0) * 0.2)
        reason = "units inferred from limited geometry; safety clamps remain authoritative"
    else:
        effective = _fallback_candidate(geometry)
        confidence = 0.1
        reason = "units inferred by fallback because no usable geometric evidence was available"

    evidence: dict[str, Any] = {
        "robust_sample_counts": {
            "walls": len(wall_lengths),
            "openings": len(opening_lengths),
            "room_areas": len(room_areas),
            "room_minor_dimensions": len(room_minors),
        },
        "robust_medians_drawing_units": {
            "walls": statistics.median(wall_lengths) if wall_lengths else None,
            "openings": statistics.median(opening_lengths) if opening_lengths else None,
            "room_areas": statistics.median(room_areas) if room_areas else None,
            "room_minor_dimensions": statistics.median(room_minors) if room_minors else None,
        },
        "family_scores": family_by_candidate,
        "strong_families": strong_families,
        "best_candidate": best,
        "second_candidate": second,
        "margin": round(margin, 6),
    }
    return UnitResolution(
        header_insunits=header,
        effective_insunits=effective,
        drawing_units_per_meter=INSUNITS_DRAWING_UNITS_PER_METER[effective],
        overridden=header is not None and effective != header,
        confidence=round(confidence, 3),
        scores=scores,
        evidence=evidence,
        reason=reason,
    )


def room_median_minor_dimension_m(
    room_polygons: list[object] | None,
    resolution: UnitResolution,
) -> float | None:
    """Return robust median room minor dimension in physical metres."""
    _, minors = _room_statistics(room_polygons or [])
    if not minors:
        return None
    return statistics.median(minors) / resolution.drawing_units_per_meter
