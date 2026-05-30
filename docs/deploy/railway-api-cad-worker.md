# Conectar la API (Railway) con el servicio Python cad-worker (Railway)

Este instructivo asume:

- **API** (`apps/api`): servicio Node en Railway (proceso largo con worker de pipeline).
- **cad-worker** (`services/cad-worker`): servicio Python en Railway (FastAPI + ezdxf).
- **Front**: Vercel (`VITE_API_URL` apunta a la API en Railway).
- **BD / Storage**: Supabase.

## Por qué hace falta `CAD_WORKER_URL`

Por defecto la API ejecuta el worker **en el mismo contenedor** con:

```bash
python -m cad_worker inspect ...
```

En Railway la API y el Python suelen ser **dos servicios distintos**. La API no tiene `ezdxf` instalado; debe llamar al servicio HTTP del worker.

Cuando defines `CAD_WORKER_URL`, el bridge (`apps/api/src/cadWorkerBridge.ts`) usa HTTP en lugar de `spawn`:

| Operación pipeline | Endpoint HTTP |
|--------------------|---------------|
| Inspección DXF | `POST /inspect` |
| Extracción geometría | `POST /extract-geometry` |
| Capa eléctrica | `POST /apply-electrical-layer` |
| Health check arranque | `GET /healthz` |

## 1. Servicio Python en Railway (cad-worker)

### Root directory y build

En el servicio **cad-worker** en Railway:

| Ajuste | Valor |
|--------|--------|
| Root Directory | `services/cad-worker` |
| Builder | Nixpacks (o Dockerfile si lo añades) |

### Variables de entorno (cad-worker)

Normalmente no necesita secrets para el MVP. Opcional: `PORT` (Railway lo inyecta).

### Comando de arranque

```bash
pip install -r requirements.txt && pip install -e . && uvicorn cad_worker_server:app --host 0.0.0.0 --port ${PORT:-8000}
```

> El módulo `cad_worker_server.py` está en la raíz de `services/cad-worker`, no dentro de `src/`.

### Verificar el servicio

Desde tu máquina (sustituye la URL pública de Railway):

```bash
curl -sS https://<cad-worker>.up.railway.app/healthz
# {"status":"ok","service":"cad-worker"}
```

En **Railway → cad-worker → Logs** deberías ver líneas JSON como:

```json
{"event":"cad_worker_http_request","method":"GET","path":"/healthz"}
{"event":"cad_worker_http_response","method":"GET","path":"/healthz","status":200,"duration_ms":1.2}
```

### Red privada (recomendado)

En el mismo proyecto Railway:

1. Habilita **Private Networking** en ambos servicios.
2. Anota el hostname interno del cad-worker (p. ej. `cad-worker.railway.internal`).
3. Usa `http://cad-worker.railway.internal:<PORT>` como `CAD_WORKER_URL` en la API (sin barra final).

Ventaja: el tráfico DXF no sale a internet y evitas cold starts externos.

Si usas URL pública, también funciona: `https://<cad-worker>.up.railway.app`.

## 2. Servicio API en Railway

### Root directory y start

| Ajuste | Valor |
|--------|--------|
| Root Directory | *(raíz del monorepo)* |
| Build Command | `npm ci && npm run build --workspace=api` |
| Start Command | `node apps/api/dist/index.js` |

### Variables obligatorias (además de Supabase / CORS)

| Variable | Ejemplo | Notas |
|----------|---------|--------|
| `CAD_WORKER_URL` | `http://cad-worker.railway.internal:8000` o URL pública | **Sin** barra final |
| `CAD_PIPELINE_MODE` | `live` o `stub` | `live` requiere `OPENAI_API_KEY` |
| `PIPELINE_WORKER_ENABLED` | `true` | Worker en background |
| `CORS_ORIGIN` | URL del front en Vercel | |
| `SUPABASE_*` | … | Igual que local |

**No** configures `CAD_WORKER_DISABLED=true` si quieres inspección y capa eléctrica reales.

Opcional:

| Variable | Default | Uso |
|----------|---------|-----|
| `CAD_WORKER_TIMEOUT_MS` | `30000` | DXF grandes: subir a `60000`–`120000` |
| `CAD_WORKER_PYTHON` | — | Solo modo `spawn` local; ignorado con `CAD_WORKER_URL` |

### Verificar la API

```bash
curl -sS https://<api>.up.railway.app/healthz
```

Respuesta esperada:

```json
{
  "status": "ok",
  "cad_worker": {
    "cad_worker_transport": "http",
    "cad_worker_url": "http://cad-worker.railway.internal:8000",
    "cad_worker_timeout_ms": 30000
  }
}
```

Si `cad_worker_transport` es `spawn`, la API **no** está leyendo `CAD_WORKER_URL` (variable ausente o mal escrita).

## 3. Front en Vercel

| Variable | Valor |
|----------|--------|
| `VITE_API_URL` | URL pública de la API en Railway |

Redeploy del front tras cambiar la URL de la API.

## 4. Qué buscar en los logs al procesar un job

Filtra por `correlation_id` (viene en la respuesta de error del job o en headers `X-Correlation-Id`).

### API (Railway → servicio api)

| Evento | Significado |
|--------|-------------|
| `api_listening` | Arranque; incluye `cad_worker_transport` |
| `cad_worker_startup_probe` | Probe a `/healthz` del worker al iniciar |
| `cad_worker_startup_probe_failed` | API no alcanza el worker (URL/red/firewall) |
| `pipeline_start` | Inicio pipeline de un job |
| `pipeline_step_start` / `pipeline_step_end` | Pasos ingest, vision, normative, cad_generation |
| `cad_worker_http_request` / `cad_worker_http_response` | Llamada HTTP al worker (duración, status) |
| `cad_worker_inspect` | Inspección OK |
| `cad_worker_inspect_skipped` | Falló inspect (revisa `error_code`) |
| `cad_worker_apply_failed` | Falló apply-electrical-layer |
| `pipeline_complete` | Job terminó OK |

### cad-worker (Railway → servicio Python)

| Evento | Significado |
|--------|-------------|
| `cad_worker_http_request` | Petición entrante |
| `cad_worker_http_response` | Respuesta con status y `duration_ms` |
| `cad_worker_apply_complete` | DXF de salida generado |

## 5. Problemas frecuentes

### `cad_worker_transport: "spawn"` en producción

- Falta `CAD_WORKER_URL` en el servicio **api** de Railway.
- Variable definida en el servicio equivocado (cad-worker en lugar de api).

### `cad_worker_startup_probe_failed`

- URL incorrecta o worker caído.
- Red privada: puerto distinto al que escucha uvicorn (`PORT` del worker).
- Worker no desplegado / build fallido.

### `CAD_WORKER_SPAWN_FAILED` o `CAD_WORKER_EMPTY_OUTPUT`

- La API sigue en modo **spawn** (no hay `CAD_WORKER_URL`).
- En Railway la API no tiene Python/ezdxf → debes usar HTTP.

### `CAD_WORKER_HTTP_FAILED` / timeout

- DXF muy grande: aumenta `CAD_WORKER_TIMEOUT_MS`.
- Worker en cold start: primer request lento; reintenta o usa always-on en Railway.

### Pipeline termina en stub (`pipeline_us009_stub`) sin error

- `CAD_WORKER_DISABLED=true`, o
- Sin placements normativos, o
- Sin archivo en Storage (`job-dxf-input`), o
- Inspect/apply fallaron y se usó mock (ver logs `*_skipped`).

### CORS / front no llega a la API

- `CORS_ORIGIN` debe incluir el dominio exacto de Vercel (con `https://`).

## 6. Checklist rápido

1. [ ] `GET <cad-worker>/healthz` → 200
2. [ ] `GET <api>/healthz` → `cad_worker_transport: "http"`
3. [ ] Logs API: `cad_worker_startup_probe` con status 200
4. [ ] Crear job, subir `.dxf`, esperar `procesado`
5. [ ] Logs con mismo `correlation_id`: `pipeline_step_*` y `cad_worker_http_*`

## Referencia de código

- Bridge API: `apps/api/src/cadWorkerBridge.ts`
- Pipeline: `apps/api/src/jobsPipeline.ts`
- Servidor HTTP Python: `services/cad-worker/cad_worker_server.py`
