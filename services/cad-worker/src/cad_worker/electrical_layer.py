"""Add Cambre_Electrical layer with CAMBRE_OUTLET block inserts to a DXF copy (US-009).

Supports incremental merge by room_id: blockrefs are tagged with XDATA so that
reprocesar a room replaces only that room's entities (US-013).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf import bbox as ezdxf_bbox
from ezdxf.document import Drawing

from cad_worker.constants import (
    DEFAULT_LAYER_COLOR_ACI,
    DEFAULT_OUTLET_BLOCK_NAME,
    GENERATOR_VERSION,
    LEGACY_BLOCK_NAMES,
    OUTLET_BLOCK_RADIUS,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.dxf_io import open_dxf_file, save_dxf_file
from cad_worker.extract_geometry import extract_geometry, geometry_bounding_box, point_inside_bbox
from cad_worker.geometry import point_in_polygon, point_seg_distance, polygon_edges
from cad_worker.symbol_catalog import (
    CROSS_ARM_RATIO,
    SymbolDef,
    UnknownPlacementKindError,
    compute_symbol_scale_resolution,
    read_dxf_insunits,
    resolve_placement_kind,
    resolve_symbol,
)
from cad_worker.unit_resolution import polygon_vertices, resolve_drawing_units

logger = logging.getLogger(__name__)

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"
CAMBRE_APPID = "CAMBRE_ROOM"
CAMBRE_ROOM_GROUP_CODE = 1000  # string xdata group code
CAMBRE_GENERATOR_VERSION_GROUP_CODE = 1000
CAMBRE_GENERATION_ID_GROUP_CODE = 1000
BATCH_ROOM_ID = "__batch__"

PlacementPoint = tuple[float, float, dict[str, object], SymbolDef, int]


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


def _normalize_placements(
    raw: list[dict[str, object]],
) -> tuple[list[PlacementPoint], list[dict[str, object]]]:
    """Accept outlet_placements ({position:{x,y}}) or nuevas_tomas ({coordenadas:[x,y]})."""
    normalized: list[PlacementPoint] = []
    rejected: list[dict[str, object]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            rejected.append({"index": index, "reason": "invalid_placement_record"})
            continue
        x: float | None = None
        y: float | None = None
        pos = item.get("position")
        if isinstance(pos, dict):
            px, py = pos.get("x"), pos.get("y")
            if isinstance(px, (int, float)) and isinstance(py, (int, float)):
                x, y = float(px), float(py)
        coords = item.get("coordenadas")
        if x is None and isinstance(coords, (list, tuple)) and len(coords) >= 2:
            try:
                x, y = float(coords[0]), float(coords[1])
            except (TypeError, ValueError):
                x, y = None, None
        if x is None or y is None:
            rejected.append({"index": index, "reason": "missing_or_invalid_position"})
            continue
        if not math.isfinite(x) or not math.isfinite(y):
            rejected.append({"index": index, "reason": "non_finite_position"})
            continue
        try:
            symbol = resolve_symbol(item)
        except UnknownPlacementKindError as exc:
            rejected.append(
                {"index": index, "reason": "unknown_placement_kind", "detail": str(exc)},
            )
            continue
        normalized.append((x, y, item, symbol, index))
    return normalized, rejected


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


def _populate_symbol_block(block: Any, symbol: SymbolDef) -> None:
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


def _create_symbol_block(doc: Drawing, block_name: str, symbol: SymbolDef) -> None:
    block = doc.blocks.new(name=block_name)
    _populate_symbol_block(block, symbol)


def _block_footprint(doc: Drawing, block_name: str) -> float | None:
    """Maximum 2D bbox dimension of an unscaled block definition."""
    try:
        extents = ezdxf_bbox.extents(doc.blocks.get(block_name), fast=True)
    except Exception:  # noqa: BLE001
        return None
    if not extents.has_data:
        return None
    width = float(extents.extmax.x - extents.extmin.x)
    height = float(extents.extmax.y - extents.extmin.y)
    footprint = max(width, height)
    return footprint if math.isfinite(footprint) and footprint > 1e-9 else None


def _expected_symbol_footprint(symbol: SymbolDef) -> float:
    scratch = ezdxf.new("R2010", setup=False)
    _create_symbol_block(scratch, "__EXPECTED_SYMBOL__", symbol)
    return _block_footprint(scratch, "__EXPECTED_SYMBOL__") or 2.0 * OUTLET_BLOCK_RADIUS


def _block_matches_symbol(doc: Drawing, block_name: str, symbol: SymbolDef) -> bool:
    actual = _block_footprint(doc, block_name)
    expected = _expected_symbol_footprint(symbol)
    return actual is not None and abs(actual - expected) <= max(expected * 0.05, 1e-6)


def _ensure_safe_symbol_block(doc: Drawing, symbol: SymbolDef) -> str:
    """Reuse a canonical block only when its measured footprint is trustworthy."""
    if symbol.block_name not in doc.blocks:
        _create_symbol_block(doc, symbol.block_name, symbol)
        return symbol.block_name
    if _block_matches_symbol(doc, symbol.block_name, symbol):
        return symbol.block_name

    version = 2
    while True:
        candidate = f"{symbol.block_name}__V{version}"
        if candidate not in doc.blocks:
            _create_symbol_block(doc, candidate, symbol)
            return candidate
        if _block_matches_symbol(doc, candidate, symbol):
            return candidate
        version += 1


def _ensure_symbol_block(doc: Drawing, symbol: SymbolDef) -> None:
    """Compatibility helper retained for tests and internal callers."""
    _ensure_safe_symbol_block(doc, symbol)


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


def _sanitize_electrical_layer(
    doc: Drawing,
    layer_name: str,
) -> tuple[int, list[str]]:
    """Remove legacy blockrefs and untagged orphan entities from the reserved layer."""
    msp = doc.modelspace()
    to_delete = []
    for entity in msp:
        if str(getattr(entity.dxf, "layer", "")) != layer_name:
            continue
        block_name = str(getattr(entity.dxf, "name", "") or "")
        is_known_legacy = entity.dxftype() == "INSERT" and block_name in LEGACY_BLOCK_NAMES
        if is_known_legacy or _get_entity_room_id(entity) is None:
            to_delete.append(entity)
    for entity in to_delete:
        msp.delete_entity(entity)

    referenced = {
        str(getattr(entity.dxf, "name", "") or "")
        for entity in doc.entitydb.values()
        if entity.is_alive and entity.dxftype() == "INSERT"
    }
    purged: list[str] = []
    for block_name in sorted(LEGACY_BLOCK_NAMES):
        if block_name not in doc.blocks or block_name in referenced:
            continue
        try:
            doc.blocks.delete_block(block_name, safe=True)
            purged.append(block_name)
        except ezdxf.DXFError:
            logger.warning("Could not purge unreferenced legacy block %s", block_name)
    return len(to_delete), purged


def _point_in_or_on_polygon(
    point: tuple[float, float],
    vertices: list[tuple[float, float]],
) -> bool:
    if point_in_polygon(point, vertices):
        return True
    scale = max((abs(value) for vertex in vertices for value in vertex), default=1.0)
    tolerance = max(scale * 1e-9, 1e-8)
    return any(
        point_seg_distance(point, start, end) <= tolerance
        for start, end in polygon_edges(vertices)
    )


def _origin_disk_intersects_rooms(
    room_polygons: list[list[tuple[float, float]]],
    radius: float,
) -> bool:
    origin = (0.0, 0.0)
    for vertices in room_polygons:
        if _point_in_or_on_polygon(origin, vertices):
            return True
        if any(
            point_seg_distance(origin, start, end) <= radius
            for start, end in polygon_edges(vertices)
        ):
            return True
    return False


def _detected_room_polygons(
    geometry: dict[str, object],
) -> list[object]:
    detection_resolution = resolve_drawing_units(None, geometry, [])
    detection = detect_rooms_from_walls(
        geometry,
        None,
        unit_resolution=detection_resolution,
    )
    if not detection.get("ok"):
        return []
    return [room.get("polygon") for room in detection.get("rooms", []) if isinstance(room, dict)]


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
    bbox_margin: float | None = None,
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

    _ensure_appid(doc)
    legacy_entities_removed, legacy_blocks_purged = _sanitize_electrical_layer(doc, layer_name)
    exclude = {layer_name}
    source_entity_counts = _modelspace_entity_counts_by_layer(doc, exclude)

    normalized, placements_rejected = _normalize_placements(placements)
    geometry = extract_geometry(input_path)
    bbox = geometry_bounding_box(geometry)
    header_insunits = read_dxf_insunits(doc)
    attached_polygons: list[object] = [
        item.get("room_polygon")
        for _x, _y, item, _symbol, _index in normalized
        if polygon_vertices(item.get("room_polygon"))
    ]
    detected_polygons = _detected_room_polygons(geometry)
    resolution_polygons = attached_polygons or detected_polygons
    unit_resolution = resolve_drawing_units(header_insunits, geometry, resolution_polygons)
    effective_bbox_margin = (
        float(bbox_margin)
        if bbox_margin is not None
        else 0.5 * unit_resolution.drawing_units_per_meter
    )

    skipped_out_of_bbox = 0
    blocks_used: set[str] = set()
    resolved_blocks: dict[str, str] = {}
    accepted: list[PlacementPoint] = []
    fallback_room_vertices = [
        vertices for polygon in detected_polygons if len(vertices := polygon_vertices(polygon)) >= 3
    ]
    all_room_vertices = [
        vertices
        for polygon in resolution_polygons
        if len(vertices := polygon_vertices(polygon)) >= 3
    ]
    origin_guard_radius = max(
        0.5 * unit_resolution.drawing_units_per_meter,
        10.0 * 0.45 * unit_resolution.drawing_units_per_meter,
    )
    origin_disk_intersects = _origin_disk_intersects_rooms(all_room_vertices, origin_guard_radius)

    for x, y, item, symbol, index in normalized:
        if bbox is not None and not point_inside_bbox(x, y, bbox, margin=effective_bbox_margin):
            skipped_out_of_bbox += 1
            placements_rejected.append(
                {"index": index, "reason": "outside_classified_bbox", "position": [x, y]},
            )
            logger.warning("Skipping placement outside plan bbox: x=%s y=%s bbox=%s", x, y, bbox)
            continue

        explicit_vertices = polygon_vertices(item.get("room_polygon"))
        candidate_rooms = (
            [explicit_vertices] if len(explicit_vertices) >= 3 else fallback_room_vertices
        )
        if not candidate_rooms:
            placements_rejected.append(
                {"index": index, "reason": "room_polygon_unavailable", "position": [x, y]},
            )
            continue
        if math.hypot(x, y) <= origin_guard_radius and not origin_disk_intersects:
            placements_rejected.append(
                {"index": index, "reason": "origin_guard", "position": [x, y]},
            )
            continue
        if not any(_point_in_or_on_polygon((x, y), vertices) for vertices in candidate_rooms):
            placements_rejected.append(
                {"index": index, "reason": "outside_room_polygon", "position": [x, y]},
            )
            continue
        accepted.append((x, y, item, symbol, index))

    for _x, _y, _item, symbol, _index in accepted:
        kind = resolve_placement_kind(_item)
        if kind not in resolved_blocks:
            resolved_blocks[kind] = _ensure_safe_symbol_block(doc, symbol)

    base_footprints = [
        footprint
        for block_name in resolved_blocks.values()
        if (footprint := _block_footprint(doc, block_name)) is not None
    ]
    max_base_footprint = max(base_footprints, default=2.0 * OUTLET_BLOCK_RADIUS)
    scale_resolution = compute_symbol_scale_resolution(
        unit_resolution,
        resolution_polygons,
        bbox,
        base_footprint=max_base_footprint,
    )
    symbol_scale = scale_resolution.final_scale
    symbol_radius = symbol_scale * OUTLET_BLOCK_RADIUS

    target_room_ids = {
        str(room_id or item.get("room_id") or BATCH_ROOM_ID)
        for _x, _y, item, _symbol, _index in accepted
    }
    if room_id is not None and not target_room_ids:
        target_room_ids.add(room_id)
    removed = sum(
        _remove_room_entities(doc.modelspace(), layer_name, target_room_id)
        for target_room_id in sorted(target_room_ids)
    )
    if target_room_ids:
        logger.info(
            "Incremental merge room_ids=%s: removed %d existing entities",
            sorted(target_room_ids),
            removed,
        )

    generation_payload = [
        {
            "x": x,
            "y": y,
            "room_id": str(room_id or item.get("room_id") or BATCH_ROOM_ID),
            "kind": resolve_placement_kind(item),
        }
        for x, y, item, _symbol, _index in accepted
    ]
    generation_id = hashlib.sha256(
        (_sha256_file(input_path) + json.dumps(generation_payload, sort_keys=True)).encode("utf-8"),
    ).hexdigest()[:20]

    msp = doc.modelspace()
    added = 0
    for x, y, item, _symbol, _index in accepted:
        kind = resolve_placement_kind(item)
        block_name = resolved_blocks[kind]
        blocks_used.add(block_name)
        ref = msp.add_blockref(
            block_name,
            (x, y),
            dxfattribs={
                "layer": layer_name,
                "xscale": symbol_scale,
                "yscale": symbol_scale,
                "zscale": symbol_scale,
            },
        )
        entity_room_id = str(room_id or item.get("room_id") or BATCH_ROOM_ID)
        ref.set_xdata(
            CAMBRE_APPID,
            [
                (CAMBRE_ROOM_GROUP_CODE, entity_room_id),
                (CAMBRE_GENERATOR_VERSION_GROUP_CODE, f"generator_version={GENERATOR_VERSION}"),
                (CAMBRE_GENERATION_ID_GROUP_CODE, f"generation_id={generation_id}"),
            ],
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
        "symbol_scale": symbol_scale,
        "symbol_radius_drawing_units": symbol_radius,
        "drawing_insunits": header_insunits,
        "header_insunits": unit_resolution.header_insunits,
        "effective_insunits": unit_resolution.effective_insunits,
        "insunits_overridden": unit_resolution.overridden,
        "unit_confidence": unit_resolution.confidence,
        "unit_scores": unit_resolution.scores,
        "unit_evidence": unit_resolution.evidence,
        "unit_resolution_reason": unit_resolution.reason,
        "nominal_symbol_scale": scale_resolution.nominal_scale,
        "final_symbol_scale": scale_resolution.final_scale,
        "scale_clamped": scale_resolution.scale_clamped,
        "clamp_reason": scale_resolution.clamp_reason,
        "room_median_minor_dimension_m": scale_resolution.room_median_minor_dimension_m,
        "nominal_symbol_footprint_m": scale_resolution.nominal_footprint_m,
        "final_symbol_footprint_m": scale_resolution.final_footprint_m,
        "legacy_entities_removed": legacy_entities_removed,
        "legacy_blocks_purged": legacy_blocks_purged,
        "placements_rejected": placements_rejected,
        "generator_version": GENERATOR_VERSION,
        "generation_id": generation_id,
        "bbox_margin_drawing_units": effective_bbox_margin,
        "blocks_used": sorted(blocks_used),
        "outlets_added": added,
        "source_layers_preserved": preserved,
        "output_checksum_sha256": _sha256_file(output_path),
    }
    if room_id is not None:
        result["room_id"] = room_id
        result["outlets_removed"] = removed
    elif removed:
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
