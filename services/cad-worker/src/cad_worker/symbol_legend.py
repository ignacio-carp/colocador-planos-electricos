"""The symbology reference block drawn beside the plan.

A plan full of circles nobody can name is not a deliverable. What makes a real
electrical plan readable is the legend: every symbol that appears, spelled out,
with how many of them there are. It is also the cheapest audit an architect can
run, because a wrong count is visible without opening anything.

Sizes are in millimetres of paper, like the symbols themselves, so the legend
scales with the drawing instead of floating at some absolute size.
"""

from __future__ import annotations

from typing import Any

from cad_worker.symbol_catalog import CATALOG, SymbolDef
from cad_worker.symbol_geometry import symbol_primitives

LEGEND_ROOM_ID = "__legend__"

# Layout, in millimetres of paper.
TITLE_HEIGHT_MM = 3.6
TEXT_HEIGHT_MM = 2.6
ROW_HEIGHT_MM = 7.0
SYMBOL_COLUMN_MM = 8.0
TEXT_COLUMN_MM = 11.0
PADDING_MM = 4.0
BOX_WIDTH_MM = 68.0
GAP_FROM_PLAN_MM = 12.0

TITLE = "SIMBOLOGIA ELECTRICA"


def legend_entries(counts: dict[str, int]) -> list[tuple[SymbolDef, int]]:
    """Catalog entries actually used, in catalog order so the list is stable."""
    seen: set[str] = set()
    entries: list[tuple[SymbolDef, int]] = []
    for kind, symbol in CATALOG.items():
        if kind not in counts or symbol.block_name in seen:
            continue
        seen.add(symbol.block_name)
        entries.append((symbol, counts[kind]))
    return entries


def draw_legend(
    msp: Any,
    *,
    counts: dict[str, int],
    layer_name: str,
    scale: float,
    origin: tuple[float, float],
    color_aci: int,
) -> list[Any]:
    """Draw the reference block; returns the entities so the caller can tag them.

    Every entity is returned rather than tagged here because the electrical layer
    owns the XDATA convention: anything on that layer without it is treated as
    stray and swept on the next run.
    """
    entries = legend_entries(counts)
    if not entries:
        return []

    def mm(value: float) -> float:
        return value * scale

    created: list[Any] = []
    left, top = origin
    height = mm(PADDING_MM * 2 + TITLE_HEIGHT_MM + ROW_HEIGHT_MM * (len(entries) + 0.5))
    width = mm(BOX_WIDTH_MM)

    box = [
        (left, top),
        (left + width, top),
        (left + width, top - height),
        (left, top - height),
    ]
    created.append(
        msp.add_lwpolyline(
            box,
            close=True,
            dxfattribs={"layer": layer_name, "color": color_aci},
        ),
    )

    title = msp.add_text(
        TITLE,
        dxfattribs={
            "layer": layer_name,
            "color": color_aci,
            "height": mm(TITLE_HEIGHT_MM),
        },
    )
    title.set_placement((left + mm(PADDING_MM), top - mm(PADDING_MM + TITLE_HEIGHT_MM)))
    created.append(title)

    row_top = top - mm(PADDING_MM + TITLE_HEIGHT_MM + ROW_HEIGHT_MM * 0.8)
    for index, (symbol, count) in enumerate(entries):
        row_y = row_top - mm(ROW_HEIGHT_MM) * index
        symbol_x = left + mm(SYMBOL_COLUMN_MM * 0.5)
        # Wall symbols sit on the wall and grow upward, so the sample is drawn
        # from a baseline half a row below the text.
        symbol_y = row_y - mm(ROW_HEIGHT_MM * 0.3)
        created.extend(
            _draw_sample(
                msp,
                symbol,
                layer_name=layer_name,
                color_aci=symbol.color_aci,
                scale=scale,
                at=(symbol_x, symbol_y),
            ),
        )

        text = msp.add_text(
            f"{symbol.label or symbol.element}   ({count})",
            dxfattribs={
                "layer": layer_name,
                "color": color_aci,
                "height": mm(TEXT_HEIGHT_MM),
            },
        )
        text.set_placement((left + mm(TEXT_COLUMN_MM), row_y - mm(TEXT_HEIGHT_MM * 0.4)))
        created.append(text)

    return created


def _draw_sample(
    msp: Any,
    symbol: SymbolDef,
    *,
    layer_name: str,
    color_aci: int,
    scale: float,
    at: tuple[float, float],
) -> list[Any]:
    """One legend sample, drawn as plain geometry rather than a block insert.

    Inserting the block would make the sample count as a placed component in
    every downstream tally; the legend must describe the plan, not change it.
    """
    attribs = {"layer": layer_name, "color": color_aci}
    x0, y0 = at
    created: list[Any] = []
    for primitive in symbol_primitives(symbol):
        kind = primitive[0]
        if kind == "circle":
            _, cx, cy, radius = primitive
            created.append(
                msp.add_circle(
                    (x0 + cx * scale, y0 + cy * scale),
                    radius * scale,
                    dxfattribs=attribs,
                ),
            )
        elif kind == "line":
            _, x1, y1, x2, y2 = primitive
            created.append(
                msp.add_line(
                    (x0 + x1 * scale, y0 + y1 * scale),
                    (x0 + x2 * scale, y0 + y2 * scale),
                    dxfattribs=attribs,
                ),
            )
        elif kind == "arc":
            _, cx, cy, radius, start, end = primitive
            created.append(
                msp.add_arc(
                    (x0 + cx * scale, y0 + cy * scale),
                    radius * scale,
                    start,
                    end,
                    dxfattribs=attribs,
                ),
            )
    return created


def legend_origin(
    points: list[tuple[float, float]],
    scale: float,
) -> tuple[float, float] | None:
    """Top-left corner of the legend: clear of the components, aligned to their top.

    Anchored to what was drawn rather than to the classified bounding box. On a
    real drawing that box also swallows title blocks and site work far from the
    plan, which parked the legend hundreds of metres away from anything.
    """
    if not points:
        return None
    max_x = max(point[0] for point in points)
    max_y = max(point[1] for point in points)
    return (max_x + GAP_FROM_PLAN_MM * scale, max_y)
