import argparse
import json
import os
import sys
from datetime import datetime, timezone

from cad_worker.electrical_layer import apply_layer_cmd
from cad_worker.extract_geometry import extract_geometry_cmd
from cad_worker.inspect_dxf import inspect_cmd
from cad_worker.render_plan import render_plan_cmd, render_room_cmd


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

    p_inspect = subparsers.add_parser("inspect", help="Inspect DXF; JSON on stdout.")
    p_inspect.add_argument("--input", required=True, help="Path to .dxf file")
    p_inspect.add_argument("--json", action="store_true", help="Emit JSON (default)")

    p_extract = subparsers.add_parser(
        "extract-geometry",
        help="Extract walls and text labels from DXF modelspace.",
    )
    p_extract.add_argument("--input", required=True, help="Path to .dxf file")
    p_extract.add_argument("--json", action="store_true", help="Emit JSON (default)")

    p_layer = subparsers.add_parser(
        "apply-electrical-layer",
        help="Copy input DXF and add Cambre_Electrical outlet blocks from JSON placements.",
    )
    p_layer.add_argument("--input", required=True)
    p_layer.add_argument("--output", required=True)
    p_layer.add_argument(
        "--placements-json",
        required=True,
        help="JSON array of outlet_placements, nuevas_tomas, or wrapper object",
    )
    p_layer.add_argument(
        "--output-layer-json",
        default=None,
        help=(
            'Optional JSON: {"name":"Cambre_Electrical",'
            '"block_name":"CAMBRE_OUTLET","color_aci":3}'
        ),
    )
    p_layer.add_argument(
        "--room-id",
        default=None,
        dest="room_id",
        help=(
            "US-013: room_id for incremental merge — removes prior entities "
            "for this room and tags new ones."
        ),
    )

    p_render_plan = subparsers.add_parser(
        "render-plan",
        help="Rasterize full DXF plan to PNG for multimodal LLM (US-007).",
    )
    p_render_plan.add_argument("--input", required=True)
    p_render_plan.add_argument("--output", required=True)
    p_render_plan.add_argument("--width-px", type=int, default=2048, dest="width_px")

    p_render_room = subparsers.add_parser(
        "render-room",
        help="Rasterize room crop to PNG for multimodal LLM (US-008).",
    )
    p_render_room.add_argument("--input", required=True)
    p_render_room.add_argument("--output", required=True)
    p_render_room.add_argument(
        "--polygon-json",
        required=True,
        help='JSON: [{"x":0,"y":0},...] or {"vertices":[...]}',
    )
    p_render_room.add_argument("--margin-mm", type=float, default=500.0, dest="margin_mm")
    p_render_room.add_argument("--width-px", type=int, default=1024, dest="width_px")

    args = parser.parse_args(argv)

    if args.command == "health":
        raise SystemExit(health_cmd())
    if args.command == "pipeline-log":
        raise SystemExit(pipeline_log_cmd(args.job_id))
    if args.command == "inspect":
        raise SystemExit(inspect_cmd(args.input))
    if args.command == "extract-geometry":
        raise SystemExit(extract_geometry_cmd(args.input))
    if args.command == "apply-electrical-layer":
        raise SystemExit(
            apply_layer_cmd(
                args.input,
                args.output,
                args.placements_json,
                args.output_layer_json,
                room_id=args.room_id,
            ),
        )
    if args.command == "render-plan":
        raise SystemExit(render_plan_cmd(args.input, args.output, width_px=args.width_px))
    if args.command == "render-room":
        raise SystemExit(
            render_room_cmd(
                args.input,
                args.output,
                args.polygon_json,
                margin_mm=args.margin_mm,
                width_px=args.width_px,
            ),
        )

    raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
