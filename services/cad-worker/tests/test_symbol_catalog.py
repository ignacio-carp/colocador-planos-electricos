"""Tests for the paper-millimetre symbol catalog and its scale resolution."""

import pytest

from cad_worker.constants import MAX_SYMBOL_PAPER_MM, MIN_SYMBOL_PAPER_MM
from cad_worker.symbol_catalog import (
    CATALOG,
    UnknownPlacementKindError,
    compute_symbol_scale_resolution,
    infer_insunits,
    paper_mm_of,
    paper_size_is_legible,
    resolve_placement_kind,
    resolve_plot_scale,
    resolve_symbol,
)
from cad_worker.symbol_geometry import symbol_paper_extent, wall_rotation_degrees
from cad_worker.unit_resolution import resolve_drawing_units


def test_resolve_symbol_rejects_missing_kind() -> None:
    with pytest.raises(UnknownPlacementKindError):
        resolve_symbol({})


def test_resolve_symbol_switch() -> None:
    sym = resolve_symbol({"outlet_type": "switch"})
    assert sym.block_name == "CBR_LLAVE_1"
    assert sym.geometry == "llave"


def test_resolve_symbol_centro_does_not_rotate() -> None:
    sym = resolve_symbol({"element": "centro"})
    assert sym.geometry == "centro_luz"
    assert sym.rotates_with_wall is False


def test_resolve_symbol_toma() -> None:
    sym = resolve_symbol({"element": "toma"})
    assert sym.block_name == "CBR_TOMA"
    assert sym.geometry == "toma"


def test_resolve_placement_kind_legacy_alias() -> None:
    assert resolve_placement_kind({"outlet_type": "dedicated_appliance"}) == "toma_especial"
    assert resolve_placement_kind({"outlet_type": "double"}) == "toma_doble"


def test_catalog_covers_the_full_component_set() -> None:
    elements = (
        "toma",
        "toma_doble",
        "toma_especial",
        "centro",
        "brazo",
        "llave",
        "llave_2_puntos",
        "llave_3_puntos",
        "llave_combinacion",
        "tablero",
        "puesta_tierra",
    )
    for element in elements:
        assert element in CATALOG


def test_every_symbol_is_drawn_at_its_declared_paper_size() -> None:
    """The block definition is the specification: no symbol may drift from it."""
    for element, symbol in CATALOG.items():
        measured = symbol_paper_extent(symbol)
        assert measured == pytest.approx(symbol.paper_mm, abs=1e-6), element
        assert paper_size_is_legible(measured), element


def test_wall_rotation_points_symbol_into_the_room() -> None:
    # Local +Y must end up along the inward normal.
    assert wall_rotation_degrees((0.0, 1.0)) == pytest.approx(0.0)
    assert wall_rotation_degrees((1.0, 0.0)) == pytest.approx(-90.0)
    assert wall_rotation_degrees((-1.0, 0.0)) == pytest.approx(90.0)
    assert wall_rotation_degrees((0.0, 0.0)) == 0.0


def test_infer_insunits_mm_for_large_span() -> None:
    bbox = {"min_x": 0, "min_y": 0, "max_x": 8000, "max_y": 6000}
    assert infer_insunits(bbox) == 4


def test_plot_scale_read_from_dimension_layer_name() -> None:
    geometry = {
        "dimensiones": [
            {"medida_du": 4.3, "capa": "_NOM - COTAS 1.100"},
            {"medida_du": 2.0, "capa": "_NOM - COTAS 1.100"},
            {"medida_du": 1.5, "capa": "_AR - COTAS TERRENO"},
        ],
    }
    assert resolve_plot_scale(geometry) == 100.0


def test_plot_scale_defaults_when_the_drawing_does_not_state_it() -> None:
    assert resolve_plot_scale({"dimensiones": [{"medida_du": 4.3, "capa": "COTAS"}]}) == 100.0
    assert resolve_plot_scale(None) == 100.0


def test_scale_converts_paper_millimetres_to_drawing_units() -> None:
    """4.5 mm at 1:100 is 0.45 m, in whatever unit the drawing happens to use."""
    metres = compute_symbol_scale_resolution(
        resolve_drawing_units(6, {"paredes": [{"inicio": [0, 0], "fin": [4.0, 0]}]}, []),
        [],
        plot_scale=100.0,
        paper_mm=4.5,
    )
    millimetres = compute_symbol_scale_resolution(
        resolve_drawing_units(4, {"paredes": [{"inicio": [0, 0], "fin": [4000, 0]}]}, []),
        [],
        plot_scale=100.0,
        paper_mm=4.5,
    )
    assert 4.5 * metres.final_scale == pytest.approx(0.45)
    assert 4.5 * millimetres.final_scale == pytest.approx(450.0)


def test_room_relative_cap_reduces_the_symbol_in_a_tiny_room() -> None:
    geometry = {"paredes": [{"inicio": [0, 0], "fin": [3000, 0]}]}
    room = {"vertices": [[0, 0], [1500, 0], [1500, 2000], [0, 2000]]}
    resolution = resolve_drawing_units(4, geometry, [room])
    scale = compute_symbol_scale_resolution(
        resolution,
        [room],
        plot_scale=200.0,
        paper_mm=4.5,
    )
    assert scale.scale_clamped is True
    assert scale.clamp_reason in ("room_relative_footprint", "room_relative_footprint_floored")
    assert scale.final_scale < scale.nominal_scale
    if scale.clamp_reason == "room_relative_footprint":
        # The cap is a pure ratio: 15% of the 1.5 m minor dimension.
        assert 4.5 * scale.final_scale <= 0.15 * 1500 + 1e-9


def test_legibility_floor_stops_a_tiny_room_from_hiding_the_symbol() -> None:
    """A 1 m² toilette gets a symbol that overflows it, not one nobody can read.

    Only when the units are trustworthy: the floor is denominated in them, so
    under a wrong resolution it would inflate instead of protect.
    """
    geometry = {
        "paredes": [{"inicio": [0, 0], "fin": [4000, 0]}, {"inicio": [0, 0], "fin": [0, 3000]}],
        "dimensiones": [{"medida_du": 1000.0 * n, "dimlfac": 1.0} for n in (1, 2, 3, 4, 5, 6, 7)],
    }
    room = {"vertices": [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]}
    resolution = resolve_drawing_units(4, geometry, [room])
    assert resolution.confidence >= 0.5, "el caso necesita unidades confiables"

    scale = compute_symbol_scale_resolution(resolution, [room], plot_scale=100.0, paper_mm=4.5)
    assert scale.clamp_reason == "room_relative_footprint_floored"
    assert scale.final_paper_mm == pytest.approx(MIN_SYMBOL_PAPER_MM)


def test_room_relative_cap_still_bounds_the_symbol_under_wrong_units() -> None:
    """The cap is dimensionless, so a 1000x unit error cannot inflate the symbol.

    Real Cambre case: a plan in metres whose header claimed millimetres. A
    metre-denominated floor turned that into 150 m symbols; a ratio cannot.
    """
    fragmented = [{"inicio": [x * 0.15, 0], "fin": [(x + 1) * 0.15, 0]} for x in range(40)]
    geometry = {"paredes": fragmented, "aberturas": []}
    room = {"vertices": [[100, 100], [103.3, 100], [103.3, 140], [100, 140]]}
    resolution = resolve_drawing_units(4, geometry, [room])
    assert resolution.confidence < 0.5, "sin cotas la resolución debe quedar en baja confianza"

    scale = compute_symbol_scale_resolution(resolution, [room], plot_scale=100.0, paper_mm=4.5)
    footprint_du = 4.5 * scale.final_scale
    assert scale.scale_clamped is True
    assert footprint_du <= 0.15 * 3.3 + 1e-9
    assert footprint_du < 1.0


def test_paper_mm_of_inverts_the_scale() -> None:
    assert paper_mm_of(0.45, 0.1) == pytest.approx(4.5)
    assert paper_size_is_legible(paper_mm_of(0.45, 0.1))
    assert not paper_size_is_legible(MIN_SYMBOL_PAPER_MM - 0.5)
    assert not paper_size_is_legible(MAX_SYMBOL_PAPER_MM + 0.5)
