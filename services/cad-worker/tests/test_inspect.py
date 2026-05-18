import json
import subprocess
import sys
from pathlib import Path

import ezdxf


def _write_minimal_dxf(path: Path) -> None:
    doc = ezdxf.new()
    doc.layers.add("Cambre_Electrical")
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 0))
    doc.saveas(path)


def test_inspect_cli_json(tmp_path: Path) -> None:
    dwg = tmp_path / "minimal.dxf"
    _write_minimal_dxf(dwg)
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "inspect", "--input", str(dwg), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["entity_count"] >= 1
    assert payload["has_cambre_electrical_layer"] is True
