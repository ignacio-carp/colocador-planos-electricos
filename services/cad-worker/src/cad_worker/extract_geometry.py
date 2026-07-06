"""Extract walls, openings and furniture from a DXF modelspace (other entities discarded)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

import ezdxf

from cad_worker.constants import OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.dxf_io import open_dxf_file

ELECTRICAL_LAYER_NAME = OUTPUT_ELECTRICAL_LAYER_NAME

LayerKind = Literal["pared", "mueble", "abertura"]

# Layer-name tokens used to classify entities for the electrical analysis.
WALL_LAYER_TOKENS = ("wall", "pared", "muro", "a-wall", "partition", "tabique")
OPENING_LAYER_TOKENS = (
    "door",
    "puerta",
    "ventana",
    "window",
    "opening",
    "abertura",
    "a-door",
    "a-glaz",
    "glazing",
)
FURNITURE_LAYER_TOKENS = (
    "mobili",
    "furnitur",
    "mueble",
    "equip",
    "a-furn",
    "sanitari",
)


def classify_layer(name: str | None) -> LayerKind | None:
    """Classify a DXF layer name as pared | mueble | abertura (None when discarded)."""
    if not name:
        return None
    lowered = name.strip().lower()
    if any(token in lowered for token in FURNITURE_LAYER_TOKENS):
        return "mueble"
    if any(token in lowered for token in OPENING_LAYER_TOKENS):
        return "abertura"
    if any(token in lowered for token in WALL_LAYER_TOKENS):
        return "pared"
    return None


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
    paredes: list[dict[str, object]] = []
    aberturas: list[dict[str, object]] = []
    muebles: list[dict[str, object]] = []
    capas: dict[str, set[str]] = {"paredes": set(), "aberturas": set(), "muebles": set()}

    def _entity_layer(entity: Any) -> str | None:
        layer = getattr(entity.dxf, "layer", None)
        return str(layer) if layer else None

    def _add_segments(
        entity: Any,
        segments: list[tuple[list[float], list[float]]],
        kind: LayerKind,
    ) -> None:
        layer = _entity_layer(entity)
        if classify_layer(layer) != kind:
            return
        capa_key = {"pared": "paredes", "abertura": "aberturas", "mueble": "muebles"}[kind]
        capas[capa_key].add(layer or "")
        target = {"pared": paredes, "abertura": aberturas, "mueble": muebles}[kind]
        for start, end in segments:
            item: dict[str, object] = {"inicio": start, "fin": end}
            if layer:
                item["capa"] = layer
            target.append(item)

    for entity in msp:
        dxftype = entity.dxftype()
        if dxftype == "LINE":
            start = _point_xy(entity.dxf.start)
            end = _point_xy(entity.dxf.end)
            if start and end:
                layer = _entity_layer(entity)
                kind = classify_layer(layer)
                if kind in ("pared", "abertura"):
                    _add_segments(entity, [(start, end)], kind)
        elif dxftype == "LWPOLYLINE":
            points = [_point_xy(p) for p in entity.get_points(format="xy")]
            valid = [p for p in points if p is not None]
            segments: list[tuple[list[float], list[float]]] = []
            for i in range(len(valid) - 1):
                segments.append((valid[i], valid[i + 1]))
            if entity.closed and len(valid) > 2:
                segments.append((valid[-1], valid[0]))
            if segments:
                layer = _entity_layer(entity)
                kind = classify_layer(layer)
                if kind in ("pared", "abertura"):
                    _add_segments(entity, segments, kind)
        elif dxftype == "INSERT":
            layer = _entity_layer(entity)
            if classify_layer(layer) != "mueble":
                continue
            pos = _point_xy(entity.dxf.insert)
            block_name = str(getattr(entity.dxf, "name", "") or "")
            if pos:
                capas["muebles"].add(layer or "")
                muebles.append({"bloque": block_name, "posicion": pos, "capa": layer})

    return {
        "paredes": paredes,
        "aberturas": aberturas,
        "muebles": muebles,
        "capas_clasificadas": {
            key: sorted(value for value in values if value) for key, values in capas.items()
        },
    }


def point_inside_bbox(
    x: float,
    y: float,
    bbox: dict[str, float],
    *,
    margin: float = 0.0,
) -> bool:
    return (
        bbox["min_x"] - margin <= x <= bbox["max_x"] + margin
        and bbox["min_y"] - margin <= y <= bbox["max_y"] + margin
    )


def geometry_bounding_box(geometry: dict[str, object]) -> dict[str, float] | None:
    xs: list[float] = []
    ys: list[float] = []

    def _collect_segment_points(wall: dict[str, object]) -> None:
        for key in ("inicio", "fin"):
            pt = wall.get(key)
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))

    for wall in geometry.get("paredes", []):
        if isinstance(wall, dict):
            _collect_segment_points(wall)
    for opening in geometry.get("aberturas", []):
        if isinstance(opening, dict):
            _collect_segment_points(opening)
    for item in geometry.get("muebles", []):
        if not isinstance(item, dict):
            continue
        pos = item.get("posicion")
        if isinstance(pos, (list, tuple)) and len(pos) >= 2:
            xs.append(float(pos[0]))
            ys.append(float(pos[1]))
    if not xs or not ys:
        return None
    return {"min_x": min(xs), "max_x": max(xs), "min_y": min(ys), "max_y": max(ys)}


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
