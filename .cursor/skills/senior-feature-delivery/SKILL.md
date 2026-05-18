---
name: senior-feature-delivery
description: Analiza la tarea, planifica, aísla en worktree y rama, implementa con calidad. Hay dos modos: (1) por defecto, no commitea hasta aprobación explícita del usuario; (2) en delegación delegate-task-pr, trello-vago u orden explícita de "PR sin merge", commitea, empuja, abre PR y limpia el worktree, sin mergear. Usar cuando el usuario pida feature senior, worktree, planner, aprobación antes de commit, delegación con PR, o delegación Trello vago.
---

# Entrega de feature (flujo senior)

## Cuándo aplicar

Cuando haya que desarrollar un cambio de producto no trivial: primero **planificar**, **aislar el trabajo en git** (worktree + rama), **cerrar definición** con el usuario si hace falta, **implementar** y luego entregar según el **modo** (ver abajo). No contradecir: si aplica otra skill con reglas de entrega (p. ej. **delegate-task-pr** en `~/.cursor/skills/delegate-task-pr/SKILL.md` o **trello-vago-delegation** en `~/.cursor/skills/trello-vago-delegation/SKILL.md`), **sigue el orden de precedencia** que defina esa skill para esa sesión o delegación concreta.

## Modos de cierre (elegir uno y cumplirlo de punta a punta)

| Modo | Cuándo | Commit / PR | Worktree al terminar |
|------|--------|-------------|------------------------|
| **A — Interactivo (por defecto)** | Tareas al usuario, sin otra skill que imponga PR, o el usuario pide **revisar antes de commitear** | **No** `git commit` hasta aprobación explícita. Tras aprobación: commit, y opcionalmente push y recordatorio de PR | Opcional: `git worktree remove` cuando el usuario indique, si el merge del PR o la política del equipo lo permiten |
| **B — Entrega con PR (sin merge por el agente)** | Se delega con **delegate-task-pr**, **trello-vago-delegation** (que a su vez usa delegate-task-pr), o el usuario pide explícitamente **abrir PR y no mergear** / **cierre vago** | Tras verificar: `git add`, **`git commit`**, `git push -u`, **`gh pr create`**. **Prohibido** `gh pr merge` o merge local al base por el agente | **Obligatorio** `git worktree remove` del directorio de esa tarea tras abrir el PR, desde el clon principal; luego `git worktree prune` si aplica (detalle en la skill de delegación) |

- Si el prompt de delegación o el usuario citan **delegate-task-pr**, el flujo **trello-vago** (o el texto equivalente), usa **Modo B** aunque este documento, en otras secciones, hable de “esperar aprobación”: en ese contexto, la **revisión** pasa a ser el **PR en GitHub**, no un paso de “aprobame el diff en el chat” antes del commit.
- El **Modo A** es el supuesto si nadie fija otra regla de cierre.

## Principios (comunes a ambos modos)

- **Un cambio = una rama + un worktree** (o equivalente aislado) para no mezclar contexto con otras tareas.
- **Plan antes de código**: descomponer en tareas verificables; no empezar a implementar hasta tener un plan razonable o hasta que el usuario confirme el enfoque si hay ambigüedad fuerte.
- **Regla de commit según el modo** (A: tras aprobación en chat. B: tras implementación verificada, sin depender de “aprobación de diff” en el chat; el PR es el canal de revisión).

## Fase 1 — Análisis y planificación (“planner”)

1. Leer el pedido y el código/contexto mínimo necesario (no explorar de más).
2. **Usar modo Plan** (o equivalente de planificación estructurada en Cursor) para:
   - Objetivo y criterios de aceptación inferidos (marcar supuestos).
   - Lista de tareas ordenada con dependencias.
   - Riesgos (auth, datos, migraciones, compatibilidad).
   - Plan de verificación (tests manuales o automatizados).
3. Si el plan es largo o hay decisiones de producto, **presentar el plan al usuario** y pedir confirmación del enfoque antes de tocar código (en **Modo B**, si el usuario no está en el chat, documentar supuestos en el cuerpo del PR).

## Fase 2 — Aislamiento en Git (worktree + rama)

1. Desde la raíz del repo, elegir nombres claros:
   - **Rama**: `feature/<tema-corto>` o convención del proyecto.
   - **Directorio del worktree**: hermano del repo o bajo un path acordado, p. ej. `../<repo>-<tema-corto>`.
2. Crear worktree y rama en un solo paso (ajustar rutas):

```bash
git fetch origin
git worktree add ../NOMBRE_WORKTREE -b feature/NOMBRE_RAMA origin/main
```

Usar la rama base correcta del proyecto (`main`, `master`, `develop`, etc.).

3. **Trabajar solo dentro del worktree** para esta tarea (edits, tests, `git status`).

## Fase 3 — Aclaraciones de producto

Antes de implementar en serio, pedir al usuario aclaración cuando falte:

- Comportamiento esperado en casos borde o errores.
- Permisos/roles, datos de ejemplo, copy/UI, métricas de éxito.
- Alcance explícito (qué queda **fuera** del cambio).

En **Modo A**, si no hay bloqueo, seguir con supuestos **explícitos** y marcarlos. En **Modo B**, los mismos supuestos van al **cuerpo del PR** o al comentario Trello vinculado, si el usuario no está disponible en el hilo.

## Fase 4 — Implementación

1. Ejecutar las tareas del plan de forma incremental; mantener el diff enfocado al pedido.
2. Verificar con linters/tests del proyecto en el worktree.
3. Preparar un resumen breve: qué cambió, por qué, cómo probarlo, riesgos residuales (en **Modo B**, incluirlo en el PR y en cierre Trello si aplica).

## Fase 5 — Aprobación, commit y cierre (según el modo)

### Modo A — Interactivo (por defecto)

1. **No hacer `git commit`** hasta que el usuario apruebe explícitamente los cambios (diff + resumen).
2. Tras la aprobación:
   - `git add` selectivo (evitar archivos basura o secretos).
   - Mensaje de commit claro (convención del repo si existe).
3. Opcional: recordar push y PR según el flujo del equipo.
4. El worktree: eliminarlo solo cuando el usuario lo indique y el estado del branch lo permita (ver notas al final).

### Modo B — Entrega con PR (p. ej. delegate-task-pr o trello-vago)

1. Con implementación y checks pasados, **sí** hacer `git add` y **`git commit`** (sin guardar aprobación de diff en el chat; la revisión es el PR).
2. `git push -u origin <rama>`; **`gh pr create`** con título y cuerpo que enlacen la tarjeta o el contexto.
3. **No** `gh pr merge` ni merge local: el humano o CI fusionan después.
4. Desde el **repositorio principal** (no desde el worktree a borrar), **`git worktree remove <ruta>`**; opcional `git worktree prune`.
5. Incluir la **URL del PR** en el cierre requerido por la otra skill (p. ej. comentario en Trello).

## Checklist rápido

**Modo A**

- [ ] Plan alineado (o supuestos explícitos aceptados).
- [ ] Worktree creado; trabajo solo ahí.
- [ ] Implementación verificada localmente.
- [ ] Usuario aprobó el diff en el chat **antes** del commit.
- [ ] Commit (y push/PR si el usuario lo pide en ese momento).

**Modo B**

- [ ] Plan o supuestos documentados (PR / Trello si no hay usuario en hilo).
- [ ] Worktree creado; trabajo solo ahí.
- [ ] Implementación verificada.
- [ ] Commit + push + `gh pr create` (sin merge por el agente).
- [ ] `git worktree remove` del worktree de la tarea.
- [ ] Enlace al PR en el cierre requerido (Trello, etc. si aplica).

## Notas

- Si el usuario **no** quiere worktree (entorno limitado), como alternativa mínima: rama dedicada en el mismo clon y disciplina de `git stash`/contexto; registrar la excepción en el chat. En **Modo B** se prefiere worktree; si no es posible, al menos rama aislada + push + PR y no merge.
- Inconsistencia entre skills: **la skill concreta de la tarea o la delegación** (p. ej. delegate-task-pr o vago) **gana** sobre el párrafo genérico de “no commitear” de Fase 5 cuando se invoca **Modo B** explícitamente.
