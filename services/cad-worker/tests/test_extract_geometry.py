"""Tests for DXF geometry extraction."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import ezdxf

from cad_worker.extract_geometry import classify_layer, extract_geometry, geometry_bounding_box


def _write_sample_dxf(path: Path) -> None:
    doc = ezdxf.new()
    doc.layers.add("MUROS")
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "MUROS"})
    msp.add_lwpolyline([(100, 0), (100, 50), (0, 50)], close=True, dxfattribs={"layer": "MUROS"})
    msp.add_text("SALA", dxfattribs={"insert": (10, 10), "layer": "MUROS"})
    doc.saveas(path)


def test_extract_geometry_structure(tmp_path: Path) -> None:
    src = tmp_path / "plan.dxf"
    _write_sample_dxf(src)
    result = extract_geometry(src)
    assert len(result["paredes"]) >= 1
    assert "etiquetas_texto" not in result
    assert result["aberturas"] == []
    bbox = geometry_bounding_box(result)
    assert bbox is not None
    assert bbox["max_x"] >= bbox["min_x"]


def _write_layered_dxf(path: Path) -> None:
    doc = ezdxf.new()
    for layer in ("MUROS", "PUERTAS", "MOBILIARIO"):
        doc.layers.add(layer)
    doc.blocks.new(name="SILLA")
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "MUROS"})
    msp.add_line((40, 0), (50, 0), dxfattribs={"layer": "PUERTAS"})
    msp.add_blockref("SILLA", (20, 20), dxfattribs={"layer": "MOBILIARIO"})
    msp.add_text("COCINA", dxfattribs={"insert": (10, 10), "layer": "MUROS"})
    doc.saveas(path)


def test_classify_layer_tokens() -> None:
    assert classify_layer("A-WALL") == "pared"
    assert classify_layer("Puertas_PB") == "abertura"
    assert classify_layer("VENTANAS") == "abertura"
    assert classify_layer("Mobiliario fijo") == "mueble"
    assert classify_layer("Cotas") is None
    assert classify_layer(None) is None


def test_extract_geometry_classifies_layers(tmp_path: Path) -> None:
    src = tmp_path / "layered.dxf"
    _write_layered_dxf(src)
    result = extract_geometry(src)

    paredes = result["paredes"]
    assert any(seg.get("capa") == "MUROS" for seg in paredes)
    assert all(seg.get("capa") != "PUERTAS" for seg in paredes)

    aberturas = result["aberturas"]
    assert len(aberturas) == 1
    assert aberturas[0]["capa"] == "PUERTAS"

    muebles = result["muebles"]
    assert len(muebles) == 1
    assert muebles[0]["bloque"] == "SILLA"
    assert muebles[0]["capa"] == "MOBILIARIO"

    capas = result["capas_clasificadas"]
    assert capas["paredes"] == ["MUROS"]
    assert capas["aberturas"] == ["PUERTAS"]
    assert capas["muebles"] == ["MOBILIARIO"]


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
    assert "aberturas" in payload
    assert "muebles" in payload
