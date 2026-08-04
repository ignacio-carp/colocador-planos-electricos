"""Regression tests: symbol scale is a property of the document, not of one room.

Bug fixed in electrical_layer.apply_electrical_layer: the scale sent to
compute_symbol_scale_resolution was built from `attached_polygons` (the
room_polygon carried by the current run's placements) whenever that list was
non-empty — which it always is when the caller processes one room at a time,
as the UI does. So the same DXF, wired room by room, produced nine different
symbol scales in one file (0.066667 to 0.1, a 50% spread) because each run
sized its symbols against whichever single room it happened to be given.

The fix introduces `scale_polygons = detected_polygons or attached_polygons`:
the document-wide room detection (re-derived from the input file on every
call, independent of which placement was supplied) now wins over the single
attached room whenever it finds anything.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from cad_worker.electrical_layer import apply_electrical_layer

# Two disjoint, polygonize-able rooms in the same drawing: a small toilette and
# a large living room. Both are far enough from the origin to clear the
# origin-guard disk (radius 4.5 m at 1 unit == 1 m) regardless of which one is
# attached to the placement being processed.
SMALL_ROOM = [(30.0, 30.0), (31.5, 30.0), (31.5, 32.0), (30.0, 32.0)]  # 1.5 x 2.0 m
LARGE_ROOM = [(50.0, 0.0), (58.0, 0.0), (58.0, 6.0), (50.0, 6.0)]  # 8 x 6 m


def _room_polygon(vertices: list[tuple[float, float]]) -> dict[str, object]:
    return {"vertices": [{"x": x, "y": y} for x, y in vertices]}


def _center(vertices: list[tuple[float, float]]) -> tuple[float, float]:
    xs = [v[0] for v in vertices]
    ys = [v[1] for v in vertices]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def _placement_for(vertices: list[tuple[float, float]]) -> dict[str, object]:
    x, y = _center(vertices)
    return {
        "position": {"x": x, "y": y},
        "element": "toma",
        "room_polygon": _room_polygon(vertices),
    }


def _doc_with_two_rooms() -> ezdxf.document.Drawing:
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 6  # metres
    doc.layers.new("MUROS")
    msp = doc.modelspace()
    for room in (SMALL_ROOM, LARGE_ROOM):
        for index in range(len(room)):
            start = room[index]
            end = room[(index + 1) % len(room)]
            msp.add_line(start, end, dxfattribs={"layer": "MUROS"})
    return doc


def test_symbol_scale_is_the_same_whether_the_small_or_the_large_room_is_processed(
    tmp_path: Path,
) -> None:
    """Same document, one room placed at a time: the scale must not depend on which.

    Before the fix, running with only the small room's placement sized the
    symbol against the small room's own dimensions, and running with only the
    large room's placement sized it against the large room instead — two
    different xscale values for the same plan.
    """
    src = tmp_path / "two_rooms.dxf"
    _doc_with_two_rooms().saveas(str(src))

    out_small = tmp_path / "wired_from_small.dxf"
    out_large = tmp_path / "wired_from_large.dxf"

    result_small = apply_electrical_layer(src, out_small, [_placement_for(SMALL_ROOM)])
    result_large = apply_electrical_layer(src, out_large, [_placement_for(LARGE_ROOM)])

    assert result_small["ok"] is True
    assert result_large["ok"] is True
    assert result_small["outlets_added"] == 1
    assert result_large["outlets_added"] == 1

    # Both runs must have drawn on the document-wide room detection (median
    # minor dimension across BOTH rooms), not just the single attached one —
    # otherwise this assertion, and the scale below, would differ by room.
    assert result_small["room_median_minor_dimension_m"] == pytest.approx(3.75)
    assert result_large["room_median_minor_dimension_m"] == pytest.approx(3.75)

    assert result_small["symbol_scale"] == pytest.approx(result_large["symbol_scale"])

    for out_path, result in ((out_small, result_small), (out_large, result_large)):
        out_doc = ezdxf.readfile(str(out_path))
        inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
        assert len(inserts) == 1
        assert float(inserts[0].dxf.xscale) == pytest.approx(result["symbol_scale"])

    out_small_doc = ezdxf.readfile(str(out_small))
    out_large_doc = ezdxf.readfile(str(out_large))
    xscale_small = next(e for e in out_small_doc.modelspace() if e.dxftype() == "INSERT").dxf.xscale
    xscale_large = next(e for e in out_large_doc.modelspace() if e.dxftype() == "INSERT").dxf.xscale
    assert float(xscale_small) == pytest.approx(float(xscale_large))


def test_compute_symbol_scale_resolution_ignores_which_room_is_first(tmp_path: Path) -> None:
    """Unit-level pin: the resolver reads the whole polygon list, order does not matter.

    Kept alongside the end-to-end test above because it isolates the exact
    function the bug lived in — a future change that reintroduces "use only
    the first/attached polygon" behaviour fails here even if some other part
    of apply_electrical_layer masks it.
    """
    from cad_worker.symbol_catalog import compute_symbol_scale_resolution
    from cad_worker.unit_resolution import resolve_drawing_units

    geometry: dict[str, object] = {"paredes": [], "aberturas": [], "dimensiones": []}
    resolution = resolve_drawing_units(6, geometry, [])

    small_polygon = _room_polygon(SMALL_ROOM)
    large_polygon = _room_polygon(LARGE_ROOM)

    only_small = compute_symbol_scale_resolution(resolution, [small_polygon], paper_mm=4.5)
    only_large = compute_symbol_scale_resolution(resolution, [large_polygon], paper_mm=4.5)
    both_rooms_small_first = compute_symbol_scale_resolution(
        resolution, [small_polygon, large_polygon], paper_mm=4.5,
    )
    both_rooms_large_first = compute_symbol_scale_resolution(
        resolution, [large_polygon, small_polygon], paper_mm=4.5,
    )

    # Feeding a single room in isolation is exactly the pre-fix behaviour, and
    # it really does produce two different scales — this is the bug, reproduced.
    assert only_small.final_scale != pytest.approx(only_large.final_scale)

    # The fix's contract: pass the full document-wide list, and the result no
    # longer depends on which single room a caller would have attached.
    assert both_rooms_small_first.final_scale == pytest.approx(both_rooms_large_first.final_scale)
