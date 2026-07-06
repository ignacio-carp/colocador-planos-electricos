# cad-worker (MVP)

Servicio Python que centraliza la lectura, inspección y geometría de archivos **DXF** para el resto de la plataforma.
La plataforma ya no acepta `.dwg`; el worker usa `ezdxf` directamente sobre DXF.

## Para qué sirve este servicio

- Inspeccionar archivos DXF y devolver un resumen estructurado.
- Extraer geometría (paredes como segmentos, etiquetas de texto) para el pipeline de IA.
- Aplicar la capa vectorial `Cambre_Electrical` (bloques `CAMBRE_OUTLET`) con placements normativos de US-008 (solo tomacorrientes).
- Aislar dependencias CAD (`ezdxf`) en un servicio dedicado.

## Flujo de llamados (alto nivel)

1. Un cliente sube o referencia un archivo `.dxf`.
2. La API principal deriva análisis al bridge del worker (`apps/api/src/cadWorkerBridge.ts`).
3. **Local / mismo host:** el bridge ejecuta subcomandos CLI (`python -m cad_worker …`).
4. **Producción (Railway u otro host):** con `CAD_WORKER_URL` el bridge llama al servidor HTTP (`cad_worker_server.py`).
5. La API persiste `cad_worker_inspect`, `geometry_extract` y el DXF de salida en Storage.

Guía de despliegue API ↔ worker en Railway: [`docs/deploy/railway-api-cad-worker.md`](../../docs/deploy/railway-api-cad-worker.md).

### Comandos usados por la API

```bash
python -m cad_worker inspect --input /path/to/file.dxf --json
python -m cad_worker extract-geometry --input /path/to/file.dxf --json
python -m cad_worker apply-electrical-layer --input in.dxf --output out.dxf --placements-json '[...]' --output-layer-json '{"name":"Cambre_Electrical","block_name":"CAMBRE_OUTLET","color_aci":3}'
```

El tiempo máximo de espera se controla con `CAD_WORKER_TIMEOUT_MS` (default 30s).

## Ejecución local

```bash
python -m pip install -e ".[dev]"
python -m cad_worker health
python -m cad_worker inspect --input /path/to/file.dxf --json
python -m cad_worker extract-geometry --input /path/to/file.dxf --json
```

## Servidor HTTP (producción)

```bash
pip install -r requirements.txt && pip install -e .
uvicorn cad_worker_server:app --host 0.0.0.0 --port 8000
```

Endpoints: `GET /healthz`, `POST /inspect`, `POST /extract-geometry`, `POST /apply-electrical-layer` (multipart: `file`, `placements_json`).

## Configuración útil (API)

- `CAD_WORKER_URL`: URL base del servicio HTTP (sin barra final). Si está definida, la API no hace `spawn` local.
- `CAD_WORKER_PYTHON`: intérprete de Python a utilizar en modo spawn (default `python3`).
- `CAD_WORKER_DISABLED`: desactiva la invocación desde la API.
- `CAD_WORKER_TIMEOUT_MS`: timeout de llamadas (HTTP o spawn).
- `CAD_WORKER_FIXTURE_DXF`: ruta local a fixture DXF para pruebas del pipeline (alias legacy: `CAD_WORKER_FIXTURE_DWG`).

## Códigos de error

- `CAD_WORKER_INVALID_DXF`: archivo DXF inválido o corrupto.
- `CAD_WORKER_FILE_NOT_FOUND`: ruta de entrada inexistente.
- `CAD_WORKER_ERROR`: error genérico.

## Dependencia CAD principal

`ezdxf` está fijado en `pyproject.toml` (`>=1.3,<2`).

## Lint y formato

```bash
python -m pip install ruff black
ruff check .
black --check .
```

## Tests

```bash
python -m pytest -q
```
