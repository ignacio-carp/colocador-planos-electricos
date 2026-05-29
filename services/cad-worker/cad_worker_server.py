from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import ezdxf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from cad_worker.electrical_layer import INVALID_DXF_CODE, apply_electrical_layer
from cad_worker.extract_geometry import extract_geometry
from cad_worker.inspect_dxf import inspect_dxf_file

app = FastAPI(title="cad-worker", version="0.2.0")


def _http_error(status: int, code: str, error: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"ok": False, "code": code, "error": error})


@app.get("/healthz")
def healthz() -> dict[str, object]:
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


@app.post("/apply-electrical-layer")
async def apply_layer(
    file: UploadFile = File(...),
    placements_json: str = Form(...),
) -> dict[str, object]:
    input_suffix = Path(file.filename or "input.dxf").suffix or ".dxf"
    with NamedTemporaryFile(delete=False, suffix=input_suffix) as input_tmp:
        input_tmp.write(await file.read())
        input_path = Path(input_tmp.name)

    with NamedTemporaryFile(delete=False, suffix=".dxf") as output_tmp:
        output_path = Path(output_tmp.name)

    try:
        placements_raw = json.loads(placements_json)
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
        return apply_electrical_layer(input_path, output_path, placements)
    except FileNotFoundError as exc:
        raise _http_error(404, "CAD_WORKER_FILE_NOT_FOUND", str(exc)) from exc
    except ezdxf.DXFStructureError as exc:
        raise _http_error(400, INVALID_DXF_CODE, str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise _http_error(400, "CAD_WORKER_INVALID_JSON", str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise _http_error(500, "CAD_WORKER_ERROR", str(exc)) from exc
    finally:
        input_path.unlink(missing_ok=True)
