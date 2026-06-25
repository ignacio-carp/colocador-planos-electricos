"""Add Cambre_Electrical layer with CAMBRE_OUTLET block inserts to a DXF copy (US-009).

Supports incremental merge by room_id: blockrefs are tagged with XDATA so that
reprocesar a room replaces only that room's entities (US-013).
"""

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
from cad_worker.symbol_catalog import (
    CROSS_ARM_RATIO,
    SymbolDef,
    compute_symbol_radius_drawing_units,
    compute_symbol_scale,
    read_dxf_insunits,
    resolve_symbol,
)

logger = logging.getLogger(__name__)

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"
CAMBRE_APPID = "CAMBRE_ROOM"
CAMBRE_ROOM_GROUP_CODE = 1000  # string xdata group code

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


def _add_cross_arms(block: Any, radius: float, color_aci: int) -> None:
    arm = radius * CROSS_ARM_RATIO
    block.add_line((-arm, 0), (arm, 0), dxfattribs={"color": color_aci})
    block.add_line((0, -arm), (0, arm), dxfattribs={"color": color_aci})


def _add_toma_legs(block: Any, radius: float, color_aci: int) -> None:
    """IRAM tomacorriente: circle + two vertical legs (NOT a cross)."""
    leg_x = radius * 0.4
    leg_top = radius * 0.25
    leg_bottom = radius * 1.3
    block.add_line((-leg_x, leg_top), (-leg_x, leg_bottom), dxfattribs={"color": color_aci})
    block.add_line((leg_x, leg_top), (leg_x, leg_bottom), dxfattribs={"color": color_aci})


def _ensure_symbol_block(doc: Drawing, symbol: SymbolDef) -> None:
    if symbol.block_name in doc.blocks:
        return
    block = doc.blocks.new(name=symbol.block_name)
    color = symbol.color_aci
    r = OUTLET_BLOCK_RADIUS
    geom = symbol.geometry

    if geom == "filled_circle":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
    elif geom == "toma":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_toma_legs(block, r, color)
    elif geom == "toma_especial":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_toma_legs(block, r, color)
        bar = r * 1.2
        block.add_line((-bar, -bar), (bar, -bar), dxfattribs={"color": color})
    elif geom == "brazo":
        block.add_arc((0, 0), r, 0, 180, dxfattribs={"color": color})
        block.add_line((-r, 0), (r, 0), dxfattribs={"color": color})
    elif geom == "llave":
        dot = r * 0.3
        block.add_circle((-r * 0.85, -r * 0.85), dot, dxfattribs={"color": color})
        tip = r * 0.7
        block.add_line((-r * 0.85, -r * 0.85), (tip, tip), dxfattribs={"color": color})
        block.add_line((tip, tip), (tip * 0.3, tip * 1.35), dxfattribs={"color": color})
    elif geom == "tablero":
        w, h = r * 2.0, r * 1.25
        block.add_line((-w / 2, -h / 2), (w / 2, -h / 2), dxfattribs={"color": color})
        block.add_line((w / 2, -h / 2), (w / 2, h / 2), dxfattribs={"color": color})
        block.add_line((w / 2, h / 2), (-w / 2, h / 2), dxfattribs={"color": color})
        block.add_line((-w / 2, h / 2), (-w / 2, -h / 2), dxfattribs={"color": color})
    elif geom == "puesta_tierra":
        block.add_line((0, r), (0, 0), dxfattribs={"color": color})
        block.add_line((-r * 0.8, 0), (r * 0.8, 0), dxfattribs={"color": color})
        block.add_line((-r * 0.5, -r * 0.4), (r * 0.5, -r * 0.4), dxfattribs={"color": color})
        block.add_line((-r * 0.2, -r * 0.8), (r * 0.2, -r * 0.8), dxfattribs={"color": color})
    elif geom == "circle_cross":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_cross_arms(block, r, color)
    elif geom == "circle_cross_double":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_cross_arms(block, r, color)
        inner = r * 0.45
        block.add_line((-inner, -inner), (inner, inner), dxfattribs={"color": color})
        block.add_line((-inner, inner), (inner, -inner), dxfattribs={"color": color})
    elif geom == "circle_s":
        s = r * 0.55
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        block.add_line((-s * 0.6, s * 0.5), (s * 0.6, -s * 0.5), dxfattribs={"color": color})
        block.add_line((-s * 0.3, s * 0.8), (s * 0.8, -s * 0.2), dxfattribs={"color": color})
    elif geom == "circle_cross_emergency":
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_cross_arms(block, r, color)
        block.add_circle((0, 0), r * 0.35, dxfattribs={"color": color})
    else:
        block.add_circle((0, 0), r, dxfattribs={"color": color})
        _add_toma_legs(block, r, color)


def _ensure_outlet_block(doc: Drawing, block_name: str, color_aci: int) -> None:
    """Legacy helper — ensures standard circle+cross block."""
    _ensure_symbol_block(
        doc,
        SymbolDef(block_name=block_name, geometry="circle_cross", color_aci=color_aci),
    )


def _ensure_appid(doc: Drawing) -> None:
    """Register CAMBRE_ROOM APPID for xdata tagging (US-013 idempotent room merge)."""
    if CAMBRE_APPID not in doc.appids:
        doc.appids.new(CAMBRE_APPID)


def _get_entity_room_id(entity: Any) -> str | None:
    """Return the room_id xdata tag on a blockref, or None if not tagged."""
    try:
        xdata = entity.get_xdata(CAMBRE_APPID)
        for item in xdata:
            if item.code == CAMBRE_ROOM_GROUP_CODE:
                return str(item.value)
    except Exception:  # noqa: BLE001
        pass
    return None


def _remove_room_entities(msp: Any, layer_name: str, room_id: str) -> int:
    """Delete all blockrefs on layer_name tagged with room_id. Returns deleted count."""
    to_delete = []
    for entity in msp:
        if entity.dxf.layer != layer_name:
            continue
        if _get_entity_room_id(entity) == room_id:
            to_delete.append(entity)
    for entity in to_delete:
        msp.delete_entity(entity)
    return len(to_delete)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_electrical_layer(
    input_path: Path,
    output_path: Path,
    placements: list[dict[str, object]],
    *,
    output_layer: OutputLayerConfig | None = None,
    bbox_margin: float = 500.0,
    room_id: str | None = None,
) -> dict[str, object]:
    """Apply outlet placements to a DXF copy.

    When ``room_id`` is provided (US-013 incremental mode):
    - Existing Cambre_Electrical blockrefs tagged with that room_id are removed first.
    - New blockrefs are tagged with the room_id via XDATA for future idempotent reprocesar.
    - Source layers (non-Cambre_Electrical) are preserved.

    When ``room_id`` is None (batch mode): behaves like the original US-009 full-batch path.
    """
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    config = output_layer or OutputLayerConfig()
    doc = open_dxf_file(input_path)
    layer_name = config.layer_name
    if layer_name not in [layer.dxf.name for layer in doc.layers]:
        doc.layers.new(name=layer_name, dxfattribs={"color": config.color_aci})

    exclude = {layer_name}
    source_entity_counts = _modelspace_entity_counts_by_layer(doc, exclude)

    removed = 0
    if room_id is not None:
        _ensure_appid(doc)
        removed = _remove_room_entities(doc.modelspace(), layer_name, room_id)
        logger.info("Incremental merge room_id=%s: removed %d existing entities", room_id, removed)

    geometry = extract_geometry(input_path)
    bbox = geometry_bounding_box(geometry)
    insunits = read_dxf_insunits(doc)
    symbol_radius = compute_symbol_radius_drawing_units(bbox, geometry, insunits)
    symbol_scale = compute_symbol_scale(bbox, geometry, insunits)
    skipped_out_of_bbox = 0
    blocks_used: set[str] = set()

    msp = doc.modelspace()
    added = 0
    for x, y, item in _normalize_placements(placements):
        if bbox is not None and not point_inside_bbox(x, y, bbox, margin=bbox_margin):
            skipped_out_of_bbox += 1
            logger.warning(
                "Skipping placement outside plan bbox: x=%s y=%s bbox=%s",
                x,
                y,
                bbox,
            )
            continue
        symbol = resolve_symbol(item)
        if symbol.block_name not in blocks_used:
            _ensure_symbol_block(doc, symbol)
            blocks_used.add(symbol.block_name)
        ref = msp.add_blockref(
            symbol.block_name,
            (x, y),
            dxfattribs={
                "layer": layer_name,
                "xscale": symbol_scale,
                "yscale": symbol_scale,
                "zscale": symbol_scale,
            },
        )
        if room_id is not None:
            ref.set_xdata(CAMBRE_APPID, [(CAMBRE_ROOM_GROUP_CODE, room_id)])
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
        "symbol_scale": symbol_scale,
        "symbol_radius_drawing_units": symbol_radius,
        "drawing_insunits": insunits,
        "blocks_used": sorted(blocks_used),
        "outlets_added": added,
        "source_layers_preserved": preserved,
        "output_checksum_sha256": _sha256_file(output_path),
    }
    if room_id is not None:
        result["room_id"] = room_id
        result["outlets_removed"] = removed
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
    room_id: str | None = None,
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
            room_id=room_id or None,
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
