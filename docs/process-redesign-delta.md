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
| CAD `extract_geometry` | **Paredes**, **aberturas** (puertas/ventanas) y **muebles**; descarta textos y capas no clasificadas |
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

**Decisión:** Cierre flexible + descarga incremental + reabrir trabajo cerrado.

| Aspecto | Comportamiento |
|--------|----------------|
| Marcar procesado | En **cualquier momento** (`listo_para_editar` o `parcialmente_procesado`), aunque queden habitaciones pendientes |
| Descarga DXF | Disponible desde la **primera habitación procesada** (`parcialmente_procesado`); sin cambio |
| UI descarga | Barra superior (Export) + ProjectFileBar |
| Trabajo `procesado` | Chat y ediciones siguen activos; procesamiento por sidebar deshabilitado hasta reabrir |
| Reabrir | `POST …/workspace/reopen`: `procesado` → `parcialmente_procesado` si hay habitaciones procesadas, si no → `listo_para_editar` |

## Capítulo 8 — CAD Worker

**Decisión:** Recortar operaciones, enriquecer extract-geometry y exigir worker en rutas productivas.

| Aspecto | Comportamiento |
|--------|----------------|
| Operaciones | `inspect`, `extract-geometry`, `render-plan` (US-007), `apply-electrical-layer` (US-009 incremental por `room_id`) |
| Eliminado | `render-room` — la captura del visor reemplaza el PNG de habitación en US-008 |
| `extract-geometry` | Paredes + **aberturas** (puertas/ventanas) + muebles; sin textos |
| US-009 | Merge incremental por habitación (sin cambio) |
| Transporte | Spawn local + HTTP (`CAD_WORKER_URL`) según entorno |
| Worker deshabilitado | Las funciones del bridge **lanzan error**; en live el análisis preliminar falla si `CAD_WORKER_DISABLED=true`. Modo stub sigue operando sin CAD en dev/test |

## Capítulo 9 — Cola y batch legacy

**Decisión:** Eliminar el endpoint batch `POST /api/jobs/:jobId/process`. La cola in-memory y el worker de fondo se mantienen para análisis preliminar y process-rooms async.

| Aspecto | Comportamiento |
|--------|----------------|
| Eliminado | `POST …/process` (pipeline batch completo) y `full_pipeline` en cola |
| Cola | In-memory FIFO; tipos: `preliminary_analysis`, `room_processing` |
| Worker | `PIPELINE_WORKER_ENABLED` drena cola en background |
| UI | `process-rooms` siempre con `?sync=1`; `start-analysis` encola y el worker procesa en background (UI hace polling) |
| Integraciones | Pueden encolar process-rooms sin sync y confiar en el worker |
| Flujo canónico | start-analysis → workspace → process-rooms |

## Orden sugerido de PRs

1. **PR1 — Disparador manual de análisis** (API register/replace + `start-analysis` + UI)
2. **PR2 — Docs US-012** (historias de usuario alineadas)
3. Futuro: cola Postgres
