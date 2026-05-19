# cad-worker (MVP)

Worker Python para inspección y manipulación DWG (ezdxf).

## Ejecución

```bash
python -m pip install -e ".[dev]"
python -m cad_worker health
python -m cad_worker inspect --input /path/to/file.dxf --json
```

**ezdxf** está fijado en `pyproject.toml` (`>=1.3,<2`). El bridge Node (`apps/api/src/cadWorkerBridge.ts`) invoca `inspect` con timeout configurable (`CAD_WORKER_TIMEOUT_MS`, default 30s).

Variables útiles:

- `CAD_WORKER_PYTHON` — intérprete (default `python3`)
- `CAD_WORKER_DISABLED` — omitir invocación desde API
- `CAD_WORKER_FIXTURE_DWG` — ruta local para pruebas de integración del pipeline

## Lint / format

```bash
python -m pip install ruff black
ruff check .
black --check .
```

