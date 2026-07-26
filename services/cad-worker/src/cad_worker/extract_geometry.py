"""Extract walls, openings, furniture, text labels and dimensions from a DXF modelspace.

Real architectural DXFs are not the tidy LINE/LWPOLYLINE files the synthetic
fixtures pretend they are. In the Cambre corpus a single plan carries ARCs (door
swings), POLYLINEs, CIRCLEs and 341 block references whose geometry only exists
inside the block definition. Reading just top-level LINE/LWPOLYLINE threw away
most of the drawing, which starved unit resolution and room detection alike.

Two families are new and matter downstream:

- ``etiquetas_texto`` — the architect already wrote the name of every room in the
  drawing (``_NOM - LOCALES``: COCINA, DORMITORIO, BAÑO SUITE...). Those labels
  are the seeds for deterministic room detection, so no model has to guess them.
- ``dimensiones`` — dimension entities state a real-world measurement against a
  geometric length. That pair *measures* drawing units per metre instead of
  inferring them from wall-length heuristics.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

import ezdxf
from ezdxf import bbox as ezdxf_bbox
from ezdxf import path as ezdxf_path

from cad_worker.constants import OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.dxf_io import open_dxf_file
from cad_worker.symbol_catalog import read_dxf_insunits

ELECTRICAL_LAYER_NAME = OUTPUT_ELECTRICAL_LAYER_NAME

LayerKind = Literal["pared", "mueble", "abertura"]

# Layer-name tokens used to classify entities for the electrical analysis.
# Order of evaluation is furniture -> opening -> wall (see classify_layer): a
# layer named "CARPINTERIAS" is joinery (an opening), not a wall, even though
# some studios file it under the wall group.
WALL_LAYER_TOKENS = (
    "wall",
    "pared",
    "muro",
    "a-wall",
    "partition",
    "tabique",
    "mampost",
    "ladrillo",
    "divisori",
)
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
    "carpinteria",
    "cortina",
)
FURNITURE_LAYER_TOKENS = (
    "mobili",
    "furnitur",
    "mueble",
    "equip",
    "a-furn",
    "sanitari",
    "artefacto",
    "electrodomest",
)

# Curves are flattened to polylines. The sagitta budget is a fraction of the
# entity's own size so the tolerance is unit-agnostic: a 0.9 m door arc in a
# metre drawing and a 900 mm arc in a millimetre drawing flatten identically.
CURVE_FLATTENING_RATIO = 1.0 / 64.0
MAX_INSERT_DEPTH = 3


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


def _flattening_distance(vertices: list[Any]) -> float:
    """Sagitta budget proportional to the entity's own extent."""
    xs = [float(v.x) for v in vertices]
    ys = [float(v.y) for v in vertices]
    if not xs:
        return 1e-6
    extent = max(max(xs) - min(xs), max(ys) - min(ys))
    return max(extent * CURVE_FLATTENING_RATIO, 1e-9)


def entity_segments(entity: Any) -> list[tuple[list[float], list[float]]]:
    """Flatten any drawable entity to 2D segments; empty when not drawable.

    ``ezdxf.path`` normalizes LINE, LWPOLYLINE (bulges included), POLYLINE, ARC,
    CIRCLE, ELLIPSE and SPLINE into one representation, so curved walls and door
    swings survive instead of being silently dropped.
    """
    try:
        converted = ezdxf_path.make_path(entity)
    except (TypeError, ValueError, AttributeError):
        return []
    control_points = list(converted.control_vertices())
    if len(control_points) < 2:
        return []
    try:
        vertices = list(converted.flattening(distance=_flattening_distance(control_points)))
    except (ValueError, ZeroDivisionError):
        return []
    segments: list[tuple[list[float], list[float]]] = []
    for index in range(len(vertices) - 1):
        start = [float(vertices[index].x), float(vertices[index].y)]
        end = [float(vertices[index + 1].x), float(vertices[index + 1].y)]
        if start != end:
            segments.append((start, end))
    return segments


def _insert_footprint(entity: Any) -> dict[str, float] | None:
    """2D bounding box of a block reference (furniture footprint for placement).

    The deterministic placer anchors furniture-relative outlets (e.g. the bed
    headboard pair) to this box; the insertion point alone says nothing about size.
    """
    try:
        extents = ezdxf_bbox.extents([entity], fast=True)
    except Exception:  # noqa: BLE001 - unresolvable blocks simply have no footprint
        return None
    if not extents.has_data:
        return None
    return {
        "min_x": float(extents.extmin.x),
        "min_y": float(extents.extmin.y),
        "max_x": float(extents.extmax.x),
        "max_y": float(extents.extmax.y),
    }


def _text_of(entity: Any) -> str:
    dxftype = entity.dxftype()
    try:
        if dxftype == "MTEXT":
            return str(entity.plain_text()).strip()
        if dxftype in ("TEXT", "ATTRIB"):
            return str(entity.dxf.text).strip()
    except Exception:  # noqa: BLE001 - malformed text entities are simply skipped
        return ""
    return ""


def _dimension_record(entity: Any, layer: str | None) -> dict[str, object] | None:
    """Measured length in drawing units paired with the drawn scale factor.

    ``measurement`` is the geometric distance the dimension spans; the value the
    architect reads on paper is ``measurement * dimlfac``. Knowing both anchors
    drawing units to metres by measurement instead of by heuristic.
    """
    try:
        measurement = float(entity.get_measurement())
    except Exception:  # noqa: BLE001 - angular/ordinate dims have no linear measure
        return None
    if not math.isfinite(measurement) or measurement <= 1e-9:
        return None
    try:
        dimlfac = float(entity.dxf.get("dimlfac", 1.0) or 1.0)
    except Exception:  # noqa: BLE001
        dimlfac = 1.0
    if not math.isfinite(dimlfac) or dimlfac <= 1e-9:
        dimlfac = 1.0
    record: dict[str, object] = {
        "medida_du": measurement,
        "dimlfac": dimlfac,
        "valor_mostrado": measurement * dimlfac,
    }
    override = ""
    try:
        override = str(entity.dxf.get("text", "") or "").strip()
    except Exception:  # noqa: BLE001
        override = ""
    # "<>" is AutoCAD's placeholder for "use the measured value".
    if override and override not in ("<>", " "):
        record["texto"] = override
    if layer:
        record["capa"] = layer
    return record


def extract_geometry(dxf_path: str | Path) -> dict[str, object]:
    doc = open_dxf_file(dxf_path)
    msp = doc.modelspace()
    paredes: list[dict[str, object]] = []
    aberturas: list[dict[str, object]] = []
    muebles: list[dict[str, object]] = []
    etiquetas: list[dict[str, object]] = []
    dimensiones: list[dict[str, object]] = []
    capas: dict[str, set[str]] = {"paredes": set(), "aberturas": set(), "muebles": set()}

    target_by_kind = {"pared": paredes, "abertura": aberturas, "mueble": muebles}
    capa_key_by_kind = {"pared": "paredes", "abertura": "aberturas", "mueble": "muebles"}

    def _add_segments(layer: str | None, kind: LayerKind, entity: Any) -> None:
        segments = entity_segments(entity)
        if not segments:
            return
        capas[capa_key_by_kind[kind]].add(layer or "")
        target = target_by_kind[kind]
        for start, end in segments:
            item: dict[str, object] = {"inicio": start, "fin": end}
            if layer:
                item["capa"] = layer
            target.append(item)

    def _add_label(entity: Any, layer: str | None) -> None:
        text = _text_of(entity)
        if not text:
            return
        position = _point_xy(getattr(entity.dxf, "insert", None))
        if position is None:
            position = _point_xy(getattr(entity.dxf, "align_point", None))
        if position is None:
            return
        label: dict[str, object] = {"texto": text, "posicion": position}
        if layer:
            label["capa"] = layer
        etiquetas.append(label)

    def _walk(entity: Any, layer_override: str | None, depth: int) -> None:
        dxftype = entity.dxftype()
        layer = layer_override or (
            str(entity.dxf.layer) if getattr(entity.dxf, "layer", None) else None
        )

        if dxftype in ("TEXT", "MTEXT"):
            _add_label(entity, layer)
            return
        if dxftype == "DIMENSION":
            record = _dimension_record(entity, layer)
            if record:
                dimensiones.append(record)
            return

        if dxftype == "INSERT":
            kind = classify_layer(layer)
            if kind == "mueble" and depth == 0:
                position = _point_xy(entity.dxf.insert)
                if position:
                    capas["muebles"].add(layer or "")
                    item: dict[str, object] = {
                        "bloque": str(getattr(entity.dxf, "name", "") or ""),
                        "posicion": position,
                        "capa": layer,
                    }
                    footprint = _insert_footprint(entity)
                    if footprint:
                        item["footprint"] = footprint
                    muebles.append(item)
            # Walls and openings routinely live inside block definitions (door
            # and window families), so the reference itself carries no geometry.
            # Resolve it, keeping the reference's layer for nested entities drawn
            # on layer "0" — the CAD convention for "inherit from the insert".
            if depth < MAX_INSERT_DEPTH and kind in ("pared", "abertura"):
                try:
                    children = list(entity.virtual_entities())
                except Exception:  # noqa: BLE001 - unresolvable xrefs/blocks
                    return
                for child in children:
                    child_layer = str(getattr(child.dxf, "layer", "") or "")
                    inherited = layer if child_layer in ("", "0") else child_layer
                    _walk(child, inherited, depth + 1)
            return

        kind = classify_layer(layer)
        if kind in ("pared", "abertura"):
            _add_segments(layer, kind, entity)

    for entity in msp:
        _walk(entity, None, 0)

    return {
        "paredes": paredes,
        "aberturas": aberturas,
        "muebles": muebles,
        "etiquetas_texto": etiquetas,
        "dimensiones": dimensiones,
        "capas_clasificadas": {
            key: sorted(value for value in values if value) for key, values in capas.items()
        },
        # Declared DXF units travel with the geometry so downstream consumers
        # (deterministic placement, chat snapping) never re-guess them.
        "insunits": read_dxf_insunits(doc),
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
