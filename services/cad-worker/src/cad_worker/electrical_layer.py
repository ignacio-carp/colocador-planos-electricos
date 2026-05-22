"""Add Cambre_Electrical layer with outlet circles to a DWG/DXF copy."""

from __future__ import annotations

import json
from pathlib import Path

import ezdxf


def apply_electrical_layer(
    input_path: Path,
    output_path: Path,
    placements: list[dict[str, object]],
) -> dict[str, object]:
    if not input_path.is_file():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    doc = ezdxf.readfile(str(input_path))
    layer_name = "Cambre_Electrical"
    if layer_name not in [layer.dxf.name for layer in doc.layers]:
        doc.layers.add(layer_name)

    msp = doc.modelspace()
    added = 0
    for item in placements:
        pos = item.get("position")
        if not isinstance(pos, dict):
            continue
        x = pos.get("x")
        y = pos.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        radius = 150.0
        msp.add_circle((float(x), float(y)), radius, dxfattribs={"layer": layer_name})
        added += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(str(output_path))

    return {
        "ok": True,
        "input": str(input_path.resolve()),
        "output": str(output_path.resolve()),
        "layer": layer_name,
        "outlets_added": added,
    }


def apply_layer_cmd(input_path: str, output_path: str, placements_json: str) -> int:
    try:
        placements = json.loads(placements_json)
        if not isinstance(placements, list):
            placements = []
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
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_INVALID_DWG"}))
        return 3
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(e), "code": "CAD_WORKER_ERROR"}))
        return 1
