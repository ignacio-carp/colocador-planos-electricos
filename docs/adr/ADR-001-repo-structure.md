# ADR-001: Estructura del repo (Monorepo con npm workspaces)

Fecha: 2026-05-11
Estado: Aceptada (scaffolding mínimo / bootstrap)

## Contexto
El proyecto necesita, al menos, 3 componentes:

1. `apps/web`: frontend React con Tailwind y Vite.
2. `apps/api`: backend Node + Express con TypeScript.
3. `services/cad-worker`: herramienta/worker CLI en Python.

Se requiere una estructura clonable y un punto único de instalación/arranque (`npm install` y scripts de `npm`) para facilitar el desarrollo inicial.

## Decisión
Usar un **monorepo** con **npm workspaces**:

- El `package.json` raíz define `workspaces`:
  - `apps/*`
  - `services/*`
- Cada componente mantiene su propio `package.json`:
  - `apps/web`: Vite + React + Tailwind
  - `apps/api`: Express + TypeScript
  - `services/cad-worker`: CLI Python (packaged vía `pyproject.toml`)

## Efectos / Consecuencias
- Ventajas:
  - `npm install` desde la raíz instala dependencias necesarias para todos los paquetes JS.
  - Scripts comunes (`dev`, `lint`, `test`) se pueden orquestar desde la raíz.
- Limitaciones (bootstrap):
  - Se deja preparado el esqueleto; la implementación completa de features y el CI/CD no es parte del alcance mínimo de este T-01.

