"""Add Cambre_Electrical layer with CAMBRE_OUTLET block inserts to a DXF copy (US-009)."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.document import Drawing

from cad_worker.constants import (
    DEFAULT_LAYER_COLOR_ACI,
    DEFAULT_OUTLET_BLOCK_NAME,
    OUTLET_BLOCK_RADIUS,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.dxf_io import open_dxf_file, save_dxf_file
from cad_worker.extract_geometry import extract_geometry, geometry_bounding_box, point_inside_bbox

logger = logging.getLogger(__name__)

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"

PlacementPoint = tuple[float, float, dict[str, object]]


@dataclass(frozen=True)
class OutputLayerConfig:
    layer_name: str = OUTPUT_ELECTRICAL_LAYER_NAME
    block_name: str = DEFAULT_OUTLET_BLOCK_NAME
    color_aci: int = DEFAULT_LAYER_COLOR_ACI


def parse_output_layer_config(raw: object | None) -> OutputLayerConfig:
    if not isinstance(raw, dict):
        return OutputLayerConfig()
    layer_name = raw.get("name")
    block_name = raw.get("block_name")
    color_aci = raw.get("color_aci")
    resolved_layer = (
        str(layer_name)
        if isinstance(layer_name, str) and layer_name.strip()
        else OUTPUT_ELECTRICAL_LAYER_NAME
    )
    resolved_block = (
        str(block_name)
        if isinstance(block_name, str) and block_name.strip()
        else DEFAULT_OUTLET_BLOCK_NAME
    )
    return OutputLayerConfig(
        layer_name=resolved_layer,
        block_name=resolved_block,
        color_aci=int(color_aci) if isinstance(color_aci, int) else DEFAULT_LAYER_COLOR_ACI,
    )


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


def _modelspace_entity_counts_by_layer(doc: Drawing, exclude_layers: set[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entity in doc.modelspace():
        layer = entity.dxf.layer
        if layer in exclude_layers:
            continue
        counts[layer] = counts.get(layer, 0) + 1
    return counts


def _ensure_outlet_block(doc: Drawing, block_name: str, color_aci: int) -> None:
    if block_name in doc.blocks:
        return
    block = doc.blocks.new(name=block_name)
    block.add_circle((0, 0), OUTLET_BLOCK_RADIUS, dxfattribs={"color": color_aci})
    radius = OUTLET_BLOCK_RADIUS * 0.7
    block.add_line(
        (-radius, 0),
        (radius, 0),
        dxfattribs={"color": color_aci},
    )
    block.add_line(
        (0, -radius),
        (0, radius),
        dxfattribs={"color": color_aci},
    )


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_electrical_layer(
    input_path: Path,
    output_path: Path,
    placements: list[dict[str, object]],
    *,
    output_layer: OutputLayerConfig | None = None,
    bbox_margin: float = 500.0,
) -> dict[str, object]:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    config = output_layer or OutputLayerConfig()
    doc = open_dxf_file(input_path)
    layer_name = config.layer_name
    if layer_name not in [layer.dxf.name for layer in doc.layers]:
        doc.layers.new(name=layer_name, dxfattribs={"color": config.color_aci})

    exclude = {layer_name}
    source_entity_counts = _modelspace_entity_counts_by_layer(doc, exclude)

    _ensure_outlet_block(doc, config.block_name, config.color_aci)

    geometry = extract_geometry(input_path)
    bbox = geometry_bounding_box(geometry)
    skipped_out_of_bbox = 0

    msp = doc.modelspace()
    added = 0
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
        msp.add_blockref(
            config.block_name,
            (x, y),
            dxfattribs={"layer": layer_name, "xscale": 1, "yscale": 1, "zscale": 1},
        )
        added += 1

    preserved = _modelspace_entity_counts_by_layer(doc, exclude) == source_entity_counts
    if not preserved:
        raise RuntimeError(
            "Source modelspace entities were modified; US-009 requires non-destructive layer add",
        )

    save_dxf_file(doc, output_path)

    result: dict[str, Any] = {
        "ok": True,
        "input": str(input_path.resolve()),
        "output": str(output_path.resolve()),
        "layer": layer_name,
        "block_name": config.block_name,
        "outlets_added": added,
        "source_layers_preserved": preserved,
        "output_checksum_sha256": _sha256_file(output_path),
    }
    if bbox is not None:
        result["bounding_box"] = bbox
    if skipped_out_of_bbox:
        result["placements_skipped_out_of_bbox"] = skipped_out_of_bbox
    return result


def apply_layer_cmd(
    input_path: str,
    output_path: str,
    placements_json: str,
    output_layer_json: str | None = None,
) -> int:
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
        layer_config = parse_output_layer_config(
            json.loads(output_layer_json) if output_layer_json else None,
        )
        payload = apply_electrical_layer(
            Path(input_path),
            Path(output_path),
            placements,
            output_layer=layer_config,
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
