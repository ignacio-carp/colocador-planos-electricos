"""DXF save/load with non-ASCII layer and text content."""

from __future__ import annotations

from pathlib import Path

import ezdxf

from cad_worker.electrical_layer import apply_electrical_layer


def test_apply_electrical_layer_preserves_spanish_layer_names(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new(dxfversion="R2010")
    doc.layers.new("Instalación existente")
    msp = doc.modelspace()
    msp.add_line((0, 0), (4000, 0), dxfattribs={"layer": "Instalación existente"})
    msp.add_mtext("Baño principal", dxfattribs={"insert": (500, 500)})
    doc.saveas(str(src))

    result = apply_electrical_layer(
        src,
        out,
        [
            {
                "position": {"x": 1000, "y": 0},
                "element": "toma",
                "room_polygon": {
                    "vertices": [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
                },
            },
        ],
    )
    assert result["ok"] is True
    assert result["outlets_added"] == 1
    assert out.is_file()

    saved = ezdxf.readfile(str(out))
    layer_names = {layer.dxf.name for layer in saved.layers}
    assert "Instalación existente" in layer_names
