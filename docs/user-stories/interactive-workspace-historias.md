# Historias de usuario técnicas — Cambre: workspace interactivo

| Campo | Valor |
|-------|--------|
| Versión | 0.3 |
| Fecha | 2026-06-08 |
| Autoría | Derivado de iteración de producto sobre `docs/user-stories/cambre-planos-mvp-historias.md` |
| Estado | listo |

## Resumen ejecutivo

Evolución del flujo batch del MVP hacia un **espacio de trabajo interactivo** donde el arquitecto, tras subir un `.dxf`, obtiene un análisis preliminar (US-007 + US-008 en modo lectura si las reglas están activas), visualiza el plano en 2D desde arriba, consulta y corrige el análisis vía chat con IA, y procesa habitaciones de forma incremental (siempre US-008 → US-009 por habitación seleccionada, salvo reglas desactivadas). La descarga del `.dxf` con capa `Cambre_Electrical` está disponible en cuanto al menos una habitación fue procesada.

**Objetivo de negocio:** dar control y transparencia al arquitecto sobre qué se analiza y qué se modifica en el CAD, reduciendo la sensación de “caja negra” del pipeline actual y permitiendo validar habitación por habitación antes de comprometer el archivo de salida.

**Relación con MVP:** este documento **no reemplaza** [`cambre-planos-mvp-historias.md`](cambre-planos-mvp-historias.md). Define historias US-011 en adelante y documenta **enmiendas** a US-006, US-007, US-008, US-009 y US-010. US-001 a US-005 permanecen sin cambio.

### Regla transversal: US-008 antes de toda modificación al CAD

**Acordado (v0.2):** toda operación que modifique el `.dxf` (US-009, escritura de `Cambre_Electrical`) **debe** estar precedida por inferencia normativa **US-008** con reglas Cambre activas. No se aplican atajos heurísticos sobre `rules.json` en lugar de US-008 para decidir componentes o coordenadas.

| Condición | Comportamiento |
|-----------|----------------|
| `normative_rules_enabled: true` (default) | US-008 obligatorio antes de US-009; las recomendaciones del panel provienen de la salida US-008 (`outlet_placements` + resumen textual por habitación). |
| `normative_rules_enabled: false` | El arquitecto desactiva reglas explícitamente. **No** hay US-008 automático en análisis ni en botonera; US-008 y procesamiento CAD solo se ejecutan si un **prompt explícito del usuario en el chat** lo solicita (v0.3). |

Esta regla aplica a US-012 (recomendaciones preliminares), US-013 (procesamiento por botonera) y US-014 (chat como único canal cuando las reglas están desactivadas).

### Roles del dominio

| Rol | Responsabilidad en el workspace |
|-----|----------------------------------|
| **Arquitecto** | Dueño del job: accede al workspace, ve análisis, usa chat, selecciona y procesa habitaciones, descarga `.dxf` incremental. |
| **Administrador** | Solo lectura del workspace y descarga de trabajos con al menos una habitación procesada (soporte/auditoría). **No** puede modificar trabajos: sin chat, sin procesar habitaciones, sin editar análisis (v0.3). |

### Máquina de estados del trabajo (`job`) — ampliada

Estados del MVP (`pendiente`, `procesando`, `procesado`, `error`) se **extienden** para el flujo interactivo. Los valores canónicos en API se documentan en snake_case; la UI puede mostrar etiquetas en español.

```text
Pendiente ──► Analizando ──► Listo_para_editar ──┬──► Parcialmente_procesado ──► Procesado
                    │                            │              ▲
                    └──► Error                   │              │
                                                   └── (procesar habitación(es)) ──┘
```

| Estado | Significado |
|--------|-------------|
| **Pendiente** | Trabajo creado; aún no hay `.dxf` registrado o análisis iniciado. |
| **Analizando** | Pipeline de análisis preliminar en curso (inspect + geometry + US-007 + US-008 si reglas activas). No se escribe capa eléctrica. |
| **Listo_para_editar** | Análisis preliminar completó; workspace habilitado (visor 2D, panel, chat, botonera). Ninguna habitación procesada aún. |
| **Parcialmente_procesado** | Al menos una habitación en estado `procesada`; existe `.dxf` de salida incremental descargable. |
| **Procesado** | El arquitecto marcó el trabajo como completo, o todas las habitaciones están `procesada` u `omitida`. **No bloquea** seguir procesando habitaciones `pendiente` (el job puede volver a **Parcialmente_procesado**). |
| **Error** | Fallo en análisis preliminar o condición bloqueante global. Fallo por habitación aislada no cambia el estado global; ver rollback US-009. |

**Transiciones permitidas:**

- **Pendiente → Analizando:** registro exitoso de `input_dxf` (enmienda US-006).
- **Analizando → Listo_para_editar:** US-007 exitoso.
- **Analizando → Error:** fallo terminal en análisis preliminar.
- **Listo_para_editar → Parcialmente_procesado:** primera habitación procesada con éxito (US-008 + US-009).
- **Parcialmente_procesado → Parcialmente_procesado:** procesamiento adicional de habitaciones.
- **Parcialmente_procesado → Procesado:** todas las habitaciones `procesada` u `omitida`, o acción explícita “Marcar como procesado” del arquitecto.
- **Procesado → Parcialmente_procesado:** el arquitecto procesa una habitación que seguía `pendiente` o reprocesa una existente.
- **Listo_para_editar / Parcialmente_procesado → Error:** solo fallo bloqueante global (p. ej. corrupción irrecuperable del DXF); fallo por habitación aislada marca esa habitación en `error` y aplica rollback del DXF (v0.3).

**Compatibilidad:** no se requiere retrocompatibilidad con el flujo batch MVP — la plataforma aún no está en producción (v0.3). Todos los jobs nuevos usan el flujo interactivo.

### Estado por habitación (`room_processing_state`)

Independiente del estado global del job; persiste en `pipeline_metadata` o tabla dedicada.

| Estado | Significado |
|--------|-------------|
| **pendiente** | Detectada en US-007; sin tomas en `Cambre_Electrical`. |
| **procesando** | US-008 y/o US-009 en curso para esta habitación. |
| **procesada** | Tomas aplicadas en el DXF de salida para esta habitación. |
| **error** | Fallo al procesar; mensaje y `correlation_id` consultables. |
| **omitida** | El arquitecto excluyó explícitamente la habitación del procesamiento. Cuenta como “cerrada” para marcar el job **Procesado**, pero el arquitecto puede revertirla a `pendiente` y procesarla después. |

## Tabla de contenidos

- [US-011 — Vista 2D del plano (render superior)](#us-011-vista-2d-del-plano-render-superior)
- [US-012 — Análisis preliminar automático al recibir DXF](#us-012-análisis-preliminar-automático-al-recibir-dxf)
- [US-013 — Botonera de habitaciones y procesamiento incremental](#us-013-botonera-de-habitaciones-y-procesamiento-incremental)
- [US-014 — Chat con IA en el workspace](#us-014-chat-con-ia-en-el-workspace)
- [US-015 — Descarga incremental del DXF procesado](#us-015-descarga-incremental-del-dxf-procesado)
- [Enmiendas a historias MVP](#enmiendas-a-historias-mvp)
- [Modelo de datos extendido](#modelo-de-datos-extendido)
- [Metadata para ingestión](#metadata-para-ingestión-global)
- [Decisiones cerradas (v0.3)](#decisiones-cerradas-v03)

---

## US-011 — Vista 2D del plano (render superior)

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Workspace / UI |
| Epic | Cambre — Workspace interactivo |

**Como** Arquitecto dueño del proyecto  
**quiero** ver el plano renderizado en 2D desde arriba con las habitaciones detectadas superpuestas  
**para** orientarme espacialmente y validar la interpretación de la IA antes de procesar tomas.

#### Contexto

Hoy [`JobDetail.tsx`](../../apps/web/src/pages/JobDetail.tsx) solo gestiona carga, estado y descarga; no existe visor de plano. El workspace interactivo requiere representación visual alineada con la geometría extraída por cad-worker y los polígonos de US-007.

#### Alcance

- Incluye:
  - Lienzo 2D con geometría base del DXF: segmentos de pared (`paredes` de `geometry_extract`), etiquetas de texto (`etiquetas_texto`).
  - Superposición de polígonos de habitaciones (`layout_interpretation.rooms[]`) con estilo diferenciado por `room_type` o estado de procesamiento.
  - Controles de zoom y pan (rueda, arrastre o equivalente accesible).
  - Resaltado de habitación al seleccionarla en la botonera (US-013) o al referenciarla desde el chat (US-014).
  - Leyenda mínima: escala si `scale.known`, sistema de coordenadas (`coordinate_system`).
- No incluye:
  - Edición geométrica del plano en el lienzo (mover paredes, redibujar polígonos, snap CAD).
  - Vista 3D, cortes o capas con toggle granular por layer DXF (fase posterior).
  - Render de entidades `Cambre_Electrical` en tiempo real durante procesamiento (opcional v2; v1 puede actualizar tras completar US-009 por habitación).

#### Flujo principal

1. El job está en **Listo_para_editar** o **Parcialmente_procesado**.
2. El arquitecto abre el workspace del proyecto.
3. El cliente solicita datos de render al backend (metadata persistida o endpoint dedicado).
4. El visor pinta geometría base y polígonos de habitaciones en el mismo espacio de coordenadas que US-007.
5. Al seleccionar una habitación en la botonera o vía chat, el polígono correspondiente se resalta y el viewport centra esa zona.
6. Mientras habitaciones están `procesando`, el cliente hace **polling** del estado del job (intervalo ~2 s) y actualiza visor, botonera y panel sin WebSocket/SSE (v0.3).

#### Variaciones y errores

- Análisis US-007 sin polígonos válidos: mensaje en panel; visor muestra solo geometría base si existe.
- `geometry_extract` vacío o fallido: visor degradado con mensaje; no bloquea panel ni chat si US-007 produjo habitaciones.
- Plano muy extenso: vista inicial ajustada a bounding box de todas las entidades renderizables.
- Pérdida de sesión durante navegación: al reingresar, el visor se reconstruye desde datos persistidos.

#### Datos y reglas

- **Entrada de render** (propuesta de contrato):
  - `geometry_extract.paredes[]`: `{ inicio: {x,y}, fin: {x,y} }`
  - `geometry_extract.etiquetas_texto[]`: `{ texto, posicion: {x,y} }`
  - `layout_interpretation.rooms[]`: `id`, `label`, `room_type`, `polygon.vertices[]`, `area_m2`
  - `layout_interpretation.coordinate_system`, `layout_interpretation.scale` (opcional)
  - `room_processing_state[]` por `room_id` para estilos de overlay
- **Validaciones:** coordenadas numéricas finitas; polígonos con ≥3 vértices para dibujar relleno.
- **Reglas de negocio:** solo el dueño del job y el Administrador (solo lectura) acceden al payload de render.

#### Integraciones

- **API (propuesta):** `GET /api/jobs/:jobId/workspace/render-data` → JSON con bloques anteriores; alternativa: campos ya en `GET /api/jobs/:id` / `pipeline_metadata` sin endpoint nuevo.
- **cad-worker:** reutiliza salida de `extract_geometry` ya persistida en análisis preliminar (US-012).
- **Contrato US-007:** [`vision-layout-output.json`](../../docs/contracts/pipeline/vision-layout-output.json).

#### Requisitos no funcionales

- **Rendimiento:** primera pintura perceptible en planos típicos del benchmark acordado con Cambre (umbral TBD; objetivo orientativo &lt;3 s en red local de desarrollo).
- **Seguridad:** mismo RBAC que el job; sin URLs públicas permanentes del archivo fuente.
- **Accesibilidad:** controles de zoom alternativos a rueda del mouse (botones +/-); contraste suficiente en polígonos superpuestos (TBD WCAG).
- **Consistencia:** mismo origen de ejes que el pipeline CAD para evitar desalineación con US-009.

#### Criterios de aceptación (verificables)

```gherkin
Escenario: Visor muestra plano y habitaciones tras análisis exitoso
  Dado un job en estado Listo_para_editar con layout_interpretation válido
  Cuando el arquitecto abre el workspace
  Entonces ve segmentos de pared y polígonos de cada habitación detectada
  Y puede hacer zoom y pan sin perder alineación entre paredes y polígonos

Escenario: Resaltado al seleccionar habitación
  Dado el workspace abierto con al menos dos habitaciones
  Cuando el arquitecto selecciona una habitación en la botonera
  Entonces el polígono de esa habitación se resalta en el visor 2D

Escenario: Acceso denegado a terceros
  Dado un job de otro arquitecto
  Cuando un arquitecto no dueño intenta obtener render-data
  Entonces el sistema responde 403 o 404 según política de ocultamiento
```

#### Dependencias y supuestos

- Depende de US-012 (análisis preliminar completado).
- Supone que `geometry_extract` y `layout_interpretation` comparten espacio de coordenadas coherente (normalización en API si el LLM devuelve variantes).

#### Metadata para ingestión (opcional)

- `story_id`: `US-011`
- `feature_key`: `workspace.render_2d`
- `labels`: `interactive-workspace`, `ui`, `visor`

#### Notas técnicas (decisión v0.3)

**Enfoque elegido — SVG 2D desde API (menor complejidad):** el visor renderiza un `<svg>` con transformaciones CSS para zoom/pan. Capas: (1) segmentos `paredes` y `etiquetas_texto` desde `render-data`; (2) polígonos de habitaciones con estilos por estado; (3) símbolos de tomas tras US-009. Sin parseo DXF en el cliente ni dependencia de Three.js.

**Alternativas evaluadas:**

| Opción | Soporte / adopción | Complejidad | Descarte para v1 |
|--------|-------------------|-------------|------------------|
| **SVG + payload API** | Nativo en navegadores; alineado a `geometry_extract` existente | Baja | — (elegida) |
| [`dxf-render`](https://www.npmjs.com/package/dxf-render) / [`dxf-react`](https://www.npmjs.com/package/dxf-react) | 21 tipos de entidad DXF; activo 2026; wrapper React | Media-alta (Three.js ~960 KB) | Reservada si SVG no alcanza fidelidad en planos reales |
| [`dxf-viewer`](https://www.npmjs.com/package/dxf-viewer) | ~37K descargas/mes; agnóstico | Media | Menos entidades que dxf-render |
| [`cad-viewer`](https://github.com/mlightcad/cad-viewer/) | 660+ stars; visor/editor completo DWG/DXF | Alta | Excesivo para overlay + habitaciones en v1 |
| Canvas 2D manual | Sin dependencias | Media | Más código propio que SVG para zoom/pan |

---

## US-012 — Análisis preliminar automático al recibir DXF

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Workspace / Pipeline |
| Epic | Cambre — Workspace interactivo |

**Como** sistema  
**quiero** ejecutar automáticamente el análisis preliminar del `.dxf` al registrarlo  
**para** que el arquitecto disponga de habitaciones, superficies y recomendaciones antes de cualquier modificación al CAD.

#### Contexto

En el MVP, el registro del archivo dispara el pipeline completo US-007 → US-008 → US-009. En el workspace interactivo, la carga solo debe producir **interpretación visual** y datos para la UI, sin escribir tomas ni generar `output_dxf` hasta que el arquitecto procese habitaciones (US-013).

#### Alcance

- Incluye:
  - Tras `POST /api/jobs/:jobId/dxf-input/register`, encolar o ejecutar **análisis preliminar**: cad-worker `inspect` + `extract_geometry` + **US-007** (`vision_layout`) + **US-008** en modo lectura (si `normative_rules_enabled`, default `true`).
  - Transición de job: **Pendiente** → **Analizando** → **Listo_para_editar** (o **Error**).
  - Persistencia en `pipeline_metadata`: `cad_worker_inspect`, `geometry_extract`, salida US-007, salida US-008 (`outlet_placements` propuestos, `normative_rules_version`).
  - Panel en workspace con:
    - Cantidad total de habitaciones detectadas.
    - Por habitación: `label`, `room_type`, `area_m2` (si US-007 la provee).
    - **Recomendaciones** derivadas de la salida US-008 (cantidad y tipo de tomas propuestas, reglas aplicadas); texto legible para el arquitecto.
  - Inicialización de `room_processing_state` en `pendiente` para cada `room_id`.
  - Toggle **Reglas normativas activas** (`normative_rules_enabled`, default `true`); si el arquitecto lo desactiva, se omite US-008 automático y el panel muestra solo datos US-007; inferencia normativa solo vía prompts en chat (US-014).
- No incluye:
  - US-009 ni escritura en el CAD.
  - Creación de `output_dxf` ni capa `Cambre_Electrical`.
  - Re-análisis US-007 tras ediciones en chat (no aplica: el plano base no se modifica, solo metadata — v0.3).

#### Flujo principal

1. Arquitecto sube `.dxf` válido (flujo US-006 sin cambio en storage).
2. Al registrar el archivo, el job pasa a **Analizando**.
3. Worker ejecuta inspect + geometry extract + US-007.
4. Si US-007 es exitoso y `normative_rules_enabled`, ejecuta US-008 para todas las habitaciones (modo lectura: persiste `outlet_placements` propuestos, sin US-009).
5. El job pasa a **Listo_para_editar**; la UI redirige o habilita el workspace con panel poblado (habitaciones + recomendaciones US-008 si aplica).

#### Variaciones y errores

- US-007 sin habitaciones (`rooms` vacío o ilegible): **Error** con mensaje orientado al usuario y `correlation_id`; opción futura “reintentar análisis” (TBD).
- Timeout o rate limit del proveedor IA: reintentos según `IA_MAX_ATTEMPTS`; fallo terminal → **Error**.
- Archivo DXF corrupto en inspect: **Error** antes de invocar LLM.
- Análisis en curso: la UI muestra progreso o estado **Analizando**; acciones de procesamiento deshabilitadas.

#### Datos y reglas

- **Recomendaciones (cerrado v0.2):** provienen **exclusivamente** de US-008 cuando `normative_rules_enabled: true`. El panel muestra resumen por habitación a partir de `outlet_placements` y `rule_ids` de la salida normativa. No se usan heurísticas paralelas sobre `rules.json` que sustituyan a US-008.
- **Entidades:** salidas US-007 y US-008; más `preliminary_recommendations[]` por `room_id` (texto generado desde US-008, `rule_ids[]`, conteo de tomas propuestas).
- **`normative_rules_enabled`:** boolean en `pipeline_metadata` o preferencia del job; default `true`.
- **Validaciones:** extensión `.dxf`, MIME y storage según US-006; `layout_interpretation` debe cumplir schema US-007 para habilitar workspace.

#### Integraciones

- cad-worker: `inspect_dxf`, `extract_geometry` ([`cadWorkerBridge.ts`](../../apps/api/src/cadWorkerBridge.ts)).
- US-007 live/stub: [`pipelineLive.ts`](../../apps/api/src/pipelineLive.ts), [`vision-layout-output.json`](../../docs/contracts/pipeline/vision-layout-output.json).
- Cola: reutilizar `job_pipeline_queue` con tipo de corrida `preliminary_analysis` o equivalente (TBD).

#### Requisitos no funcionales

- **Observabilidad:** logs y métricas por `job_id` y `correlation_id`; costo IA registrado como en pipeline actual.
- **Auditoría:** versión de `normative_rules_version` usada solo para recomendaciones textuales.
- **Idioma:** textos de recomendaciones y panel en español (alineado a hueco MVP sobre idioma UI).

#### Criterios de aceptación (verificables)

```gherkin
Escenario: Análisis preliminar automático tras carga
  Dado un job Pendiente del arquitecto
  Cuando registra un input_dxf válido
  Entonces el job pasa por Analizando y llega a Listo_para_editar sin output_dxf
  Y el panel lista cada habitación con etiqueta, tipo y m² si disponible
  Y cada habitación muestra al menos una recomendación textual basada en reglas Cambre

Escenario: US-008 en carga sin escritura CAD
  Dado registro exitoso del dxf con normative_rules_enabled true
  Cuando finaliza el análisis preliminar
  Entonces no existe archivo output_dxf
  Y sí hay outlet_placements propuestos en pipeline_metadata desde US-008
  Y las recomendaciones del panel reflejan esa salida

Escenario: Reglas desactivadas en análisis preliminar
  Dado normative_rules_enabled false antes del análisis
  Cuando finaliza US-007
  Entonces no se ejecuta US-008
  Y el panel muestra habitaciones sin recomendaciones normativas

Escenario: Fallo de análisis
  Dado un dxf que provoca fallo terminal en US-007
  Cuando se agotan los reintentos
  Entonces el job queda en Error con correlation_id visible para soporte
```

#### Dependencias y supuestos

- Depende de US-006 (carga de `.dxf`).
- Enmienda US-006: ver sección [Enmiendas a historias MVP](#enmiendas-a-historias-mvp).
- Supone `CAD_PIPELINE_MODE` compatible con live o stub para US-007 en entornos de prueba.

#### Metadata para ingestión (opcional)

- `story_id`: `US-012`
- `feature_key`: `workspace.preliminary_analysis`
- `labels`: `interactive-workspace`, `pipeline`, `us-007`

---

## US-013 — Botonera de habitaciones y procesamiento incremental

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Workspace / Pipeline |
| Epic | Cambre — Workspace interactivo |

**Como** Arquitecto  
**quiero** seleccionar una o varias habitaciones y procesarlas para agregar componentes eléctricos  
**para** controlar qué zonas del plano reciben tomas en la capa Cambre_Electrical sin procesar todo el archivo de una vez.

#### Contexto

El valor del workspace interactivo se materializa cuando el arquitecto decide qué habitaciones pasan por inferencia normativa (US-008) y generación CAD (US-009). La botonera es el control principal; el chat (US-014) puede disparar la misma operación.

#### Alcance

- Incluye:
  - Lista o botonera con una entrada por habitación (`room_id`, `label`, `room_type`, `area_m2`, estado local).
  - Selección simple y múltiple (checkbox o equivalente).
  - Acción **Procesar** sobre selección no vacía en estados `pendiente` o `procesada` (reprocesar).
  - Acción **Omitir** para marcar habitación como `omitida` sin escribir en el CAD.
  - Acción **Marcar trabajo como procesado** cuando el arquitecto considera cerrado el job (habitaciones `omitida` cuentan).
  - Por cada habitación seleccionada, **secuencialmente** (v0.3 — simplifica merge CAD y rollback):
    1. Guardar **checkpoint** del `output_dxf` actual (o referencia al `input_dxf` si es la primera iteración).
    2. **US-008** acotado a `room_ids` — obligatorio si `normative_rules_enabled: true`; produce o refresca `outlet_placements` (reutiliza propuesta del análisis salvo `analysis_overrides` del chat).
    3. **US-009 incremental** — tras US-008 exitoso; si reglas desactivadas, la botonera **no** dispara procesamiento (solo chat — v0.3).
    4. Si la habitación ya estaba `procesada`, **sobrescribir** entidades `Cambre_Electrical` de esa habitación (sin versionar historial — ahorro de espacio, v0.3).
  - Actualización optimista en UI al pulsar Procesar; confirmación vía polling (US-011).
  - Sincronización con visor: estilos por estado; símbolos de tomas tras US-009 exitoso.
- No incluye:
  - Procesamiento automático de todas las habitaciones sin acción explícita.
  - Edición manual de coordenadas de tomas en el visor (fase posterior).

#### Flujo principal

1. Job en **Listo_para_editar**, **Parcialmente_procesado** o **Procesado**.
2. Arquitecto selecciona una o más habitaciones en `pendiente` o `procesada` (reprocesar).
3. Pulsa **Procesar**; la UI marca optimistamente `procesando`.
4. Por cada habitación (secuencial): checkpoint DXF → US-008 → US-009.
5. Si éxito: habitación → `procesada`; job → **Parcialmente_procesado** (si había ≥1 procesada).
6. Si fallo US-009: rollback al checkpoint (ver variaciones); habitación → `error`.
7. Polling confirma estado; descarga habilitada según US-015.

#### Variaciones y errores

- Selección vacía: acción deshabilitada o mensaje inline.
- Habitación en `procesando`: no permite segunda ejecución concurrente para el mismo `room_id`.
- Fallo en US-008 para una habitación: esa habitación → `error`; las demás de la misma tanda continúan si el diseño es por habitación aislada.
- **Rollback US-009 (v0.3):** si US-009 falla tras US-008 exitoso, restaurar el `output_dxf` al **checkpoint inmediatamente anterior**: si era la primera iteración de escritura, volver al `input_dxf` original; si ya existía salida incremental, volver al último `output_dxf` válido guardado antes de esa habitación. La habitación queda en `error`.
- **Reprocesar habitación `procesada`:** sobrescribir placements previos de esa habitación en `Cambre_Electrical` (sin historial de versiones).

#### Datos y reglas

- **Request (propuesta):** `POST /api/jobs/:jobId/workspace/process-rooms` con `{ room_ids: string[], idempotency_key?: string }`.
- **Extensión de contratos:** `normative-inference-input` y `cad-generation-input` aceptan `room_ids` obligatorio en modo interactivo.
- **`dxf_checkpoint`:** antes de cada US-009, persistir referencia al blob previo (`input_dxf` o último `output_dxf` válido) para rollback.
- **Idempotencia:** reprocesar la misma habitación sobrescribe; reintentos con mismo `idempotency_key` no duplican tomas.
- **Reglas de negocio:** solo el arquitecto dueño puede procesar u omitir; Administrador sin permisos de mutación.

#### Integraciones

- US-008: [`normative-inference-input.json`](../../docs/contracts/pipeline/normative-inference-input.json), [`pipelineLive.ts`](../../apps/api/src/pipelineLive.ts).
- US-009: [`electrical_layer.py`](../../services/cad-worker/src/cad_worker/electrical_layer.py) extendido para merge incremental por `room_id`.
- Storage: lectura `input_dxf`; escritura/actualización `output_dxf` en bucket `job-dxf-output`.

#### Requisitos no funcionales

- **Rendimiento:** feedback de progreso por habitación en UI (spinner o barra por ítem).
- **Trazabilidad:** cada corrida US-008/US-009 por habitación registra `correlation_id`, timestamp y versión de reglas en `pipeline_metadata`.
- **Concurrencia:** procesamiento **secuencial** por habitación dentro de cada tanda (v0.3).

#### Criterios de aceptación (verificables)

```gherkin
Escenario: Procesar una habitación
  Dado un job Listo_para_editar con habitación room-cocina en pendiente
  Cuando el arquitecto selecciona room-cocina y pulsa Procesar
  Entonces room-cocina pasa a procesada
  Y el job pasa a Parcialmente_procesado
  Y el output_dxf contiene tomas Cambre_Electrical solo en room-cocina

Escenario: Procesar varias habitaciones en una acción
  Dado dos habitaciones en pendiente
  Cuando el arquitecto las selecciona y procesa
  Entonces ambas quedan procesada si no hay error
  Y el output_dxf incluye tomas de ambas sin alterar capas base del arquitecto

Escenario: Fallo aislado por habitación con rollback
  Dado una tanda donde una habitación falla en US-009
  Cuando finaliza la tanda
  Entonces la habitación fallida queda en error con mensaje
  Y el output_dxf se restaura al checkpoint anterior a esa habitación
  Y las demás habitaciones de la tanda y las ya procesadas conservan su estado correcto

Escenario: Reprocesar habitación sobrescribe tomas
  Dado room-cocina en procesada con tomas en Cambre_Electrical
  Cuando el arquitecto reprocesa room-cocina
  Entonces las entidades eléctricas previas de room-cocina se reemplazan
  Y no se acumulan duplicados en el DXF

Escenario: Omitir habitación permite cerrar el job
  Dado todas las habitaciones en procesada u omitida
  Cuando el arquitecto marca el trabajo como procesado
  Entonces el job pasa a Procesado
  Y puede seguir procesando una habitación omitida revertida a pendiente
```

#### Dependencias y supuestos

- Depende de US-012 (habitaciones detectadas) y US-011 (opcional para UX de selección visual).
- Enmiendas US-008 y US-009: ver sección de enmiendas.
- US-009 identifica y reemplaza entidades por `room_id` o región del polígono de la habitación.

#### Metadata para ingestión (opcional)

- `story_id`: `US-013`
- `feature_key`: `workspace.room_processing`
- `labels`: `interactive-workspace`, `pipeline`, `us-008`, `us-009`

---

## US-014 — Chat con IA en el workspace

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Workspace / IA |
| Epic | Cambre — Workspace interactivo |

**Como** Arquitecto  
**quiero** conversar con la IA en el contexto del plano y las habitaciones detectadas  
**para** consultar normativa, corregir el análisis y disparar procesamiento sin depender solo de la botonera.

#### Contexto

El chat complementa la botonera con lenguaje natural. Debe operar sobre el mismo estado del job que US-011 y US-013, con tres capacidades acordadas: consultas, ediciones al análisis preliminar, y acciones de procesamiento.

#### Alcance

- Incluye:
  - **Consultas:** explicación de recomendaciones, normativa Cambre/IRAM aplicable a un `room_type`, aclaraciones sobre el plano o habitaciones detectadas.
  - **Ediciones:** reclasificar `room_type`, ajustar `label`, anotar recomendaciones, marcar habitación como `omitida`; persistir en `analysis_overrides` (solo metadata — **no** modifica geometría del plano ni dispara re-análisis US-007, v0.3). Si cambia `room_type`, US-008 se re-ejecuta al procesar esa habitación.
  - **Acciones:** interpretar “procesá el baño y la cocina” → `process-rooms` (US-013) cuando reglas activas. Con reglas desactivadas, el chat es el **único** canal para solicitar US-008 y procesamiento CAD vía prompts explícitos (v0.3).
  - Historial de mensajes visible en el panel de chat (usuario / asistente / sistema).
  - Contexto enviado al LLM: `layout_interpretation` (con overrides), `preliminary_recommendations`, `room_processing_state`, versión de reglas, resumen de `geometry_extract` (recortado como en `llmContext.ts`).
- No incluye (v1):
  - Streaming obligatorio de respuestas (puede ser sync con indicador de carga).
  - Adjuntar archivos adicionales en el chat.
  - Colaboración multi-usuario en el mismo job.
  - Edición de geometría del plano base (polígonos, paredes) — el sistema solo agrega capa eléctrica; no re-análisis US-007 tras ediciones de metadata (v0.3).

#### Flujo principal

1. Arquitecto abre workspace en **Listo_para_editar** o **Parcialmente_procesado**.
2. Escribe mensaje en el chatbox.
3. Backend clasifica intención (consulta | edición | acción) o usa tool-calling / structured output (TBD).
4. **Consulta:** respuesta textual sin mutar estado persistente salvo log de chat.
5. **Edición:** actualiza `analysis_overrides`; panel y visor reflejan cambios (etiquetas, tipos, recomendaciones).
6. **Acción:** resuelve nombres de habitación a `room_ids`; invoca procesamiento US-013; responde con resumen de resultado.
7. Mensaje del asistente se añade al historial.

#### Variaciones y errores

- Habitación referida ambiguamente (“el baño” con dos baños): pedir aclaración al usuario.
- Acción de procesar habitación ya `procesada`: ejecutar reprocesamiento con sobrescritura (US-013).
- Límite de rate / costo IA: mensaje claro; no ejecutar acción destructiva si se supera cuota (TBD).
- Job en **Analizando** o **Error:** chat deshabilitado o solo mensaje de estado.
- Proveedor IA no disponible: error con reintento sugerido.

#### Datos y reglas

- **Entidades:**
  - `chat_message`: `id`, `job_id`, `role` (`user` | `assistant` | `system`), `content`, `created_at`, `intent?`, `actions_taken?` (jsonb).
  - `analysis_overrides`: por `room_id`, campos opcionales `label`, `room_type`, `recommendation_notes`, `excluded_from_processing` (boolean → estado `omitida`).
- **Validaciones:** `room_type` en enum del contrato US-007; no permitir ediciones que borren `room_id`.
- **Reglas de negocio:** solo dueño del job; acciones de procesamiento sujetas a mismas reglas que US-013; auditoría de ediciones y acciones disparadas desde chat.

#### Integraciones

- **API (propuesta):** `POST /api/jobs/:jobId/workspace/chat` con `{ message: string }`; respuesta `{ reply, mutations?, process_result? }`.
- LLM: mismo proveedor que [`pipelineLive.ts`](../../apps/api/src/pipelineLive.ts); prompt de sistema específico para workspace (versión trazable en `prompt_version`).
- US-013: invocación interna compartida para acciones de procesamiento.

#### Requisitos no funcionales

- **Seguridad:** sanitización de entrada; no exponer tokens ni rutas internas de storage en respuestas.
- **Auditoría:** persistir mensajes y acciones con `user_id` y timestamp.
- **Privacidad:** retención de historial de chat alineada a política de datos del job (TBD).
- **Latencia:** acciones de procesamiento asíncronas; el cliente usa **polling** (~2 s) del estado del job hasta finalizar (v0.3).

#### Criterios de aceptación (verificables)

```gherkin
Escenario: Consulta sobre recomendaciones
  Dado un job Listo_para_editar con cocina detectada
  Cuando el arquitecto pregunta cuántas tomas recomienda la normativa para la cocina
  Entonces recibe una respuesta textual coherente con rules.json
  Y no se modifica el estado de procesamiento de la habitación

Escenario: Edición de clasificación vía chat
  Dado una habitación clasificada como other
  Cuando el arquitecto indica que es un dormitorio
  Entonces analysis_overrides actualiza room_type a bedroom
  Y el panel muestra el tipo actualizado

Escenario: Procesamiento por lenguaje natural
  Dado baño y cocina en pendiente
  Cuando el arquitecto escribe "procesá el baño y la cocina"
  Entonces se ejecuta process-rooms para esos room_ids
  Y el asistente confirma el resultado por habitación

Escenario: Reglas desactivadas — solo chat procesa
  Dado normative_rules_enabled false
  Cuando el arquitecto pulsa Procesar en la botonera
  Entonces la acción no ejecuta US-008 ni US-009
  Cuando el arquitecto escribe en el chat "agregá tomas en la cocina según lo que necesite"
  Entonces el sistema ejecuta US-008 y US-009 para esa habitación vía prompt explícito
```

#### Dependencias y supuestos

- Depende de US-012 (análisis base) y US-013 (acciones de procesamiento).
- Supone capacidad del modelo o capa de orquestación para clasificar intención y extraer referencias a habitaciones con tolerancia a sinónimos en español.

#### Metadata para ingestión (opcional)

- `story_id`: `US-014`
- `feature_key`: `workspace.ai_chat`
- `labels`: `interactive-workspace`, `ia`, `chat`

---

## US-015 — Descarga incremental del DXF procesado

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta |
| Módulo / Área | Workspace / Entrega |
| Epic | Cambre — Workspace interactivo |

**Como** Arquitecto (o Administrador en lectura)  
**quiero** descargar el `.dxf` con la capa Cambre_Electrical tan pronto haya al menos una habitación procesada  
**para** iterar con el estudio o el cliente sin esperar a procesar todo el plano.

#### Contexto

US-010 del MVP habilita descarga solo con job **Procesado**. El workspace interactivo requiere entrega **incremental** coherente con el procesamiento por habitación.

#### Alcance

- Incluye:
  - Botón o acción **Descargar** habilitada cuando ≥1 habitación está en `procesada` (job **Parcialmente_procesado** o **Procesado**).
  - Archivo `output_dxf` con capa `Cambre_Electrical` conteniendo tomas solo de habitaciones procesadas hasta el momento.
  - Capas y geometría base del arquitecto intactas según reglas US-009.
  - Mismo mecanismo de entrega que MVP: URL firmada o stream (`GET /api/jobs/:jobId/download` o equivalente).
  - **Convención de nombre (v0.3):** `{nombre_original_sin_extension}_cambre{últimos_4_dígitos_timestamp}.dxf` — ej. `planta_baja.dxf` → `planta_baja_cambre0847.dxf` si el timestamp termina en `…0847`.
- No incluye:
  - Descarga del solo análisis JSON (export separado — fase posterior).
  - Envío automático por email.

#### Flujo principal

1. Arquitecto procesa al menos una habitación (US-013).
2. Job en **Parcialmente_procesado**; existe `output_dxf` en storage.
3. Desde workspace o detalle de proyecto, pulsa **Descargar**.
4. Obtiene el `.dxf` actualizado con tomas parciales.
5. Tras procesar más habitaciones, nueva descarga refleja el acumulado (mismo `output_dxf` sobrescrito en storage).

#### Variaciones y errores

- Cero habitaciones procesadas: botón deshabilitado; mensaje “Procesá al menos una habitación”.
- Job **Error** global pero con habitaciones procesadas previas: permitir descarga del último `output_dxf` válido (post-rollback).
- Link firmado expirado: renovación transparente al reintentar.
- Administrador descarga trabajo de otro arquitecto en **Parcialmente_procesado**: mismo archivo que vería el dueño (RBAC US-010).

#### Datos y reglas

- **RBAC:** Arquitecto solo sus jobs; Administrador lectura en todos con ≥1 habitación `procesada`.
- **Integridad:** checksum opcional del `output_dxf` expuesto en metadatos (TBD).
- **Reglas de negocio:** cada descarga corresponde al estado actual del `output_dxf`; no se genera DWG paralelo.

#### Integraciones

- Supabase Storage bucket `job-dxf-output`.
- API Express: extensión de rutas de descarga existentes en [`apps/api/src/index.ts`](../../apps/api/src/index.ts).
- Validación en cliente: [`canDownloadProcessedDxf`](../../apps/web/src/lib/jobPresentation.ts) debe ampliarse para estados parciales.

#### Requisitos no funcionales

- **Seguridad:** URLs firmadas de corta duración; sin exposición pública permanente.
- **Rendimiento:** descarga de archivos grandes con progreso visible (reutilizar patrón upload US-006).

#### Criterios de aceptación (verificables)

```gherkin
Escenario: Nombre de archivo en descarga
  Dado input_dxf registrado como planta_baja.dxf
  Cuando el arquitecto descarga tras procesar al menos una habitación
  Entonces el nombre sugerido es planta_baja_cambreXXXX.dxf donde XXXX son los últimos 4 dígitos del timestamp de generación

Escenario: Descarga tras primera habitación procesada
  Dado un job Parcialmente_procesado con una habitación procesada
  Cuando el arquitecto descarga el resultado
  Entonces obtiene un dxf que abre en CAD estándar
  Y contiene capa Cambre_Electrical solo para esa habitación

Escenario: Descarga bloqueada sin habitaciones procesadas
  Dado un job Listo_para_editar
  Cuando el arquitecto intenta descargar
  Entonces la acción no está disponible o devuelve error claro

Escenario: Descarga acumulativa
  Dado un job con dos habitaciones procesadas y una pendiente
  Cuando descarga el dxf
  Entonces las tomas corresponden a las dos habitaciones procesadas y no a la pendiente
```

#### Dependencias y supuestos

- Depende de US-013 (generación/actualización de `output_dxf`).
- Enmienda US-010: ver sección de enmiendas.

#### Metadata para ingestión (opcional)

- `story_id`: `US-015`
- `feature_key`: `workspace.incremental_download`
- `labels`: `interactive-workspace`, `entrega`, `dxf`

---

## Enmiendas a historias MVP

Referencias: [`cambre-planos-mvp-historias.md`](cambre-planos-mvp-historias.md).

| Historia | Qué se mantiene | Qué cambia en modo interactivo |
|----------|-----------------|-------------------------------|
| **US-006** Cargar plano | Upload seguro a Storage, validación MIME, registro `input_dxf`, RBAC. | El registro dispara **análisis preliminar (US-012)** en lugar del pipeline completo. Referencias `.dwg` en MVP deben interpretarse como **`.dxf`** en implementación actual. Estado tras carga: **Analizando**, no **Procesando** global por US-008/009. |
| **US-007** Interpretación visual | Contrato `vision-layout-output`, proveedor IA, inspect + geometry como contexto. | US-007 es el primer paso automático post-carga. Salida alimenta US-008, visor, panel y chat. **No** se re-ejecuta tras ediciones de metadata en chat (v0.3). |
| **US-008** Inferencia normativa | Ruleset activo `cambre-tomas-2026.07.1` (solo tomacorrientes; ver [`docs/normative-rules.md`](../normative-rules.md)), `outlet_placements`, trazabilidad. | Se ejecuta en **análisis preliminar** (todas las habitaciones, modo lectura) y se **re-ejecuta o valida** antes de US-009 por `room_ids`. Obligatorio salvo `normative_rules_enabled: false`. Entrada incluye `layout_interpretation` + overrides del chat. |
| **US-009** Generación CAD | Capa `Cambre_Electrical`, bloque `CAMBRE_OUTLET`, no destructivo sobre capas base. | **Merge incremental** en `output_dxf` por habitación; idempotencia/reemplazo por `room_id` al reprocesar. Job global puede estar **Parcialmente_procesado** sin esperar todas las habitaciones. |
| **US-010** Descargar procesado | RBAC arquitecto/admin, URLs firmadas, integridad CAD. | Descarga con **≥1 habitación procesada** (US-015). Nombre `{original}_cambre{4 dígitos timestamp}.dxf`. **Procesado** no bloquea nuevas descargas ni procesamiento. |

---

## Modelo de datos extendido

Propuesta de campos adicionales en `jobs.pipeline_metadata` (jsonb) o normalización futura en tablas.

### `room_processing_state[]`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `room_id` | string | `room-*` según US-007 |
| `status` | enum | `pendiente`, `procesando`, `procesada`, `error`, `omitida` |
| `last_processed_at` | datetime? | Última ejecución exitosa US-009 |
| `last_error` | object? | `{ code, message, correlation_id }` |
| `outlet_count` | number? | Tomas aplicadas en última corrida |

### `preliminary_recommendations[]`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `room_id` | string | FK lógica a habitación |
| `summary` | string | Texto legible para panel |
| `rule_ids` | string[] | Referencias a `rules.json` |
| `suggested_outlet_types` | string[]? | p. ej. `standard`, `dedicated_appliance` |

### `analysis_overrides` (mapa por `room_id`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `label` | string? | Reemplazo de etiqueta mostrada |
| `room_type` | enum? | Mismo enum que US-007 |
| `recommendation_notes` | string? | Anotación libre del arquitecto o IA |
| `excluded_from_processing` | boolean? | Si true, estado `omitida` |

### `chat_messages[]` o tabla `job_chat_messages`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | uuid | Identificador estable |
| `job_id` | uuid | |
| `user_id` | uuid | Autor si `role=user` |
| `role` | enum | `user`, `assistant`, `system` |
| `content` | text | |
| `intent` | enum? | `query`, `edit`, `action` |
| `actions_taken` | jsonb? | p. ej. `{ type: "process_rooms", room_ids: [] }` |
| `created_at` | timestamptz | |

### `dxf_checkpoint`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `room_id` | string | Habitación en procesamiento |
| `source` | enum | `input_dxf` \| `output_dxf` |
| `storage_ref` | string | Ruta o `file_id` del blob checkpoint |
| `created_at` | timestamptz | Antes de cada intento US-009 |

### `workspace_mode`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `mode` | enum | `interactive` (único modo; sin retrocompat batch — v0.3) |
| `preliminary_analysis_completed_at` | datetime? | |
| `normative_rules_enabled` | boolean | Default `true`. Si `false`, US-008 solo vía prompts explícitos en chat. |

---

## Metadata para ingestión (global)

| Clave | Uso |
|-------|-----|
| `initiative_slug` | `cambre-interactive-workspace` |
| `doc_id` | `docs/user-stories/interactive-workspace-historias.md` |
| `story_id_prefix` | `US-` + número (`US-011` … `US-015`) |
| `parent_initiative` | `cambre-planos-mvp` |
| `parent_doc_id` | `docs/user-stories/cambre-planos-mvp-historias.md` |
| `roles` | `administrator`, `architect` |
| `job_status_extended` | `pendiente`, `analizando`, `listo_para_editar`, `parcialmente_procesado`, `procesado`, `error` |
| `room_status` | `pendiente`, `procesando`, `procesada`, `error`, `omitida` |

---

## Decisiones cerradas (v0.3)

Todos los huecos abiertos de v0.1–v0.2 quedaron resueltos:

| # | Tema | Decisión |
|---|------|----------|
| 1 | Recomendaciones / US-008 | Siempre US-008 cuando reglas activas; ver regla transversal (v0.2). |
| 2 | Reprocesar habitación | **Sobrescribir** entidades en `Cambre_Electrical` de esa habitación (sin versionar historial). |
| 3 | Sync visor ↔ chat ↔ botonera | **Polling** ~2 s del estado del job + **UI optimista** al disparar acciones. Sin WebSocket/SSE. |
| 4 | Render 2D | **SVG 2D** desde payload API (`render-data`). Alternativas DXF en cliente documentadas en US-011; reservar `dxf-react` si hace falta más fidelidad. |
| 5 | Habitaciones `omitida` | Cuentan para marcar job **Procesado**; el arquitecto puede seguir procesando o revertir a `pendiente`. |
| 6 | Administrador | **Solo lectura** + descarga; sin modificar trabajos. |
| 7 | Retrocompat batch | **No aplica** — plataforma no productiva; solo flujo interactivo. |
| 8 | Rollback US-009 | Restaurar checkpoint: primera iteración → `input_dxf`; posteriores → último `output_dxf` válido. |
| 9 | Re-análisis US-007 | **No necesario** — el plano base no se modifica; solo capa eléctrica y metadata (`analysis_overrides`). |
| 10 | Nombre de archivo | `{original}_cambre{últimos 4 dígitos timestamp}.dxf` |
| 11 | Reglas desactivadas | US-008 y procesamiento CAD **solo** tras **prompts explícitos** del usuario en el chat; botonera no procesa con reglas off. |

No quedan huecos bloqueantes para implementación del workspace interactivo.
