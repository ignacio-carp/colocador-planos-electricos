---
name: user-story-to-backlog
description: Derives an implementation backlog from a user story with technical implementation details and acceptance criteria; writes output to a markdown file under docs/ or creates cards on a Trello list the user specifies. Use when the user asks for backlog from a user story, tasks to implement a US, technical breakdown of a story, or when attaching this skill for story-to-sprint work.
disable-model-invocation: true
---

# De historia de usuario a backlog implementable

## Objetivo operativo (texto del usuario)

> A partir de una historia de usuario, queiro que armes el backlog necesario para poder implementarlo. Necesito que incluyas detalles tecnicos de la implementacion y los criterios de aceptacion. Los podes guardar en un archivo, o en alguna lista de Trello que yo te indique.

## Cuándo usar este skill

- Tienen una **historia de usuario** (p. ej. `US-xxx` en markdown, tarjeta, o texto pegado) y quieren **tareas de implementación** ordenadas y estimables.
- Debe quedar **trazabilidad** entre criterios de aceptación de la historia y verificaciones concretas (tests, checks manuales, contratos).

## Entrada mínima

1. **Historia completa** (archivo, ID + repo, o contenido en el mensaje): formato libre si incluye contexto, alcance, datos, integraciones y criterios de aceptación.
2. **Destino del backlog** (elegir uno; si no dicen, proponer ruta de archivo y confirmar):
   - **Archivo:** ruta bajo el repo, p. ej. `docs/backlog/US-xxx-backlog.md` (crear `docs/backlog/` si no existe).
   - **Trello:** `boardId` (o board activo), `listId` donde crear tarjetas; el usuario debe indicarlos explícitamente.

## Salida obligatoria

Cada ítem del backlog debe incluir, en la medida que la historia lo permita (si falta info, marcar **TBD** y una pregunta concreta):

| Bloque | Contenido |
|--------|-----------|
| Referencia | ID y título de la historia |
| Tareas | Lista ordenada (dependencias primero); granularidad **día o menos** por tarea cuando sea posible |
| Detalle técnico | Stack/archivos a tocar, APIs, esquema DB, auth/RBAC, jobs/async, integraciones — sin inventar stack: inferir del repo o preguntar |
| Criterios de aceptación | Copiar o refinar los de la US; por tarea, sub-bullets **cómo verificar** (manual, test automatizado, contrato API) |
| Riesgos / supuestos | Breve |

## Workflow

1. **Leer** la historia y el código o `docs/` relevante del repo (si existe) para alinear nombres y stack.
2. **Descomponer** en: infra/config → modelo de datos → backend → frontend → observabilidad → QA/documentación mínima según aplique.
3. **Mapear** cada criterio de aceptación de la historia a una o más tareas o a una sección "Verificación final".
4. **Escribir** en el destino elegido:
   - **Markdown:** seguir plantilla en [reference.md](reference.md).
   - **Trello:** una tarjeta por tarea (o por grupo cohesivo si el usuario pide menos ruido); título corto; descripción con detalle técnico + AC en markdown de tarjeta; checklist en tarjeta si aplica. No mover tarjetas de lista salvo que lo pidan.
5. **Cerrar** el turno: rutas creadas o enlaces a tarjetas, y lista corta de TBD si quedaron.

## Reglas

- **No inventar** requisitos que la historia no mencione; los gaps van como TBD + pregunta.
- **Brevedad** en nombres de tareas; el detalle técnico va en el cuerpo.
- **Misma nomenclatura** que la historia (roles, estados, entidades).
- Si el usuario **no** indica archivo ni Trello, preguntar solo: "¿`docs/backlog/<US-id>-backlog.md` o lista Trello (pegar `listId`)?"

## Recursos

- Plantilla y ejemplo: [reference.md](reference.md)
