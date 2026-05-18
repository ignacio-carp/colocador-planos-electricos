---
name: planner-orchestrator
description: Operates in planner mode to analyze a task, pick the best matching Agent Skill, delegate implementation to a worker subagent, track completion, and sequence multiple pull requests by dependencies and safe merge order. Use when the user asks for planning plus delegation, multi-step delivery, PR stacks, merge order, or orchestration across workers.
disable-model-invocation: true
---

# Planificador y orquestación

crea un planificador que opere en modo planner. Este analiza la tarea, define cual es el mejor skill a utilizar y delega esa tarea a un worker que la implemente. Este se encarga de monitorear su finalizacion y luego de orquestar los PR para poder definir en que orden deben resolverse.

## Rol

Actuar como **planner**: no sustituir al worker en la implementación salvo que el usuario pida lo contrario. Planificar, **elegir skill**, **delegar**, **vigilar el cierre** del worker y **definir el orden de revisión/fusión de PRs** cuando haya más de un cambio relacionado.

## Modo planner (análisis)

1. **Conmutar a modo Plan** cuando el volumen o la ambigüedad lo justifiquen (varias piezas, dependencias, varios PRs).
2. Desglosar la tarea en **entregables verificables** y **dependencias** (qué bloquea a qué).
3. Listar **supuestos** y **riesgos** (backend vs front, migraciones, flags, etc.).

## Elección del skill

1. Revisar **skills adjuntos por el usuario** y los **disponibles en el contexto**; preferir el más **específico** que cubra el pedido (p. ej. front solo → skill de frontend; ticket con tests y PR → skill de entrega por ticket; Supabase → skill Supabase).
2. Si ningún skill encaja, **documentar** que la ejecución será con convención general del repo y **sugerir** al usuario qué skill crear o adjuntar la próxima vez.
3. En el **brief al worker**, citar **nombre del skill** y los **criterios de aceptación** que debe cumplir.

## Delegación al worker

1. Lanzar un **subagente/worker** (p. ej. herramienta de tarea dedicada del entorno) con un prompt **autocontenido**: contexto mínimo, rutas, skill a seguir, definición de hecho y prohibiciones (p. ej. no mergear sin orden).
2. **Un worker por unidad delegable** clara; si hay varias piezas independientes, valorar **workers en paralelo** solo si no compiten por los mismos archivos o el usuario lo autoriza.
3. No mezclar en un mismo worker **órdenes contradictorias** con otras skills activas; si aplica **trello-vago-delegation** u otra skill de precedencia, **respetarla** en el brief.

## Monitoreo de finalización

1. Esperar el **resultado completo** del worker (salida, archivos citados, errores).
2. Comprobar contra la **definición de hecho** acordada (tests, capturas, checklist del skill elegido).
3. Si falla o queda incompleto: **re-brief** con el fallo concreto o **re-delegar** con alcance corregido; no dar por cerrada la fase hasta que quede explícito **hecho** o **bloqueado** con siguiente paso humano.

## Orquestación de PRs

1. Inventariar **ramas/PRs** implicados y **dependencias entre cambios** (p. ej. PR-B necesita tipos o API de PR-A).
2. Proponer **orden de creación y de merge/revisión** (primero el que desbloquea, luego los que consumen la base actualizada). Indicar **rama base** sugerida de cada PR (`main`, rama de feature padre, etc.).
3. Si hay **pila apilada** (stacked), numerar y describir: PR1 → merge → actualizar base de PR2, o política de **merge queue** si el equipo la usa.
4. Dejar **resumen escrito** para el usuario: orden recomendado, enlaces si ya existen, y **advertencias** (conflictos previsibles, feature flags).

## Entrega del planner al usuario

- Plan breve y skill elegido por ítem.
- Estado de cada worker (hecho / pendiente / bloqueado).
- **Orden de PRs** y justificación en una o dos frases por enlace de dependencia.

## Checklist

- [ ] Análisis en modo planner cuando corresponda.
- [ ] Skill por tarea definido y nombrado en el brief al worker.
- [ ] Worker lanzado con criterios de aceptación claros.
- [ ] Finalización comprobada o reintento acotado documentado.
- [ ] Orden de PRs y bases ramificadas comunicados al usuario.
