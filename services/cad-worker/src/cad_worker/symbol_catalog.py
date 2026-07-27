"""Electrical symbol catalog: shapes declared in millimetres of paper.

An electrical symbol is an annotation, not a scale drawing of the device. Its
size is decided on the sheet — a tomacorriente reads at about 4.5 mm at any plot
scale — and only then converted to drawing units. Declaring the geometry directly
in paper millimetres removes the whole class of bug that produced 200-metre
circles: there is no dimensionless "block radius" left to multiply by a wrong
unit guess.

    drawing units = paper mm * (plot scale / 1000) * drawing units per metre

Every symbol is drawn with its wall side toward local -Y, so a single INSERT
rotation aligns it to whatever wall the placer chose.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Literal

from cad_worker.constants import (
    CONFIDENT_UNITS_THRESHOLD,
    DEFAULT_PLOT_SCALE,
    MAX_SYMBOL_PAPER_MM,
    MAX_SYMBOL_ROOM_MINOR_RATIO,
    MIN_SYMBOL_PAPER_MM,
    SUPPORTED_PLOT_SCALES,
    SYMBOL_PAPER_MM,
)
from cad_worker.unit_resolution import (
    INSUNITS_DRAWING_UNITS_PER_METER,
    UnitResolution,
    resolve_drawing_units,
    room_median_minor_dimension_m,
)

GeometryType = Literal[
    "toma",
    "toma_doble",
    "toma_especial",
    "centro_luz",
    "brazo",
    "llave",
    "llave_combinacion",
    "tablero",
    "puesta_tierra",
]

# Legacy MVP outlet types (cambre-normative-2026.05.1).
OUTLET_TYPES = frozenset(
    {"standard", "double", "switch", "dedicated_appliance", "emergency"},
)

# Legacy outlet_type → element (for backward-compatible placements).
LEGACY_TO_ELEMENT: dict[str, str] = {
    "standard": "toma",
    "double": "toma_doble",
    "switch": "llave",
    "dedicated_appliance": "toma_especial",
    "emergency": "toma_especial",
}

# Backwards-compatible alias.
INSUNITS_PER_METER = INSUNITS_DRAWING_UNITS_PER_METER


@dataclass(frozen=True)
class SymbolDef:
    """One catalog entry, sized in millimetres on the printed sheet."""

    block_name: str
    geometry: GeometryType
    color_aci: int
    element: str
    paper_mm: float = SYMBOL_PAPER_MM
    # Ceiling devices keep the drawing's orientation; wall devices turn to face
    # the room they serve.
    rotates_with_wall: bool = True
    # Switch gangs: how many levers the symbol shows.
    poles: int = 1
    label: str = ""


@dataclass(frozen=True)
class SymbolScaleResolution:
    """One scale for the whole document, plus why it was reduced if it was."""

    nominal_scale: float
    final_scale: float
    scale_clamped: bool
    clamp_reason: str | None
    room_median_minor_dimension_m: float | None
    plot_scale: float
    nominal_paper_mm: float
    final_paper_mm: float


class UnknownPlacementKindError(ValueError):
    """Raised when a placement does not identify a supported symbol kind."""


# ACI colours land on the INSERT, never inside the block, so a plan can be
# recoloured per layer or per instance without regenerating geometry.
_TOMA = 1
_LUZ = 5
_LLAVE = 6
_ESPECIAL = 2
_TABLERO = 7
_TIERRA = 3

CATALOG: dict[str, SymbolDef] = {
    "toma": SymbolDef("CBR_TOMA", "toma", _TOMA, "toma", label="Tomacorriente 10 A"),
    "toma_doble": SymbolDef(
        "CBR_TOMA_DOBLE",
        "toma_doble",
        _TOMA,
        "toma_doble",
        label="Tomacorriente doble 10 A",
    ),
    "toma_especial": SymbolDef(
        "CBR_TOMA_ESP",
        "toma_especial",
        _ESPECIAL,
        "toma_especial",
        label="Tomacorriente especial 20 A",
    ),
    "centro": SymbolDef(
        "CBR_CENTRO",
        "centro_luz",
        _LUZ,
        "centro",
        rotates_with_wall=False,
        label="Centro de luz",
    ),
    "brazo": SymbolDef("CBR_BRAZO", "brazo", _LUZ, "brazo", label="Brazo / aplique de pared"),
    "llave": SymbolDef("CBR_LLAVE_1", "llave", _LLAVE, "llave", poles=1, label="Llave 1 punto"),
    "llave_2_puntos": SymbolDef(
        "CBR_LLAVE_2",
        "llave",
        _LLAVE,
        "llave_2_puntos",
        poles=2,
        label="Llave 2 puntos",
    ),
    "llave_3_puntos": SymbolDef(
        "CBR_LLAVE_3",
        "llave",
        _LLAVE,
        "llave_3_puntos",
        poles=3,
        label="Llave 3 puntos",
    ),
    "llave_combinacion": SymbolDef(
        "CBR_LLAVE_COMB",
        "llave_combinacion",
        _LLAVE,
        "llave_combinacion",
        label="Llave de combinación",
    ),
    "tablero": SymbolDef(
        "CBR_TABLERO",
        "tablero",
        _TABLERO,
        "tablero",
        paper_mm=5.0,
        label="Tablero seccional",
    ),
    "puesta_tierra": SymbolDef(
        "CBR_PAT",
        "puesta_tierra",
        _TIERRA,
        "puesta_tierra",
        label="Puesta a tierra",
    ),
}

# Aliases kept so placements written by older runs still resolve.
CATALOG["tablero_seccional"] = CATALOG["tablero"]
CATALOG["tablero_principal_medidor"] = CATALOG["tablero"]

ELEMENT_TYPES = frozenset(CATALOG)

_PLOT_SCALE_PATTERN = re.compile(r"1[\s._:/-]\s*(\d{2,4})")


def resolve_placement_kind(item: dict[str, object]) -> str:
    """Resolve symbol key from element (preferred) or outlet_type (legacy)."""
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
    for legacy, element in LEGACY_TO_ELEMENT.items():
        if element == kind:
            return legacy
    return "standard"


def resolve_symbol(item: dict[str, object]) -> SymbolDef:
    return CATALOG[resolve_placement_kind(item)]


def resolve_plot_scale(geometry: dict[str, object] | None) -> float:
    """Plot scale read from the drawing's own annotation layers.

    Studios name their dimension layers after the sheet scale ("_NOM - COTAS
    1.100"), which is the only place a DXF states it. Absent that, 1:100 is the
    convention for a house plan and the symbol stays inside the legibility band
    either way.
    """
    if not isinstance(geometry, dict):
        return DEFAULT_PLOT_SCALE
    counts: dict[float, int] = {}
    for item in geometry.get("dimensiones", []) or []:
        if not isinstance(item, dict):
            continue
        match = _PLOT_SCALE_PATTERN.search(str(item.get("capa") or ""))
        if not match:
            continue
        value = float(match.group(1))
        if value in SUPPORTED_PLOT_SCALES:
            counts[value] = counts.get(value, 0) + 1
    if not counts:
        return DEFAULT_PLOT_SCALE
    return max(sorted(counts), key=lambda scale: counts[scale])


def compute_symbol_scale_resolution(
    resolution: UnitResolution,
    room_polygons: list[object] | None,
    *,
    plot_scale: float = DEFAULT_PLOT_SCALE,
    paper_mm: float = SYMBOL_PAPER_MM,
) -> SymbolScaleResolution:
    """INSERT scale converting paper millimetres to drawing units, once per document.

    The room-relative cap is the last line of defence: it is a pure ratio, so it
    still bounds the symbol when the unit resolution itself is wrong.
    """
    per_meter = resolution.drawing_units_per_meter
    nominal_scale = (plot_scale / 1000.0) * per_meter
    median_minor_m = room_median_minor_dimension_m(room_polygons, resolution)

    final_scale = nominal_scale
    clamp_reason: str | None = None
    if median_minor_m is not None and median_minor_m > 0:
        max_footprint_du = MAX_SYMBOL_ROOM_MINOR_RATIO * median_minor_m * per_meter
        max_scale = max_footprint_du / paper_mm
        if max_scale < nominal_scale:
            final_scale = max_scale
            clamp_reason = "room_relative_footprint"

    # The cap may not shrink a symbol out of legibility: a room too small to hold
    # a readable symbol is a real situation (a 1 m² toilette), and the answer is a
    # symbol that overflows its room, not one nobody can read.
    #
    # But the floor is denominated in the resolved units, so it can only be
    # trusted when the units are. Under a wrong resolution it would inflate
    # rather than protect, which is exactly how 200-metre symbols happened; below
    # the confidence threshold the dimensionless cap rules alone.
    if resolution.confidence >= CONFIDENT_UNITS_THRESHOLD and paper_mm > 0:
        floor_scale = nominal_scale * (MIN_SYMBOL_PAPER_MM / paper_mm)
        if final_scale < floor_scale:
            final_scale = floor_scale
            clamp_reason = "room_relative_footprint_floored"
    final_scale = max(final_scale, 1e-12)

    return SymbolScaleResolution(
        nominal_scale=nominal_scale,
        final_scale=final_scale,
        scale_clamped=final_scale < nominal_scale * (1.0 - 1e-9),
        clamp_reason=clamp_reason,
        room_median_minor_dimension_m=median_minor_m,
        plot_scale=plot_scale,
        nominal_paper_mm=paper_mm,
        final_paper_mm=paper_mm * final_scale / nominal_scale if nominal_scale > 0 else 0.0,
    )


def paper_mm_of(footprint_drawing_units: float, scale: float) -> float:
    """Invert the scale: how many millimetres of paper a drawn symbol occupies."""
    if scale <= 0 or not math.isfinite(scale):
        return math.inf
    return footprint_drawing_units / scale


def paper_size_is_legible(paper_mm: float) -> bool:
    return MIN_SYMBOL_PAPER_MM - 1e-6 <= paper_mm <= MAX_SYMBOL_PAPER_MM + 1e-6


def read_dxf_insunits(doc: Any) -> int | None:
    """Read AutoCAD $INSUNITS from a DXF document."""
    try:
        val = int(doc.header.get("$INSUNITS", 0))
        return val if val else None
    except (TypeError, ValueError, AttributeError):
        return None


def drawing_units_per_meter(
    insunits: int | None,
    bbox: dict[str, float] | None,
    geometry: dict[str, object] | None,
) -> float:
    """Compatibility helper routed through the shared unit resolver."""
    resolved_geometry = dict(geometry or {})
    if not resolved_geometry.get("paredes") and bbox:
        span = max(bbox["max_x"] - bbox["min_x"], bbox["max_y"] - bbox["min_y"])
        resolved_geometry["paredes"] = [{"inicio": [0.0, 0.0], "fin": [span, 0.0]}]
    return resolve_drawing_units(insunits, resolved_geometry, []).drawing_units_per_meter


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
