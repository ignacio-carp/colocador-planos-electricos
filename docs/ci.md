# CI / CD — estado y despliegue (placeholder)

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, tests de humo y build para `web`, `api` y `cad-worker`. Una PR debe pasar estos jobs antes de fusionar.

## CD / hosting

Instrucciones paso a paso (Vercel web, API, Supabase, cad-worker): ver **README → Despliegue en Vercel** y **Desarrollo local**.

El front suele desplegarse en Vercel desde `apps/web`; la API conviene en un host Node de larga duración (Render/Fly) por el worker del pipeline. Aún no hay workflow de deploy en GitHub Actions (solo CI).
