# Referencia: plantilla de backlog y checklist

## Plantilla — archivo `docs/backlog/US-xxx-backlog.md`

```markdown
# Backlog de implementación — [US-xxx] Título de la historia

| Campo | Valor |
|-------|--------|
| Historia | US-xxx |
| Fuente | ruta o enlace al documento de historias |
| Fecha | ISO |
| Estado del backlog | borrador \| listo para sprint |

## Resumen

1–3 frases: qué se construye y qué queda explícitamente fuera.

## Criterios de aceptación (de la historia)

Copiar de la US. Tabla opcional:

| # | Criterio (texto de la US) | Verificación |
|---|---------------------------|--------------|
| AC1 | … | Test / manual / contrato |

## Tareas ordenadas

### T1 — Título corto

- **Descripción:** qué se logra.
- **Detalle técnico:** archivos/módulos, endpoints, tablas, colas, feature flags, env vars.
- **Criterios / verificación:** bullets enlazados a AC#.
- **Depende de:** T0 o ninguna.

### T2 — …

## Verificación final (Definition of Done para esta US)

- [ ] Todos los AC cubiertos por tarea o por sección de pruebas
- [ ] RBAC / permisos probados si aplica
- [ ] Errores y estados límite alineados a la US

## Riesgos y supuestos

- …

## TBD / preguntas abiertas

- …
```

## Plantilla — descripción de tarjeta Trello (por tarea)

```markdown
**Historia:** US-xxx — …

**Detalle técnico**
- …

**Criterios de aceptación (trazabilidad)**
- [ ] … (AC1)
- [ ] … (AC2)

**Notas**
Depende de: …
```

## Checklist antes de generar el backlog

- [ ] Historia leída completa (contexto, alcance, datos, integraciones, NFR si hay).
- [ ] Explorado el repo (stack, patrones, carpetas) o anotado TBD si repo vacío.
- [ ] Estados / roles / entidades alineados al texto de la US.
- [ ] Cada AC tiene al menos un camino de verificación en una tarea o en "Verificación final".
- [ ] Orden de tareas respeta dependencias (DB antes de API que la consume, etc.).

## Granularidad sugerida

| Tamaño | Indicación |
|--------|--------------|
| Grande | Partir en 2+ tareas (ej. "API + UI" separados). |
| Pequeño | Una tarea puede unir setup + primer endpoint si es trivial. |

## Anti-patrones

- Tareas solo genéricas ("implementar feature") sin archivo o capa mencionada cuando el repo es conocible.
- Omitir criterios de aceptación porque "ya están en la US" — deben **reaparecer** mapeados a verificación.
- Crear en Trello sin `listId` confirmado por el usuario.
