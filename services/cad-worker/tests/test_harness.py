"""The verification harness must be green: every fixture, every validator.

This is the executable form of the placement spec
(docs/placement-spec/reglas-dormitorio-tomas-v1.md §9). A failure here means
the deterministic placer violates an invariant — fix the placer, not the test.
"""

import pytest

from cad_worker.harness.runner import run_harness


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


def test_real_plans_pass_the_acceptance_gates(tmp_path):
    """The real corpus is the only thing that catches what fixtures cannot.

    Skipped when fixtures/real/ is absent: those are client CAD files, several
    megabytes each, and are deliberately not committed.
    """
    from cad_worker.harness.runner import EXPECTED_REAL_FAILURES, _run_real_plans

    real = _run_real_plans(tmp_path)
    if real["status"] != "ok":
        pytest.skip(real["reason"])

    failures = [
        "{}: {}".format(
            plan["plan"],
            "; ".join(
                "{} — {}".format(gate["gate"], gate["detail"])
                for gate in plan["gates"]
                if not gate["ok"]
            ),
        )
        for plan in real["plans"]
        if not plan["ok"] and plan["plan"] not in EXPECTED_REAL_FAILURES
    ]
    assert not failures, "planos reales fallidos:\n" + "\n".join(failures)
