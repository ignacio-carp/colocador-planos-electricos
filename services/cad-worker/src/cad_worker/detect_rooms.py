"""Experimental deterministic room detection: polygonize wall segments.

Rooms in a floor plan are closed regions bounded by the walls we already
extract as vectors. shapely's polygonize finds those closed faces
deterministically: same plan, same rooms, every run. The LLM keeps the
semantic half (labelling each polygon dormitorio/cocina/...), never the shape.

Status: validated against synthetic single-line-wall fixtures. Real plans with
double-line walls produce extra thin faces (wall cavities) which are filtered
by area and aspect heuristics — needs validation with real studio DXFs before
replacing vision_layout. shapely is an optional dependency (dev extra); the
operation degrades to an explicit error when missing.
"""

from __future__ import annotations

import json
from typing import Any

from cad_worker.symbol_catalog import drawing_units_per_meter

# Faces smaller than this are noise or wall cavities; larger than max are the
# building outline. Both in real m², converted through drawing units.
MIN_ROOM_AREA_M2 = 1.0
MAX_ROOM_AREA_M2 = 400.0
# Thin-face filter: wall cavities have tiny width relative to perimeter.
MIN_WIDTH_M = 0.6

SHAPELY_MISSING_CODE = "SHAPELY_MISSING"


def detect_rooms_from_walls(
    geometry: dict[str, Any],
    insunits: int | None = None,
) -> dict[str, Any]:
    """Detect closed room polygons from extracted wall segments."""
    try:
        from shapely.geometry import LineString
        from shapely.ops import polygonize, unary_union
    except ImportError as e:  # pragma: no cover - environment dependent
        return {
            "ok": False,
            "code": SHAPELY_MISSING_CODE,
            "error": f"shapely is required for detect-rooms: {e}",
        }

    walls = geometry.get("paredes")
    if not isinstance(walls, list) or not walls:
        return {"ok": False, "code": "NO_WALLS", "error": "geometry has no wall segments"}

    lines = []
    for wall in walls:
        if not isinstance(wall, dict):
            continue
        start, end = wall.get("inicio"), wall.get("fin")
        if (
            isinstance(start, (list, tuple))
            and isinstance(end, (list, tuple))
            and len(start) >= 2
            and len(end) >= 2
        ):
            a = (float(start[0]), float(start[1]))
            b = (float(end[0]), float(end[1]))
            if a != b:
                lines.append(LineString([a, b]))
    if not lines:
        return {"ok": False, "code": "NO_WALLS", "error": "no valid wall segments"}

    du_per_m = drawing_units_per_meter(insunits, None, geometry)
    merged = unary_union(lines)
    faces = list(polygonize(merged))

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
        exterior = list(face.exterior.coords)[:-1]  # drop closing duplicate
        rooms.append(
            {
                "polygon": {
                    "vertices": [
                        {"x": round(float(x), 3), "y": round(float(y), 3)} for x, y in exterior
                    ],
                },
                "area_m2": round(area_m2, 2),
            },
        )

    # Deterministic order: by area desc, then min vertex for stable ties.
    rooms.sort(
        key=lambda r: (
            -r["area_m2"],
            min((v["x"], v["y"]) for v in r["polygon"]["vertices"]),
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
        "detector": "polygonize-v0 (experimental)",
    }


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
