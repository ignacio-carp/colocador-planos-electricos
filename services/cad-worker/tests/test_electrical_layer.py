"""Tests for Cambre_Electrical layer application."""

from __future__ import annotations

from pathlib import Path

import ezdxf

from cad_worker.electrical_layer import apply_electrical_layer


def test_apply_electrical_layer_adds_circles(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.saveas(str(src))

    placements = [
        {
            "id": "o1",
            "position": {"x": 1000, "y": 2000, "unit": "drawing_units"},
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["ok"] is True
    assert result["outlets_added"] == 1
    assert out.is_file()

    out_doc = ezdxf.readfile(str(out))
    assert "Cambre_Electrical" in [layer.dxf.name for layer in out_doc.layers]
    circles = [e for e in out_doc.modelspace() if e.dxftype() == "CIRCLE"]
    assert len(circles) >= 1
