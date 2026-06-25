"""Tests for symbol catalog helpers."""

from cad_worker.symbol_catalog import (
    CATALOG,
    compute_symbol_radius_drawing_units,
    compute_symbol_scale,
    infer_insunits,
    resolve_placement_kind,
    resolve_symbol,
)


def test_resolve_symbol_defaults_to_standard() -> None:
    sym = resolve_symbol({})
    assert sym.block_name == "SYM_TOMA"
    assert sym.geometry == "toma"


def test_resolve_symbol_switch() -> None:
    sym = resolve_symbol({"outlet_type": "switch"})
    assert sym.block_name == "SYM_LLAVE"
    assert sym.geometry == "llave"


def test_resolve_symbol_vivienda_element_centro() -> None:
    sym = resolve_symbol({"element": "centro"})
    assert sym.block_name == "SYM_CENTRO"
    assert sym.geometry == "filled_circle"


def test_resolve_symbol_vivienda_toma() -> None:
    sym = resolve_symbol({"element": "toma"})
    assert sym.block_name == "SYM_TOMA"
    assert sym.geometry == "toma"


def test_resolve_placement_kind_legacy_alias() -> None:
    assert resolve_placement_kind({"outlet_type": "dedicated_appliance"}) == "toma_especial"


def test_vivienda_element_types_in_catalog() -> None:
    for element in ("centro", "brazo", "toma", "toma_especial", "llave", "tablero", "puesta_tierra"):
        assert element in CATALOG


def test_infer_insunits_mm_for_large_span() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    assert infer_insunits(bbox) == 4


def test_symbol_radius_mm_plan_about_15_units() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    radius = compute_symbol_radius_drawing_units(bbox, insunits=4)
    assert 8 <= radius <= 16


def test_symbol_radius_meter_plan_about_1_5cm() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 12, "max_y": 10}
    radius = compute_symbol_radius_drawing_units(bbox, insunits=6)
    assert abs(radius - 0.015) < 0.002


def test_compute_symbol_scale_uses_unit_block_radius() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    scale = compute_symbol_scale(bbox, insunits=4)
    radius = compute_symbol_radius_drawing_units(bbox, insunits=4)
    assert abs(scale - radius) < 1e-9
