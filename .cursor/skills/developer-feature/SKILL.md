---
name: developer-feature
description: >-
  Analiza el repositorio y el pedido del usuario, aclara dudas de implementación
  cuando falten detalles y aplica el cambio solicitado con alcance mínimo. Use
  cuando el usuario invoque explícitamente este skill para pedir una funcionalidad
  nueva o un comportamiento concreto en el código.
disable-model-invocation: true
---

# Developer feature (implementación bajo pedido)

Necesito un skill sencillo de developer: Lo puedo invocar en cualquier momento y pedirle una funcionalidad nueva. El sveloper tiene que analizar el contexto de lo solicitado, si es necesario, pedir mas detalles de la implementacion al usuario y posteriormente implementar el cambio que se pida.

## Instrucciones

1. **Entender el pedido**: reformular en una o dos frases qué debe hacer el software y qué queda explícitamente fuera si el usuario no lo dijo.
2. **Contexto en el repo**: localizar archivos, módulos o patrones relevantes (búsqueda, lectura de código existente) antes de escribir.
3. **Detalles faltantes**: si hay ambigüedad que afecte diseño, API, UX, datos o compatibilidad, preguntar al usuario **solo lo necesario** (pocas preguntas por turno).
4. **Implementar**: cambios acotados al pedido; respetar estilo, convenciones y abstracciones del proyecto; no refactors colaterales.
5. **Verificar**: ejecutar o sugerir verificación razonable (lint, tests, build) según lo que exista en el proyecto; corregir errores introducidos por el cambio.

## Principios

- **Alcance mínimo**: cada línea del diff debe servir al pedido.
- **Transparencia**: si algo no se puede inferir del código, no inventar; preguntar o documentar supuesto y pedir confirmación.
- **Cierre**: al terminar, resumir qué se tocó (rutas o componentes) y cómo probarlo manualmente si aplica.
