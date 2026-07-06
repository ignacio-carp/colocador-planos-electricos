# Delta de rediseño de procesos — Cambre Planos de Luz

Documento de decisiones de la sesión iterativa. **Interfaces, roles y responsabilidades se mantienen**; cambian disparadores y secuencia de procesos.

## Capítulo 1 — Acceso al sistema

**Decisión:** Mantener sin cambios.

- Bootstrap admin vía CLI, invites Supabase, roles `administrator` / `architect`.
- Admin: solo lectura en workspace; arquitecto: operación completa.

## Capítulo 2 — Nace un trabajo

**Decisión:** Análisis preliminar **manual** (no automático al registrar DXF).

| Antes | Después |
|-------|---------|
| `POST …/dxf-input/register` encola análisis inmediatamente | Register solo persiste el archivo; job queda `pendiente` con DXF |
| Replace reinicia análisis automáticamente | Replace resetea estado; arquitecto inicia análisis explícitamente |
| — | `POST …/workspace/start-analysis` dispara US-012 |

**Sin cambio:** creación con título, upload en 3 pasos, toggle `normative_rules_enabled` solo en `pendiente`.

## Capítulo 3 — Análisis preliminar

**Decisión:** Solo identificación de habitaciones (US-007). US-008 queda para procesar habitación (Cap. 5).

| Aspecto | Comportamiento |
|---------|----------------|
| Objetivo | Detectar habitaciones y polígonos para futuras capturas por ambiente |
| US-007 | Sí — núcleo del análisis |
| US-008 | No en preliminar |
| CAD `extract_geometry` | Solo **paredes** y **muebles**; descarta aberturas, textos y capas no clasificadas |
| 0 habitaciones | Job → `listo_para_editar` con warning `NO_ROOMS_DETECTED`; workspace habilitado; botón reprocesar |
| Fallo global | Solo errores técnicos (IA, DXF ilegible), no por ausencia de habitaciones |

**Disparador:** manual vía `POST …/workspace/start-analysis` (Cap. 2).

## Capítulo 4 — Workspace

**Decisión:** Workspace centrado en habitaciones con visor amplio y chat flotante.

| Aspecto | Comportamiento |
|---------|----------------|
| Layout | Lista lateral de habitaciones + visor DXF a ancho completo |
| Selección | Click en lista o overlay → zoom automático al polígono |
| Chat | Panel flotante inferior, **minimizado por defecto** |
| Recomendaciones preliminares | Eliminadas del UI (sin US-008 en preliminar) |
| 0 habitaciones | Visor + chat habilitados; sin botonera de procesamiento |
| Botonera | Solo visible si hay ≥1 habitación detectada |

## Capítulo 5 — Procesar habitación

**Decisión:** Procesamiento desde la **lista lateral** (habitación seleccionada), no desde botonera multi-select.

| Aspecto | Comportamiento |
|--------|----------------|
| Disparador | Botón **Procesar** / **Reprocesar** en sidebar sobre la habitación seleccionada |
| Instrucción IA | Preview editable antes de enviar (`GET …/processing-instruction` + modal) |
| Envío US-008 | `processing_instruction` + `viewport_image` (captura del visor) en `POST …/process-rooms` |
| Reproceso | Permitido en habitaciones `procesada` o `error` |
| Omitir | Por habitación desde sidebar (pendientes) |
| Cierre trabajo | Panel inferior solo **Marcar trabajo como procesado** |
| DXF | Sigue siendo incremental por habitación (US-009 tras US-008) |

## Capítulo 6 — Chat

**Decisión:** El chat live pasa de respuesta JSON estructurada a un **loop agéntico con herramientas** (tool-calling).

| Aspecto | Comportamiento |
|--------|----------------|
| Arquitectura live | El LLM encadena herramientas viendo resultados intermedios (`openaiChatWithTools`, máx. 6 iteraciones) |
| Herramientas | `get_room_details` (polígono + elementos + estado), `add_elements` (posiciones explícitas), `remove_elements`, `process_room` (con instrucción derivada) |
| Posicionamiento | La IA consulta el polígono y elementos existentes antes de posicionar (ya no cae al centroide por defecto) |
| Confirmación | No se pide: la conversación expresa la intención, procesa directo |
| Trabajos `procesado` | Chat activo con ediciones (sin cambio) |
| DXF | Ediciones no procesadas en el loop → re-apply US-009 automático al cerrar el turno |
| Modo stub | Parser determinístico en español sin cambios (dev/tests sin API key); también es el fallback si el LLM falla |
| Intent registrado | Derivado de las herramientas usadas: `process_room` → `action`, ediciones → `edit`, ninguna → `query` |

## Capítulo 7 — Cerrar y descargar

**Decisión:** Sin cambios. `mark-complete`, descarga incremental, `procesado` no bloquea habitaciones pendientes.

## Capítulo 8 — CAD Worker

**Decisión:** Sin cambios en contrato Python. Mismas operaciones vía `cadWorkerBridge`.

## Capítulo 9 — Cola y batch legacy

**Decisión:** Deprecar botón UI de pipeline batch completo; mantener `POST …/process` por compatibilidad API.

- Cola in-memory sin cambio en esta iteración.
- Flujo canónico: start-analysis → workspace → process-rooms.

## Orden sugerido de PRs

1. **PR1 — Disparador manual de análisis** (API register/replace + `start-analysis` + UI)
2. **PR2 — Docs US-012** (historias de usuario alineadas)
3. Futuro: cola Postgres, retiro de `/process` batch
