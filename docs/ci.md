# CI / CD — estado y despliegue (placeholder)

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, tests de humo y build para `web`, `api` y `cad-worker`. Una PR debe pasar estos jobs antes de fusionar.

## CD / hosting

Instrucciones paso a paso (Vercel web, API, Supabase, cad-worker): ver **README → Despliegue en Vercel** y **Desarrollo local**.

El front suele desplegarse en Vercel desde `apps/web`; la API conviene en un host Node de larga duración (Render/Fly) por el worker del pipeline. Aún no hay workflow de deploy en GitHub Actions (solo CI).

## Staging sugerido (N6)

| Componente | Destino | Variables clave |
|------------|---------|-----------------|
| `apps/web` | Vercel | `VITE_API_URL`, Supabase anon |
| `apps/api` | Render/Fly/Railway | `SUPABASE_*`, `OPENAI_API_KEY`, `CAD_PIPELINE_MODE`, `PIPELINE_WORKER_ENABLED` |
| Supabase | Proyecto staging | migraciones `supabase db push` |
| `cad-worker` | Misma imagen que API o sidecar | Python 3.11+ con ezdxf |

Preview Vercel: conectar repo, root `apps/web`, build `npm run build`, output `dist`.

## Métricas (N8)

- JSON: `GET /api/metrics` (admin)
- Prometheus text: `GET /api/metrics/prometheus` (admin)

## Golden pipeline (N5)

Job opcional en CI cuando existan DWG en `fixtures/golden/dwg/` y secretos staging; mientras tanto `npm test --workspace=api` valida snapshot JSON stub.
