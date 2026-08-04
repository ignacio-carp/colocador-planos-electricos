"""The legend must describe the plan, not the run that happened to draw it.

The UI processes a plan room by room. Both the legend's tally and its anchor
were taken from the placements of the current run, so on a real job the file
ended up with a legend that declared four components on a plan carrying a
hundred and four, parked on top of the living room because the first room
processed happened to sit there. A wrong count is precisely what an architect
opens the legend to catch.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf

from cad_worker.constants import OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.electrical_layer import CAMBRE_APPID, apply_electrical_layer
from cad_worker.symbol_legend import LEGEND_ROOM_ID

ROOM_POLYGON = {
    "vertices": [
        {"x": 0, "y": -500},
        {"x": 6000, "y": -500},
        {"x": 6000, "y": 4000},
        {"x": 0, "y": 4000},
    ],
}


def _placement(x: float, y: float, *, element: str = "toma") -> dict[str, object]:
    return {
        "position": {"x": x, "y": y, "unit": "drawing_units"},
        "element": element,
        "room_polygon": ROOM_POLYGON,
    }


def _source(path: Path) -> None:
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (6000, 0))
    doc.saveas(str(path))


def _legend_entities(path: Path) -> list:
    doc = ezdxf.readfile(str(path))
    out = []
    for entity in doc.modelspace():
        if entity.dxf.layer != OUTPUT_ELECTRICAL_LAYER_NAME:
            continue
        try:
            tags = entity.get_xdata(CAMBRE_APPID)
        except Exception:  # noqa: BLE001 - untagged entities are not the legend
            continue
        if tags and str(tags[0][1]) == LEGEND_ROOM_ID:
            out.append(entity)
    return out


def _legend_texts(path: Path) -> list[str]:
    return [e.dxf.text for e in _legend_entities(path) if e.dxftype() == "TEXT"]


def _legend_count_for(path: Path, needle: str) -> int | None:
    """The number the legend prints beside a symbol, e.g. 'Tomacorriente 10 A   (3)'."""
    for text in _legend_texts(path):
        if needle.lower() in text.lower() and "(" in text:
            return int(text.rsplit("(", 1)[1].rstrip(")").strip())
    return None


def test_legend_counts_every_component_on_the_layer_not_only_this_run(
    tmp_path: Path,
) -> None:
    src = tmp_path / "in.dxf"
    out1 = tmp_path / "out1.dxf"
    out2 = tmp_path / "out2.dxf"
    _source(src)

    apply_electrical_layer(
        src,
        out1,
        [_placement(500, 0), _placement(1500, 0)],
        room_id="room-cocina",
    )
    assert _legend_count_for(out1, "tomacorriente") == 2

    # Second room, drawn onto the first run's output the way the UI does it.
    apply_electrical_layer(out1, out2, [_placement(2500, 0)], room_id="room-living")

    total = _legend_count_for(out2, "tomacorriente")
    assert total == 3, (
        f"the legend says {total} outlets; the layer carries 3. A legend that "
        "counts only the current run is worse than no legend at all."
    )


def test_legend_is_rebuilt_rather_than_stacked(tmp_path: Path) -> None:
    """Reprocessing must not leave two legends on the layer."""
    src = tmp_path / "in.dxf"
    out1 = tmp_path / "out1.dxf"
    out2 = tmp_path / "out2.dxf"
    _source(src)

    apply_electrical_layer(src, out1, [_placement(500, 0)], room_id="room-cocina")
    apply_electrical_layer(out1, out2, [_placement(2500, 0)], room_id="room-living")

    titles = [t for t in _legend_texts(out2) if "SIMBOLOGIA" in t.upper()]
    assert len(titles) == 1


def test_legend_clears_every_component_on_the_plan_not_just_the_first_room(
    tmp_path: Path,
) -> None:
    """Anchored to the whole drawing, so it cannot land on a room drawn later.

    The anchor used to be the rightmost component of the current run. Processing
    room by room, that is the edge of one room, which on the Cambre plan dropped
    the legend inside the living room.
    """
    src = tmp_path / "in.dxf"
    out1 = tmp_path / "out1.dxf"
    out2 = tmp_path / "out2.dxf"
    _source(src)

    # Ordering matters: the run that draws last sits on the LEFT. Anchoring to
    # the current run therefore parks the legend in the middle of the drawing,
    # right on top of the component placed earlier on the right. Anchoring to
    # the whole layer clears both.
    apply_electrical_layer(src, out1, [_placement(5000, 0)], room_id="room-living")
    apply_electrical_layer(out1, out2, [_placement(500, 0)], room_id="room-cocina")

    legend_xs = []
    for entity in _legend_entities(out2):
        if entity.dxftype() == "TEXT":
            legend_xs.append(entity.dxf.insert.x)
        elif entity.dxftype() == "LWPOLYLINE":
            legend_xs.extend(point[0] for point in entity.get_points("xy"))
    assert legend_xs, "the legend must exist"

    doc = ezdxf.readfile(str(out2))
    component_xs = [
        e.dxf.insert.x
        for e in doc.modelspace()
        if e.dxf.layer == OUTPUT_ELECTRICAL_LAYER_NAME and e.dxftype() == "INSERT"
    ]
    assert min(legend_xs) > max(component_xs), (
        "the legend overlaps the components it is meant to describe"
    )
