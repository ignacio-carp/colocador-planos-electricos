"""Tests for DXF → SVG rendering."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import ezdxf

from cad_worker.render_svg import render_dxf_to_svg


def _write_sample_dxf(path: Path) -> None:
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0))
    msp.add_lwpolyline([(100, 0), (100, 50), (0, 50)], close=True)
    doc.saveas(path)


def test_render_dxf_to_svg_structure(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    _write_sample_dxf(src)
    result = render_dxf_to_svg(src)
    assert "<svg" in result["svg"]
    assert len(result["svg_inner"]) > 0
    assert result["view_box"] is not None
    assert result["view_box"]["w"] > 0
    assert result["dxf_bbox"]["max_x"] >= result["dxf_bbox"]["min_x"]
    assert result["entity_count"] >= 1


def test_render_svg_cli(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    _write_sample_dxf(src)
    proc = subprocess.run(
        [sys.executable, "-m", "cad_worker", "render-svg", "--input", str(src), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert "svg_inner" in payload
