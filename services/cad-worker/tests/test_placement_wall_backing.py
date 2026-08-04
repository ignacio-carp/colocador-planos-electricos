"""An outlet may only sit where a wall was actually found.

The placer used to carve its usable spans out of the room's boundary and treat
walls as mere evidence. On a real plan that made the open side of a gallery — a
boundary drawn as paving, with no wall behind it — the *longest* free span in
the room, and the candidate ranking prefers the longest. Outlets came out up to
seven metres from the nearest wall, each recorded as sitting on a "tramo útil de
pared". These tests pin the boundary between what was measured and what was
assumed.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pytest

from cad_worker.placement import (
    WARN_NO_VERIFIED_WALL,
    place_outlets_for_room,
)

RULES_PATH = (
    Path(__file__).resolve().parents[3]
    / "rules"
    / "cambre-normative"
    / "2026.07.2"
    / "rules.json"
)

# A 4 m × 3 m room in metres, matching INSUNITS=6.
ROOM = [(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)]


def _rules() -> dict[str, Any]:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


def _wall(x1: float, y1: float, x2: float, y2: float) -> dict[str, Any]:
    return {"inicio": [x1, y1], "fin": [x2, y2], "capa": "MUROS"}


def _polygon(vertices: list[tuple[float, float]]) -> dict[str, Any]:
    return {"vertices": [{"x": x, "y": y} for x, y in vertices]}


def _place(
    walls: list[dict[str, Any]],
    *,
    vertices: list[tuple[float, float]] | None = None,
    room_type: str = "generico",
) -> dict[str, Any]:
    payload = {
        "room": {
            "id": "room-test",
            "room_type": room_type,
            "polygon": _polygon(vertices or ROOM),
        },
        "geometry": {"paredes": walls, "aberturas": [], "muebles": []},
        "rules": _rules(),
        "insunits": 6,
    }
    return place_outlets_for_room(payload)


def _positions(result: dict[str, Any], *, element: str = "toma") -> list[tuple[float, float]]:
    """Positions of wall-mounted components only.

    ``outlet_placements`` also carries ceiling lights, which belong in the middle
    of the room and say nothing about walls.
    """
    out = []
    for item in result.get("outlet_placements") or []:
        if element not in str(item.get("element") or "").lower():
            continue
        position = item.get("position") or {}
        if isinstance(position, dict) and "x" in position:
            out.append((float(position["x"]), float(position["y"])))
    return out


def _distance_to_walls(point: tuple[float, float], walls: list[dict[str, Any]]) -> float:
    best = math.inf
    px, py = point
    for wall in walls:
        (ax, ay), (bx, by) = wall["inicio"], wall["fin"]
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            best = min(best, math.hypot(px - ax, py - ay))
            continue
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
    return best


THREE_WALLS = [
    _wall(0.0, 0.0, 4.0, 0.0),  # south
    _wall(4.0, 0.0, 4.0, 3.0),  # east
    _wall(0.0, 0.0, 0.0, 3.0),  # west
]  # the north side (y = 3) is open: a gallery edge, not a wall


def test_outlets_never_land_on_a_boundary_with_no_wall_behind_it() -> None:
    result = _place(THREE_WALLS)
    assert result["drawing_units_per_meter"] == pytest.approx(1.0)
    positions = _positions(result)
    assert positions, "the three walled sides must still receive outlets"
    for x, y in positions:
        assert y < 2.9, f"outlet at ({x:.2f}, {y:.2f}) sits on the open north side"
        assert _distance_to_walls((x, y), THREE_WALLS) < 0.10


def test_the_open_side_does_not_inflate_how_many_outlets_are_required() -> None:
    """Required count follows wall, not boundary.

    The open side used to enter the usable perimeter, asking for outlets that
    were then placed on that same open air: the defect funded itself.
    """
    # Large enough that the normative count follows perimeter rather than the
    # per-room minimum, which a 4 m × 3 m room never exceeds.
    big = [(0.0, 0.0), (12.0, 0.0), (12.0, 9.0), (0.0, 9.0)]
    open_side = [
        _wall(0.0, 0.0, 12.0, 0.0),
        _wall(12.0, 0.0, 12.0, 9.0),
        _wall(0.0, 0.0, 0.0, 9.0),
    ]
    # "living" is a rule with spacing_along_wall_m; the generic rule has only a
    # minimum, so it could never show the difference.
    three = _place(open_side, vertices=big, room_type="living")["required_outlets"]
    four = _place(
        [*open_side, _wall(0.0, 9.0, 12.0, 9.0)],
        vertices=big,
        room_type="living",
    )["required_outlets"]
    assert three < four


def test_a_room_with_no_verified_wall_reports_instead_of_placing() -> None:
    """A terrace whose outline is paving carries no outlets, and says so."""
    far_away = [_wall(50.0, 50.0, 54.0, 50.0)]
    result = _place(far_away)
    assert _positions(result) == []
    assert WARN_NO_VERIFIED_WALL in result["warnings"]


def test_a_wall_running_past_the_corner_keeps_the_outlet_inside_the_room() -> None:
    """Projection runs along the infinite line, so it must be clamped to the edge.

    A wall shared with the neighbouring room overshoots the corner. Unclamped,
    its interval reaches beyond the edge and the outlet lands outside the room —
    caught by the real-plan acceptance gate, not by any synthetic fixture.
    """
    overshooting = [
        _wall(-6.0, 0.0, 10.0, 0.0),
        _wall(4.0, -6.0, 4.0, 9.0),
        _wall(0.0, -6.0, 0.0, 9.0),
    ]
    for x, y in _positions(_place(overshooting)):
        assert -0.01 <= x <= 4.01, f"x={x:.3f} fell past the room edge"
        assert -0.01 <= y <= 3.01, f"y={y:.3f} fell past the room edge"


def test_a_partially_backed_edge_only_offers_its_backed_stretch() -> None:
    """Half a wall is half a span, not a whole edge."""
    half_backed = [
        _wall(0.0, 0.0, 2.0, 0.0),  # only the western half of the south side
        _wall(4.0, 0.0, 4.0, 3.0),
        _wall(0.0, 0.0, 0.0, 3.0),
    ]
    for x, y in _positions(_place(half_backed)):
        if y < 0.10:  # sitting on the south side
            assert x <= 2.05, f"outlet at x={x:.2f} sits on the unbuilt half"
