"""Electrical symbol catalog — maps outlet_type / element to DXF block geometry (US-009)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

from cad_worker.constants import (
    ASSUMED_PLOT_SCALE,
    CONFIDENT_UNITS_THRESHOLD,
    MAX_SYMBOL_CLASSIFIED_SPAN_RATIO,
    MAX_SYMBOL_ROOM_MINOR_RATIO,
    MIN_SYMBOL_DIAMETER_M,
    OUTLET_BLOCK_RADIUS,
    SYMBOL_PAPER_MM,
)
from cad_worker.unit_resolution import (
    INSUNITS_DRAWING_UNITS_PER_METER,
    UnitResolution,
    resolve_drawing_units,
    room_median_minor_dimension_m,
)

GeometryType = Literal[
    "circle_cross",
    "circle_cross_double",
    "circle_s",
    "circle_cross_emergency",
    "filled_circle",
    "toma",
    "toma_especial",
    "brazo",
    "llave",
    "tablero",
    "puesta_tierra",
]

# Legacy MVP outlet types (cambre-normative-2026.05.1).
OUTLET_TYPES = frozenset(
    {"standard", "double", "switch", "dedicated_appliance", "emergency"},
)

# Vivienda ruleset element types (cambre-vivienda-2026.06.3 symbology.blocks).
ELEMENT_TYPES = frozenset(
    {
        "centro",
        "brazo",
        "toma",
        "toma_especial",
        "llave",
        "tablero",
        "puesta_tierra",
        "tablero_seccional",
        "tablero_principal_medidor",
    },
)

# Legacy outlet_type → vivienda element (for backward-compatible placements).
LEGACY_TO_ELEMENT: dict[str, str] = {
    "standard": "toma",
    "double": "toma",
    "switch": "llave",
    "dedicated_appliance": "toma_especial",
    "emergency": "toma_especial",
}

# 4.5 mm on paper at 1:100 -> 0.45 m model-space nominal diameter.
TARGET_SYMBOL_DIAMETER_M = SYMBOL_PAPER_MM / 1000.0 * ASSUMED_PLOT_SCALE
CROSS_ARM_RATIO = 0.65

# Backwards-compatible alias. Unit resolution intentionally only considers the
# three architectural candidates required by the worker contract.
INSUNITS_PER_METER = INSUNITS_DRAWING_UNITS_PER_METER


@dataclass(frozen=True)
class SymbolDef:
    block_name: str
    geometry: GeometryType
    color_aci: int
    element: str | None = None


@dataclass(frozen=True)
class SymbolScaleResolution:
    nominal_scale: float
    final_scale: float
    scale_clamped: bool
    clamp_reason: str | None
    room_median_minor_dimension_m: float | None
    nominal_footprint_m: float
    final_footprint_m: float


class UnknownPlacementKindError(ValueError):
    """Raised when a placement does not identify a supported symbol kind."""


CATALOG: dict[str, SymbolDef] = {
    # Legacy MVP types (geometry updated to vivienda symbology; block names unified)
    "standard": SymbolDef("SYM_TOMA", "toma", 3, "toma"),
    "double": SymbolDef("SYM_TOMA", "toma", 3, "toma"),
    "switch": SymbolDef("SYM_LLAVE", "llave", 1, "llave"),
    "dedicated_appliance": SymbolDef("SYM_TOMA_ESP", "toma_especial", 5, "toma_especial"),
    "emergency": SymbolDef("SYM_TOMA_ESP", "toma_especial", 6, "toma_especial"),
    # Vivienda element types (symbology.blocks from cambre-vivienda-2026.06.3)
    "centro": SymbolDef("SYM_CENTRO", "filled_circle", 3, "centro"),
    "brazo": SymbolDef("SYM_BRAZO", "brazo", 3, "brazo"),
    "toma": SymbolDef("SYM_TOMA", "toma", 3, "toma"),
    "toma_especial": SymbolDef("SYM_TOMA_ESP", "toma_especial", 5, "toma_especial"),
    "llave": SymbolDef("SYM_LLAVE", "llave", 1, "llave"),
    "tablero": SymbolDef("SYM_TABLERO", "tablero", 7, "tablero"),
    "tablero_seccional": SymbolDef("SYM_TABLERO", "tablero", 7, "tablero"),
    "tablero_principal_medidor": SymbolDef("SYM_TABLERO", "tablero", 7, "tablero"),
    "puesta_tierra": SymbolDef("SYM_PAT", "puesta_tierra", 3, "puesta_tierra"),
}


def resolve_placement_kind(item: dict[str, object]) -> str:
    """Resolve symbol key from element (vivienda) or outlet_type (legacy)."""
    for key in ("element", "tipo_componente"):
        element = item.get(key)
        if isinstance(element, str) and element in CATALOG:
            return element
    raw = item.get("outlet_type")
    if isinstance(raw, str):
        if raw in LEGACY_TO_ELEMENT:
            return LEGACY_TO_ELEMENT[raw]
        if raw in CATALOG:
            return raw
    supplied = item.get("element") or item.get("tipo_componente") or item.get("outlet_type")
    raise UnknownPlacementKindError(f"unsupported placement kind: {supplied!r}")


def resolve_outlet_type(item: dict[str, object]) -> str:
    kind = resolve_placement_kind(item)
    if kind in OUTLET_TYPES:
        return kind
    # Map vivienda element back to closest legacy outlet_type for metadata.
    for legacy, element in LEGACY_TO_ELEMENT.items():
        if element == kind:
            return legacy
    return "standard"


def resolve_symbol(item: dict[str, object]) -> SymbolDef:
    return CATALOG[resolve_placement_kind(item)]


def _median_wall_length(geometry: dict[str, object] | None) -> float | None:
    if not geometry:
        return None
    walls = geometry.get("paredes")
    if not isinstance(walls, list):
        return None
    lengths: list[float] = []
    for wall in walls:
        if not isinstance(wall, dict):
            continue
        start = wall.get("inicio")
        end = wall.get("fin")
        if not isinstance(start, (list, tuple)) or not isinstance(end, (list, tuple)):
            continue
        if len(start) < 2 or len(end) < 2:
            continue
        dx = float(end[0]) - float(start[0])
        dy = float(end[1]) - float(start[1])
        length = math.hypot(dx, dy)
        if length > 1e-6:
            lengths.append(length)
    if not lengths:
        return None
    lengths.sort()
    mid = len(lengths) // 2
    return lengths[mid] if len(lengths) % 2 else (lengths[mid - 1] + lengths[mid]) / 2


def infer_insunits(
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None = None,
) -> int:
    """Compatibility helper routed through the shared unit resolver."""
    resolved_geometry = dict(geometry or {})
    if not resolved_geometry.get("paredes") and bbox:
        span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
        resolved_geometry["paredes"] = [{"inicio": [0.0, 0.0], "fin": [span, 0.0]}]
    return resolve_drawing_units(None, resolved_geometry, []).effective_insunits


def drawing_units_per_meter(
    insunits: int | None,
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None,
) -> float:
    resolved_geometry = dict(geometry or {})
    if not resolved_geometry.get("paredes") and bbox:
        span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
        resolved_geometry["paredes"] = [{"inicio": [0.0, 0.0], "fin": [span, 0.0]}]
    return resolve_drawing_units(insunits, resolved_geometry, []).drawing_units_per_meter


def compute_symbol_scale_resolution(
    resolution: UnitResolution,
    room_polygons: list[object] | None,
    bbox: dict[str, float] | None,
    *,
    base_footprint: float,
) -> SymbolScaleResolution:
    """Resolve a shared INSERT scale using the measured unscaled block footprint."""
    per_meter = resolution.drawing_units_per_meter
    nominal_scale = TARGET_SYMBOL_DIAMETER_M / 2.0 * per_meter / OUTLET_BLOCK_RADIUS
    measured_base = max(float(base_footprint), 1e-9)
    nominal_footprint_m = measured_base * nominal_scale / per_meter
    median_minor_m = room_median_minor_dimension_m(room_polygons, resolution)

    if median_minor_m is not None:
        room_cap_m = MAX_SYMBOL_ROOM_MINOR_RATIO * median_minor_m
        if resolution.confidence >= CONFIDENT_UNITS_THRESHOLD:
            max_footprint_m = max(MIN_SYMBOL_DIAMETER_M, room_cap_m)
            reason = "room_relative_footprint"
        else:
            # The 0.15 m floor is metre-denominated: under a wrong unit
            # resolution it inflates instead of protecting (0.15 m read as
            # mm becomes 150 real metres). The room-relative cap is a pure
            # ratio in drawing units, so with untrusted units it rules alone.
            max_footprint_m = max(room_cap_m, 1e-9)
            reason = "room_relative_footprint_low_confidence"
    else:
        max_footprint_m = TARGET_SYMBOL_DIAMETER_M
        reason = "no_rooms_fallback"
        if bbox:
            span_du = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
            if span_du > 0:
                span_guard_m = span_du / per_meter * MAX_SYMBOL_CLASSIFIED_SPAN_RATIO
                if span_guard_m < max_footprint_m:
                    max_footprint_m = span_guard_m
                    reason = "classified_bbox_span"

    max_scale = max_footprint_m * per_meter / measured_base
    final_scale = max(min(nominal_scale, max_scale), 1e-9)
    clamped = final_scale < nominal_scale * (1.0 - 1e-9)
    return SymbolScaleResolution(
        nominal_scale=nominal_scale,
        final_scale=final_scale,
        scale_clamped=clamped,
        clamp_reason=reason if clamped else None,
        room_median_minor_dimension_m=median_minor_m,
        nominal_footprint_m=nominal_footprint_m,
        final_footprint_m=measured_base * final_scale / per_meter,
    )


def compute_symbol_radius_drawing_units(
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None = None,
    insunits: int | None = None,
) -> float:
    """Compatibility helper for the final scale of a circle-only unit block."""
    resolution = resolve_drawing_units(insunits, geometry, [])
    return compute_symbol_scale_resolution(
        resolution,
        [],
        bbox,
        base_footprint=2.0,
    ).final_scale


def read_dxf_insunits(doc: Any) -> int | None:
    """Read AutoCAD $INSUNITS from a DXF document."""
    try:
        val = int(doc.header.get("$INSUNITS", 0))
        return val if val else None
    except (TypeError, ValueError, AttributeError):
        return None


def compute_symbol_scale(
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None = None,
    insunits: int | None = None,
) -> float:
    """Scale factor for block INSERT (block geometry uses OUTLET_BLOCK_RADIUS as base)."""
    return compute_symbol_radius_drawing_units(bbox, geometry, insunits) / OUTLET_BLOCK_RADIUS
