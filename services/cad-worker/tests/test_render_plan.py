"""Tests for DXF plan/room PNG rendering."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import ezdxf

from cad_worker.render_plan import polygon_bbox, render_plan, render_room


def _write_sample_dxf(path: Path) -> None:
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0))
    msp.add_lwpolyline([(100, 0), (100, 50), (0, 50)], close=True)
    msp.add_text("SALA", dxfattribs={"insert": (10, 10)})
    doc.saveas(path)


def test_polygon_bbox() -> None:
    bbox = polygon_bbox([{"x": 0, "y": 0}, {"x": 100, "y": 50}], margin=10)
    assert bbox is not None
    assert bbox["min_x"] == -10
    assert bbox["max_x"] == 110


def test_render_plan_produces_png(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    out = tmp_path / "plan.png"
    _write_sample_dxf(src)
    result = render_plan(src, out, width_px=800)
    assert result.get("ok") is True
    assert out.is_file()
    assert out.stat().st_size > 100
    assert isinstance(result.get("bbox_drawing_units"), dict)
    assert (result.get("width_px") or 0) > 0


def test_render_room_crop(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    out = tmp_path / "room.png"
    _write_sample_dxf(src)
    vertices = [
        {"x": 0, "y": 0},
        {"x": 100, "y": 0},
        {"x": 100, "y": 50},
        {"x": 0, "y": 50},
    ]
    result = render_room(src, out, polygon_vertices=vertices, margin_mm=5, width_px=512)
    assert result.get("ok") is True
    assert out.is_file()


def test_render_plan_cli(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    out = tmp_path / "plan.png"
    _write_sample_dxf(src)
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "cad_worker",
            "render-plan",
            "--input",
            str(src),
            "--output",
            str(out),
            "--width-px",
            "640",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload.get("ok") is True
    assert out.is_file()
