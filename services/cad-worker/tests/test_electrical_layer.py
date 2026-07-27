"""Tests for INSTALACION_ELECTRICA layer application."""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from cad_worker.constants import (
    DEFAULT_OUTLET_BLOCK_NAME,
    MAX_SYMBOL_PAPER_MM,
    MIN_SYMBOL_PAPER_MM,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.electrical_layer import apply_electrical_layer

ROOM_POLYGON = {
    "vertices": [
        {"x": 0, "y": 0},
        {"x": 5000, "y": 0},
        {"x": 5000, "y": 4000},
        {"x": 0, "y": 4000},
    ],
}


def _placement(x: float, y: float, *, element: str = "toma") -> dict[str, object]:
    return {
        "position": {"x": x, "y": y, "unit": "drawing_units"},
        "element": element,
        "room_polygon": ROOM_POLYGON,
    }


def test_apply_electrical_layer_adds_block_inserts(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [{"id": "outlet-test-01", **_placement(1000, 0)}]
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
    assert DEFAULT_OUTLET_BLOCK_NAME in [b.name for b in out_doc.blocks] or "CBR_TOMA" in [
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
            "room_polygon": ROOM_POLYGON,
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 1
    blocks_used = result.get("blocks_used", [])
    assert "CBR_LLAVE_1" in blocks_used or "CAMBRE_SWITCH" in blocks_used

    out_doc = ezdxf.readfile(str(out))
    block_names = [b.name for b in out_doc.blocks]
    assert "CBR_LLAVE_1" in block_names or "CAMBRE_SWITCH" in block_names
    inserts = [e for e in out_doc.modelspace() if e.dxftype() == "INSERT"]
    assert inserts[0].dxf.name in ("CBR_LLAVE_1", "CAMBRE_SWITCH")


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
            "room_polygon": ROOM_POLYGON,
        }
    ]
    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 1


def test_apply_skips_out_of_bbox(tmp_path: Path) -> None:
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.layers.add("MUROS")
    doc.modelspace().add_line((0, 0), (100, 0), dxfattribs={"layer": "MUROS"})
    doc.saveas(str(src))

    placements = [_placement(99999, 99999)]
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

    placements = [_placement(1000, 0)]
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
    assert len([item for item in xdata if item.code == CAMBRE_ROOM_GROUP_CODE]) == 3


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
        _placement(500, 0),
        _placement(1500, 0),
    ]
    result1 = apply_electrical_layer(src, out1, placements_kitchen, room_id="room-kitchen")
    assert result1["outlets_added"] == 2

    # Second run on out1 as input: add 1 outlet for room-living
    placements_living = [_placement(2500, 0)]
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
        [_placement(600, 0)],
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

    placements = [_placement(1000, 0)]
    result = apply_electrical_layer(src, out, placements, room_id="room-bath")
    assert result["ok"] is True
    assert result.get("source_layers_preserved") is True


def test_batch_mode_tags_entities_for_future_hygiene(tmp_path: Path) -> None:
    """Batch entities receive a sentinel room tag and generator lineage."""
    src = tmp_path / "in.dxf"
    out = tmp_path / "out.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    doc.saveas(str(src))

    placements = [_placement(1000, 0)]
    result = apply_electrical_layer(src, out, placements)  # no room_id
    assert result["ok"] is True
    assert result.get("room_id") is None
    saved = ezdxf.readfile(out)
    insert = next(entity for entity in saved.modelspace() if entity.dxftype() == "INSERT")
    assert insert.has_xdata("CAMBRE_ROOM")


def test_apply_removes_legacy_entities_and_purges_blocks(tmp_path: Path) -> None:
    from cad_worker.constants import LEGACY_BLOCK_NAMES

    src = tmp_path / "legacy.dxf"
    out = tmp_path / "clean.dxf"
    doc = ezdxf.new()
    doc.layers.new(OUTPUT_ELECTRICAL_LAYER_NAME)
    msp = doc.modelspace()
    msp.add_line((0, 0), (5000, 0))
    for index, block_name in enumerate(sorted(LEGACY_BLOCK_NAMES)):
        block = doc.blocks.new(block_name)
        block.add_circle((0, 0), 40 if "SWITCH" in block_name else 100)
        msp.add_blockref(
            block_name,
            (500 + index * 500, 0),
            dxfattribs={"layer": OUTPUT_ELECTRICAL_LAYER_NAME},
        )
    msp.add_line(
        (0, 0),
        (1, 1),
        dxfattribs={"layer": OUTPUT_ELECTRICAL_LAYER_NAME},
    )
    doc.saveas(src)

    result = apply_electrical_layer(src, out, [_placement(1000, 0)])
    # One blockref per legacy family plus the untagged stray line.
    assert result["legacy_entities_removed"] == len(LEGACY_BLOCK_NAMES) + 1
    assert set(result["legacy_blocks_purged"]) == set(LEGACY_BLOCK_NAMES)
    saved = ezdxf.readfile(out)
    assert not [
        entity
        for entity in saved.modelspace()
        if entity.dxftype() == "INSERT" and entity.dxf.name in LEGACY_BLOCK_NAMES
    ]


def test_apply_versions_poisoned_symbol_block(tmp_path: Path) -> None:
    src = tmp_path / "poison.dxf"
    out = tmp_path / "safe.dxf"
    doc = ezdxf.new()
    doc.modelspace().add_line((0, 0), (5000, 0))
    poisoned = doc.blocks.new("CBR_TOMA")
    poisoned.add_circle((0, 0), 100)
    doc.saveas(src)

    result = apply_electrical_layer(src, out, [_placement(1000, 0)])
    assert result["blocks_used"] == ["CBR_TOMA__V2"]
    saved = ezdxf.readfile(out)
    insert = next(entity for entity in saved.modelspace() if entity.dxftype() == "INSERT")
    assert insert.dxf.name == "CBR_TOMA__V2"


def test_apply_reports_degenerate_unknown_and_outside_placements(tmp_path: Path) -> None:
    src = tmp_path / "guard.dxf"
    out = tmp_path / "guarded.dxf"
    doc = ezdxf.new()
    doc.layers.new("MUROS")
    msp = doc.modelspace()
    for start, end in (
        ((0, 0), (5000, 0)),
        ((5000, 0), (5000, 4000)),
        ((5000, 4000), (0, 4000)),
        ((0, 4000), (0, 0)),
    ):
        msp.add_line(start, end, dxfattribs={"layer": "MUROS"})
    doc.saveas(src)
    placements = [
        {"element": "toma"},
        {"position": {"x": float("nan"), "y": 0}, "element": "toma"},
        {"position": {"x": 1000, "y": 1000}, "element": "unknown"},
        _placement(5200, 2000),
    ]
    result = apply_electrical_layer(src, out, placements)
    reasons = [item["reason"] for item in result["placements_rejected"]]
    assert reasons == [
        "missing_or_invalid_position",
        "non_finite_position",
        "unknown_placement_kind",
        "outside_room_polygon",
    ]
    assert result["outlets_added"] == 0


def test_symbols_are_drawn_once_per_document_at_a_legible_paper_size(tmp_path: Path) -> None:
    """One scale for every symbol, measured on the written geometry."""
    from ezdxf import bbox as ezdxf_bbox

    src = tmp_path / "rooms.dxf"
    out = tmp_path / "wired.dxf"
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 6
    doc.layers.new("MUROS")
    msp = doc.modelspace()
    for start, end in (
        ((0, 0), (5, 0)),
        ((5, 0), (5, 4)),
        ((5, 4), (0, 4)),
        ((0, 4), (0, 0)),
    ):
        msp.add_line(start, end, dxfattribs={"layer": "MUROS"})
    doc.saveas(src)

    polygon = {"vertices": [{"x": 0, "y": 0}, {"x": 5, "y": 0}, {"x": 5, "y": 4}, {"x": 0, "y": 4}]}
    placements = [
        {
            "element": element,
            "position": {"x": 1.0 + index, "y": 2.0},
            "room_polygon": polygon,
            "wall_normal": [0.0, 1.0],
        }
        for index, element in enumerate(("toma", "llave_3_puntos", "centro", "tablero"))
    ]

    result = apply_electrical_layer(src, out, placements)
    assert result["outlets_added"] == 4
    assert result["symbols_measured"] == 4
    assert MIN_SYMBOL_PAPER_MM <= result["symbol_paper_mm_min"]
    assert result["symbol_paper_mm_max"] <= MAX_SYMBOL_PAPER_MM

    saved = ezdxf.readfile(out)
    inserts = [
        entity
        for entity in saved.modelspace()
        if entity.dxftype() == "INSERT" and entity.dxf.layer == OUTPUT_ELECTRICAL_LAYER_NAME
    ]
    assert {round(float(entity.dxf.xscale), 9) for entity in inserts} == {
        round(result["symbol_scale"], 9),
    }, "a single document-wide scale, not one per room run"
    # 4.5 mm on paper at 1:100 is 0.45 m in a drawing measured in metres.
    toma = next(entity for entity in inserts if entity.dxf.name == "CBR_TOMA")
    extents = ezdxf_bbox.extents([toma], fast=True)
    assert max(
        float(extents.extmax.x - extents.extmin.x),
        float(extents.extmax.y - extents.extmin.y),
    ) == pytest.approx(0.45, abs=1e-6)


def test_illegible_symbols_are_refused_instead_of_written(tmp_path: Path) -> None:
    """The measured post-condition is the only thing that caught 200 m circles."""
    from cad_worker.electrical_layer import _audit_drawn_symbols

    src = tmp_path / "plan.dxf"
    doc = ezdxf.new()
    doc.layers.new(OUTPUT_ELECTRICAL_LAYER_NAME)
    block = doc.blocks.new("CBR_TOMA")
    block.add_circle((0, 0), 2.25)
    doc.modelspace().add_blockref(
        "CBR_TOMA",
        (0, 0),
        dxfattribs={"layer": OUTPUT_ELECTRICAL_LAYER_NAME, "xscale": 1.0, "yscale": 1.0},
    )
    doc.saveas(src)

    # Declaring a scale 100x larger than the one actually applied makes every
    # symbol measure 0.045 mm on paper.
    with pytest.raises(RuntimeError, match="illegible"):
        _audit_drawn_symbols(doc, OUTPUT_ELECTRICAL_LAYER_NAME, 100.0)
