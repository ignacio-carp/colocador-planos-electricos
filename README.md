# VanguardIA — Cambre Planos Electricos (MVP)

Repo (MVP) organizado como **monorepo**.

## Estructura

- `apps/web`: Frontend React + Tailwind + Vite.
- `apps/api`: Backend Node + Express + TypeScript.
- `services/cad-worker`: Skeleton Python (CLI + healthcheck) con `pyproject.toml`.
- `docs/adr`: ADRs del diseño (ej. `ADR-001`).
- `docs/ci.md`: CI en GitHub Actions y notas de despliegue (placeholder).

## Requisitos

- Node.js 20+
- Python 3.12+
- (Opcional) Docker / Docker Compose

## Variables de entorno

```bash
cp .env.example .env
```

## Levantar en modo local (sin Docker)

1. Instalar dependencias:

```bash
npm install
```

2. Iniciar apps:

```bash
npm run dev:api
npm run dev:web
```

3. Worker (en otra terminal):

```bash
cd services/cad-worker
python -m pip install -e .
python -m cad_worker health
```

## Salud (healthchecks)

- Web: `GET http://localhost:5173/healthz`
- API: `GET http://localhost:3001/healthz`
- Worker: `python -m cad_worker health` (exit code 0)

## CI/CD

El repositorio ejecuta **GitHub Actions** en cada `pull_request` y en pushes a `main` (workflow `.github/workflows/ci.yml`):

- **apps/web** y **apps/api**: en matriz **Node.js 20 y 22**, `npm ci`, luego `lint`, `typecheck`, `test` y `build` por workspace.
- **services/cad-worker**: Python **3.12**, `pip install -e ".[dev]"`, `ruff check`, `pytest`, y comprobación CLI `python -m cad_worker health`.

La verificación local equivalente:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
cd services/cad-worker && pip install -e ".[dev]" && ruff check src tests && pytest && python -m cad_worker health
```

**Artefactos de build:** no se publican todavía desde CI; puede añadirse un upload cuando haya un flujo de release.

**Despliegue (placeholder):** hosting del front (p. ej. Vercel), API y worker (p. ej. Fly.io / Render) **pendiente de decisión**. Resumen breve en `docs/ci.md`.

## Secretos de GitHub (Actions / despliegue)

Configura secretos en el repositorio (o entornos **staging** / **production**) con nombres acordados por entorno si aplica. Esta lista documenta variables que el MVP prevé o ya usa; valores reales solo en GitHub, no en el repo.

| Secreto sugerido | Uso |
|------------------|-----|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Build del front contra el proyecto Supabase del entorno. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | API (cliente público / RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor (bypass RLS); **no** exponer al cliente. |
| `CORS_ORIGIN` | Orígenes permitidos para la API en ese entorno (p. ej. URL del front desplegado). |
| `VITE_API_URL` | URL base de la API consumida por el web en build. |
| `EMAIL_API_KEY` / `EMAIL_PROVIDER_*` | Envío transaccional (invitaciones, notificaciones); nombres según proveedor. |
| `OPENAI_API_KEY` u otras `*_API_KEY` | Proveedores de IA en servidor o jobs. |

**Notas**

- Los jobs actuales de lint, test y build **no dependen** de estos secretos (no hay integraciones reales en CI salvo que se añadan más adelante pruebas con mocks o bases efímeras).
- Para preview de PRs o despliegue por entorno, usa **GitHub Environments** y secretos distintos para staging vs production cuando toque cablear pipelines.

## Docker Compose (opcional)

```bash
docker compose up --build
```

