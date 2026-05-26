import argparse
import json
import os
import sys
from datetime import datetime, timezone

from cad_worker.electrical_layer import apply_layer_cmd
from cad_worker.inspect_dwg import inspect_cmd


def _health_payload() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "cad-worker",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def health_cmd() -> int:
    print(json.dumps(_health_payload()))
    return 0


def pipeline_log_cmd(job_id: str) -> int:
    """Emit one JSON log line — simulates worker receiving correlation from S-01 / API."""
    correlation_id = os.environ.get("CAD_CORRELATION_ID", "").strip() or "unset"
    line = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": "info",
        "event": "worker_step",
        "service": "cad-worker",
        "job_id": job_id,
        "correlation_id": correlation_id,
        "step": "cad_stub",
        "hint": "Orchestrator should set CAD_CORRELATION_ID or HTTP X-Correlation-Id equivalent.",
    }
    print(json.dumps(line))
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cad-worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")

    p_log = subparsers.add_parser(
        "pipeline-log",
        help="Structured JSON log stub (propaga job_id + correlation_id vía env).",
    )
    p_log.add_argument("--job-id", required=True, dest="job_id")

    p_inspect = subparsers.add_parser("inspect", help="Inspect DWG/DXF; JSON on stdout.")
    p_inspect.add_argument("--input", required=True, help="Path to .dwg or .dxf file")
    p_inspect.add_argument("--json", action="store_true", help="Emit JSON (default)")

    p_layer = subparsers.add_parser(
        "apply-electrical-layer",
        help="Copy input DWG and add Cambre_Electrical outlets from JSON placements.",
    )
    p_layer.add_argument("--input", required=True)
    p_layer.add_argument("--output", required=True)
    p_layer.add_argument(
        "--placements-json",
        required=True,
        help='JSON array of outlet_placements (US-008 output)',
    )

    args = parser.parse_args(argv)

    if args.command == "health":
        raise SystemExit(health_cmd())
    if args.command == "pipeline-log":
        raise SystemExit(pipeline_log_cmd(args.job_id))
    if args.command == "inspect":
        raise SystemExit(inspect_cmd(args.input))
    if args.command == "apply-electrical-layer":
        raise SystemExit(apply_layer_cmd(args.input, args.output, args.placements_json))

    raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv[1:])

