# Referencia: plantilla y checklist extendido

## Plantilla por historia (Markdown)

Usar una sección por historia con IDs únicos.

```markdown
### [HU-XXX] Título corto y orientado al valor

| Campo | Valor |
|-------|--------|
| Estado | borrador \| revisión \| listo |
| Prioridad | … |
| Módulo / Área | … |
| Epic | … |

**Como** [actor]
**quiero** [capacidad]
**para** [beneficio / resultado medible].

#### Contexto
[Fondo mínimo: problema actual, disparadores.]

#### Alcance
- Incluye: …
- No incluye: …

#### Flujo principal
1. …
2. …

#### Variaciones y errores
- …

#### Datos y reglas
- Entidades / campos: …
- Validaciones: …
- Reglas de negocio: …

#### Integraciones
- APIs / eventos / sistemas: …
- Contrato (request/response o payload): … si conocido

#### Requisitos no funcionales
- Seguridad / permisos: …
- Rendimiento / volumen: …
- Auditoría / trazabilidad: …
- Otros: …

#### Criterios de aceptación (Gherkin opcional)
```gherkin
Escenario: …
  Dado …
  Cuando …
  Entonces …
```

#### Dependencias y supuestos
- …

#### Metadata para ingestión (opcional)
Campos clave-valor acordados con el sistema destino (ej. `feature_key`, `labels`, `team_id`).

#### Notas técnicas (opcional)
Orientación de implementación sin prescribir diseño si no fue pedido.
```

## Índice en documento único

Si todo va en un solo archivo:

```markdown
# Historias de usuario — <nombre iniciativa>

## Resumen ejecutivo
…

## Tabla de contenidos
- [HU-001 …](#hu-001)
- …

---

## HU-001 …
…
```

## Checklist extendido (preguntas de respaldo)

Usar solo si faltan datos después del mínimo:

- ¿Hay estados del proceso (máquina de estados)?
- ¿Idempotencia / reintentos / duplicados?
- ¿Privacidad / retención / datos personales?
- ¿Feature flags o rollout?
- ¿Ambientes y datos de prueba?
- ¿Migraciones o datos históricos?
- ¿Observabilidad (logs, métricas, alertas)?

## Ejemplo mínimo rellenado

```markdown
### [HU-001] Exportar plano en PDF

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Planos |
| Epic | Entregables cliente |

**Como** responsable de obra
**quiero** exportar el plano actual en PDF
**para** enviarlo al cliente sin herramientas de diseño.

#### Contexto
Hoy capturan pantalla o copian manualmente.

#### Alcance
- Incluye: exportación del estado visible del lienzo, nombre de archivo sugerido.
- No incluye: marca de agua corporativa (epic aparte).

#### Criterios de aceptación
- El PDF refleja dimensiones y escala indicadas en pantalla.
- Si el plano supera el tamaño máximo permitido, se muestra error claro sin bloquear la app.
```
