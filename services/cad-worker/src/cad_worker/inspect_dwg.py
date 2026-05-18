"""Inspect a DWG/DXF file with ezdxf and emit JSON on stdout."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import ezdxf


def inspect_dwg_file(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"Input file not found: {path}")

    doc = ezdxf.readfile(str(path))
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
        "has_cambre_electrical_layer": "Cambre_Electrical" in layers,
    }


def inspect_cmd(input_path: str) -> int:
    try:
        payload = inspect_dwg_file(Path(input_path))
        print(json.dumps(payload))
        return 0
    except FileNotFoundError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_FILE_NOT_FOUND"}))
        return 2
    except ezdxf.DXFStructureError as e:
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_DWG"}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1


def main_json_stdout() -> None:
    """Entry when run as module with --input."""
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    raise SystemExit(inspect_cmd(args.input))
