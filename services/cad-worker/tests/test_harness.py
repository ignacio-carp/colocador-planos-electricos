"""The verification harness must be green: every fixture, every validator.

This is the executable form of the placement spec
(docs/placement-spec/reglas-dormitorio-tomas-v1.md §9). A failure here means
the deterministic placer violates an invariant — fix the placer, not the test.
"""

import pytest

pytest.importorskip("shapely", reason="detect-rooms validators need shapely")

from cad_worker.harness.runner import run_harness  # noqa: E402


def test_harness_all_checks_pass(tmp_path):
    report = run_harness(tmp_path)
    failed = [
        f"{fixture['fixture']}::{check['check']}"
        f"{'::' + check['room_id'] if check.get('room_id') else ''} — {check['detail']}"
        for fixture in report["fixtures"]
        for check in fixture["checks"]
        if not check["ok"]
    ]
    assert not failed, "checks fallidos:\n" + "\n".join(failed)
    assert report["summary"]["total_checks"] > 0
