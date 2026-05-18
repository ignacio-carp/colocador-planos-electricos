---
name: senior-ticket-engineer
description: Lee el contenido de un ticket, planifica e implementa la solución, exige tests y ejecución exitosa de la suite antes de dar el ticket por cerrado y puede abrir un PR nuevo cuando los tests pasan. Usar cuando el usuario adjunte o describa un ticket, pida implementar una tarea, issue o tarjeta, o combine ticket, tests y PR.
disable-model-invocation: true
---

# Ingeniero senior por ticket

Va a leer el contenido de un ticket, planificar la implementacion y ejecutarla.

Cada ticket que implemente, debe sumar tests y correr correctamente para poder cerrarse.

Al implementar un ticket nuevo, si los test corren satisfactoriamente, puede crear un PR nuevo con los cambios.

## Objetivo (operativo)

Leer el **contenido del ticket**, **planificar** la implementación, **ejecutarla** y considerar el trabajo **cerrado solo** cuando existan **tests adecuados** y la **suite del proyecto corra con éxito**. Si la verificación es satisfactoria, **puede crear un PR nuevo** con los cambios (sin merge por el agente salvo orden explícita del usuario).

## Precedencia con otras skills

Si el usuario invoca **trello-vago-delegation**, **senior-feature-delivery** u otra skill que fije worktree, commits antes/después o reglas de PR, **esa skill gana** en lo que contradiga este documento; aquí se refuerza sobre todo **tests obligatorios** y **criterio de cierre**.

## Entrada del ticket

Obtener el texto y criterios de aceptación desde donde el usuario los proporcione: pegado en el chat, ruta a archivo, issue de GitHub, tarjeta de Trello, etc. Si falta alcance o criterios, **acotar supuestos por escrito** antes de implementar o preguntar al usuario si el hueco es crítico.

## Fase 1 — Planificación

1. Extraer objetivo, alcance explícito y criterios de aceptación del ticket.
2. Identificar archivos/módulos tocados y riesgos (datos, auth, breaking changes).
3. Definir lista ordenada de pasos de implementación y **qué comportamiento debe cubrir cada test** (nuevo o actualizado).
4. Si el plan es largo o hay bifurcaciones de producto, **resumir el plan** en el chat antes de codificar en serio.

## Fase 2 — Implementación

1. Mantener el cambio **acotado al ticket**; reutilizar patrones del repo.
2. **Añadir o actualizar tests** que demuestren el comportamiento acordado (unitarios, widget, integración o los que use el proyecto). Un ticket implementado **no se da por cerrado** solo con cambios de producción sin cobertura de prueba razonable para lo pedido.
3. Ejecutar los comandos de test del proyecto en el árbol donde se trabaja (por ejemplo `flutter test`, `npm test`, `pytest`, etc.) y **corregir fallos** hasta que pasen.

## Fase 3 — Definición de “ticket cerrado”

El ticket **solo puede considerarse listo para cerrar** cuando:

- Los cambios de código cumplen el alcance del ticket.
- Hay **tests nuevos o modificados** pertinentes al cambio.
- La **suite de tests ejecutada para ese trabajo termina correctamente** (exit code 0, sin tests fallidos ignorados).

Si el proyecto no tenía tests previos en esa área, **introducir la base mínima** para lo implementado en lugar de omitir tests.

## Fase 4 — PR (cuando aplique)

Si hay **repositorio git**, **rama dedicada** y **tests en verde**:

1. `git status` limpio de ruido; **no** incluir secretos ni artefactos locales.
2. Commit con mensaje claro (convención del repo si existe).
3. Push de la rama y **`gh pr create`** (u herramienta equivalente) con título/cuerpo que **resuman el ticket**, el enfoque y cómo se validó (comandos de test relevantes).

**No** fusionar el PR ni hacer merge local **salvo** que el usuario lo pida explícitamente.

## Checklist

- [ ] Ticket leído y criterios claros o supuestos documentados.
- [ ] Plan breve alineado con el alcance.
- [ ] Implementación acotada al ticket.
- [ ] Tests añadidos o actualizados para el comportamiento nuevo o corregido.
- [ ] Suite de tests del proyecto ejecutada con éxito para este trabajo.
- [ ] Si corresponde: commit, push y PR nuevo (sin merge por defecto).
