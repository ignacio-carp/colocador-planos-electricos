from __future__ import annotations

from pathlib import Path
from tempfile import NamedTemporaryFile

import ezdxf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from cad_worker.electrical_layer import apply_electrical_layer
from cad_worker.inspect_dwg import inspect_dwg_file

app = FastAPI(title="cad-worker", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {"status": "ok", "service": "cad-worker"}


@app.post("/inspect")
async def inspect(file: UploadFile = File(...)) -> dict[str, object]:
    suffix = Path(file.filename or "input.dwg").suffix or ".dwg"
    with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        return inspect_dwg_file(tmp_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "code": "CAD_WORKER_FILE_NOT_FOUND", "error": str(exc)},
        ) from exc
    except ezdxf.DXFStructureError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "code": "CAD_WORKER_INVALID_DWG", "error": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "code": "CAD_WORKER_ERROR", "error": str(exc)},
        ) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/apply-electrical-layer")
async def apply_layer(
    file: UploadFile = File(...),
    placements_json: str = Form(...),
) -> dict[str, object]:
    input_suffix = Path(file.filename or "input.dwg").suffix or ".dwg"
    with NamedTemporaryFile(delete=False, suffix=input_suffix) as input_tmp:
        input_tmp.write(await file.read())
        input_path = Path(input_tmp.name)

    with NamedTemporaryFile(delete=False, suffix=".dwg") as output_tmp:
        output_path = Path(output_tmp.name)

    try:
        import json

        placements = json.loads(placements_json)
        if not isinstance(placements, list):
            placements = []
        return apply_electrical_layer(input_path, output_path, placements)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "code": "CAD_WORKER_FILE_NOT_FOUND", "error": str(exc)},
        ) from exc
    except ezdxf.DXFStructureError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "code": "CAD_WORKER_INVALID_DWG", "error": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "code": "CAD_WORKER_ERROR", "error": str(exc)},
        ) from exc
    finally:
        input_path.unlink(missing_ok=True)
