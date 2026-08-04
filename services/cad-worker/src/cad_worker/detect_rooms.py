"""Deterministic room detection: raster flood-fill seeded by the drawing's own labels.

Two strategies, tried in order:

1. **Label-seeded flood fill** (real plans). The architect already named every
   room. For each name we rasterize walls and joinery around it and flood-fill
   the free space from the label's insertion point. Raster tolerates what vector
   booleans cannot: hairline gaps at wall joints, overshooting lines, doorways
   bridged by a door leaf and its swing arc.

2. **Polygonize** (single-line-wall fixtures). shapely finds the closed faces of
   the wall graph. Exact when walls are one clean loop, useless on real
   double-line plans, which is why it is the fallback and not the default.

Measured on ``fixtures/real/cambre-vivienda-limpio.dxf``: polygonize returns 2
rooms (one a 159 m² blob spanning the whole floor) against 38 labelled rooms.
The strategy used is reported in ``detector`` so the caller never has to guess.

Neither strategy invents geometry. A room whose fill escapes its search window
or swallows another room's label is reported unresolved, with the reason.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

from cad_worker.room_labels import RoomLabel, area_warning, collect_room_labels
from cad_worker.unit_resolution import UnitResolution, resolve_drawing_units

# Faces smaller than this are noise or wall cavities; larger than max are the
# building outline. Both in real m², converted through drawing units.
MIN_ROOM_AREA_M2 = 1.0
MAX_ROOM_AREA_M2 = 400.0
# Thin-face filter: wall cavities have tiny width relative to perimeter.
MIN_WIDTH_M = 0.6

SHAPELY_MISSING_CODE = "SHAPELY_MISSING"
RASTER_MISSING_CODE = "RASTER_DEPS_MISSING"

# Flood-fill parameters, all expressed in real metres and converted per plan.
PIXEL_SIZE_M = 0.02
BARRIER_WIDTH_M = 0.04
# Most rooms fit in 9 m; the window only grows for the ones that do not, so the
# common case rasterizes 450x450 px instead of 1300x1300.
SEARCH_WINDOW_M = 9.0
SEARCH_WINDOW_GROWTH = 2.0
MAX_WINDOW_ATTEMPTS = 3
MAX_RASTER_PIXELS = 2000

# Doorway sealing. Real walls are closed double-line outlines (often hatched
# solids), so a doorway is not a gap in a line with two free ends — it is a void
# between two wall bodies, and the door is drawn open. Morphological closing of
# the barrier mask seals any void narrower than twice the radius while restoring
# wall thickness everywhere else.
#
# The radius is chosen per room, not globally: a 1.0 m corridor would be sealed
# shut by the radius a 0.9 m doorway needs. Each label tries radii in order and
# keeps the first fill that measures like a room, so a corridor resolves at 0.0
# and a room behind a wide opening resolves at 0.5 without either breaking the
# other.
CLOSING_RADII_M = (0.0, 0.12, 0.25, 0.40, 0.55)
# A labelled room may legitimately be large (an open living-dining), but a fill
# beyond this has leaked through an unclosed doorway.
MAX_LABELLED_ROOM_AREA_M2 = 120.0
MIN_LABELLED_ROOM_AREA_M2 = 0.8
# Contour simplification, as a multiple of the pixel size: removes the staircase
# left by marching squares without moving a wall by more than ~3 cm.
SIMPLIFY_PIXELS = 1.5

UNRESOLVED_LEAKED = "fill_escaped_window"
UNRESOLVED_TOO_LARGE = "fill_larger_than_a_room"
UNRESOLVED_TOO_SMALL = "fill_smaller_than_a_room"
UNRESOLVED_NO_CONTOUR = "fill_has_no_usable_contour"
UNRESOLVED_SEED_ON_BARRIER = "label_sits_on_a_wall"


def _segments(geometry: dict[str, Any], key: str) -> list[tuple[float, float, float, float]]:
    out: list[tuple[float, float, float, float]] = []
    items = geometry.get(key)
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        start, end = item.get("inicio"), item.get("fin")
        if not isinstance(start, (list, tuple)) or not isinstance(end, (list, tuple)):
            continue
        if len(start) < 2 or len(end) < 2:
            continue
        try:
            x0, y0, x1, y1 = float(start[0]), float(start[1]), float(end[0]), float(end[1])
        except (TypeError, ValueError):
            continue
        if all(math.isfinite(value) for value in (x0, y0, x1, y1)):
            out.append((x0, y0, x1, y1))
    return out


def _polygon_area(vertices: list[tuple[float, float]]) -> float:
    if len(vertices) < 3:
        return 0.0
    total = 0.0
    for index, (x1, y1) in enumerate(vertices):
        x2, y2 = vertices[(index + 1) % len(vertices)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _point_in_polygon(point: tuple[float, float], vertices: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    count = len(vertices)
    for index in range(count):
        x1, y1 = vertices[index]
        x2, y2 = vertices[(index + 1) % count]
        if (y1 > y) != (y2 > y):
            t = (y - y1) / (y2 - y1) if y2 != y1 else 0.0
            if x < x1 + t * (x2 - x1):
                inside = not inside
    return inside


Segment = tuple[float, float, float, float]


class _SegmentGrid:
    """Uniform grid index over segments, so a window query is O(window), not O(all).

    Without it every label rasterizes all ~28 000 segments of a full house plan;
    with 33 labels that is a million Python iterations per run.
    """

    def __init__(self, segments: list[Segment], cell: float) -> None:
        self.cell = max(cell, 1e-9)
        self.buckets: dict[tuple[int, int], list[Segment]] = {}
        for segment in segments:
            x0, y0, x1, y1 = segment
            for key in self._cells(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)):
                self.buckets.setdefault(key, []).append(segment)

    def _cells(self, min_x: float, min_y: float, max_x: float, max_y: float):
        cx0, cx1 = int(math.floor(min_x / self.cell)), int(math.floor(max_x / self.cell))
        cy0, cy1 = int(math.floor(min_y / self.cell)), int(math.floor(max_y / self.cell))
        for cx in range(cx0, cx1 + 1):
            for cy in range(cy0, cy1 + 1):
                yield (cx, cy)

    def query(self, min_x: float, min_y: float, max_x: float, max_y: float) -> list[Segment]:
        seen: set[int] = set()
        out: list[Segment] = []
        for key in self._cells(min_x, min_y, max_x, max_y):
            for segment in self.buckets.get(key, ()):
                marker = id(segment)
                if marker not in seen:
                    seen.add(marker)
                    out.append(segment)
        return out


def _room_record(
    room_id: str,
    vertices: list[tuple[float, float]],
    area_m2: float,
    *,
    label: RoomLabel | None = None,
    source: str,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": room_id,
        "polygon": {
            "vertices": [{"x": round(float(x), 4), "y": round(float(y), 4)} for x, y in vertices],
        },
        "area_m2": round(area_m2, 2),
        "source": source,
    }
    if label is not None:
        record["label"] = label.text
        record["room_type"] = label.room_type
        record["label_position"] = [round(label.x, 4), round(label.y, 4)]
    return record


# --------------------------------------------------------------------------- #
# Strategy 1: label-seeded raster flood fill
# --------------------------------------------------------------------------- #


def _fill_region_around(
    label: RoomLabel,
    barriers: _SegmentGrid,
    *,
    du_per_m: float,
    window_du: float,
    closing_m: float = 0.0,
) -> tuple[list[tuple[float, float]] | None, str | None]:
    """Flood-fill free space around a label; return its contour or a failure reason."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    pixel_du = PIXEL_SIZE_M * du_per_m
    size = int(min(MAX_RASTER_PIXELS, max(64, round(window_du / pixel_du))))
    # Recompute the effective pixel size after clamping so world<->raster stays exact.
    pixel_du = window_du / size

    min_x = label.x - window_du / 2.0
    min_y = label.y - window_du / 2.0

    def to_px(x: float, y: float) -> tuple[float, float]:
        # Raster rows grow downward; flip Y so the contour comes back in world orientation.
        return ((x - min_x) / pixel_du, size - (y - min_y) / pixel_du)

    image = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(image)
    barrier_px = max(1, int(round(BARRIER_WIDTH_M * du_per_m / pixel_du)))
    max_x, max_y = min_x + window_du, min_y + window_du
    for x0, y0, x1, y1 in barriers.query(min_x, min_y, max_x, max_y):
        draw.line([to_px(x0, y0), to_px(x1, y1)], fill=255, width=barrier_px)

    if closing_m > 0.0:
        # Dilate then erode: voids narrower than the kernel (doorways) close for
        # good, everything else returns to its original thickness.
        kernel = 2 * max(1, int(round(closing_m * du_per_m / pixel_du))) + 1
        image = image.filter(ImageFilter.MaxFilter(kernel)).filter(ImageFilter.MinFilter(kernel))
        draw = ImageDraw.Draw(image)

    # Sealing the border keeps a leak inside the window, where it is detectable,
    # instead of letting the fill run off the raster and look like a valid room.
    # Drawn after closing so erosion cannot chew a hole in it.
    draw.rectangle([0, 0, size - 1, size - 1], outline=255, width=1)

    seed = to_px(label.x, label.y)
    seed_px = (int(seed[0]), int(seed[1]))
    if not (0 <= seed_px[0] < size and 0 <= seed_px[1] < size):
        return None, UNRESOLVED_LEAKED
    if image.getpixel(seed_px) != 0:
        return None, UNRESOLVED_SEED_ON_BARRIER

    ImageDraw.floodfill(image, seed_px, 128, thresh=0)
    mask = np.asarray(image) == 128

    # Touching the sealed border means the fill leaked out of the room.
    if mask[0, :].any() or mask[-1, :].any() or mask[:, 0].any() or mask[:, -1].any():
        return None, UNRESOLVED_LEAKED

    contour = _largest_contour(mask)
    if contour is None:
        return None, UNRESOLVED_NO_CONTOUR
    return [(min_x + px * pixel_du, min_y + (size - py) * pixel_du) for px, py in contour], None


def _largest_contour(mask: Any) -> list[tuple[float, float]] | None:
    """Outer ring of the filled region, in raster coordinates."""
    import contourpy
    import numpy as np

    padded = np.pad(mask.astype(float), 1, constant_values=0.0)
    generator = contourpy.contour_generator(z=padded, name="serial", line_type="SeparateCode")
    lines, _codes = generator.lines(0.5)
    best: list[tuple[float, float]] | None = None
    best_area = 0.0
    for line in lines:
        points = [(float(px) - 1.0, float(py) - 1.0) for px, py in line]
        if len(points) < 4:
            continue
        area = _polygon_area(points)
        if area > best_area:
            best_area, best = area, points
    return best


def _simplify_ring(
    vertices: list[tuple[float, float]],
    tolerance: float,
) -> list[tuple[float, float]]:
    from shapely.geometry import Polygon

    polygon = Polygon(vertices)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty:
        return vertices
    if polygon.geom_type == "MultiPolygon":
        polygon = max(polygon.geoms, key=lambda part: part.area)
    simplified = polygon.simplify(tolerance, preserve_topology=True)
    if simplified.is_empty or simplified.geom_type != "Polygon":
        simplified = polygon
    ring = list(simplified.exterior.coords)[:-1]
    return [(float(x), float(y)) for x, y in ring]


@dataclass
class _LabelAttempt:
    """Best region found for one label, and whether it is exclusively its own."""

    label: RoomLabel
    vertices: list[tuple[float, float]] | None
    area_m2: float
    closing_m: float
    contained: tuple[int, ...]
    reason: str | None


def _labels_inside(
    vertices: list[tuple[float, float]],
    labels: list[RoomLabel],
    own_index: int,
) -> tuple[int, ...]:
    """Indices of the other room labels that fall inside this region."""
    return tuple(
        index
        for index, label in enumerate(labels)
        if index != own_index and _point_in_polygon((label.x, label.y), vertices)
    )


def _resolve_label(
    index: int,
    labels: list[RoomLabel],
    barriers: _SegmentGrid,
    *,
    du_per_m: float,
    simplify_tolerance: float,
) -> _LabelAttempt:
    """Smallest closing radius whose fill measures like this label's own room.

    Radii ascend so a corridor wins at 0.0 before a larger kernel could seal it,
    and a room behind a wide opening still gets its chance further down the list.
    """
    label = labels[index]
    fallback: _LabelAttempt | None = None
    reason: str | None = None
    # Closing only ever shrinks a region, so the window that bounded the fill at
    # radius 0 bounds every larger radius: search for it once.
    window = SEARCH_WINDOW_M * du_per_m
    for closing_m in CLOSING_RADII_M:
        contour: list[tuple[float, float]] | None = None
        for _attempt in range(MAX_WINDOW_ATTEMPTS):
            contour, reason = _fill_region_around(
                label,
                barriers,
                du_per_m=du_per_m,
                window_du=window,
                closing_m=closing_m,
            )
            if contour is not None or reason != UNRESOLVED_LEAKED:
                break
            window *= SEARCH_WINDOW_GROWTH
        if contour is None:
            if reason == UNRESOLVED_SEED_ON_BARRIER:
                break
            continue

        vertices = _simplify_ring(contour, simplify_tolerance)
        area_m2 = _polygon_area(vertices) / (du_per_m * du_per_m)
        if area_m2 < MIN_LABELLED_ROOM_AREA_M2:
            reason = UNRESOLVED_TOO_SMALL
            continue
        if area_m2 > MAX_LABELLED_ROOM_AREA_M2:
            reason = UNRESOLVED_TOO_LARGE
            continue
        contained = _labels_inside(vertices, labels, index)
        attempt = _LabelAttempt(label, vertices, area_m2, closing_m, contained, None)
        if not contained:
            return attempt
        # Shared with another label: keep the tightest such region as the
        # candidate for an open-plan merge, and keep trying to separate.
        if fallback is not None and abs(area_m2 - fallback.area_m2) <= fallback.area_m2 * 0.02:
            # This radius changed nothing, so the labels share genuinely open
            # space rather than a doorway a larger kernel could seal.
            break
        if fallback is None or area_m2 < fallback.area_m2:
            fallback = attempt
    if fallback is not None:
        return fallback
    return _LabelAttempt(label, None, 0.0, 0.0, (), reason or UNRESOLVED_NO_CONTOUR)


# Merged open-plan rooms inherit the most demanding rule of the group.
MERGED_TYPE_PRIORITY = (
    "cocina",
    "lavadero",
    "bano",
    "dormitorio",
    "estar_comedor",
    "office",
    "galeria",
    "vestidor",
    "deposito",
    "escalera",
    "paso_circulacion",
    "exterior",
    "generico",
)
WARN_MERGED_PRIVATE = "MERGED_ROOM_INCLUDES_PRIVATE_SPACE"
WARN_MERGED_OVERLAP = "MERGED_ROOMS_SHARE_REGION"

# Two regions covering this much of the smaller one are the same physical space,
# whatever their labels say. Below it, ordinary neighbours touching at a wall.
OVERLAP_SAME_REGION_RATIO = 0.60


def _room_vertices(record: dict[str, Any]) -> list[tuple[float, float]]:
    polygon = record.get("polygon")
    vertices = polygon.get("vertices") if isinstance(polygon, dict) else None
    if not isinstance(vertices, list):
        return []
    return [
        (float(v["x"]), float(v["y"]))
        for v in vertices
        if isinstance(v, dict) and "x" in v and "y" in v
    ]


def _overlap_ratio(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> float:
    """Shared area as a fraction of the smaller region. 0.0 when it cannot be measured."""
    if len(a) < 3 or len(b) < 3:
        return 0.0
    try:
        from shapely.geometry import Polygon

        pa, pb = Polygon(a), Polygon(b)
        if not pa.is_valid:
            pa = pa.buffer(0)
        if not pb.is_valid:
            pb = pb.buffer(0)
        smaller = min(pa.area, pb.area)
        if smaller <= 0:
            return 0.0
        return float(pa.intersection(pb).area / smaller)
    except Exception:  # noqa: BLE001 - without shapely, overlap stays unmeasured
        return 0.0


def _merge_rooms_sharing_a_region(rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold together rooms whose polygons cover the same physical space.

    Sharing is detected by where each label's *text* sits, so two labels whose
    fills landed on the same region still emerge as two rooms whenever neither
    text falls inside the other's contour — a caption printed over the dividing
    wall is enough. On a real plan that produced a 1.5 m² SALA DE MAQUINAS and a
    2.0 m² BAÑO SERV. occupying one another completely, and each was then given
    its own quota of outlets: two symbols 8 cm apart on the same wall.

    Geometry settles what the captions could not. Merging follows the open-plan
    precedent above — one room carrying every name is truer than inventing a wall
    between them or dropping one outright.
    """
    if len(rooms) < 2:
        return rooms

    vertices = [_room_vertices(room) for room in rooms]
    order = sorted(range(len(rooms)), key=lambda i: -float(rooms[i].get("area_m2") or 0.0))
    absorbed_by: dict[int, int] = {}
    for position, index in enumerate(order):
        if index in absorbed_by:
            continue
        for other in order[position + 1 :]:
            if other in absorbed_by:
                continue
            if _overlap_ratio(vertices[index], vertices[other]) >= OVERLAP_SAME_REGION_RATIO:
                absorbed_by[other] = index

    if not absorbed_by:
        return rooms

    merged: list[dict[str, Any]] = []
    for index, room in enumerate(rooms):
        if index in absorbed_by:
            continue
        names = [str(room.get("label") or "")] + [
            str(rooms[other].get("label") or "")
            for other, keeper in absorbed_by.items()
            if keeper == index
        ]
        names = [name for name in names if name]
        if len(names) > 1:
            record = dict(room)
            record["label"] = " / ".join(names)
            record["merged_labels"] = names
            warnings = list(record.get("warnings") or [])
            warnings.append(WARN_MERGED_OVERLAP)
            record["warnings"] = warnings
            merged.append(record)
        else:
            merged.append(room)
    return merged


def _assemble_rooms(
    attempts: list[_LabelAttempt],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Exclusive regions become rooms; shared ones become one open-plan room."""
    rooms: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    shared: list[int] = []

    for index, attempt in enumerate(attempts):
        if attempt.vertices is None:
            unresolved.append({"label": attempt.label.text, "reason": attempt.reason})
        elif attempt.contained:
            shared.append(index)
        else:
            record = _room_record(
                f"room-{attempt.label.slug}",
                attempt.vertices,
                attempt.area_m2,
                label=attempt.label,
                source="label_flood_fill",
            )
            warning = area_warning(attempt.label.room_type, attempt.area_m2)
            if warning:
                record["warnings"] = [warning]
            rooms.append(record)

    # Group labels that fell into the same region. An open living-dining-kitchen
    # is genuinely one electrical ambient; reporting it as one room with all its
    # names is truer than dropping four rooms or inventing a wall between them.
    # Grouping is geometric — two rooms named "BAÑO" are not the same room.
    parent = {index: index for index in shared}

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    shared_set = set(shared)
    for index in shared:
        for other in attempts[index].contained:
            if other in shared_set:
                parent[find(index)] = find(other)

    grouped: dict[int, list[int]] = {}
    for index in shared:
        grouped.setdefault(find(index), []).append(index)

    for members in grouped.values():
        member_set = set(members)
        # The room is the tightest region that still holds every label of the
        # group; anything smaller describes only part of the open space.
        covering = [
            index
            for index in members
            if member_set <= {index, *attempts[index].contained}
        ]
        pool = covering or members
        representative = min(pool, key=lambda index: attempts[index].area_m2)
        names = [attempts[index].label.text for index in members]
        types = {attempts[index].label.room_type for index in members}
        room_type = next((t for t in MERGED_TYPE_PRIORITY if t in types), "generico")
        record = _room_record(
            f"room-{attempts[representative].label.slug}",
            attempts[representative].vertices or [],
            attempts[representative].area_m2,
            label=attempts[representative].label,
            source="label_flood_fill_merged",
        )
        record["label"] = " / ".join(names)
        record["room_type"] = room_type
        record["merged_labels"] = names
        warnings: list[str] = []
        if {"bano", "dormitorio"} & types and len(types) > 1:
            warnings.append(WARN_MERGED_PRIVATE)
        area_note = area_warning(room_type, attempts[representative].area_m2)
        if area_note:
            warnings.append(area_note)
        if warnings:
            record["warnings"] = warnings
        rooms.append(record)

    return _merge_rooms_sharing_a_region(rooms), unresolved


def _detect_rooms_from_labels(
    geometry: dict[str, Any],
    labels: list[RoomLabel],
    resolution: UnitResolution,
) -> dict[str, Any]:
    du_per_m = resolution.drawing_units_per_meter
    walls = _segments(geometry, "paredes")
    if not walls:
        return {"ok": False, "code": "NO_WALLS", "error": "geometry has no wall segments"}
    barriers = _SegmentGrid(
        walls + _segments(geometry, "aberturas"),
        SEARCH_WINDOW_M * du_per_m / 4.0,
    )

    simplify_tolerance = SIMPLIFY_PIXELS * PIXEL_SIZE_M * du_per_m
    attempts: list[_LabelAttempt] = [
        _resolve_label(
            index,
            labels,
            barriers,
            du_per_m=du_per_m,
            simplify_tolerance=simplify_tolerance,
        )
        for index in range(len(labels))
    ]

    rooms, unresolved = _assemble_rooms(attempts)

    # Stable ids even when two rooms carry the same name ("DORMITORIO" x3).
    seen: dict[str, int] = {}
    for room in rooms:
        base = str(room["id"])
        seen[base] = seen.get(base, 0) + 1
        if seen[base] > 1:
            room["id"] = f"{base}-{seen[base]:02d}"

    return {
        "ok": True,
        "rooms": rooms,
        "labels_total": len(labels),
        "labels_resolved": sum(
            len(room.get("merged_labels", [room.get("label")])) for room in rooms
        ),
        "unresolved_labels": unresolved,
        "drawing_units_per_meter": du_per_m,
        "header_insunits": resolution.header_insunits,
        "effective_insunits": resolution.effective_insunits,
        "insunits_overridden": resolution.overridden,
        "unit_confidence": resolution.confidence,
        "detector": "label-flood-fill-v1",
    }


# --------------------------------------------------------------------------- #
# Strategy 2: polygonize the wall graph (single-line-wall fixtures)
# --------------------------------------------------------------------------- #


def _detect_rooms_by_polygonize(
    geometry: dict[str, Any],
    resolution: UnitResolution,
) -> dict[str, Any]:
    try:
        from shapely.geometry import LineString
        from shapely.ops import polygonize, unary_union
    except ImportError as e:  # pragma: no cover - environment dependent
        return {
            "ok": False,
            "code": SHAPELY_MISSING_CODE,
            "error": f"shapely is required for detect-rooms: {e}",
        }

    lines = [
        LineString([(x0, y0), (x1, y1)])
        for x0, y0, x1, y1 in _segments(geometry, "paredes")
        if (x0, y0) != (x1, y1)
    ]
    if not lines:
        return {"ok": False, "code": "NO_WALLS", "error": "no valid wall segments"}

    du_per_m = resolution.drawing_units_per_meter
    faces = list(polygonize(unary_union(lines)))

    rooms: list[dict[str, Any]] = []
    discarded = {"too_small": 0, "too_large": 0, "too_thin": 0}
    for face in faces:
        area_m2 = face.area / (du_per_m * du_per_m)
        if area_m2 < MIN_ROOM_AREA_M2:
            discarded["too_small"] += 1
            continue
        if area_m2 > MAX_ROOM_AREA_M2:
            discarded["too_large"] += 1
            continue
        # Approximate width: area / (perimeter / 2) — thin faces are cavities.
        perimeter_m = face.length / du_per_m
        approx_width_m = (2.0 * area_m2 / perimeter_m) if perimeter_m > 0 else 0.0
        if approx_width_m < MIN_WIDTH_M:
            discarded["too_thin"] += 1
            continue
        exterior = [(float(x), float(y)) for x, y in list(face.exterior.coords)[:-1]]
        rooms.append(_room_record("", exterior, area_m2, source="polygonize"))

    # Deterministic order: by area desc, then min vertex for stable ties.
    rooms.sort(
        key=lambda room: (
            -room["area_m2"],
            min((v["x"], v["y"]) for v in room["polygon"]["vertices"]),
        ),
    )
    for index, room in enumerate(rooms, start=1):
        room["id"] = f"room-geo-{index:02d}"

    return {
        "ok": True,
        "rooms": rooms,
        "faces_total": len(faces),
        "faces_discarded": discarded,
        "drawing_units_per_meter": du_per_m,
        "header_insunits": resolution.header_insunits,
        "effective_insunits": resolution.effective_insunits,
        "insunits_overridden": resolution.overridden,
        "unit_confidence": resolution.confidence,
        "detector": "polygonize-v0",
    }


def detect_rooms_from_walls(
    geometry: dict[str, Any],
    insunits: int | None = None,
    *,
    unit_resolution: UnitResolution | None = None,
) -> dict[str, Any]:
    """Detect room polygons: label-seeded flood fill, falling back to polygonize."""
    if not isinstance(geometry, dict):
        return {"ok": False, "code": "NO_WALLS", "error": "geometry has no wall segments"}

    walls = geometry.get("paredes")
    if not isinstance(walls, list) or not walls:
        return {"ok": False, "code": "NO_WALLS", "error": "geometry has no wall segments"}

    resolution = unit_resolution or resolve_drawing_units(insunits, geometry, [])
    labels = collect_room_labels(geometry.get("etiquetas_texto"))
    if labels:
        try:
            result = _detect_rooms_from_labels(geometry, labels, resolution)
        except ImportError as e:
            return {
                "ok": False,
                "code": RASTER_MISSING_CODE,
                "error": f"numpy/pillow/contourpy are required for detect-rooms: {e}",
            }
        if result.get("ok") and result.get("rooms"):
            return result
    return _detect_rooms_by_polygonize(geometry, resolution)


def detect_rooms_cmd(geometry_json: str, insunits: int | None = None) -> int:
    try:
        geometry = json.loads(geometry_json)
        result = detect_rooms_from_walls(geometry, insunits)
        print(json.dumps(result, sort_keys=True))
        return 0 if result.get("ok") else 4
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_PAYLOAD"}))
        return 2
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
