"""Regression tests: two labels whose fills land on the same physical space merge.

Bug fixed in detect_rooms._assemble_rooms: overlap between rooms was detected
only by whether one label's *text* insertion point fell inside the other
room's contour (_labels_inside). That misses the case where two labels each
flood-fill to the same region but neither caption happens to sit inside the
other's polygon — e.g. a caption printed over the dividing wall. On a real
Cambre plan that produced `room-sala-de-maquinas` (1.5 m2) and `room-bano-serv`
(2.0 m2) with 100% polygon overlap, each kept as its own room, each given its
own quota of outlets: two tomacorrientes 8 cm apart on what is one wall.

`_merge_rooms_sharing_a_region` closes that gap: it compares polygons
directly (via shapely intersection / area of the smaller one) after
`_assemble_rooms` has already resolved labels, so it catches overlap the
text-containment check structurally cannot see.
"""

from __future__ import annotations

from cad_worker.detect_rooms import (
    OVERLAP_SAME_REGION_RATIO,
    WARN_MERGED_OVERLAP,
    _merge_rooms_sharing_a_region,
)


def _room(
    room_id: str,
    vertices: list[tuple[float, float]],
    area_m2: float,
    label: str,
) -> dict[str, object]:
    """Build a room record shaped like `_room_record`'s output."""
    return {
        "id": room_id,
        "polygon": {"vertices": [{"x": x, "y": y} for x, y in vertices]},
        "area_m2": area_m2,
        "source": "label_flood_fill",
        "label": label,
        "room_type": "generico",
    }


def _rect(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def test_two_rooms_whose_polygons_cover_the_same_region_merge_into_the_larger_one() -> None:
    """The real defect: one room's fill sits almost entirely inside the other's.

    Mirrors the measured case (sala de maquinas / bano serv at 100% overlap):
    a smaller room's polygon is fully contained in a larger one nearby in area,
    which the label-containment check alone would have let through as two
    separate rooms.
    """
    big = _room("room-sala-de-maquinas", _rect(0.0, 0.0, 4.0, 4.0), 16.0, "SALA DE MAQUINAS")
    small = _room("room-bano-serv", _rect(0.5, 0.5, 3.5, 3.5), 9.0, "BAÑO SERV.")

    merged = _merge_rooms_sharing_a_region([big, small])

    assert len(merged) == 1
    survivor = merged[0]
    # The larger polygon is kept, not averaged or replaced.
    assert survivor["id"] == "room-sala-de-maquinas"
    assert survivor["area_m2"] == 16.0
    assert "SALA DE MAQUINAS" in survivor["label"]
    assert "BAÑO SERV." in survivor["label"]
    assert WARN_MERGED_OVERLAP in survivor["warnings"]


def test_neighbouring_rooms_that_only_share_a_wall_stay_separate() -> None:
    """Two rooms touching along one edge have ~0% area overlap: not the same defect."""
    left = _room("room-cocina", _rect(0.0, 0.0, 4.0, 4.0), 16.0, "COCINA")
    right = _room("room-comedor", _rect(4.0, 0.0, 8.0, 4.0), 16.0, "COMEDOR")

    merged = _merge_rooms_sharing_a_region([left, right])

    assert len(merged) == 2
    ids = {room["id"] for room in merged}
    assert ids == {"room-cocina", "room-comedor"}
    assert all("warnings" not in room for room in merged)


def test_a_single_room_passes_through_unchanged() -> None:
    """Nothing to compare against: the merge is a no-op, not an error."""
    only = _room("room-living", _rect(0.0, 0.0, 5.0, 5.0), 25.0, "LIVING")

    merged = _merge_rooms_sharing_a_region([only])

    assert merged == [only]


def test_partial_overlap_below_the_060_ratio_does_not_merge() -> None:
    """Below OVERLAP_SAME_REGION_RATIO the rooms are ordinary neighbours, not one space.

    Two equal-area rectangles offset so their intersection covers 40% of
    either one (well under the 0.60 threshold that triggers a merge) —
    exercises the boundary the fix relies on, not just the 100%-overlap case.
    """
    assert OVERLAP_SAME_REGION_RATIO == 0.60

    # Each rectangle is 5 x 4 = 20 m2; overlap strip is 2 x 4 = 8 m2 => ratio 0.4.
    left = _room("room-a", _rect(0.0, 0.0, 5.0, 4.0), 20.0, "A")
    right = _room("room-b", _rect(3.0, 0.0, 8.0, 4.0), 20.0, "B")

    merged = _merge_rooms_sharing_a_region([left, right])

    assert len(merged) == 2
    assert all("warnings" not in room for room in merged)
