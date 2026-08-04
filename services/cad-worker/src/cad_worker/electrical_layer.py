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
    MAX_SYMBOL_PAPER_MM,
    MIN_SYMBOL_PAPER_MM,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.dxf_io import open_dxf_file, save_dxf_file
from cad_worker.extract_geometry import extract_geometry, geometry_bounding_box, point_inside_bbox
from cad_worker.geometry import point_in_polygon, point_seg_distance, polygon_edges
from cad_worker.symbol_catalog import (
    CATALOG,
    SymbolDef,
    UnknownPlacementKindError,
    compute_symbol_scale_resolution,
    paper_mm_of,
    read_dxf_insunits,
    resolve_placement_kind,
    resolve_plot_scale,
    resolve_symbol,
)
from cad_worker.symbol_geometry import (
    symbol_paper_extent,
    symbol_primitives,
    wall_rotation_degrees,
)
from cad_worker.symbol_legend import LEGEND_ROOM_ID, draw_legend, legend_origin
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


#: Entities inside a block definition are drawn BYBLOCK so the INSERT's colour
#: governs. That is what lets one catalog serve a plan recoloured per layer.
BYBLOCK = 0


def _populate_symbol_block(block: Any, symbol: SymbolDef) -> None:
    """Draw the symbol in millimetres of paper; the INSERT scale converts."""
    attribs = {"color": BYBLOCK}
    for primitive in symbol_primitives(symbol):
        kind = primitive[0]
        if kind == "circle":
            _, cx, cy, radius = primitive
            block.add_circle((cx, cy), radius, dxfattribs=attribs)
        elif kind == "line":
            _, x1, y1, x2, y2 = primitive
            block.add_line((x1, y1), (x2, y2), dxfattribs=attribs)
        elif kind == "arc":
            _, cx, cy, radius, start, end = primitive
            block.add_arc((cx, cy), radius, start, end, dxfattribs=attribs)


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


def _block_matches_symbol(doc: Drawing, block_name: str, symbol: SymbolDef) -> bool:
    """Whether an existing block of this name really is our symbol.

    A file can already contain a block called CBR_TOMA drawn to a different size;
    reusing it blindly is how a plan ends up with symbols of two sizes.
    """
    actual = _block_footprint(doc, block_name)
    expected = symbol_paper_extent(symbol)
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
    """Legacy helper — ensures a standard outlet block under a caller-chosen name."""
    _ensure_symbol_block(
        doc,
        SymbolDef(
            block_name=block_name,
            geometry="toma",
            color_aci=color_aci,
            element="toma",
        ),
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


def _placement_rotation(item: dict[str, object], symbol: SymbolDef) -> float:
    """Angle that turns the symbol to face the room it serves.

    The placer already computes the inward normal of the wall it chose; carrying
    it here is what makes an outlet's leads point into the wall instead of
    sideways. Ceiling devices and placements without a normal stay unrotated.
    """
    if not symbol.rotates_with_wall:
        return 0.0
    normal = item.get("wall_normal")
    if isinstance(normal, (list, tuple)) and len(normal) >= 2:
        try:
            return wall_rotation_degrees((float(normal[0]), float(normal[1])))
        except (TypeError, ValueError):
            return 0.0
    angle = item.get("wall_angle_deg")
    if isinstance(angle, (int, float)) and math.isfinite(float(angle)):
        return float(angle)
    return 0.0


def _layer_component_census(msp: Any, layer_name: str) -> tuple[dict[str, int], list[tuple[float, float]]]:
    """Every component on the layer right now: counts by catalog kind, and positions.

    The legend describes the layer, so it has to be measured from the layer. Taking
    the tally from the current run instead ended a room-by-room session with a
    legend declaring four components on a plan that carried a hundred and four —
    and a wrong count is exactly what an architect uses the legend to catch.
    """
    kind_by_block: dict[str, str] = {}
    for kind, symbol in CATALOG.items():
        kind_by_block.setdefault(symbol.block_name, kind)

    counts: dict[str, int] = {}
    points: list[tuple[float, float]] = []
    for entity in msp:
        if entity.dxf.layer != layer_name or entity.dxftype() != "INSERT":
            continue
        points.append((float(entity.dxf.insert.x), float(entity.dxf.insert.y)))
        kind = kind_by_block.get(entity.dxf.name)
        if kind is not None:
            counts[kind] = counts.get(kind, 0) + 1
    return counts, points


def _draw_symbol_legend(
    msp: Any,
    *,
    counts: dict[str, int],
    layer_name: str,
    color_aci: int,
    scale: float,
    points: list[tuple[float, float]],
    generation_id: str,
) -> int:
    """Draw the symbology reference beside the plan; returns entities drawn.

    Tagged with the same XDATA convention as the components, so the sweep that
    removes stray entities from the layer leaves it alone and a reprocess
    replaces it instead of stacking a second copy.
    """
    origin = legend_origin(points, scale)
    if origin is None or not counts:
        return 0
    entities = draw_legend(
        msp,
        counts=counts,
        layer_name=layer_name,
        scale=scale,
        origin=origin,
        color_aci=color_aci,
    )
    for entity in entities:
        entity.set_xdata(
            CAMBRE_APPID,
            [
                (CAMBRE_ROOM_GROUP_CODE, LEGEND_ROOM_ID),
                (CAMBRE_GENERATOR_VERSION_GROUP_CODE, f"generator_version={GENERATOR_VERSION}"),
                (CAMBRE_GENERATION_ID_GROUP_CODE, f"generation_id={generation_id}"),
            ],
        )
    return len(entities)


def _audit_drawn_symbols(
    doc: Drawing,
    layer_name: str,
    nominal_scale: float,
) -> dict[str, object]:
    """Measure what was actually drawn and refuse to hand back an illegible plan.

    Every earlier generation of this code computed a scale that looked right and
    wrote symbols that were not: 200 m circles in one release, 3 cm in the next.
    The only defence that holds is measuring the written geometry and failing
    loudly, so a wrong size never reaches an architect as a silent output.

    The measurement is against the **nominal** scale, the one the plot scale and
    the resolved units imply. Dividing by the scale actually applied made the
    check tautological: it returned the block's declared size no matter how the
    symbol had been resized, which is exactly the failure it exists to catch.
    """
    footprints_mm: list[float] = []
    for entity in doc.modelspace():
        if entity.dxftype() != "INSERT" or str(entity.dxf.layer) != layer_name:
            continue
        try:
            extents = ezdxf_bbox.extents([entity], fast=True)
        except Exception:  # noqa: BLE001
            continue
        if not extents.has_data:
            continue
        footprint_du = max(
            float(extents.extmax.x - extents.extmin.x),
            float(extents.extmax.y - extents.extmin.y),
        )
        footprints_mm.append(paper_mm_of(footprint_du, nominal_scale))

    if not footprints_mm:
        return {"symbols_measured": 0}

    # Oversize is the catastrophic direction and always a bug: it is how a plan
    # ends up with 200-metre circles, and no plan is better than that plan.
    oversized = [value for value in footprints_mm if value > MAX_SYMBOL_PAPER_MM + 1e-6]
    if oversized:
        raise RuntimeError(
            "Refusing to write an oversized electrical layer: "
            f"{len(oversized)} of {len(footprints_mm)} symbols measure up to "
            f"{max(oversized):.2f} mm on paper, above the {MAX_SYMBOL_PAPER_MM} mm limit",
        )

    # Undersize is reported, not refused. A tiny room or an untrusted unit
    # resolution can legitimately produce a small symbol, and delivering a plan
    # with a warning beats delivering nothing at all.
    undersized = [value for value in footprints_mm if value < MIN_SYMBOL_PAPER_MM - 1e-6]
    audit: dict[str, object] = {
        "symbols_measured": len(footprints_mm),
        "symbol_paper_mm_min": round(min(footprints_mm), 3),
        "symbol_paper_mm_max": round(max(footprints_mm), 3),
    }
    if undersized:
        audit["symbols_below_legibility"] = len(undersized)
        audit["symbol_audit_warning"] = (
            f"{len(undersized)} de {len(footprints_mm)} símbolos miden menos de "
            f"{MIN_SYMBOL_PAPER_MM} mm de papel (mínimo {min(undersized):.2f} mm)"
        )
    return audit


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
    # Symbol size is a property of the drawing, not of this run. Preferring the
    # polygons attached to the current placements made a one-room run size its
    # symbols against that single room: processing the plan room by room, as the
    # UI does, produced nine different symbol sizes in one file (0.067 to 0.100,
    # a 50% spread). The document-wide detection answers the same question the
    # same way on every run.
    scale_polygons = detected_polygons or attached_polygons
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

    # One scale for the whole document. Computing it per room made the same plan
    # carry symbols of different sizes depending on when each room was processed.
    plot_scale = resolve_plot_scale(geometry)
    largest_paper_mm = max(
        (footprint for block_name in resolved_blocks.values()
         if (footprint := _block_footprint(doc, block_name)) is not None),
        default=float(MAX_SYMBOL_PAPER_MM),
    )
    scale_resolution = compute_symbol_scale_resolution(
        unit_resolution,
        scale_polygons,
        plot_scale=plot_scale,
        paper_mm=largest_paper_mm,
    )
    symbol_scale = scale_resolution.final_scale

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
    # The legend describes the whole layer, so it is rebuilt on every run
    # regardless of which room was processed. It is bookkeeping, not a component,
    # so it stays out of the removed/added counts an architect reads.
    _remove_room_entities(doc.modelspace(), layer_name, LEGEND_ROOM_ID)
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
    for x, y, item, symbol, _index in accepted:
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
                "rotation": _placement_rotation(item, symbol),
                # Colour on the INSERT, BYBLOCK inside the definition: one block
                # per symbol serves every colour scheme.
                "color": symbol.color_aci,
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

    # Measured after the blockrefs are in, so it sees this run's components and
    # every earlier run's alike.
    component_counts, layer_points = _layer_component_census(msp, layer_name)

    # Anchored to the rooms, not to the components. Anchoring to the components of
    # the current run put the legend beside whichever room happened to be
    # processed first, which on a room-by-room session dropped it inside the
    # living room. The detected rooms are the plan itself, and unlike the raw
    # bounding box they exclude the title block and the site work.
    legend_points = [
        vertex
        for polygon in detected_polygons
        for vertex in polygon_vertices(polygon)
    ] or layer_points
    legend_drawn = _draw_symbol_legend(
        msp,
        counts=component_counts,
        layer_name=layer_name,
        color_aci=config.color_aci,
        scale=symbol_scale,
        points=legend_points,
        generation_id=generation_id,
    )

    preserved = _modelspace_entity_counts_by_layer(doc, exclude) == source_entity_counts
    if not preserved:
        raise RuntimeError(
            "Source modelspace entities were modified; US-009 requires non-destructive layer add",
        )

    # Measured before the file is written: an illegible layer is never saved.
    symbol_audit = _audit_drawn_symbols(doc, layer_name, scale_resolution.nominal_scale)

    save_dxf_file(doc, output_path)

    result: dict[str, Any] = {
        "ok": True,
        "input": str(input_path.resolve()),
        "output": str(output_path.resolve()),
        "layer": layer_name,
        "block_name": config.block_name,
        "symbol_scale": symbol_scale,
        "plot_scale": scale_resolution.plot_scale,
        **symbol_audit,
        "drawing_insunits": header_insunits,
        "header_insunits": unit_resolution.header_insunits,
        "effective_insunits": unit_resolution.effective_insunits,
        "insunits_overridden": unit_resolution.overridden,
        "unit_confidence": unit_resolution.confidence,
        "drawing_units_per_meter": unit_resolution.drawing_units_per_meter,
        "unit_scores": unit_resolution.scores,
        "unit_evidence": unit_resolution.evidence,
        "unit_resolution_reason": unit_resolution.reason,
        "nominal_symbol_scale": scale_resolution.nominal_scale,
        "final_symbol_scale": scale_resolution.final_scale,
        "scale_clamped": scale_resolution.scale_clamped,
        "clamp_reason": scale_resolution.clamp_reason,
        "room_median_minor_dimension_m": scale_resolution.room_median_minor_dimension_m,
        "nominal_symbol_paper_mm": scale_resolution.nominal_paper_mm,
        "final_symbol_paper_mm": scale_resolution.final_paper_mm,
        "legacy_entities_removed": legacy_entities_removed,
        "legacy_blocks_purged": legacy_blocks_purged,
        "placements_rejected": placements_rejected,
        "generator_version": GENERATOR_VERSION,
        "generation_id": generation_id,
        "bbox_margin_drawing_units": effective_bbox_margin,
        "blocks_used": sorted(blocks_used),
        "outlets_added": added,
        "component_counts": component_counts,
        "legend_entities": legend_drawn,
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
