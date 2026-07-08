import argparse
import json
import os
import sys
from datetime import datetime, timezone

from cad_worker.detect_rooms import detect_rooms_cmd
from cad_worker.electrical_layer import apply_layer_cmd
from cad_worker.extract_geometry import extract_geometry_cmd
from cad_worker.inspect_dxf import inspect_cmd
from cad_worker.placement import place_elements_cmd
from cad_worker.render_plan import render_plan_cmd


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
        help="Extract walls, openings and furniture from DXF modelspace (other layers discarded).",
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

    p_place = subparsers.add_parser(
        "place-elements",
        help=(
            "Deterministic outlet placement: JSON payload "
            "(room + geometry + rules) in, outlet_placements out."
        ),
    )
    p_place.add_argument(
        "--payload-json",
        required=True,
        dest="payload_json",
        help="JSON: {room, geometry, rules, insunits?, params?}",
    )

    p_detect = subparsers.add_parser(
        "detect-rooms",
        help="Experimental: detect room polygons from wall segments (polygonize).",
    )
    p_detect.add_argument(
        "--geometry-json",
        required=True,
        dest="geometry_json",
        help="JSON geometry_extract payload (paredes[] required)",
    )
    p_detect.add_argument("--insunits", type=int, default=None)

    p_harness = subparsers.add_parser(
        "harness",
        help=(
            "Verification loop: synthetic fixtures -> deterministic pipeline "
            "-> geometric validators -> pass/fail report."
        ),
    )
    p_harness.add_argument(
        "--out-dir",
        default=None,
        dest="out_dir",
        help="Keep fixtures and drawn DXFs here (default: temp dir, discarded)",
    )
    p_harness.add_argument(
        "--report",
        default=None,
        help="Write the JSON report to this path",
    )

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
    if args.command == "place-elements":
        raise SystemExit(place_elements_cmd(args.payload_json))
    if args.command == "detect-rooms":
        raise SystemExit(detect_rooms_cmd(args.geometry_json, args.insunits))
    if args.command == "harness":
        from cad_worker.harness.runner import harness_cmd

        raise SystemExit(harness_cmd(args.out_dir, args.report))

    raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
