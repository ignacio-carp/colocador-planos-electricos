"""Extract walls and text labels from a DXF modelspace."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import ezdxf

from cad_worker.constants import OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.dxf_io import open_dxf_file

ELECTRICAL_LAYER_NAME = OUTPUT_ELECTRICAL_LAYER_NAME


def _point_xy(value: Any) -> list[float] | None:
    if value is None:
        return None
    if hasattr(value, "x") and hasattr(value, "y"):
        return [float(value.x), float(value.y)]
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return [float(value[0]), float(value[1])]
    return None


def extract_geometry(dxf_path: str | Path) -> dict[str, object]:
    doc = open_dxf_file(dxf_path)
    msp = doc.modelspace()
    paredes: list[dict[str, list[float]]] = []
    etiquetas_texto: list[dict[str, object]] = []

    for entity in msp:
        dxftype = entity.dxftype()
        if dxftype == "LINE":
            start = _point_xy(entity.dxf.start)
            end = _point_xy(entity.dxf.end)
            if start and end:
                paredes.append({"inicio": start, "fin": end})
        elif dxftype == "LWPOLYLINE":
            points = [_point_xy(p) for p in entity.get_points(format="xy")]
            valid = [p for p in points if p is not None]
            for i in range(len(valid) - 1):
                paredes.append({"inicio": valid[i], "fin": valid[i + 1]})
            if entity.closed and len(valid) > 2:
                paredes.append({"inicio": valid[-1], "fin": valid[0]})
        elif dxftype == "TEXT":
            pos = _point_xy(entity.dxf.insert)
            text = (entity.dxf.text or "").strip()
            if pos and text:
                etiquetas_texto.append({"texto": text, "posicion": pos})
        elif dxftype == "MTEXT":
            pos = _point_xy(entity.dxf.insert)
            text = (entity.plain_text() or "").strip()
            if pos and text:
                etiquetas_texto.append({"texto": text, "posicion": pos})

    return {"paredes": paredes, "etiquetas_texto": etiquetas_texto}


def geometry_bounding_box(geometry: dict[str, object]) -> dict[str, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for wall in geometry.get("paredes", []):
        if not isinstance(wall, dict):
            continue
        for key in ("inicio", "fin"):
            pt = wall.get(key)
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
    for label in geometry.get("etiquetas_texto", []):
        if not isinstance(label, dict):
            continue
        pos = label.get("posicion")
        if isinstance(pos, (list, tuple)) and len(pos) >= 2:
            xs.append(float(pos[0]))
            ys.append(float(pos[1]))
    if not xs or not ys:
        return None
    return {"min_x": min(xs), "max_x": max(xs), "min_y": min(ys), "max_y": max(ys)}


def point_inside_bbox(x: float, y: float, bbox: dict[str, float], margin: float = 0.0) -> bool:
    return (
        bbox["min_x"] - margin <= x <= bbox["max_x"] + margin
        and bbox["min_y"] - margin <= y <= bbox["max_y"] + margin
    )


def extract_geometry_cmd(input_path: str) -> int:
    try:
        payload = extract_geometry(Path(input_path))
        print(json.dumps({"ok": True, **payload}))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_DXF"}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
