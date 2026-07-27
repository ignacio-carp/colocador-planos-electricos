"""Symbol shapes as primitives in millimetres of paper.

Conventions, so one INSERT rotation orients any symbol correctly:

- The **origin is the wall contact point**. The placer puts that point on the
  wall, and the symbol grows toward local +Y, into the room.
- Local +Y is the room-inward normal. An INSERT rotation of
  ``degrees(atan2(ny, nx)) - 90`` aligns it to a wall whose inward normal is
  ``(nx, ny)``.
- Ceiling devices (``centro``) are centred on the origin and never rotate.

Every family is normalised so its bounding box measures exactly the symbol's
declared paper size. That is what makes the legibility gate checkable: the block
definition itself is the specification.
"""

from __future__ import annotations

import math

from cad_worker.symbol_catalog import SymbolDef

# ("circle", cx, cy, r) | ("line", x1, y1, x2, y2) | ("arc", cx, cy, r, a0, a1)
Primitive = tuple

_ARC_SAMPLES = 12


def _toma_leads(half_gap: float, top: float) -> list[Primitive]:
    return [
        ("line", -half_gap, 0.0, -half_gap, top),
        ("line", half_gap, 0.0, half_gap, top),
    ]


def _toma() -> list[Primitive]:
    """IRAM tomacorriente: two leads from the wall into a circle."""
    radius, lead_top = 1.55, 1.55
    return [
        *_toma_leads(0.62, lead_top),
        ("circle", 0.0, lead_top + radius, radius),
    ]


def _toma_doble() -> list[Primitive]:
    """Double outlet: the same body split by a diameter."""
    radius, lead_top = 1.55, 1.55
    centre_y = lead_top + radius
    return [
        *_toma_leads(0.62, lead_top),
        ("circle", 0.0, centre_y, radius),
        ("line", 0.0, centre_y - radius, 0.0, centre_y + radius),
    ]


def _toma_especial() -> list[Primitive]:
    """Dedicated / 220 V outlet: outlet body over a bar."""
    radius, lead_top = 1.45, 1.6
    centre_y = lead_top + radius
    return [
        *_toma_leads(0.6, lead_top),
        ("circle", 0.0, centre_y, radius),
        ("line", -1.5, 0.75, 1.5, 0.75),
    ]


def _centro_luz() -> list[Primitive]:
    """Ceiling outlet: circle with a saltire, centred on the insertion point."""
    radius = 2.25
    diagonal = radius * math.cos(math.pi / 4)
    return [
        ("circle", 0.0, 0.0, radius),
        ("line", -diagonal, -diagonal, diagonal, diagonal),
        ("line", -diagonal, diagonal, diagonal, -diagonal),
    ]


def _brazo() -> list[Primitive]:
    """Wall bracket: half circle standing on the wall line."""
    radius = 1.9
    return [
        ("line", -2.25, 0.0, 2.25, 0.0),
        ("arc", 0.0, 0.0, radius, 0.0, 180.0),
        ("line", 0.0, 0.0, 0.0, radius),
    ]


def _llave(poles: int) -> list[Primitive]:
    """Switch: a dot on the wall with a lever, one tick per gang."""
    dot_radius = 0.42
    tip_x, tip_y = 1.75, 2.6
    primitives: list[Primitive] = [
        ("circle", 0.0, 0.0, dot_radius),
        ("line", 0.0, 0.0, tip_x, tip_y),
    ]
    # Ticks sit across the lever near its tip; a 3-gang switch shows three.
    angle = math.atan2(tip_y, tip_x)
    normal = (-math.sin(angle), math.cos(angle))
    for index in range(max(1, poles)):
        along = 0.62 + index * 0.34
        base_x, base_y = tip_x * along, tip_y * along
        primitives.append(
            (
                "line",
                base_x - normal[0] * 0.5,
                base_y - normal[1] * 0.5,
                base_x + normal[0] * 0.5,
                base_y + normal[1] * 0.5,
            ),
        )
    return primitives


def _llave_combinacion() -> list[Primitive]:
    """Two-way switch: lever plus the return path."""
    return [
        *_llave(1),
        ("line", 0.0, 0.0, 1.75 * 0.55, 2.6 * 0.95),
    ]


def _tablero() -> list[Primitive]:
    """Panel board: box on the wall with the conventional diagonal."""
    half_width, height = 2.5, 3.1
    return [
        ("line", -half_width, 0.0, half_width, 0.0),
        ("line", half_width, 0.0, half_width, height),
        ("line", half_width, height, -half_width, height),
        ("line", -half_width, height, -half_width, 0.0),
        ("line", -half_width, 0.0, half_width, height),
    ]


def _puesta_tierra() -> list[Primitive]:
    """Earth: stem with three shortening bars."""
    return [
        ("line", 0.0, 0.0, 0.0, 2.4),
        ("line", -1.6, 0.0, 1.6, 0.0),
        ("line", -1.05, -0.75, 1.05, -0.75),
        ("line", -0.5, -1.5, 0.5, -1.5),
    ]


_BUILDERS = {
    "toma": _toma,
    "toma_doble": _toma_doble,
    "toma_especial": _toma_especial,
    "centro_luz": _centro_luz,
    "brazo": _brazo,
    "llave_combinacion": _llave_combinacion,
    "tablero": _tablero,
    "puesta_tierra": _puesta_tierra,
}


def _primitive_extent(primitives: list[Primitive]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for primitive in primitives:
        kind = primitive[0]
        if kind == "circle":
            _, cx, cy, r = primitive
            xs += [cx - r, cx + r]
            ys += [cy - r, cy + r]
        elif kind == "line":
            _, x1, y1, x2, y2 = primitive
            xs += [x1, x2]
            ys += [y1, y2]
        elif kind == "arc":
            _, cx, cy, r, a0, a1 = primitive
            for index in range(_ARC_SAMPLES + 1):
                angle = math.radians(a0 + (a1 - a0) * index / _ARC_SAMPLES)
                xs.append(cx + r * math.cos(angle))
                ys.append(cy + r * math.sin(angle))
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


def _scaled(primitives: list[Primitive], factor: float) -> list[Primitive]:
    out: list[Primitive] = []
    for primitive in primitives:
        kind = primitive[0]
        if kind == "circle":
            _, cx, cy, r = primitive
            out.append(("circle", cx * factor, cy * factor, r * factor))
        elif kind == "line":
            _, x1, y1, x2, y2 = primitive
            out.append(("line", x1 * factor, y1 * factor, x2 * factor, y2 * factor))
        elif kind == "arc":
            _, cx, cy, r, a0, a1 = primitive
            out.append(("arc", cx * factor, cy * factor, r * factor, a0, a1))
    return out


def symbol_primitives(symbol: SymbolDef) -> list[Primitive]:
    """Shape of a symbol, scaled so its bounding box is exactly its paper size.

    Scaling is about the origin, so the wall contact point stays put and the
    declared paper size is a property of the block definition rather than a hope
    about the insert scale.
    """
    builder = _BUILDERS.get(symbol.geometry)
    primitives = builder() if builder else _llave(symbol.poles)
    min_x, min_y, max_x, max_y = _primitive_extent(primitives)
    extent = max(max_x - min_x, max_y - min_y)
    if extent <= 1e-9:
        return primitives
    return _scaled(primitives, symbol.paper_mm / extent)


def symbol_paper_extent(symbol: SymbolDef) -> float:
    """Bounding-box size of the normalised symbol, in millimetres of paper."""
    min_x, min_y, max_x, max_y = _primitive_extent(symbol_primitives(symbol))
    return max(max_x - min_x, max_y - min_y)


def wall_rotation_degrees(inward_normal: tuple[float, float]) -> float:
    """INSERT rotation that points the symbol's local +Y along the inward normal."""
    nx, ny = inward_normal
    if math.hypot(nx, ny) < 1e-12:
        return 0.0
    return math.degrees(math.atan2(ny, nx)) - 90.0
