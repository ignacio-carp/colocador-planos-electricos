# VanguardIA — Cambre Planos Electricos (MVP)

Repo (MVP) organizado como **monorepo**.

## Estructura

- `apps/web`: Frontend React + Tailwind + Vite.
- `apps/api`: Backend Node + Express + TypeScript.
- `services/cad-worker`: Skeleton Python (CLI + healthcheck) con `pyproject.toml`.
- `docs/adr`: ADRs del diseño (ej. `ADR-001`).

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

## Docker Compose (opcional)

```bash
docker compose up --build
```

