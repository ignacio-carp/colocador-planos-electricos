---
name: delegate-task-pr
description: Planifica una tarea a partir de cualquier fuente (texto del usuario, issue de GitHub, documento o enlace), presenta resumen y plan, y delega a un subagente con worktree dedicado, commit, push, PR nuevo y limpieza del worktree, sin merge del PR. Use when the user asks to delegate a task, open a PR without merge, use a worktree for an issue or spec, or references this skill path.
---

# Delegación de tarea con PR (fuente agnóstica)

## Entrada

La tarea puede llegar como:

- **Texto** en el chat (pedido, spec, lista de requisitos).
- **Issue de GitHub** (URL, número `#123`, o comando `gh issue view`).
- **Documento** en el repo o ruta local (leer el archivo o fragmento relevante).
- **Cualquier combinación** (p. ej. enlace + aclaración en mensaje).

Si falta contexto crítico (repo objetivo, rama base, alcance), **preguntar** antes de delegar.

## 1. Reunir definición de la tarea

1. **Título** breve y **descripción** completa (y criterios de aceptación si existen en la fuente).
2. **Referencias**: URLs de issue, PRs relacionados, diseños, etc.
3. **Repositorio**: **ruta absoluta** de la raíz del repo donde debe trabajar el subagente (preguntar si no está claro por el workspace).
4. **Restricciones** del usuario (no tocar X, solo backend, etc.) si las hubo.

## 2. Analizar y planificar

1. **Analizar** el objetivo real, alcance y riesgos frente al repo.
2. **Plan de acción**: pasos ordenados, archivos o áreas probables, cómo verificar.
3. Presentar al usuario un **resumen corto** del análisis + plan **antes** de lanzar el subagente (salvo que pida automatizar sin pausa).

## 3. Delegar a un subagente (worktree + PR)

Lanzar un **subagente** (`Task` / agente hijo) con un **prompt autocontenido** que incluya:

- Título, descripción y criterios de aceptación (texto literal si vienen de un issue o documento).
- Referencias y plan de acción acordado.
- **Ruta absoluta del repositorio raíz**.
- Restricciones del usuario.
- **Skill a aplicar**: entre las skills disponibles, elegir **la que mejor encaje** (p. ej. **senior-feature-delivery** en `~/.cursor/skills/senior-feature-delivery/SKILL.md`). Indicar que la lea primero y que use **Modo B — Entrega con PR** (commit, push, `gh pr create`, `git worktree remove`); **nunca** merge del PR por el agente. Si no encaja otra skill, `generalPurpose` con los mismos cierres de Modo B y calidad explícita.
- **Cierre tras el PR**: por defecto **no** hay sistema externo obligatorio: el PR y su descripción son el registro. Si **esta sesión** o **otra skill** que invoque este flujo indican acciones **después** de abrir el PR (p. ej. comentar en un issue de GitHub), el subagente debe ejecutarlas **tras** `gh pr create` y **antes** de `git worktree remove`, salvo que el orden deba ser otro por dependencias técnicas.

El subagente **ejecuta** el trabajo; el agente padre no lo sustituye salvo que el usuario pida solo planificación.

### 3.1 Un worktree dedicado por tarea (o por delegación acordada)

Cada tarea **grande** en **su propio** `git worktree` y rama dedicada:

1. Desde el **repositorio principal** (no desde otro worktree), `git fetch origin` y confirmar la rama base (`main`, `develop`, etc.).
2. Directorio hermano único, p. ej. `../<nombre-repo>-<token-corto>`; comprobar colisiones con `git worktree list`.
3. Crear rama y worktree:

   `git worktree add <ruta_absoluta> -b feature/<tema-corto-único> origin/<rama-base>`

4. **Todo el código** de la tarea solo **dentro de ese worktree** hasta abrir el PR.
5. Varias tareas en serie: **cada una** con ruta y rama nuevas; no reutilizar un worktree en uso por otra tarea.

### 3.2 Entregar: PR nuevo, sin merge

1. `git add` y **`git commit`** con mensaje alineado a la tarea.
2. `git push -u origin <rama-del-worktree>`.
3. **`gh pr create`** (o equivalente del remoto) con título y cuerpo que enlacen issue/spec y alcance.
4. **Prohibido** para el agente: `gh pr merge`, merge manual al base, o fusionar de otra forma.

### 3.3 Limpieza: eliminar el worktree (obligatorio)

Tras push y PR abiertos (y acciones post-PR indicadas, si las hay):

1. Ejecutar git desde el **repositorio principal** u otra ruta **distinta** al worktree a borrar.
2. `git worktree remove <ruta_del_worktree>` (`--force` solo si hace falta; preferir árbol limpio antes).
3. Opcional: `git worktree prune` si quedan metadatos huérfanas.
4. **No** borrar a mano el directorio mientras git lo registre: usar `git worktree remove`.

## 4. Reglas prácticas

- **Una tarea por delegación** si el trabajo es grande; si son triviales, el usuario puede pedir **agrupar** en un solo worktree (acordarlo explícitamente).
- **Nunca** mergear el PR **desde** el agente en este flujo; solo crearlo.
- Si otra skill (p. ej. **trello-vago-delegation**) añade obligaciones extra al subagente, **esa skill prevalece** para esos pasos adicionales.

## Referencia git

| Objetivo | Comando / nota |
|----------|------------------|
| Listar worktrees | `git worktree list` |
| Añadir worktree + rama | `git worktree add <path> -b <branch> origin/<base>` |
| Quitar worktree | `git worktree remove <path>` (luego `prune` si aplica) |
| PR | `gh pr create` (sin merge posterior por el agente) |
