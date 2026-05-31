"""Tests for INSTALACION_ELECTRICA layer application."""

from __future__ import annotations

from pathlib import Path

import ezdxf

from cad_worker.constants import DEFAULT_OUTLET_BLOCK_NAME, OUTPUT_ELECTRICAL_LAYER_NAME
from cad_worker.electrical_layer import apply_electrical_layer


def test_apply_electrical_layer_adds_block_inserts(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [
        {
            "id": "outlet-test-01",
            "position": {"x": 1000, "y": 0, "unit": "drawing_units"},
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["ok"] is True
    assert result["outlets_added"] == 1
    assert result["layer"] == OUTPUT_ELECTRICAL_LAYER_NAME
    assert result["block_name"] == DEFAULT_OUTLET_BLOCK_NAME
    assert result.get("source_layers_preserved") is True
    assert isinstance(result.get("output_checksum_sha256"), str)
    assert len(result["output_checksum_sha256"]) == 64
    assert out.is_file()

    out_doc = ezdxf.readfile(str(out))
    assert OUTPUT_ELECTRICAL_LAYER_NAME in [layer.dxf.name for layer in out_doc.layers]
    assert DEFAULT_OUTLET_BLOCK_NAME in [b.name for b in out_doc.blocks]
    inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
    assert len(inserts) >= 1
    lines = [e for e in out_doc.modelspace() if e.dxftype() == "LINE"]
    assert len(lines) == 1


def test_apply_electrical_layer_nuevas_tomas_format(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (3000, 0))
    doc.saveas(str(src))

    placements = [
        {
            "coordenadas": [500, 100],
            "tipo_componente": "toma",
            "descripcion": "test",
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 1


def test_apply_skips_out_of_bbox(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (100, 0))
    doc.saveas(str(src))

    placements = [{"position": {"x": 99999, "y": 99999}}]
    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 0
    assert result.get("placements_skipped_out_of_bbox", 0) >= 1
