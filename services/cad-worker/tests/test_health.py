from cad_worker.cli import health_cmd


def test_health_cmd_exits_ok() -> None:
    assert health_cmd() == 0
