"""Tests for DXF geometry extraction."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import ezdxf

from cad_worker.extract_geometry import extract_geometry, geometry_bounding_box


def _write_sample_dxf(path: Path) -> None:
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0))
    msp.add_lwpolyline([(100, 0), (100, 50), (0, 50)], close=True)
    msp.add_text("SALA", dxfattribs={"insert": (10, 10)})
    doc.saveas(path)


def test_extract_geometry_structure(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    _write_sample_dxf(src)
    result = extract_geometry(src)
    assert len(result["paredes"]) >= 1
    assert any(
        isinstance(l, dict) and l.get("texto") == "SALA" for l in result["etiquetas_texto"]
    )
    bbox = geometry_bounding_box(result)
    assert bbox is not None
    assert bbox["max_x"] >= bbox["min_x"]


def test_extract_geometry_cli(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    _write_sample_dxf(src)
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "extract-geometry", "--input", str(src), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert "paredes" in payload
