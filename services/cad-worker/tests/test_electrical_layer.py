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
    assert DEFAULT_OUTLET_BLOCK_NAME in [b.name for b in out_doc.blocks] or "SYM_TOMA" in [
        b.name for b in out_doc.blocks
    ]
    inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
    assert len(inserts) >= 1
    lines = [e for e in out_doc.modelspace() if e.dxftype() == "LINE"]
    assert len(lines) == 1


def test_apply_electrical_layer_uses_outlet_type_block(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [
        {
            "position": {"x": 1000, "y": 0},
            "outlet_type": "switch",
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 1
    blocks_used = result.get("blocks_used", [])
    assert "SYM_LLAVE" in blocks_used or "CAMBRE_SWITCH" in blocks_used

    out_doc = ezdxf.readfile(str(out))
    block_names = [b.name for b in out_doc.blocks]
    assert "SYM_LLAVE" in block_names or "CAMBRE_SWITCH" in block_names
    inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
    assert inserts[0].dxf.name in ("SYM_LLAVE", "CAMBRE_SWITCH")


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


# US-013 incremental merge tests

def test_apply_with_room_id_tags_entities(tmp_path: Path) -> None:
    """Blockrefs added with room_id are tagged with XDATA."""
    from cad_worker.electrical_layer import CAMBRE_APPID, CAMBRE_ROOM_GROUP_CODE

    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [{"position": {"x": 1000, "y": 0}}]
    result = apply_electrical_layer(src, out, placements, room_id="room-kitchen")
    assert result["ok"] is True
    assert result["outlets_added"] == 1
    assert result.get("room_id") == "room-kitchen"
    assert result.get("outlets_removed") == 0

    out_doc = ezdxf.readfile(str(out))
    inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
    assert len(inserts) == 1
    entity = inserts[0]
    # Check xdata tag
    xdata = entity.get_xdata(CAMBRE_APPID)
    room_tag = next((item for item in xdata if item.code == CAMBRE_ROOM_GROUP_CODE), None)
    assert room_tag is not None
    assert room_tag.value == "room-kitchen"


def test_reprocesar_room_replaces_only_that_rooms_entities(tmp_path: Path) -> None:
    """Reprocesar a room removes existing tagged entities for that room only."""
    src = tmp_path / "in.dxf"
    out1 = tmp_path / "out1.dxf"
    out2 = tmp_path / "out2.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    # First run: add 2 outlets for room-kitchen
    placements_kitchen = [
        {"position": {"x": 500, "y": 0}},
        {"position": {"x": 1500, "y": 0}},
    ]
    result1 = apply_electrical_layer(src, out1, placements_kitchen, room_id="room-kitchen")
    assert result1["outlets_added"] == 2

    # Second run on out1 as input: add 1 outlet for room-living
    placements_living = [{"position": {"x": 2500, "y": 0}}]
    result2 = apply_electrical_layer(out1, out2, placements_living, room_id="room-living")
    assert result2["outlets_added"] == 1
    # No kitchen entities removed
    assert result2.get("outlets_removed") == 0

    # out2 should have 3 inserts total (2 kitchen + 1 living)
    out2_doc = ezdxf.readfile(str(out2))
    inserts = [e for e in out2_doc.modelspace() if e.dxftype() == "INSERT"]
    assert len(inserts) == 3

    # Reprocesar kitchen with 1 outlet: should remove 2 existing kitchen, add 1
    out3 = tmp_path / "out3.dxf"
    result3 = apply_electrical_layer(
        out2,
        out3,
        [{"position": {"x": 600, "y": 0}}],
        room_id="room-kitchen",
    )
    assert result3["outlets_added"] == 1
    assert result3.get("outlets_removed") == 2

    # out3 should have 2 inserts (1 new kitchen + 1 living)
    out3_doc = ezdxf.readfile(str(out3))
    inserts3 = [e for e in out3_doc.modelspace() if e.dxftype() == "INSERT"]
    assert len(inserts3) == 2


def test_incremental_preserves_source_non_electrical_layers(tmp_path: Path) -> None:
    """Source layers (non-Cambre_Electrical) must not be modified."""
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0))
    msp.add_line((0, 100), (5000, 100))
    doc.saveas(str(src))

    placements = [{"position": {"x": 1000, "y": 0}}]
    result = apply_electrical_layer(src, out, placements, room_id="room-bath")
    assert result["ok"] is True
    assert result.get("source_layers_preserved") is True


def test_batch_mode_no_room_id_unchanged(tmp_path: Path) -> None:
    """Without room_id (batch mode), entities are NOT tagged and not removed on re-run."""
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [{"position": {"x": 1000, "y": 0}}]
    result = apply_electrical_layer(src, out, placements)  # no room_id
    assert result["ok"] is True
    assert result.get("room_id") is None  # not tagged
