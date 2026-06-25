"""Electrical symbol catalog — maps outlet_type / element to DXF block geometry (US-009)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

from cad_worker.constants import DEFAULT_OUTLET_BLOCK_NAME, OUTLET_BLOCK_RADIUS

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

# Physical target: ~3 cm symbol diameter on the plan (architectural convention).
TARGET_SYMBOL_DIAMETER_M = 0.03
CROSS_ARM_RATIO = 0.65

# Max symbol radius as fraction of plan span (avoid dominating small details).
MAX_RADIUS_SPAN_RATIO = 0.0012
# Min symbol radius as fraction of plan span (stay visible when zoomed to full plan).
MIN_RADIUS_SPAN_RATIO = 0.00025

# AutoCAD $INSUNITS → drawing units per meter.
INSUNITS_PER_METER: dict[int, float] = {
    1: 39.3700787402,  # inches
    2: 3.280839895,  # feet
    3: 1.0936132983,  # miles → use with care
    4: 1000.0,  # millimeters
    5: 100.0,  # centimeters
    6: 1.0,  # meters
    8: 1000000.0,  # micrometers
    9: 1000000000.0,  # nanometers
    10: 1_000_000_000_000.0,  # kilometers — unlikely in floor plans
}


@dataclass(frozen=True)
class SymbolDef:
    block_name: str
    geometry: GeometryType
    color_aci: int
    element: str | None = None


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
    element = item.get("element")
    if isinstance(element, str) and element in CATALOG:
        return element
    raw = item.get("outlet_type")
    if isinstance(raw, str):
        if raw in CATALOG:
            return raw
        if raw in LEGACY_TO_ELEMENT:
            return LEGACY_TO_ELEMENT[raw]
    return "standard"


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
    """Guess drawing units when $INSUNITS is missing (4 = mm, 6 = m)."""
    span = 0.0
    if bbox:
        span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
    median_wall = _median_wall_length(geometry)

    if span > 800 or (median_wall is not None and median_wall > 80):
        return 4  # millimeters (typical architectural DXF)
    if span > 0 and span < 80:
        return 6  # meters
    if median_wall is not None and median_wall < 2:
        return 6
    return 4


def drawing_units_per_meter(insunits: int | None, bbox: dict[str, float] | None, geometry: dict[str, object] | None) -> float:
    if insunits and insunits in INSUNITS_PER_METER:
        return INSUNITS_PER_METER[insunits]
    inferred = infer_insunits(bbox, geometry)
    return INSUNITS_PER_METER.get(inferred, 1000.0)


def compute_symbol_radius_drawing_units(
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None = None,
    insunits: int | None = None,
) -> float:
    """Target block radius in DXF drawing units (~1.5 cm real-world diameter ≈ 3 cm)."""
    per_meter = drawing_units_per_meter(insunits, bbox, geometry)
    physical_radius = (TARGET_SYMBOL_DIAMETER_M / 2.0) * per_meter

    if not bbox:
        return max(physical_radius, 1e-6)

    span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
    if span <= 0:
        return max(physical_radius, 1e-6)

    max_radius = span * MAX_RADIUS_SPAN_RATIO
    min_radius = span * MIN_RADIUS_SPAN_RATIO
    radius = min(physical_radius, max_radius)
    radius = max(radius, min_radius)
    return max(radius, 1e-6)


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
    target = compute_symbol_radius_drawing_units(bbox, geometry, insunits)
    return target / OUTLET_BLOCK_RADIUS
