from __future__ import annotations

import logging
import sys
import time
from json import JSONDecodeError
from json import loads as json_loads
from pathlib import Path
from tempfile import NamedTemporaryFile

import ezdxf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from cad_worker.detect_rooms import detect_rooms_from_walls
from cad_worker.electrical_layer import (
    INVALID_DXF_CODE,
    apply_electrical_layer,
    parse_output_layer_config,
)
from cad_worker.extract_geometry import extract_geometry
from cad_worker.http_json import dumps_ascii_safe, encode_result_header
from cad_worker.inspect_dxf import inspect_dxf_file
from cad_worker.placement import PlacementError, place_outlets_for_room
from cad_worker.render_plan import render_plan

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
)
logger = logging.getLogger("cad_worker_server")

app = FastAPI(title="cad-worker", version="0.2.0")

CAD_WORKER_RESULT_HEADER = "X-Cad-Worker-Result"


def _log_event(level: int, event: str, **fields: object) -> None:
    payload = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **fields}
    logger.log(level, dumps_ascii_safe(payload))


def _safe_result_headers(result: dict[str, object]) -> dict[str, str]:
    try:
        header_value, header_extra = encode_result_header(result)
        return {
            CAD_WORKER_RESULT_HEADER: header_value,
            **header_extra,
        }
    except Exception as exc:  # noqa: BLE001
        _log_event(
            logging.WARNING,
            "cad_worker_result_header_encode_failed",
            error=str(exc),
        )
        return {}


@app.middleware("http")
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    t0 = time.perf_counter()
    _log_event(
        logging.INFO,
        "cad_worker_http_request",
        method=request.method,
        path=request.url.path,
    )
    response = await call_next(request)
    _log_event(
        logging.INFO,
        "cad_worker_http_response",
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round((time.perf_counter() - t0) * 1000, 2),
    )
    return response


def _http_error(status: int, code: str, error: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"ok": False, "code": code, "error": error})


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    return {"status": "ok", "service": "cad-worker"}


@app.post("/inspect")
async def inspect(file: UploadFile = File(...)) -> dict[str, object]:
    suffix = Path(file.filename or "input.dxf").suffix or ".dxf"
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        return inspect_dxf_file(tmp_path)
    except FileNotFoundError as exc:
        raise _http_error(404, "CAD_WORKER_FILE_NOT_FOUND", str(exc)) from exc
    except ezdxf.DXFStructureError as exc:
        raise _http_error(400, INVALID_DXF_CODE, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/extract-geometry")
async def extract_geometry_endpoint(file: UploadFile = File(...)) -> dict[str, object]:
    suffix = Path(file.filename or "input.dxf").suffix or ".dxf"
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        geometry = extract_geometry(tmp_path)
        return {"ok": True, **geometry}
    except FileNotFoundError as exc:
        raise _http_error(404, "CAD_WORKER_FILE_NOT_FOUND", str(exc)) from exc
    except ezdxf.DXFStructureError as exc:
        raise _http_error(400, INVALID_DXF_CODE, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/render-plan")
async def render_plan_endpoint(
    file: UploadFile = File(...),
    width_px: int = Form(default=2048),
) -> FileResponse:
    input_suffix = Path(file.filename or "input.dxf").suffix or ".dxf"
    with NamedTemporaryFile(delete=False, suffix=input_suffix) as input_tmp:
        input_tmp.write(await file.read())
        input_path = Path(input_tmp.name)

    with NamedTemporaryFile(delete=False, suffix=".png") as output_tmp:
        output_path = Path(output_tmp.name)

    try:
        result = render_plan(input_path, output_path, width_px=width_px)
        return FileResponse(
            path=output_path,
            media_type="image/png",
            filename="plan.png",
            headers=_safe_result_headers(result),
            background=BackgroundTask(_cleanup_paths, input_path, output_path),
        )
    except FileNotFoundError as exc:
        _cleanup_paths(input_path, output_path)
        raise _http_error(404, "CAD_WORKER_FILE_NOT_FOUND", str(exc)) from exc
    except ezdxf.DXFStructureError as exc:
        _cleanup_paths(input_path, output_path)
        raise _http_error(400, INVALID_DXF_CODE, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        _cleanup_paths(input_path, output_path)
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc


def _cleanup_paths(*paths: Path) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


@app.post("/place-elements")
async def place_elements(request: Request) -> dict[str, object]:
    """Deterministic outlet placement: JSON {room, geometry, rules, insunits?, params?}."""
    try:
        payload = json_loads(await request.body())
    except JSONDecodeError as exc:
        raise _http_error(400, "CAD_WORKER_INVALID_JSON", str(exc)) from exc
    if not isinstance(payload, dict):
        raise _http_error(400, "CAD_WORKER_INVALID_PAYLOAD", "payload must be a JSON object")
    try:
        result = place_outlets_for_room(payload)
        _log_event(
            logging.INFO,
            "cad_worker_place_elements_complete",
            room_id=result.get("room_id"),
            outlets=len(result.get("outlet_placements", [])),
            warnings=result.get("warnings"),
        )
        return result
    except PlacementError as exc:
        raise _http_error(422, exc.code, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc


@app.post("/detect-rooms")
async def detect_rooms(request: Request) -> dict[str, object]:
    """Experimental deterministic room detection from wall segments."""
    try:
        payload = json_loads(await request.body())
    except JSONDecodeError as exc:
        raise _http_error(400, "CAD_WORKER_INVALID_JSON", str(exc)) from exc
    if not isinstance(payload, dict):
        raise _http_error(400, "CAD_WORKER_INVALID_PAYLOAD", "payload must be a JSON object")
    geometry = payload.get("geometry")
    insunits = payload.get("insunits")
    result = detect_rooms_from_walls(
        geometry if isinstance(geometry, dict) else payload,
        int(insunits) if isinstance(insunits, (int, float)) and insunits else None,
    )
    if not result.get("ok"):
        raise _http_error(
            422,
            str(result.get("code") or "CAD_WORKER_ERROR"),
            str(result.get("error")),
        )
    return result


@app.post("/apply-electrical-layer")
async def apply_layer(
    file: UploadFile = File(...),
    placements_json: str = Form(...),
    output_layer_json: str | None = Form(default=None),
    room_id: str | None = Form(default=None),
) -> FileResponse:
    input_suffix = Path(file.filename or "input.dxf").suffix or ".dxf"
    with NamedTemporaryFile(delete=False, suffix=input_suffix) as input_tmp:
        input_tmp.write(await file.read())
        input_path = Path(input_tmp.name)

    with NamedTemporaryFile(delete=False, suffix=".dxf") as output_tmp:
        output_path = Path(output_tmp.name)

    try:
        placements_raw = json_loads(placements_json)
        placements: list[dict[str, object]] = []
        if isinstance(placements_raw, list):
            placements = placements_raw
        elif isinstance(placements_raw, dict):
            nuevas = placements_raw.get("nuevas_tomas")
            outlets = placements_raw.get("outlet_placements")
            if isinstance(nuevas, list):
                placements = nuevas
            elif isinstance(outlets, list):
                placements = outlets
        layer_config = parse_output_layer_config(
            json_loads(output_layer_json) if output_layer_json else None,
        )
        result = apply_electrical_layer(
            input_path,
            output_path,
            placements,
            output_layer=layer_config,
            room_id=room_id or None,
        )
        _log_event(
            logging.INFO,
            "cad_worker_apply_complete",
            outlets_added=result.get("outlets_added"),
            output=str(output_path),
        )
        return FileResponse(
            path=output_path,
            media_type="application/dxf",
            filename="output.dxf",
            headers=_safe_result_headers(result),
            background=BackgroundTask(_cleanup_paths, input_path, output_path),
        )
    except FileNotFoundError as exc:
        _cleanup_paths(input_path, output_path)
        raise _http_error(404, "CAD_WORKER_FILE_NOT_FOUND", str(exc)) from exc
    except ezdxf.DXFStructureError as exc:
        _cleanup_paths(input_path, output_path)
        raise _http_error(400, INVALID_DXF_CODE, str(exc)) from exc
    except JSONDecodeError as exc:
        _cleanup_paths(input_path, output_path)
        raise _http_error(400, "CAD_WORKER_INVALID_JSON", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        _cleanup_paths(input_path, output_path)
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc
