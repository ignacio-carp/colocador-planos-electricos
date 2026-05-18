# CI / CD — estado y despliegue (placeholder)

## CI

GitHub Actions (`.github/workflows/ci.yml`): lint, typecheck, tests de humo y build para `web`, `api` y `cad-worker`. Una PR debe pasar estos jobs antes de fusionar.

## CD / hosting (TBD)

Aún **no hay** pipeline de despliegue automatizado acoplado al repo. Opciones habituales a evaluar:

- **Front (`apps/web`)**: Vercel, Netlify o estático detrás de CDN.
- **API (`apps/api`)**: Fly.io, Render, Railway u otro runtime Node mantenido.
- **Worker (`services/cad-worker`)**: Mismo proveedor que la API u orquestación (cron, cola, contenedor).

Próximo paso: elegir proveedor(es), mapear secretos por entorno (ver README, sección Secretos de GitHub) y añadir workflow de deploy (por rama o por release) cuando aplique.
