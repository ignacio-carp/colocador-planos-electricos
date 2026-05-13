---
name: trello-vago-delegation
description: Obtiene tareas desde un board de Trello (lista configurable, etiqueta "vago"), verifica alineación lista/proyecto, y enruta cada tarea al skill delegate-task-pr para planificación y delegación con worktree y PR; el subagente debe cerrar la tarjeta en Trello (comentario, etiqueta finished, checklists) sin mover de lista. No hace merge de PRs. Use when the user specifies a Trello board, vago label, lista = proyecto, or this skill path.
---

# Trello: tareas `vago` y handoff a delegación

Este skill cubre **solo la parte Trello**: localizar lista, filtrar por `vago`, validar coherencia con el proyecto de la lista y extraer el contenido de cada tarjeta. La **planificación y delegación** (subagente, worktree, PR sin merge, limpieza) siguen el skill **delegate-task-pr** en `~/.cursor/skills/delegate-task-pr/SKILL.md` — **leerlo y aplicarlo** para cada tarjeta elegida.

## Modelo: lista = proyecto y backlog

Dentro de un board, **cada lista representa un proyecto y su backlog**:

- Trabajar **solo** con la lista acordada con el usuario (`listId` / nombre): es el **proyecto** activo.
- **Verificar coherencia** entre tarjeta y ese proyecto (título, descripción, enlaces, etiquetas). Si una tarjeta `vago` parece de **otro** proyecto, **no asumir**: confirmar con el usuario o excluirla con motivo explícito en el resumen.
- No mezclar listas salvo instrucción explícita del usuario.

## Entrada obligatoria

El usuario indica el **board** (nombre aproximado o ID). Resolver `boardId` con las herramientas Trello (`mcp_trello_list_boards` + nombre; si hay ambigüedad, pedir confirmación).

**Lista de origen:** el usuario indica **en qué lista** están las tarjetas. Si **no** la define, **preguntar** qué lista usar y **no continuar** hasta acordar nombre o `listId`. Esa lista es el backlog de referencia del proyecto.

Opcional: `mcp_trello_set_active_board` con ese `boardId`.

## 1. Localizar la lista

1. `mcp_trello_get_lists` con el `boardId`.
2. Resolver la lista indicada:
   - **Coincidencia exacta** por nombre si existe.
   - Si no hay exacta pero hay una candidata obvia (p. ej. una sola lista que contenga el texto dado), **proponerla** y pedir **confirmación**.
   - Si hay varias o ninguna clara, listar los **nombres reales** de las listas y pedir que elija.

Anotar `listId` acordado.

## 2. Obtener cartas y filtrar por etiqueta

1. `mcp_trello_get_cards_by_list_id` con `listId` — **solo** esta lista.
2. `mcp_trello_get_board_labels` con el `boardId` para el **id** de la etiqueta **`vago`**.
3. Considerar **solo** tarjetas no archivadas (`closed: false` si viene) con etiqueta `vago` (`idLabels` vs id de la etiqueta; si la lista no trae etiquetas, `mcp_trello_get_card` por tarjeta).
4. **Chequeo de proyecto** por candidata frente al significado de la lista; señalar incongruencias antes de delegar.

Si **no** existe la etiqueta `vago`, **reportar** los nombres reales de labels y **no** inventar datos.

## 3. Por cada tarjeta a abordar (o la que elija el usuario)

1. Leer **nombre**, **descripción**, **checklists** (p. ej. `mcp_trello_get_acceptance_criteria` / `mcp_trello_get_checklist_by_name`), **comentarios** si hace falta (`mcp_trello_get_card_comments`).
2. **Analizar** y revalidar encaje con el **proyecto** de la lista.
3. **Handoff**: ejecutar el flujo de **delegate-task-pr** (`~/.cursor/skills/delegate-task-pr/SKILL.md`) usando como fuente de la tarea el contenido de la tarjeta (título, descripción, criterios literales, URL de la tarjeta si existe en `url` / `shortLink`).
4. En el **prompt del subagente**, además de lo que exige delegate-task-pr, incluir **obligatoriamente** el bloque **Cierre en Trello** de la siguiente sección. Eso es parte del encargo; no es opcional salvo que el usuario indique lo contrario para esa sesión o tarjeta.

El agente padre puede hacer el **resumen + plan** breve antes de delegar según delegate-task-pr, o confiar en que el hijo lo documente en el PR si el usuario pidió ir directo.

## Cierre en Trello (solo subagente cuando el origen es este flujo)

Tras completar el trabajo de la tarjeta (según delegate-task-pr: PR abierto, etc.), el subagente **debe**, con MCP Trello:

1. **Comentario** en la tarjeta: resumen breve, **enlace al PR**, limitaciones o pendientes (`mcp_trello_add_comment`).
2. **Marcar finished** sin mover de lista (**no** usar `mcp_trello_move_card` para cierre):
   - `mcp_trello_get_board_labels`: etiqueta cuyo nombre sea **`finished`** (sin distinguir mayúsculas/minúsculas). Si existe, `mcp_trello_update_card_details` con `labels` que **incluyan** el id de `finished` **y** conservar las demás etiquetas que deban mantenerse.
   - Completar ítems de checklist pertinentes con `mcp_trello_update_checklist_item` cuando aplique.
   - Si **no** existe `finished`, indicarlo en el comentario de cierre, completar checklists que correspondan, y **no** inventar otra convención sin acuerdo con el usuario.

El **orden** práctico: abrir PR (delegate-task-pr) → cierre Trello (comentario + labels + checklists) → `git worktree remove` desde el clon principal, salvo que un paso técnico exija otro orden mínimo.

## 4. Reglas prácticas

- **Una tarjeta por delegación** si las tareas son grandes; si son triviales, el usuario puede pedir agrupar (un worktree para el lote, explícito).
- **Nunca** `gh pr merge` ni merge por el agente en este flujo.
- Precedencia: obligaciones **Trello** de esta skill se suman a **delegate-task-pr**; ante duda sobre cierre, esta skill **gana** para comentario/etiquetas/checklist en la tarjeta.

## Referencia MCP (Trello)

| Objetivo | Herramienta típica |
|----------|---------------------|
| Boards | `mcp_trello_list_boards`, `mcp_trello_set_active_board` |
| Listas | `mcp_trello_get_lists` |
| Cartas en lista | `mcp_trello_get_cards_by_list_id` |
| Etiquetas del board | `mcp_trello_get_board_labels` |
| Detalle / labels | `mcp_trello_get_card`, `mcp_trello_update_card_details` |
| Checklists | `mcp_trello_get_acceptance_criteria`, `mcp_trello_get_checklist_by_name`, `mcp_trello_update_checklist_item` |
| Comentarios | `mcp_trello_add_comment` |
| Cierre sin mover | etiqueta `finished` + checklists; **no** `mcp_trello_move_card` para este flujo |
