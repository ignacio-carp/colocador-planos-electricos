"""Trust-but-verify unit resolution across the full architectural matrix."""

from __future__ import annotations

import pytest

from cad_worker.unit_resolution import resolve_drawing_units


def _geometry_and_room(per_meter: float) -> tuple[dict[str, object], dict[str, object]]:
    geometry: dict[str, object] = {
        "paredes": [
            {"inicio": [0, 0], "fin": [3 * per_meter, 0]},
            {"inicio": [3 * per_meter, 0], "fin": [3 * per_meter, 4 * per_meter]},
            {"inicio": [3 * per_meter, 4 * per_meter], "fin": [0, 4 * per_meter]},
            {"inicio": [0, 4 * per_meter], "fin": [0, 0]},
            # Rótulo/entidad lejana: robust statistics must not let it dominate.
            {"inicio": [0, 0], "fin": [9232 * per_meter, 0]},
        ],
        "aberturas": [{"inicio": [1 * per_meter, 0], "fin": [1.9 * per_meter, 0]}],
    }
    room = {
        "vertices": [
            [0, 0],
            [3 * per_meter, 0],
            [3 * per_meter, 4 * per_meter],
            [0, 4 * per_meter],
        ],
    }
    return geometry, room


@pytest.mark.parametrize(
    ("truth", "per_meter", "header"),
    [
        (4, 1000.0, 4),
        (4, 1000.0, 6),
        (4, 1000.0, None),
        (5, 100.0, 5),
        (5, 100.0, 4),
        (5, 100.0, None),
        (6, 1.0, 6),
        (6, 1.0, 4),
        (6, 1.0, None),
    ],
)
def test_unit_resolution_matrix(truth: int, per_meter: float, header: int | None) -> None:
    geometry, room = _geometry_and_room(per_meter)
    result = resolve_drawing_units(header, geometry, [room])
    assert result.effective_insunits == truth
    assert result.drawing_units_per_meter == per_meter
    assert result.overridden is (header is not None and header != truth)
    assert result.confidence >= 0.8
    assert len(result.evidence["strong_families"]) >= 2


def test_header_is_retained_when_only_one_evidence_family_disagrees() -> None:
    geometry = {"paredes": [{"inicio": [0, 0], "fin": [3, 0]}]}
    result = resolve_drawing_units(4, geometry, [])
    assert result.effective_insunits == 4
    assert result.overridden is False
    assert result.confidence < 0.5

