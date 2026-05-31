"""Inspect a DXF file with ezdxf and emit JSON on stdout."""

from __future__ import annotations

import json
from pathlib import Path

import ezdxf

from cad_worker.constants import LEGACY_ELECTRICAL_LAYER_NAME, OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.dxf_io import open_dxf_file

INVALID_DXF_CODE = "CAD_WORKER_INVALID_DXF"


def inspect_dxf_file(path: Path) -> dict[str, object]:
    doc = open_dxf_file(path)
    msp = doc.modelspace()
    layers = sorted({layer.dxf.name for layer in doc.layers})
    entity_types: dict[str, int] = {}
    for entity in msp:
        name = entity.dxftype()
        entity_types[name] = entity_types.get(name, 0) + 1

    return {
        "ok": True,
        "path": str(path.resolve()),
        "dxf_version": doc.dxfversion,
        "layer_count": len(layers),
        "layers": layers[:50],
        "entity_count": sum(entity_types.values()),
        "entity_types": entity_types,
        "has_instalacion_electrica_layer": LEGACY_ELECTRICAL_LAYER_NAME in layers
        or OUTPUT_ELECTRICAL_LAYER_NAME in layers,
        "has_cambre_electrical_layer": OUTPUT_ELECTRICAL_LAYER_NAME in layers,
    }


def inspect_cmd(input_path: str) -> int:
    try:
        payload = inspect_dxf_file(Path(input_path))
        print(json.dumps(payload))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except (ezdxf.DXFStructureError, IOError, OSError) as e:
        print(json.dumps({"ok": False, "error": str(e), "code": INVALID_DXF_CODE}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
