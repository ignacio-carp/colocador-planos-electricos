"""Harness runner: fixtures → pipeline → validators → pass/fail report.

Runs the fully deterministic chain (extract_geometry → detect_rooms →
place_outlets_for_room → apply_electrical_layer) twice from freshly built
DXFs and byte-compares the placements JSON, then validates every geometric
invariant of the placement spec. Offline, $0: no LLM is involved anywhere.

The LLM baseline (placement_mode=llm) cannot run here: it needs the Node API
plus an OpenAI key. The report keeps a `baseline` section documenting that.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.electrical_layer import apply_electrical_layer
from cad_worker.extract_geometry import extract_geometry
from cad_worker.harness.fixtures import Fixture, build_all_fixtures
from cad_worker.harness.validators import (
    Check,
    validate_detection,
    validate_drawn_output,
    validate_room,
)
from cad_worker.placement import PlacementError, place_outlets_for_room


def _find_rules_bundle() -> dict[str, Any]:
    """Load the ACTIVE normative ruleset from the repo (manifest-driven)."""
    current = Path(__file__).resolve()
    for parent in current.parents:
        manifest = parent / "rules" / "cambre-normative" / "manifest.json"
        if manifest.is_file():
            data = json.loads(manifest.read_text(encoding="utf-8"))
            active = data.get("active_version")
            for version in data.get("versions", []):
                if version.get("version") == active:
                    rules_path = manifest.parent / version["path"]
                    return json.loads(rules_path.read_text(encoding="utf-8"))
            raise RuntimeError(f"manifest sin version activa valida: {active}")
    raise RuntimeError("rules/cambre-normative/manifest.json no encontrado hacia arriba")


def _run_fixture_placements(
    fixture: Fixture,
    rules: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any | None], dict[str, str | None]]:
    """One deterministic pass: geometry, detection and per-room placements."""
    geometry = extract_geometry(fixture.dxf_path)
    detection = detect_rooms_from_walls(geometry, fixture.insunits)
    results: dict[str, Any | None] = {}
    errors: dict[str, str | None] = {}
    for truth in fixture.rooms:
        payload: dict[str, Any] = {
            "room": {
                "id": truth.id,
                "room_type": truth.room_type,
                "polygon": {"vertices": [{"x": x, "y": y} for x, y in truth.polygon]},
            },
            "geometry": geometry,
            "rules": rules,
        }
        if fixture.insunits is not None:
            payload["insunits"] = fixture.insunits
        try:
            results[truth.id] = place_outlets_for_room(payload)
            errors[truth.id] = None
        except PlacementError as exc:
            results[truth.id] = None
            errors[truth.id] = exc.code
    return geometry, detection, results, errors


def _placements_snapshot(results: dict[str, Any | None]) -> str:
    """Canonical JSON of every placement result (the determinism artifact)."""
    return json.dumps(
        {room_id: result for room_id, result in sorted(results.items())},
        sort_keys=True,
        ensure_ascii=True,
    )


def run_harness(work_dir: Path, report_path: Path | None = None) -> dict[str, Any]:
    work_dir = Path(work_dir)
    rules = _find_rules_bundle()
    all_checks: list[Check] = []
    fixture_reports: list[dict[str, Any]] = []

    fixtures_run1 = build_all_fixtures(work_dir / "run1")
    fixtures_run2 = build_all_fixtures(work_dir / "run2")

    for fixture, fixture_again in zip(fixtures_run1, fixtures_run2):
        geometry, detection, results, errors = _run_fixture_placements(fixture, rules)
        checks: list[Check] = []

        checks.extend(validate_detection(fixture, detection))
        for truth in fixture.rooms:
            checks.extend(
                validate_room(fixture, truth, results[truth.id], errors[truth.id], geometry),
            )

        # Draw the placements onto the fixture DXF and audit the drawn output.
        placements = [
            placement
            for result in results.values()
            if result
            for placement in result.get("outlet_placements", [])
        ]
        if placements:
            drawn_path = work_dir / "run1" / f"{fixture.name}__electrical.dxf"
            apply_result = apply_electrical_layer(fixture.dxf_path, drawn_path, placements)
            checks.extend(validate_drawn_output(fixture, apply_result, len(placements)))

        # Determinism: a second full pass from a freshly generated DXF must be
        # byte-identical at the placements JSON level.
        _, _, results2, _ = _run_fixture_placements(fixture_again, rules)
        snap1, snap2 = _placements_snapshot(results), _placements_snapshot(results2)
        checks.append(
            Check(
                fixture=fixture.name,
                check="determinism",
                ok=snap1 == snap2,
                detail="dos corridas byte-identicas"
                if snap1 == snap2
                else "los JSON de placements difieren entre corridas",
            ),
        )

        all_checks.extend(checks)
        fixture_reports.append(
            {
                "fixture": fixture.name,
                "description": fixture.description,
                "checks": [c.as_dict() for c in checks],
            },
        )

    passed = sum(1 for c in all_checks if c.ok)
    report: dict[str, Any] = {
        "mode": "deterministic",
        "ruleset": rules.get("version"),
        "fixtures": fixture_reports,
        "summary": {
            "total_checks": len(all_checks),
            "passed": passed,
            "failed": len(all_checks) - passed,
        },
        "baseline": {
            "mode": "llm",
            "status": "not_run",
            "reason": "requiere la API Node corriendo y OPENAI_API_KEY; "
            "el modo deterministico corre offline y sin costo",
        },
    }
    if report_path:
        report_path = Path(report_path)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    return report


def print_report(report: dict[str, Any]) -> None:
    for fixture in report["fixtures"]:
        print(f"\n== {fixture['fixture']} — {fixture['description']}")
        for check in fixture["checks"]:
            mark = "PASS" if check["ok"] else "FAIL"
            room = f" [{check['room_id']}]" if check.get("room_id") else ""
            print(f"  {mark:4} {check['check']}{room}: {check['detail']}")
    summary = report["summary"]
    print(
        f"\nTOTAL: {summary['passed']}/{summary['total_checks']} checks OK"
        f" — {summary['failed']} fallidos (ruleset {report.get('ruleset')})",
    )


def harness_cmd(out_dir: str | None, report: str | None) -> int:
    import tempfile

    if out_dir:
        work_dir = Path(out_dir)
        work_dir.mkdir(parents=True, exist_ok=True)
        result = run_harness(work_dir, Path(report) if report else None)
    else:
        with tempfile.TemporaryDirectory(prefix="cambre-harness-") as tmp:
            result = run_harness(Path(tmp), Path(report) if report else None)
    print_report(result)
    return 0 if result["summary"]["failed"] == 0 else 1
