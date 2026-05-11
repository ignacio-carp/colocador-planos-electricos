# Cambre Planos de Luz

Monorepo con:

- `apps/web`: React + Tailwind + Vite
- `apps/api`: Node + Express + TypeScript
- `services/cad-worker`: CLI Python (worker mínimo)

## Requisitos

- Node.js >= 22
- Python >= 3.11

## Bootstrap (dev)

1. Instalar dependencias:
   - `npm install`
2. Levantar API:
   - `npm run dev --workspace apps/api`
   - Verificar: `curl http://localhost:3001/health`
3. Levantar Web:
   - `npm run dev --workspace apps/web`
   - La app consulta `GET /health` (proxy del dev server) para mostrar el estado.

## Scripts (desde la raíz)

- `npm run dev` (dev API + dev Web en paralelo)
- `npm run lint` (placeholder por ahora)
- `npm test` (placeholder por ahora)

## Servicios Python

El worker CAD se ha scaffoldeado como CLI mínima. Para probar:

- `cd services/cad-worker && python -m cad_worker.cli`

Nota: para un setup de empaquetado/ejecución más completo (virtualenv, dependencias reales, Docker, etc.) se requiere un alcance posterior.

