"""Tests for bundled font bootstrap (headless / minimal containers)."""

from __future__ import annotations

import tempfile
from pathlib import Path

import ezdxf
import ezdxf.fonts.font_manager as fm
import pytest
from ezdxf import options
from ezdxf.fonts import fonts

from cad_worker.font_setup import ensure_drawing_fonts
from cad_worker.render_plan import render_plan


@pytest.fixture(autouse=True)
def _isolate_font_dirs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fm, "FONT_DIRECTORIES", {fm.LINUX: [], fm.WINDOWS: [], fm.MACOS: []})
    monkeypatch.setattr(fm, "LINUX_FONT_DIRS", [])
    monkeypatch.setattr(fm, "WIN_FONT_DIRS", [])
    monkeypatch.setattr(fm, "MACOS_FONT_DIRS", [])
    options.reset()
    fonts.build_system_font_cache()


def test_render_plan_with_bundled_fonts_only(tmp_path: Path) -> None:
    ensure_drawing_fonts(force=True)

    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_text("Sala", dxfattribs={"insert": (100, 100), "height": 250})
    msp.add_lwpolyline([(0, 0), (5000, 0), (5000, 4000), (0, 4000)], close=True)
    dxf_path = tmp_path / "plan.dxf"
    doc.saveas(dxf_path)

    out_png = tmp_path / "plan.png"
    result = render_plan(dxf_path, out_png, width_px=640)

    assert result["ok"] is True
    assert out_png.is_file()
    assert out_png.stat().st_size > 0
