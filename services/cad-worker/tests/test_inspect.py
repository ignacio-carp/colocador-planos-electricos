import json
import subprocess
import sys
from pathlib import Path

import ezdxf


def _write_minimal_dxf(path: Path) -> None:
    doc = ezdxf.new()
    doc.layers.add("INSTALACION_ELECTRICA")
    msp = doc.modelspace()
    msp.add_line((0, 0), (10, 0))
    doc.saveas(path)


def test_inspect_cli_json(tmp_path: Path) -> None:
    dxf = tmp_path / "minimal.dxf"
    _write_minimal_dxf(dxf)
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "inspect", "--input", str(dxf), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["entity_count"] >= 1
    assert payload["has_instalacion_electrica_layer"] is True


def test_inspect_invalid_dxf_code(tmp_path: Path) -> None:
    bad = tmp_path / "not.dxf"
    bad.write_text("not a dxf", encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "inspect", "--input", str(bad), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 3
    payload = json.loads(proc.stdout)
    assert payload["code"] == "CAD_WORKER_INVALID_DXF"
