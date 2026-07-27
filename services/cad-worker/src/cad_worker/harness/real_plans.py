"""End-to-end harness over real studio DXFs.

The synthetic fixtures check that the rules are applied correctly; they cannot
check that the engine survives a real drawing, because a real drawing is where
every assumption breaks. This runner takes an actual plan through the whole
chain — extract, detect rooms, place components, draw — and measures the result
against the acceptance gates.

The corpus lives in ``fixtures/real/`` and is not committed (client CAD files,
several MB each). When the directory is absent the harness reports the gates as
skipped instead of failing, so CI stays green without it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cad_worker.constants import (
    MAX_SYMBOL_PAPER_MM,
    MIN_SYMBOL_PAPER_MM,
    OUTPUT_ELECTRICAL_LAYER_NAME,
)
from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.electrical_layer import apply_electrical_layer
from cad_worker.extract_geometry import extract_geometry
from cad_worker.harness.runner import _find_rules_bundle
from cad_worker.placement import PlacementError, place_outlets_for_room
from cad_worker.room_labels import NON_WIRED_ROOM_TYPES
from cad_worker.unit_resolution import resolve_drawing_units

#: Margin around a room polygon when scoping geometry for the placer, in metres.
ROOM_SCOPE_MARGIN_M = 1.5


@dataclass
class Gate:
    name: str
    ok: bool
    detail: str


@dataclass
class RealPlanReport:
    plan: str
    ok: bool
    gates: list[Gate] = field(default_factory=list)
    rooms_detected: int = 0
    rooms_wired: int = 0
    components: dict[str, int] = field(default_factory=dict)
    room_errors: list[dict[str, str]] = field(default_factory=list)
    output_dxf: str | None = None
    render_png: str | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "plan": self.plan,
            "ok": self.ok,
            "rooms_detected": self.rooms_detected,
            "rooms_wired": self.rooms_wired,
            "components": self.components,
            "room_errors": self.room_errors,
            "output_dxf": self.output_dxf,
            "render_png": self.render_png,
            "error": self.error,
            "gates": [
                {"gate": gate.name, "ok": gate.ok, "detail": gate.detail} for gate in self.gates
            ],
        }


def _polygon_bbox(polygon: dict[str, Any], margin: float) -> tuple[float, float, float, float]:
    xs = [float(v["x"]) for v in polygon["vertices"]]
    ys = [float(v["y"]) for v in polygon["vertices"]]
    return (min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin)


def _scope_geometry(
    geometry: dict[str, Any],
    polygon: dict[str, Any],
    margin: float,
) -> dict[str, Any]:
    """Walls, openings and furniture near one room.

    A plan holds several floors side by side in the same modelspace; without
    scoping, a bedroom on the upper floor sees the ground floor's walls.
    """
    min_x, min_y, max_x, max_y = _polygon_bbox(polygon, margin)

    def near(item: dict[str, Any]) -> bool:
        for key in ("inicio", "fin", "posicion"):
            point = item.get(key)
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                x, y = float(point[0]), float(point[1])
                if min_x <= x <= max_x and min_y <= y <= max_y:
                    return True
        return False

    scoped: dict[str, Any] = {"insunits": geometry.get("insunits")}
    for key in ("paredes", "aberturas", "muebles"):
        items = geometry.get(key)
        if isinstance(items, list):
            scoped[key] = [item for item in items if isinstance(item, dict) and near(item)]
    scoped["dimensiones"] = geometry.get("dimensiones", [])
    return scoped


def run_real_plan(
    dxf_path: Path,
    out_dir: Path,
    *,
    render: bool = True,
) -> RealPlanReport:
    """Take one real plan through the whole chain and grade the result."""
    report = RealPlanReport(plan=dxf_path.name, ok=False)
    out_dir.mkdir(parents=True, exist_ok=True)

    geometry = extract_geometry(dxf_path)
    detection = detect_rooms_from_walls(geometry, geometry.get("insunits"))
    if not detection.get("ok"):
        report.error = f"{detection.get('code')}: {detection.get('error')}"
        report.gates.append(Gate("G1_rooms", False, report.error))
        return report

    rooms = detection.get("rooms", [])
    report.rooms_detected = len(rooms)
    labels_total = int(detection.get("labels_total") or 0)
    labels_resolved = int(detection.get("labels_resolved") or 0)
    coverage = labels_resolved / labels_total if labels_total else 0.0
    report.gates.append(
        Gate(
            "G1_rooms",
            coverage >= 0.90,
            f"{labels_resolved}/{labels_total} etiquetas resueltas ({coverage:.0%}) "
            f"en {len(rooms)} ambientes",
        ),
    )

    rules = _find_rules_bundle()
    resolution = resolve_drawing_units(geometry.get("insunits"), geometry, [])
    margin = ROOM_SCOPE_MARGIN_M * resolution.drawing_units_per_meter

    placements: list[dict[str, Any]] = []
    wired = 0
    for room in rooms:
        room_type = str(room.get("room_type") or "generico")
        if room_type in NON_WIRED_ROOM_TYPES:
            continue
        payload = {
            "room": {
                "id": room["id"],
                "room_type": room_type,
                "polygon": room["polygon"],
            },
            "geometry": _scope_geometry(geometry, room["polygon"], margin),
            "rules": rules,
            "insunits": geometry.get("insunits"),
        }
        try:
            result = place_outlets_for_room(payload, unit_resolution=resolution)
        except PlacementError as exc:
            report.room_errors.append({"room": room["id"], "code": exc.code, "error": str(exc)})
            continue
        room_placements = result.get("outlet_placements", [])
        if room_placements:
            wired += 1
        placements.extend(room_placements)

    report.rooms_wired = wired
    counts: dict[str, int] = {}
    for item in placements:
        element = str(item.get("element") or "toma")
        counts[element] = counts.get(element, 0) + 1
    report.components = dict(sorted(counts.items()))

    wireable = [
        room for room in rooms if str(room.get("room_type") or "") not in NON_WIRED_ROOM_TYPES
    ]
    report.gates.append(
        Gate(
            "G5_coverage",
            wired + len(report.room_errors) == len(wireable),
            f"{wired} ambientes cableados, {len(report.room_errors)} con error explícito, "
            f"de {len(wireable)} cableables",
        ),
    )

    if not placements:
        report.gates.append(Gate("G2_size", False, "no se dibujó ningún componente"))
        return report

    output_dxf = out_dir / f"{dxf_path.stem}-electrico.dxf"
    try:
        applied = apply_electrical_layer(dxf_path, output_dxf, placements)
    except RuntimeError as exc:
        report.error = str(exc)
        report.gates.append(Gate("G2_size", False, str(exc)))
        return report

    report.output_dxf = str(output_dxf)
    report.gates.append(
        Gate(
            "G2_size",
            bool(applied.get("symbols_measured")),
            f"{applied.get('symbols_measured')} símbolos entre "
            f"{applied.get('symbol_paper_mm_min')} y {applied.get('symbol_paper_mm_max')} mm de "
            f"papel (banda [{MIN_SYMBOL_PAPER_MM}, {MAX_SYMBOL_PAPER_MM}]), "
            f"escala única {applied.get('symbol_scale')}",
        ),
    )
    report.gates.append(_gate_orientation(placements))
    report.gates.append(_gate_containment(applied, rooms))
    report.gates.append(_gate_hygiene(applied))
    report.gates.append(_gate_idempotence(dxf_path, output_dxf, placements, out_dir))

    if render:
        report.render_png = _render(output_dxf, out_dir)

    report.ok = all(gate.ok for gate in report.gates)
    return report


def _gate_orientation(placements: list[dict[str, Any]]) -> Gate:
    wall_mounted = [item for item in placements if item.get("mounting") == "wall"]
    oriented = [item for item in wall_mounted if item.get("wall_normal")]
    return Gate(
        "G3_orientation",
        len(oriented) == len(wall_mounted) and bool(wall_mounted),
        f"{len(oriented)}/{len(wall_mounted)} componentes de pared con normal de pared",
    )


def _gate_containment(applied: dict[str, Any], rooms: list[dict[str, Any]]) -> Gate:
    rejected = applied.get("placements_rejected") or []
    outside = [item for item in rejected if item.get("reason") == "outside_room_polygon"]
    added = int(applied.get("outlets_added") or 0)
    return Gate(
        "G4_placement",
        not outside and added > 0,
        f"{added} componentes dibujados en {len(rooms)} ambientes, "
        f"{len(outside)} fuera de su polígono, {len(rejected)} rechazos en total",
    )


def _gate_hygiene(applied: dict[str, Any]) -> Gate:
    return Gate(
        "G6_hygiene",
        bool(applied.get("source_layers_preserved")),
        f"capas de origen intactas={applied.get('source_layers_preserved')}, "
        f"legacy removido={applied.get('legacy_entities_removed')}, "
        f"bloques purgados={applied.get('legacy_blocks_purged')}",
    )


def _gate_idempotence(
    dxf_path: Path,
    first_output: Path,
    placements: list[dict[str, Any]],
    out_dir: Path,
) -> Gate:
    """Same input, same placements, byte-identical geometry."""
    second = out_dir / f"{dxf_path.stem}-electrico-2.dxf"
    try:
        again = apply_electrical_layer(dxf_path, second, placements)
    except RuntimeError as exc:
        return Gate("G6_idempotence", False, str(exc))
    finally:
        pass
    first_id = None
    try:
        import ezdxf

        first_doc = ezdxf.readfile(first_output)
        first_id = sum(
            1
            for entity in first_doc.modelspace()
            if entity.dxftype() == "INSERT" and entity.dxf.layer == OUTPUT_ELECTRICAL_LAYER_NAME
        )
    except Exception as exc:  # noqa: BLE001
        return Gate("G6_idempotence", False, f"no se pudo releer la salida: {exc}")
    second.unlink(missing_ok=True)
    return Gate(
        "G6_idempotence",
        int(again.get("outlets_added") or -1) == first_id,
        f"primera corrida {first_id} inserts, segunda {again.get('outlets_added')}",
    )


def _render(output_dxf: Path, out_dir: Path) -> str | None:
    from cad_worker.render_plan import render_plan

    png = out_dir / f"{output_dxf.stem}.png"
    try:
        result = render_plan(output_dxf, png, width_px=2400)
    except Exception as exc:  # noqa: BLE001 - a render failure must not fail the gates
        return f"render failed: {exc}"
    return str(png) if result.get("ok") else None


def discover_real_plans(root: Path) -> list[Path]:
    """Real-plan corpus, or an empty list when it is not checked out."""
    if not root.is_dir():
        return []
    return sorted(path for path in root.glob("*.dxf") if path.is_file())
