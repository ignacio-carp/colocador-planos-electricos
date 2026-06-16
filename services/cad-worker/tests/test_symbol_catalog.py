"""Tests for symbol catalog helpers."""

from cad_worker.symbol_catalog import compute_symbol_scale, resolve_symbol


def test_resolve_symbol_defaults_to_standard() -> None:
    sym = resolve_symbol({})
    assert sym.block_name == "CAMBRE_OUTLET"


def test_resolve_symbol_switch() -> None:
    sym = resolve_symbol({"outlet_type": "switch"})
    assert sym.block_name == "CAMBRE_SWITCH"
    assert sym.geometry == "circle_s"


def test_compute_symbol_scale_clamps() -> None:
    small = compute_symbol_scale({"min_x": 0, "min_y": 0, "max_x": 100, "max_y": 100})
    assert small >= 20 / 40  # MIN / base radius

    large = compute_symbol_scale({"min_x": 0, "min_y": 0, "max_x": 50000, "max_y": 50000})
    assert large <= 80 / 40
