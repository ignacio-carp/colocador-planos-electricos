"""Electrical symbol catalog — maps outlet_type to DXF block geometry (US-009)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from cad_worker.constants import DEFAULT_OUTLET_BLOCK_NAME, OUTLET_BLOCK_RADIUS

GeometryType = Literal[
    "circle_cross",
    "circle_cross_double",
    "circle_s",
    "circle_cross_emergency",
]

OUTLET_TYPES = frozenset(
    {"standard", "double", "switch", "dedicated_appliance", "emergency"},
)

BBOX_SCALE_FACTOR = 0.008
MIN_SYMBOL_RADIUS = 20.0
MAX_SYMBOL_RADIUS = 80.0
CROSS_ARM_RATIO = 0.65


@dataclass(frozen=True)
class SymbolDef:
    block_name: str
    geometry: GeometryType
    color_aci: int


CATALOG: dict[str, SymbolDef] = {
    "standard": SymbolDef(DEFAULT_OUTLET_BLOCK_NAME, "circle_cross", 3),
    "double": SymbolDef("CAMBRE_OUTLET_DBL", "circle_cross_double", 3),
    "switch": SymbolDef("CAMBRE_SWITCH", "circle_s", 1),
    "dedicated_appliance": SymbolDef("CAMBRE_OUTLET_DED", "circle_cross", 5),
    "emergency": SymbolDef("CAMBRE_OUTLET_EMG", "circle_cross_emergency", 6),
}


def resolve_outlet_type(item: dict[str, object]) -> str:
    raw = item.get("outlet_type")
    if isinstance(raw, str) and raw in CATALOG:
        return raw
    return "standard"


def resolve_symbol(item: dict[str, object]) -> SymbolDef:
    return CATALOG[resolve_outlet_type(item)]


def compute_symbol_scale(bbox: dict[str, float] | None) -> float:
    """Scale factor for block INSERT relative to base OUTLET_BLOCK_RADIUS."""
    if not bbox:
        return 1.0
    span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
    if span <= 0:
        return 1.0
    target_radius = max(MIN_SYMBOL_RADIUS, min(MAX_SYMBOL_RADIUS, span * BBOX_SCALE_FACTOR))
    return target_radius / OUTLET_BLOCK_RADIUS
