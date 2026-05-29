"""Add INSTALACION_ELECTRICA layer with outlet markers to a DXF copy."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import ezdxf

from cad_worker.dxf_io import open_dxf_file
from cad_worker.extract_geometry import (
    ELECTRICAL_LAYER_NAME,
    extract_geometry,
    geometry_bounding_box,
    point_inside_bbox,
)

logger = logging.getLogger(__name__)

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"


PlacementPoint = tuple[float, float, dict[str, object]]


def _normalize_placements(raw: list[dict[str, object]]) -> list[PlacementPoint]:
    """Accept outlet_placements ({position:{x,y}}) or nuevas_tomas ({coordenadas:[x,y]})."""
    normalized: list[PlacementPoint] = []
    for item in raw:
        x: float | None = None
        y: float | None = None
        pos = item.get("position")
        if isinstance(pos, dict):
            px, py = pos.get("x"), pos.get("y")
            if isinstance(px, (int, float)) and isinstance(py, (int, float)):
                x, y = float(px), float(py)
        coords = item.get("coordenadas")
        if x is None and isinstance(coords, (list, tuple)) and len(coords) >= 2:
            x, y = float(coords[0]), float(coords[1])
        if x is None or y is None:
            continue
        normalized.append((x, y, item))
    return normalized


def apply_electrical_layer(
    input_path: Path,
    output_path: Path,
    placements: list[dict[str, object]],
    *,
    bbox_margin: float = 500.0,
) -> dict[str, object]:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    doc = open_dxf_file(input_path)
    layer_name = ELECTRICAL_LAYER_NAME
    if layer_name not in [layer.dxf.name for layer in doc.layers]:
        doc.layers.new(name=layer_name, dxfattribs={"color": 1})

    geometry = extract_geometry(input_path)
    bbox = geometry_bounding_box(geometry)
    skipped_out_of_bbox = 0

    msp = doc.modelspace()
    added = 0
    radius = 150.0
    for x, y, _item in _normalize_placements(placements):
        if bbox is not None and not point_inside_bbox(x, y, bbox, margin=bbox_margin):
            skipped_out_of_bbox += 1
            logger.warning(
                "Skipping placement outside plan bbox: x=%s y=%s bbox=%s",
                x,
                y,
                bbox,
            )
            continue
        msp.add_circle((x, y), radius, dxfattribs={"layer": layer_name})
        added += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(str(output_path))

    result: dict[str, Any] = {
        "ok": True,
        "input": str(input_path.resolve()),
        "output": str(output_path.resolve()),
        "layer": layer_name,
        "outlets_added": added,
    }
    if bbox is not None:
        result["bounding_box"] = bbox
    if skipped_out_of_bbox:
        result["placements_skipped_out_of_bbox"] = skipped_out_of_bbox
    return result


def apply_layer_cmd(input_path: str, output_path: str, placements_json: str) -> int:
    try:
        parsed = json.loads(placements_json)
        placements: list[dict[str, object]] = []
        if isinstance(parsed, list):
            placements = parsed
        elif isinstance(parsed, dict):
            nuevas = parsed.get("nuevas_tomas")
            outlets = parsed.get("outlet_placements")
            if isinstance(nuevas, list):
                placements = nuevas
            elif isinstance(outlets, list):
                placements = outlets
        payload = apply_electrical_layer(
            Path(input_path),
            Path(output_path),
            placements,
        )
        print(json.dumps(payload))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": INVALID_DXF_CODE}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
