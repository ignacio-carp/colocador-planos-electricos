"""Synthetic DXF fixtures with hand-computable expected answers.

Each fixture builds a minimal plan with ezdxf using the layer tokens that
extract_geometry classifies (MUROS/ABERTURAS/MUEBLES) and declares its ground
truth: room polygons, expected outlet counts, and — where the spec pins the
exact answer (bedroom headboard pair) — expected coordinates in drawing units.

Walls are drawn as continuous single lines (door leaves live on ABERTURAS as
overlaid segments) so the wall graph stays closed for polygonize-based room
detection, mirroring the single-line-wall convention of the spec fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import ezdxf

from cad_worker.constants import LEGACY_BLOCK_NAMES, OUTPUT_ELECTRICAL_LAYER_NAME

WALL_LAYER = "MUROS"
OPENING_LAYER = "ABERTURAS"
FURNITURE_LAYER = "MUEBLES"

Point = tuple[float, float]


@dataclass
class RoomTruth:
    """Ground truth for one room of a fixture."""

    id: str
    room_type: str
    polygon: list[Point]
    expected_outlets: int
    # Exact expected placement points (du) when computable by hand (spec §4.5).
    expected_points: list[Point] = field(default_factory=list)
    # Minimum number of pairwise non-collinear walls the placements must use.
    expected_distinct_walls: int = 1
    expected_warnings: list[str] = field(default_factory=list)
    expected_error_code: str | None = None


@dataclass
class Fixture:
    name: str
    description: str
    insunits: int | None  # written to the DXF header; None → leave unitless (0)
    du_per_m: float  # ground-truth conversion for tolerances
    rooms: list[RoomTruth]
    expected_detected_rooms: int | None  # polygonize result; None → detection must fail
    dxf_path: Path | None = None
    expected_effective_insunits: int | None = None
    expect_insunits_override: bool = False
    expected_legacy_entities_removed: int = 0
    expect_poison_versioned: bool = False
    adversarial_placements: list[dict[str, object]] = field(default_factory=list)
    expected_rejection_reasons: list[str] = field(default_factory=list)

    def tol(self, mm: float) -> float:
        return mm * self.du_per_m / 1000.0


def _new_doc(insunits: int | None) -> ezdxf.document.Drawing:
    doc = ezdxf.new("R2010", setup=False)
    doc.header["$INSUNITS"] = insunits if insunits is not None else 0
    for layer in (WALL_LAYER, OPENING_LAYER, FURNITURE_LAYER):
        doc.layers.new(name=layer)
    return doc


def _add_walls(msp, segments: list[tuple[Point, Point]]) -> None:
    for start, end in segments:
        msp.add_line(start, end, dxfattribs={"layer": WALL_LAYER})


def _add_openings(msp, segments: list[tuple[Point, Point]]) -> None:
    for start, end in segments:
        msp.add_line(start, end, dxfattribs={"layer": OPENING_LAYER})


def _ensure_rect_block(doc, name: str, width: float, height: float) -> None:
    if name in doc.blocks:
        return
    block = doc.blocks.new(name=name)
    block.add_lwpolyline(
        [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)],
        close=True,
    )


def _insert_furniture(msp, doc, block: str, width: float, height: float, at: Point) -> None:
    _ensure_rect_block(doc, block, width, height)
    msp.add_blockref(block, at, dxfattribs={"layer": FURNITURE_LAYER})


def _rect_walls(x0: float, y0: float, x1: float, y1: float) -> list[tuple[Point, Point]]:
    return [
        ((x0, y0), (x1, y0)),
        ((x1, y0), (x1, y1)),
        ((x1, y1), (x0, y1)),
        ((x0, y1), (x0, y0)),
    ]


def _rect_polygon(x0: float, y0: float, x1: float, y1: float) -> list[Point]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# --- Fixture builders (mm unless stated; k scales for the meters variant) ---


def _dormitorio_basico(out_dir: Path, *, name: str, insunits: int | None, k: float) -> Fixture:
    """3×4 m bedroom, door south, 1.4×2.0 m bed against north wall.

    Spec §4.5 canonical case: exactly 2 outlets flanking the bed on the north
    wall at offset_cama=200 mm from the footprint, nudged 10 mm inward.
    """
    doc = _new_doc(insunits)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0, 0, 3000 * k, 4000 * k))
    _add_openings(msp, [((1050 * k, 0), (1950 * k, 0))])
    _insert_furniture(msp, doc, "CAMA_MATRIMONIAL", 1400 * k, 2000 * k, (800 * k, 2000 * k))
    path = out_dir / f"{name}.dxf"
    doc.saveas(path)
    return Fixture(
        name=name,
        description="Dormitorio 3x4, puerta sur, cama contra pared norte (caso canonico)",
        insunits=insunits,
        du_per_m=1000.0 * k,
        rooms=[
            RoomTruth(
                id="dorm-01",
                room_type="dormitorio",
                polygon=_rect_polygon(0, 0, 3000 * k, 4000 * k),
                expected_outlets=2,
                expected_points=[(600 * k, 3990 * k), (2400 * k, 3990 * k)],
                expected_distinct_walls=1,  # headboard pair shares the north wall
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
    )


def _dormitorio_dos_puertas(out_dir: Path) -> Fixture:
    """3.5×3.5 m bedroom, doors south and east, bed against west wall."""
    doc = _new_doc(4)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0, 0, 3500, 3500))
    _add_openings(msp, [((300, 0), (1200, 0)), ((3500, 2400), (3500, 3300))])
    _insert_furniture(msp, doc, "CAMA_QUEEN", 2000, 1400, (0, 1050))
    path = out_dir / "dormitorio_dos_puertas.dxf"
    doc.saveas(path)
    return Fixture(
        name="dormitorio_dos_puertas",
        description="Dormitorio con dos puertas, cama contra pared oeste",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="dorm-02",
                room_type="bedroom",
                polygon=_rect_polygon(0, 0, 3500, 3500),
                expected_outlets=2,
                expected_points=[(10, 850), (10, 2650)],
                expected_distinct_walls=1,
            ),
        ],
        expected_detected_rooms=1,
    dxf_path=path,
    )


def _ambiente_l(out_dir: Path) -> Fixture:
    """L-shaped living room; spacing 6 m over 18.8 m usable → 4 outlets."""
    doc = _new_doc(4)
    msp = doc.modelspace()
    poly: list[Point] = [(0, 0), (5000, 0), (5000, 3000), (2500, 3000), (2500, 5000), (0, 5000)]
    walls = [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
    _add_walls(msp, walls)
    _add_openings(msp, [((2000, 0), (2900, 0))])
    path = out_dir / "ambiente_l.dxf"
    doc.saveas(path)
    return Fixture(
        name="ambiente_l",
        description="Estar en L, puerta sur; spacing 6 m exige 4 tomas en paredes distintas",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="estar-l",
                room_type="living",
                polygon=poly,
                expected_outlets=4,
                expected_distinct_walls=4,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
    )


def _cocina(out_dir: Path) -> Fixture:
    """3×3 m kitchen with a counter block; v1 places generic + honest warning."""
    doc = _new_doc(4)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0, 0, 3000, 3000))
    _add_openings(msp, [((1050, 0), (1950, 0))])
    _insert_furniture(msp, doc, "MESADA", 600, 2400, (2400, 300))
    path = out_dir / "cocina.dxf"
    doc.saveas(path)
    return Fixture(
        name="cocina",
        description="Cocina 3x3 con mesada; v1 = algoritmo generico + warning de mesada",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="cocina-01",
                room_type="cocina",
                polygon=_rect_polygon(0, 0, 3000, 3000),
                expected_outlets=2,
                expected_distinct_walls=2,
                expected_warnings=["KITCHEN-COUNTER-UNVERIFIED"],
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
    )


def _multi_habitacion(out_dir: Path) -> Fixture:
    """Two rooms sharing a divider wall with an interior door."""
    doc = _new_doc(4)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0, 0, 8000, 4000) + [((3000, 0), (3000, 4000))])
    _add_openings(
        msp,
        [
            ((1050, 0), (1950, 0)),  # dormitorio exterior door
            ((3000, 1500), (3000, 2400)),  # interior door in the divider
            ((5000, 0), (5900, 0)),  # estar exterior door
        ],
    )
    _insert_furniture(msp, doc, "CAMA_MATRIMONIAL", 1400, 2000, (800, 2000))
    path = out_dir / "multi_habitacion.dxf"
    doc.saveas(path)
    return Fixture(
        name="multi_habitacion",
        description="Dormitorio + estar con pared divisoria y puerta interior",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="dorm-m",
                room_type="dormitorio",
                polygon=_rect_polygon(0, 0, 3000, 4000),
                expected_outlets=2,
                expected_points=[(600, 3990), (2400, 3990)],
                expected_distinct_walls=1,
            ),
            RoomTruth(
                id="estar-m",
                room_type="living",
                polygon=_rect_polygon(3000, 0, 8000, 4000),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        ],
        expected_detected_rooms=2,
        dxf_path=path,
    )


def _estar_pared_larga(out_dir: Path) -> Fixture:
    """8×2 m living, central south door; catches same-wall double placement.

    Usable 18.8 m → 4 outlets. Four walls have usable spans, so spec §6.3
    demands four distinct walls — a placer that ranks spans statically puts
    two on the south wall and skips the west one.
    """
    doc = _new_doc(4)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0, 0, 8000, 2000))
    _add_openings(msp, [((3550, 0), (4450, 0))])
    path = out_dir / "estar_pared_larga.dxf"
    doc.saveas(path)
    return Fixture(
        name="estar_pared_larga",
        description="Estar 8x2, puerta sur central; 4 tomas deben usar 4 paredes distintas",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="estar-largo",
                room_type="living",
                polygon=_rect_polygon(0, 0, 8000, 2000),
                expected_outlets=4,
                expected_distinct_walls=4,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
    )


def _sin_paredes(out_dir: Path) -> Fixture:
    """Furniture-only DXF: extraction yields no walls → explicit error (spec §7)."""
    doc = _new_doc(4)
    msp = doc.modelspace()
    _insert_furniture(msp, doc, "CAMA_MATRIMONIAL", 1400, 2000, (800, 2000))
    path = out_dir / "sin_paredes.dxf"
    doc.saveas(path)
    return Fixture(
        name="sin_paredes",
        description="Sin capa de muros: el colocador debe fallar explicito, nunca inventar",
        insunits=4,
        du_per_m=1000.0,
        rooms=[
            RoomTruth(
                id="dorm-x",
                room_type="dormitorio",
                polygon=_rect_polygon(0, 0, 3000, 4000),
                expected_outlets=0,
                expected_error_code="NO_WALLS_FOR_ROOM",
            ),
        ],
        expected_detected_rooms=None,
        dxf_path=path,
    )


def _unit_matrix_fixture(
    out_dir: Path,
    *,
    unit_name: str,
    truth_insunits: int,
    header_insunits: int | None,
    header_state: str,
) -> Fixture:
    per_meter = {4: 1000.0, 5: 100.0, 6: 1.0}[truth_insunits]
    doc = _new_doc(header_insunits)
    msp = doc.modelspace()
    x0, y0 = 10.0 * per_meter, 8.0 * per_meter
    x1, y1 = x0 + 3.0 * per_meter, y0 + 4.0 * per_meter
    _add_walls(msp, _rect_walls(x0, y0, x1, y1))
    _add_openings(
        msp,
        [((x0 + 1.0 * per_meter, y0), (x0 + 1.9 * per_meter, y0))],
    )
    name = f"unidades_{unit_name}_{header_state}"
    path = out_dir / f"{name}.dxf"
    doc.saveas(path)
    return Fixture(
        name=name,
        description=(
            f"Geometria real en {unit_name}; header {header_state} "
            "para matriz trust-but-verify"
        ),
        insunits=header_insunits,
        du_per_m=per_meter,
        rooms=[
            RoomTruth(
                id=f"room-{unit_name}-{header_state}",
                room_type="living",
                polygon=_rect_polygon(x0, y0, x1, y1),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
        expected_effective_insunits=truth_insunits,
        expect_insunits_override=(
            header_insunits is not None and header_insunits != truth_insunits
        ),
    )


def _tres_plantas_adversario(out_dir: Path) -> Fixture:
    """Three stacked views plus unclassified grids/title/origin contamination."""
    doc = _new_doc(4)
    doc.layers.new(name="GRID")
    doc.layers.new(name="ROTULO")
    msp = doc.modelspace()
    rooms: list[RoomTruth] = []
    for index, y0 in enumerate((0.0, 6000.0, 12000.0), start=1):
        x0, x1, y1 = 10000.0, 13000.0, y0 + 4000.0
        _add_walls(msp, _rect_walls(x0, y0, x1, y1))
        _add_openings(msp, [((11000.0, y0), (11900.0, y0))])
        rooms.append(
            RoomTruth(
                id=f"planta-{index}",
                room_type="living",
                polygon=_rect_polygon(x0, y0, x1, y1),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        )
    for x in (9500.0, 11500.0, 13500.0):
        msp.add_line((x, -1000.0), (x, 17000.0), dxfattribs={"layer": "GRID"})
    msp.add_line((80000.0, 80000.0), (120000.0, 80000.0), dxfattribs={"layer": "ROTULO"})
    msp.add_line((0.0, 0.0), (100.0, 0.0), dxfattribs={"layer": "GRID"})
    path = out_dir / "tres_plantas_adversario.dxf"
    doc.saveas(path)
    return Fixture(
        name="tres_plantas_adversario",
        description="Tres plantas apiladas, grillas cruzadas, rotulo lejano y ruido en origen",
        insunits=4,
        du_per_m=1000.0,
        rooms=rooms,
        expected_detected_rooms=3,
        dxf_path=path,
        expected_effective_insunits=4,
    )


def _legacy_fixture(out_dir: Path) -> Fixture:
    doc = _new_doc(6)
    doc.layers.new(name=OUTPUT_ELECTRICAL_LAYER_NAME)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(0.0, 0.0, 3.0, 4.0))
    _add_openings(msp, [((1.0, 0.0), (1.9, 0.0))])
    for index, block_name in enumerate(sorted(LEGACY_BLOCK_NAMES)):
        block = doc.blocks.new(name=block_name)
        block.add_circle((0.0, 0.0), 40.0 if "SWITCH" in block_name else 100.0)
        msp.add_blockref(
            block_name,
            (0.5 + index * 0.4, 2.0),
            dxfattribs={"layer": OUTPUT_ELECTRICAL_LAYER_NAME},
        )
    msp.add_line(
        (0.2, 0.2),
        (0.8, 0.2),
        dxfattribs={"layer": OUTPUT_ELECTRICAL_LAYER_NAME},
    )
    path = out_dir / "contenido_legacy.dxf"
    doc.saveas(path)
    return Fixture(
        name="contenido_legacy",
        description="Capa electrica pre-poblada con cinco bloques CAMBRE_* gigantes sin XDATA",
        insunits=6,
        du_per_m=1.0,
        rooms=[
            RoomTruth(
                id="legacy-room",
                room_type="living",
                polygon=_rect_polygon(0.0, 0.0, 3.0, 4.0),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
        expected_effective_insunits=6,
        expected_legacy_entities_removed=6,
    )


def _poisoned_symbol_fixture(out_dir: Path) -> Fixture:
    doc = _new_doc(6)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(10.0, 8.0, 13.0, 12.0))
    _add_openings(msp, [((11.0, 8.0), (11.9, 8.0))])
    poisoned = doc.blocks.new(name="SYM_TOMA")
    poisoned.add_circle((0.0, 0.0), 100.0)
    path = out_dir / "simbolo_envenenado.dxf"
    doc.saveas(path)
    return Fixture(
        name="simbolo_envenenado",
        description="Definicion SYM_TOMA preexistente con footprint gigante",
        insunits=6,
        du_per_m=1.0,
        rooms=[
            RoomTruth(
                id="poison-room",
                room_type="living",
                polygon=_rect_polygon(10.0, 8.0, 13.0, 12.0),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
        expected_effective_insunits=6,
        expect_poison_versioned=True,
    )


def _degenerate_placements_fixture(out_dir: Path) -> Fixture:
    doc = _new_doc(6)
    msp = doc.modelspace()
    _add_walls(msp, _rect_walls(10.0, 8.0, 13.0, 12.0))
    _add_openings(msp, [((11.0, 8.0), (11.9, 8.0))])
    # Classified noise makes (0, 0) pass the bbox guard; the origin guard must reject it.
    _add_walls(msp, [((0.0, 0.0), (0.2, 0.0))])
    polygon = {"vertices": [{"x": 10.0, "y": 8.0}, {"x": 13.0, "y": 8.0},
                            {"x": 13.0, "y": 12.0}, {"x": 10.0, "y": 12.0}]}
    path = out_dir / "placements_degenerados.dxf"
    doc.saveas(path)
    return Fixture(
        name="placements_degenerados",
        description="Placements explicito en origen, NaN, tipo desconocido y sin posicion",
        insunits=6,
        du_per_m=1.0,
        rooms=[
            RoomTruth(
                id="guard-room",
                room_type="living",
                polygon=_rect_polygon(10.0, 8.0, 13.0, 12.0),
                expected_outlets=3,
                expected_distinct_walls=3,
            ),
        ],
        expected_detected_rooms=1,
        dxf_path=path,
        expected_effective_insunits=6,
        adversarial_placements=[
            {"position": {"x": 0.0, "y": 0.0}, "element": "toma", "room_polygon": polygon},
            {"position": {"x": float("nan"), "y": 9.0}, "element": "toma"},
            {"position": {"x": 11.0, "y": 9.0}, "element": "desconocido"},
            {"element": "toma"},
        ],
        expected_rejection_reasons=[
            "origin_guard",
            "non_finite_position",
            "unknown_placement_kind",
            "missing_or_invalid_position",
        ],
    )


def build_all_fixtures(out_dir: Path) -> list[Fixture]:
    """Build every fixture DXF under out_dir and return their ground truths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    fixtures = [
        _dormitorio_basico(out_dir, name="dormitorio_basico", insunits=4, k=1.0),
        _dormitorio_basico(out_dir, name="dormitorio_metros", insunits=6, k=1.0 / 1000.0),
        _dormitorio_basico(out_dir, name="dormitorio_sin_insunits", insunits=None, k=1.0),
        _dormitorio_dos_puertas(out_dir),
        _ambiente_l(out_dir),
        _cocina(out_dir),
        _multi_habitacion(out_dir),
        _estar_pared_larga(out_dir),
        _sin_paredes(out_dir),
    ]
    lying_headers = {4: 6, 5: 4, 6: 4}
    for unit_name, truth_insunits in (("mm", 4), ("cm", 5), ("m", 6)):
        fixtures.extend(
            [
                _unit_matrix_fixture(
                    out_dir,
                    unit_name=unit_name,
                    truth_insunits=truth_insunits,
                    header_insunits=truth_insunits,
                    header_state="correcto",
                ),
                _unit_matrix_fixture(
                    out_dir,
                    unit_name=unit_name,
                    truth_insunits=truth_insunits,
                    header_insunits=lying_headers[truth_insunits],
                    header_state="mentiroso",
                ),
                _unit_matrix_fixture(
                    out_dir,
                    unit_name=unit_name,
                    truth_insunits=truth_insunits,
                    header_insunits=None,
                    header_state="ausente",
                ),
            ],
        )
    fixtures.extend(
        [
            _tres_plantas_adversario(out_dir),
            _legacy_fixture(out_dir),
            _poisoned_symbol_fixture(out_dir),
            _degenerate_placements_fixture(out_dir),
        ],
    )
    return fixtures
