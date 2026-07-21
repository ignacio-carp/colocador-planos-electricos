"""Tests for symbol catalog helpers."""

import pytest

from cad_worker.symbol_catalog import (
    CATALOG,
    UnknownPlacementKindError,
    compute_symbol_radius_drawing_units,
    compute_symbol_scale,
    compute_symbol_scale_resolution,
    infer_insunits,
    resolve_placement_kind,
    resolve_symbol,
)
from cad_worker.unit_resolution import resolve_drawing_units


def test_resolve_symbol_rejects_missing_kind() -> None:
    with pytest.raises(UnknownPlacementKindError):
        resolve_symbol({})


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
    elements = ("centro", "brazo", "toma", "toma_especial", "llave", "tablero", "puesta_tierra")
    for element in elements:
        assert element in CATALOG


def test_infer_insunits_mm_for_large_span() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    assert infer_insunits(bbox) == 4


def test_symbol_radius_without_rooms_uses_bbox_safety_guard() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    radius = compute_symbol_radius_drawing_units(bbox, insunits=4)
    assert radius == 40.0


def test_plot_scale_clamps_measured_toma_footprint_to_room_limit() -> None:
    geometry = {
        "paredes": [
            {"inicio": [0, 0], "fin": [3000, 0]},
            {"inicio": [3000, 0], "fin": [3000, 4000]},
        ],
        "aberturas": [{"inicio": [1000, 0], "fin": [1900, 0]}],
    }
    room = {"vertices": [[0, 0], [3000, 0], [3000, 4000], [0, 4000]]}
    resolution = resolve_drawing_units(4, geometry, [room])
    scale = compute_symbol_scale_resolution(
        resolution,
        [room],
        {"min_x": 0, "min_y": 0, "max_x": 3000, "max_y": 4000},
        base_footprint=2.3,
    )
    assert scale.nominal_scale == pytest.approx(225.0)
    assert scale.scale_clamped is True
    assert scale.clamp_reason == "room_relative_footprint"
    assert abs(scale.final_footprint_m - 0.45) < 1e-9


def test_low_confidence_units_disable_metric_floor() -> None:
    """Header mentiroso + evidencia débil: el piso de 0.15 m no debe inflarse.

    Caso real Cambre: plano en metros con paredes fragmentadas (~0.15 du) y
    $INSUNITS=4. La resolución queda en confianza baja sin override; si el piso
    métrico se aplicara con per_meter=1000, el símbolo saldría de 150 m reales.
    El tope relativo a habitación es adimensional y debe mandar solo.
    """
    fragmented_walls = [
        {"inicio": [x * 0.15, 0], "fin": [(x + 1) * 0.15, 0]} for x in range(40)
    ]
    geometry = {"paredes": fragmented_walls, "aberturas": []}
    # Polígono fuera de banda en ambas interpretaciones (132 m² bajo metros,
    # absurdo bajo mm): el área no aporta evidencia y la confianza queda baja.
    room = {"vertices": [[100, 100], [103.3, 100], [103.3, 140], [100, 140]]}
    resolution = resolve_drawing_units(4, geometry, [room])
    assert resolution.confidence < 0.5, "el caso debe quedar en confianza baja"

    scale = compute_symbol_scale_resolution(
        resolution,
        [room],
        {"min_x": 0, "min_y": 0, "max_x": 9232, "max_y": 9264},
        base_footprint=2.3,
    )
    assert scale.scale_clamped is True
    assert scale.clamp_reason == "room_relative_footprint_low_confidence"
    # Tope adimensional: footprint final <= 15% del lado menor (3.3 du) en du.
    final_footprint_du = 2.3 * scale.final_scale
    assert final_footprint_du <= 0.15 * 3.3 + 1e-9
    # Y jamás el piso métrico envenenado (0.15 m x 1000 du/m = 150 du).
    assert final_footprint_du < 1.0


def test_compute_symbol_scale_uses_unit_block_radius() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    scale = compute_symbol_scale(bbox, insunits=4)
    radius = compute_symbol_radius_drawing_units(bbox, insunits=4)
    assert abs(scale - radius) < 1e-9
