# Historias de usuario técnicas — Cambre: planos eléctricos con IA (MVP)

| Campo | Valor |
|-------|--------|
| Versión | 0.3 |
| Fecha | 2026-05-05 |
| Autoría | Derivado de `docs/Propuesta de Desarrollo MVP.md` |
| Estado | borrador |

## Resumen ejecutivo

Plataforma web para que arquitectos invitados carguen planos `.dwg`, los procese un pipeline de IA con reglas normativas de Cambre, y obtengan el mismo archivo con una capa adicional (`Cambre_Electrical`) con la propuesta de **tomacorrientes** por habitación, descargable sin alterar el diseño base del arquitecto.

**Objetivo de negocio:** reducir trabajo manual de interpretación y ubicación de tomacorrientes según normativa, acelerando entregables manteniendo el CAD original como fuente de verdad.

### Roles del dominio

| Rol | Responsabilidad |
|-----|-----------------|
| **Administrador** | Invita arquitectos, administra la totalidad de la plataforma (configuración, usuarios, visibilidad global de trabajos según se defina en cada historia). **No** crea análisis/trabajos ni en su nombre ni en nombre de otros arquitectos. |
| **Arquitecto** | Opera sobre sus propios trabajos: onboarding (si fue invitado), creación de análisis, carga de `.dwg`, seguimiento y descarga de resultados. |

### Máquina de estados del trabajo (`job`)

Estados y transiciones acordadas para el MVP:

```text
                    ┌──► Procesado
Pendiente ──► Procesando ──┤
                    └──► Error
```

| Estado | Significado |
|--------|-------------|
| **Pendiente** | Trabajo creado; aún no hay resultado final. Incluye: espera de carga de `.dwg` (si aplica), archivo recibido y en cola, o cualquier precondición antes de que el pipeline marque ejecución activa. La UI debe reflejar si falta carga vs. en cola (detalle de subestados TBD en implementación si hace falta). |
| **Procesando** | Pipeline de interpretación IA + inferencia normativa + generación CAD en curso. |
| **Procesado** | Pipeline completó correctamente; el `.dwg` resultado está disponible para descarga (US-010). |
| **Error** | Fallo del pipeline o condición de error de negocio/técnica que impide entregar resultado. Mensaje al usuario; política de reintento o “nuevo análisis” (TBD). |

Transiciones permitidas: **Pendiente → Procesando → Procesado** o **Pendiente → Procesando → Error**. No se documentan transiciones desde **Procesado** hacia **Pendiente** en el MVP salvo decisión explícita de “reprocesar” en una fase posterior.

### Cuotas y límites (MVP vs. evolución)

- **MVP:** sin límite de tamaño de `.dwg` ni tope de cantidad de trabajos por usuario/mes.
- **Diseño:** la API y la UI deben contemplar de forma **extensible** la futura aplicación de límites (p. ej. validación centralizada de tamaño, headers de uso/cuota, mensajes de error homogéneos, flags de configuración o tabla de `plan_limits`) para no reescribir flujos cuando Cambre defina políticas.

## Tabla de contenidos

- [US-001 — Invitar arquitecto al sistema](#us-001-invitar-arquitecto-al-sistema)
- [US-002 — Onboarding y activación de cuenta](#us-002-onboarding-y-activación-de-cuenta)
- [US-003 — Autenticación segura (sesión)](#us-003-autenticación-segura-sesión)
- [US-004 — Dashboard de trabajos](#us-004-dashboard-de-trabajos)
- [US-005 — Crear proyecto / nuevo análisis](#us-005-crear-proyecto--nuevo-análisis)
- [US-006 — Cargar plano .dwg al proyecto](#us-006-cargar-plano-dwg-al-proyecto)
- [US-007 — Interpretación visual del plano (IA)](#us-007-interpretación-visual-del-plano-ia)
- [US-008 — Inferencia normativa Cambre](#us-008-inferencia-normativa-cambre)
- [US-009 — Generar capa CAD con tomas de luz](#us-009-generar-capa-cad-con-tomas-de-luz)
- [US-010 — Descargar .dwg procesado](#us-010-descargar-dwg-procesado)
- [Metadata para ingestión](#metadata-para-ingestión-global)
- [Huecos y preguntas abiertas](#huecos-y-preguntas-abiertas)

---

## US-001 — Invitar arquitecto al sistema

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 1) |
| Módulo / Área | Accesos |
| Epic | MVP Cambre — Fundaciones |

**Como** Administrador  
**quiero** enviar una invitación personalizada a un arquitecto  
**para** que solo usuarios autorizados accedan al sistema.

#### Contexto

La propuesta MVP contempla invitaciones personalizadas; no se describe registro abierto. Solo el rol **Administrador** invita.

#### Alcance

- Incluye: creación de invitación asociada a email (y metadatos mínimos acordados), envío de correo con enlace de onboarding.
- No incluye: self-service de alta masiva, SSO empresarial (no mencionado en propuesta).

#### Flujo principal

1. Administrador ingresa email (y datos mínimos requeridos) del arquitecto.
2. El sistema valida duplicados / estado previo del email.
3. Se genera token de invitación con vigencia definida (TBD).
4. Se envía correo con enlace a completar perfil / activar cuenta.

#### Variaciones y errores

- Email ya registrado o invitación pendiente: mensaje claro y acción sugerida.
- Fallo de envío de correo: reintento / estado visible para el Administrador (TBD política).

#### Datos y reglas

- Entidades: `invitation` (email, token/hash, expiración, `invited_by` = administrador, estado), vínculo con `user`.
- Validaciones: formato email, unicidad según reglas de negocio acordadas.
- RBAC: solo **Administrador** puede crear invitaciones.

#### Integraciones

- Proveedor de email transaccional (TBD).
- Supabase Auth / tablas custom (según decisión técnica — TBD en propuesta).

#### Requisitos no funcionales

- Seguridad: tokens no predecibles, expiración, rate limit en creación de invitaciones (TBD umbrales).

#### Criterios de aceptación (verificables)

- Dado un Administrador autenticado y un email válido no duplicado según reglas, cuando envía invitación, entonces el arquitecto recibe correo con enlace funcional y el Administrador ve confirmación.
- Dado un Arquitecto (o sin rol Administrador), cuando intenta acceder a la función de invitación, entonces el sistema deniega la acción.
- Dado un email con invitación vigente pendiente, cuando se intenta reinvitar, entonces el sistema informa el estado sin crear invitaciones inconsistentes (comportamiento exacto TBD).

#### Dependencias y supuestos

- Existe al menos un usuario **Administrador** bootstrap (semilla o primer deploy).

#### Metadata para ingestión (opcional)

- `story_id`: `US-001`
- `feature_key`: `access.invite_architect`
- `labels`: `mvp`, `fase-1`, `accesos`, `rol-administrador`

---

## US-002 — Onboarding y activación de cuenta

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 1) |
| Módulo / Área | Accesos |
| Epic | MVP Cambre — Fundaciones |

**Como** arquitecto invitado  
**quiero** completar mi perfil profesional y activar mi cuenta desde el correo  
**para** operar en la plataforma con identidad verificada.

#### Contexto

Flujo descrito: correo → perfil profesional → activación de cuenta. El **Administrador** no usa este flujo salvo que también sea invitado por otro admin (fuera de alcance típico); el onboarding aplica al **Arquitecto** invitado.

#### Alcance

- Incluye: formulario de perfil (campos TBD con negocio), establecimiento de credenciales o flujo mágico según auth elegida, marcado de cuenta como activa, asignación de rol **Arquitecto**.
- No incluye: verificación de matrícula profesional ante terceros (no en propuesta).

#### Flujo principal

1. Usuario abre enlace de invitación válido.
2. Completa datos de perfil requeridos.
3. Confirma credenciales / método de acceso.
4. Cuenta queda activa con rol Arquitecto y puede iniciar sesión.

#### Variaciones y errores

- Token expirado o inválido: pantalla con opción de solicitar nueva invitación al Administrador (TBD texto UX).
- Datos de perfil incompletos: validación en cliente y servidor.

#### Datos y reglas

- Entidades: extensión de `user` / `profile` (campos profesionales TBD), `role = architect` (o convención equivalente).
- Reglas: campos obligatorios definidos por Cambre/Vanguard (pendiente detalle).

#### Integraciones

- Mismo stack de auth que US-001/US-003.

#### Requisitos no funcionales

- Accesibilidad: formularios etiquetados y errores asociados a campos (nivel TBD WCAG).

#### Criterios de aceptación (verificables)

- Dado un enlace de invitación vigente, cuando el arquitecto completa el perfil con datos válidos, entonces puede autenticarse y acceder al área autenticada como Arquitecto.
- Dado un enlace expirado, cuando intenta activar, entonces ve mensaje explícito y no se crea usuario inconsistente.

#### Dependencias y supuestos

- Depende de US-001.

#### Metadata para ingestión (opcional)

- `story_id`: `US-002`
- `feature_key`: `access.onboarding`
- `labels`: `mvp`, `fase-1`, `accesos`, `rol-arquitecto`

---

## US-003 — Autenticación segura (sesión)

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 1) |
| Módulo / Área | Accesos |
| Epic | MVP Cambre — Fundaciones |

**Como** usuario activo (Arquitecto o Administrador)  
**quiero** iniciar y cerrar sesión de forma segura  
**para** proteger el acceso a la plataforma y a los planos.

#### Contexto

Propuesta: login/logout seguro; stack sugiere Supabase para usuarios.

#### Alcance

- Incluye: login, logout, sesión persistente según política (TBD), recuperación de acceso si aplica al proveedor; rutas y menús según rol (Administrador vs. Arquitecto).
- No incluye: MFA (no mencionado en MVP).

#### Flujo principal

1. Usuario ingresa credenciales (o método acordado).
2. Sistema valida y emite sesión con claims de rol.
3. Logout invalida sesión en cliente y servidor según proveedor.

#### Variaciones y errores

- Credenciales incorrectas: mensaje genérico anti-enumeración (TBD política).
- Cuenta deshabilitada: mensaje acorde sin filtrar detalles internos.

#### Datos y reglas

- Sesión gestionada por proveedor de auth; roles MVP: **`administrator`**, **`architect`** (nombres técnicos TBD; mapear 1:1 a Administrador / Arquitecto).

#### Integraciones

- Supabase Auth (propuesta) u otro equivalente documentado en ADR.

#### Requisitos no funcionales

- Seguridad: HTTPS, cookies/sesión según mejores prácticas del proveedor.

#### Criterios de aceptación (verificables)

- Dado usuario activo de cualquiera de los dos roles, cuando las credenciales son correctas, entonces accede al dashboard o última ruta permitida según su rol.
- Dado sesión iniciada, cuando el usuario hace logout, entonces no puede acceder a rutas protegidas sin reautenticarse.

#### Dependencias y supuestos

- Depende de US-002 para arquitectos invitados; Administrador según mecanismo de alta (bootstrap TBD).

#### Metadata para ingestión (opcional)

- `story_id`: `US-003`
- `feature_key`: `access.session`
- `labels`: `mvp`, `fase-1`, `accesos`

---

## US-004 — Dashboard de trabajos

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 2) |
| Módulo / Área | Trabajos |
| Epic | MVP Cambre — Gestión de archivos |

**Como** Arquitecto o Administrador  
**quiero** ver el listado de trabajos con nombre opcional, fecha de creación y estado del pipeline  
**para** retomar proyectos, descargar entregables o supervisar la plataforma.

#### Contexto

Dashboard con metadatos mínimos según propuesta; el **Administrador** administra toda la plataforma, incluida la visibilidad de trabajos de todos los arquitectos.

#### Alcance

- Incluye: listado paginado o scroll, nombre opcional del trabajo, fecha de creación, estado (**Pendiente**, **Procesando**, **Procesado**, **Error**).
- **Arquitecto:** solo trabajos donde es dueño (`user_id` = su cuenta).
- **Administrador:** todos los trabajos de la plataforma, con identificación del arquitecto dueño (campo TBD: nombre o email).
- No incluye: colaboración con cliente final (roadmap futuro).

#### Flujo principal

1. Usuario entra al dashboard autenticado.
2. Ve trabajos según su rol (filtrado automático).
3. Ve trabajos ordenados por criterio por defecto (TBD: fecha desc).
4. Puede abrir detalle de un trabajo o acciones contextuales (ver US-010).

#### Variaciones y errores

- Sin trabajos (lista vacía para ese rol): estado vacío con CTA a US-005 para Arquitecto; Administrador puede ver mensaje distinto si la plataforma está vacía.
- Error de carga: reintento y mensaje.

#### Datos y reglas

- Entidades: `job` (nombre opcional, `created_at`, `owner_user_id`, `status` ∈ {pendiente, procesando, procesado, error}).
- Validaciones: nombre longitud máxima (TBD).
- RBAC: query filtrada por rol en backend (no solo en UI).

#### Integraciones

- Supabase (DB) para metadatos; Storage para referencias a archivos (propuesta).

#### Requisitos no funcionales

- Rendimiento: listado usable con N trabajos esperados en MVP (N TBD); preparar índices por `owner_user_id` y `created_at` para escala futura con cuotas.

#### Criterios de aceptación (verificables)

- Dado un **Arquitecto** con trabajos previos, cuando abre el dashboard, entonces ve solo sus trabajos con fecha, nombre si aplica y estado coherente con la máquina de estados.
- Dado un **Administrador**, cuando abre el dashboard, entonces ve trabajos de todos los arquitectos con indicación del dueño.
- Dado **Arquitecto** sin trabajos, cuando abre el dashboard, entonces ve mensaje vacío y acceso claro a crear proyecto (US-005).

#### Dependencias y supuestos

- Depende de US-003 y del concepto `job` creado en US-005.

#### Metadata para ingestión (opcional)

- `story_id`: `US-004`
- `feature_key`: `jobs.dashboard`
- `labels`: `mvp`, `fase-2`, `trabajos`

---

## US-005 — Crear proyecto / nuevo análisis

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 2) |
| Módulo / Área | Trabajos |
| Epic | MVP Cambre — Gestión de archivos |

**Como** Arquitecto  
**quiero** iniciar un nuevo análisis (trabajo) desde un flujo guiado  
**para** asociar mi próxima carga de plano a un contenedor con trazabilidad.

#### Contexto

“Creación de proyecto: flujo de carga para nuevos análisis” en propuesta. La creación de análisis la realiza **únicamente** el **Arquitecto** autenticado con ese rol. El **Administrador** no puede crear trabajos en nombre de otro usuario ni delegar la titularidad del `job` a un arquitecto distinto del que inicia el flujo.

#### Alcance

- Incluye: crear registro de trabajo con estado inicial **Pendiente**, opcionalmente nombre, transición a paso de carga (US-006); `owner_user_id` siempre el arquitecto que crea.
- No incluye: plantillas multiplano por obra (no en MVP); creación de trabajos por Administrador (ningún caso).

#### Flujo principal

1. Arquitecto elige “Nuevo análisis”.
2. Opcionalmente ingresa nombre.
3. Se crea `job` en estado **Pendiente** con `owner_user_id` = arquitecto.
4. Redirección a carga de archivo.

#### Variaciones y errores

- **MVP:** sin tope de trabajos por mes; la creación no aplica límite. El servicio debe permitir enganchar validación de cuota sin cambiar la firma pública del endpoint (extensibilidad acordada en sección global).

#### Datos y reglas

- Estado inicial obligatorio: **Pendiente**.

#### Integraciones

- API backend Node (propuesta) persistiendo en Supabase.

#### Requisitos no funcionales

- Auditoría: quién creó el trabajo y cuándo (`owner_user_id`, timestamps).

#### Criterios de aceptación (verificables)

- Dado Arquitecto autenticado, cuando completa “nuevo análisis”, entonces existe un trabajo **Pendiente** visible en su dashboard y puede continuar a la carga.
- Dado **Administrador** autenticado (solo rol admin o sin rol Arquitecto), cuando intenta usar la creación de “nuevo análisis” vía API o UI, entonces el sistema **deniega** la operación (403 / equivalente) o **no muestra** la acción, y no se persiste ningún `job`.
- Dado fallo de red al crear, cuando el cliente reintenta, entonces no se duplican trabajos de forma silenciosa sin feedback (idempotencia TBD en API).

#### Dependencias y supuestos

- Depende de US-003 con rol Arquitecto.

#### Metadata para ingestión (opcional)

- `story_id`: `US-005`
- `feature_key`: `jobs.create`
- `labels`: `mvp`, `fase-2`, `trabajos`, `rol-arquitecto`

---

## US-006 — Cargar plano .dwg al proyecto

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 2–3) |
| Módulo / Área | Ingesta CAD |
| Epic | MVP Cambre — Motor |

**Como** Arquitecto  
**quiero** subir un archivo `.dwg` de la capa de arquitectura  
**para** que el sistema lo procese en el pipeline de IA.

#### Contexto

Input explícito en propuesta: `.dwg` capa de arquitectura; almacenamiento en Supabase Storage.

#### Alcance

- Incluye: upload seguro, validación de extensión/MIME, almacenamiento referenciado al `job`, disparo del pipeline hacia **Procesando** cuando corresponda.
- **MVP:** sin límite de tamaño de archivo; la validación de tamaño debe estar **centralizada** (p. ej. constante de configuración o servicio de políticas) inicialmente desactivada o con umbral muy alto, para activar límites sin refactor mayor.
- No incluye: conversión definitiva a otro formato de edición online (futuro “Editor Online”).

#### Flujo principal

1. Arquitecto selecciona archivo desde el flujo del trabajo en estado **Pendiente** (u homologable según subestados de implementación).
2. Cliente sube a storage vía backend o políticas Supabase acordadas.
3. Tras upload válido, el `job` transiciona a **Procesando** (o permanece **Pendiente** en cola hasta que el worker arranque — la UI debe mostrar **Procesando** mientras el pipeline esté activo; ver nota en máquina de estados).

#### Variaciones y errores

- Cuando existan límites futuros: archivo demasiado grande → error con mensaje claro (preparado en capa de validación).
- Formato no soportado o DWG corrupto: error claro; detalle técnico solo en logs.

#### Datos y reglas

- Entidades: objeto en Storage + `file_id`, `original_filename`, `byte_size`, `checksum` (TBD), `job_id`.

#### Integraciones

- Supabase Storage; backend Express para archivos pesados (propuesta).

#### Requisitos no funcionales

- Rendimiento: progreso de upload visible para archivos grandes.
- Seguridad: URLs firmadas; acceso al archivo: dueño del trabajo (**Arquitecto**) y **Administrador** (lectura para soporte/gestión).

#### Criterios de aceptación (verificables)

- Dado trabajo **Pendiente** del arquitecto que acepta upload, cuando sube `.dwg` válido, entonces el archivo queda almacenado y el estado del trabajo evoluciona según la máquina de estados hacia **Procesando** / pipeline.
- Dado archivo inválido, cuando intenta subir, entonces ve error sin corromper el job.
- Dado política de límite de tamaño activada en el futuro, cuando supera el máximo, entonces el rechazo ocurre en el mismo punto de validación sin cambiar el flujo UX acordado.

#### Dependencias y supuestos

- Depende de US-005.

#### Metadata para ingestión (opcional)

- `story_id`: `US-006`
- `feature_key`: `cad.upload_dwg`
- `labels`: `mvp`, `fase-3`, `ingesta`, `cuotas-futuras`

---

## US-007 — Interpretación visual del plano (IA)

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 3) |
| Módulo / Área | Motor IA |
| Epic | MVP Cambre — Integración IA |

**Como** sistema  
**quiero** enviar representación vectorial/temporal o imagen del layout a un modelo de visión  
**para** interpretar geometrías y contexto del plano como entrada a la lógica normativa.

#### Contexto

Propuesta: conversión temporal a vectorial/imagen para análisis; modelo GPT-4o / Claude 3.5 Sonnet / otro según performance (a definir).

#### Alcance

- Incluye: paso de pipeline que produce insumo al modelo y recibe estructura interpretada (contrato TBD).
- No incluye: entrenamiento de modelo propio (usa API de visión según propuesta).

#### Flujo principal

1. Con `job` en **Procesando**, worker/servicio obtiene representación del DWG.
2. Se invoca API de visión con payload acordado.
3. Se persiste resultado intermedio y/o pasa a US-008.

#### Variaciones y errores

- Timeout o rate limit del proveedor IA: reintentos con backoff (TBD); si fallo terminal → **Error** con mensaje y trazabilidad.
- Planos ilegibles para el modelo: degradación controlada y mensaje al usuario (TBD).

#### Datos y reglas

- Contrato request/response entre servicio Python / Node y proveedor IA: **pendiente especificación**.
- Estado del job: en fallo terminal, **Error**.

#### Integraciones

- API de visión (proveedor TBD); posible orquestación desde Python (scripts + ezdxf mencionados en propuesta).

#### Requisitos no funcionales

- Observabilidad: logs correlacionados por `job_id`, métricas de latencia y costo por job (TBD).

#### Criterios de aceptación (verificables)

- Dado DWG de prueba de la suite acordada, cuando el pipeline corre, entonces se obtiene salida estructurada parseable por el paso normativo (definición de “parseable” en contrato TBD).
- Dado fallo del proveedor IA, cuando excede reintentos, entonces el trabajo pasa a **Error** y es reproducible en soporte (correlation id).

#### Dependencias y supuestos

- Depende de US-006.

#### Metadata para ingestión (opcional)

- `story_id`: `US-007`
- `feature_key`: `ai.layout_interpretation`
- `labels`: `mvp`, `fase-3`, `ia`

---

## US-008 — Inferencia normativa Cambre

| Campo | Valor |
|-------|--------|
| Estado | en progreso |
| Prioridad | Alta (Sprint 3) |
| Módulo / Área | Motor IA |
| Epic | MVP Cambre — Integración IA |

**Como** sistema  
**quiero** aplicar un bundle versionado de reglas Cambre (tomacorrientes por habitación) vía LLM  
**para** proponer ubicaciones de tomas coherentes con la política comercial/técnica acordada.

#### Contexto

Ruleset activo `cambre-tomas-2026.07.1`: tres secciones (`estrategia_procesamiento`, `apliques_y_simbologia`, `reglas_por_habitacion`). Sin iluminación, circuitos ni cómputo. Documentación: [`docs/normative-rules.md`](../normative-rules.md).

#### Alcance

- Incluye: versión versionada del ruleset, trazabilidad `normative_rules_version` por job, salida `outlet_placements[]` hacia US-009.
- Incluye (implementado): editor del ruleset del sistema en `/normative-rules` (arquitecto y administrador); persistencia en Postgres (`normative_rulesets`) con fallback a archivos en repo.
- No incluye: edición de reglas por proyecto o por usuario (solo ruleset global del sistema).

#### Flujo principal

1. Entrada: salida estructurada de US-007 (`layout_interpretation`) + bundle activo + contexto mínimo del job.
2. Mapeo `room_type` → regla en `reglas_por_habitacion`; LLM devuelve `outlet_placements` con `rule_ids` y coordenadas en unidades del plano.
3. Salida: `outlet_placements[]` consumida por US-009 (bloque `CAMBRE_OUTLET`, capa `Cambre_Electrical`).

#### Variaciones y errores

- Habitación sin tipo reconocido: aplica `RULE-GENERICO` y opcional warning en salida.
- Conflicto entre reglas: prioridad por orden de match de `room_types` (documentar con negocio si hace falta).

#### Datos y reglas

- Fuente: `rules/cambre-normative/` + tabla `normative_rulesets` cuando Supabase está configurado.
- Actualización sin redeploy: guardar desde `/normative-rules` o `PUT /api/normative-rules` (misma `version`).

#### Integraciones

- OpenAI GPT-4o (stub o live en `pipelineLive.ts`); prompt en `normativePromptSpec.ts`.

#### Requisitos no funcionales

- Auditoría: `normative_rules_version` en `pipeline_metadata` y endpoint `GET /api/jobs/:jobId/normative-rules`.

#### Criterios de aceptación (verificables)

- Dado un juego de planos golden definido con Cambre, cuando se ejecuta inferencia, entonces las salidas cumplen criterios de validación humana acordados en Sprint 4 (QA propuesta).
- Dado cambio de versión de reglas, cuando se procesa un job nuevo, entonces queda asociada la versión aplicada consultable por soporte.
- Dado arquitecto autenticado, cuando abre `/normative-rules`, entonces ve las tres secciones del ruleset activo y puede guardar cambios válidos.

#### Dependencias y supuestos

- Depende de US-007; contenido normativo provisto por Cambre.

#### Metadata para ingestión (opcional)

- `story_id`: `US-008`
- `feature_key`: `ai.normative_inference`
- `labels`: `mvp`, `fase-3`, `normativa`

---

## US-009 — Generar capa CAD con tomacorrientes

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 3) |
| Módulo / Área | Salida CAD |
| Epic | MVP Cambre — Integración IA |

**Como** sistema  
**quiero** escribir una capa adicional sobre el DWG original con la disposición técnica de tomas  
**para** no destructurar el trabajo del arquitecto y mantener trazabilidad por layer.

#### Contexto

Output: capa de arquitectura + capa `Cambre_Electrical` (nombre según propuesta). Manipulación con librerías tipo ezdxf en Python.

#### Alcance

- Incluye: merge no destructivo, entidades en layer dedicado, bloque `CAMBRE_OUTLET` (definido en `apliques_y_simbologia` del ruleset activo).
- No incluye: cómputo de materiales (futuro).

#### Flujo principal

1. Entrada: DWG original en Storage + salida de US-008.
2. Script CAD genera nuevo blob DWG o sobrescribe versión “resultado” manteniendo capas previas intactas salvo adición acordada.
3. Actualiza estado del job a **Procesado** si el archivo de salida es válido; en fallo, **Error**.

#### Variaciones y errores

- DWG que no permite escritura compatible: **Error** técnico con log y mensaje usuario (TBD).

#### Datos y reglas

- Nombre fijo de layer `Cambre_Electrical` salvo que negocio defina otro; documentar en contrato de salida.

#### Integraciones

- Python + ezdxf (propuesta); posible invocación desde worker Node.

#### Requisitos no funcionales

- Integridad: checksum del archivo de salida; comparación de capas base sin alteración no autorizada (criterio TBD).

#### Criterios de aceptación (verificables)

- Dado DWG golden, cuando el pipeline completa, entonces al abrir en lector CAD estándar se ve la capa `Cambre_Electrical` con entidades esperadas según fixture y el job queda **Procesado**.
- Dado el mismo input, cuando se repite proceso en ventana controlada, entonces el comportamiento es estable o las diferencias están documentadas (no determinismo — TBD).

#### Dependencias y supuestos

- Depende de US-006 y US-008.

#### Metadata para ingestión (opcional)

- `story_id`: `US-009`
- `feature_key`: `cad.layer_output`
- `labels`: `mvp`, `fase-3`, `cad`

---

## US-010 — Descargar .dwg procesado

| Campo | Valor |
|-------|--------|
| Estado | borrador |
| Prioridad | Alta (Sprint 2–4 según integración) |
| Módulo / Área | Entrega |
| Epic | MVP Cambre — Entrega |

**Como** Arquitecto o Administrador  
**quiero** descargar el `.dwg` resultado con la capa de tomas  
**para** usar el entregable en CAD (arquitecto) o auditar / respaldar (administrador).

#### Contexto

Propuesta: botón de exportación manteniendo integridad del diseño original.

#### Alcance

- Incluye: descarga cuando el job está en estado **Procesado**; nombre de archivo sugerido (TBD convención).
- **Arquitecto:** solo sus trabajos **Procesados**.
- **Administrador:** descarga de cualquier trabajo **Procesado** (gestión de plataforma).
- No incluye: envío automático por email al cliente (no en MVP).

#### Flujo principal

1. Desde dashboard o detalle de trabajo, usuario ve acción “Descargar” habilitada si el estado es **Procesado**.
2. Obtiene URL firmada o stream según diseño.
3. Archivo local coincide con el almacenado (verificación opcional por hash expuesto — TBD).

#### Variaciones y errores

- Estado **Pendiente** o **Procesando:** botón deshabilitado con estado visible.
- Estado **Error:** sin descarga de resultado; mensaje acorde.
- Expiración de link firmado: renovación transparente o reintento (TBD).

#### Datos y reglas

- RBAC: Arquitecto solo sobre sus jobs; Administrador sobre todos.

#### Integraciones

- Supabase Storage + API Express.

#### Requisitos no funcionales

- Seguridad: no URLs públicas permanentes sin token.

#### Criterios de aceptación (verificables)

- Dado job **Procesado** del propio arquitecto, cuando descarga, entonces obtiene archivo que abre en CAD y contiene capa acordada.
- Dado job **Procesado** de otro arquitecto, cuando un **Administrador** descarga, entonces obtiene el mismo archivo que vería el dueño.
- Dado job no **Procesado**, cuando intenta descargar, entonces no obtiene archivo válido de resultado y ve feedback de estado.

#### Dependencias y supuestos

- Depende de US-009.

#### Metadata para ingestión (opcional)

- `story_id`: `US-010`
- `feature_key`: `delivery.download_dwg`
- `labels`: `mvp`, `fase-4`, `entrega`

---

## Metadata para ingestión (global)

| Clave | Uso |
|-------|-----|
| `initiative_slug` | `cambre-planos-mvp` |
| `doc_id` | `docs/user-stories/cambre-planos-mvp-historias.md` |
| `story_id_prefix` | `US-` + número (ej. `US-001`, … `US-010`) |
| `roles_mvp` | `administrator`, `architect` (nombres técnicos finales TBD) |
| `job_status` | `pendiente`, `procesando`, `procesado`, `error` (valores canónicos API TBD: snake_case vs. enums) |

---

## Huecos y preguntas abiertas

**Cerrados en v0.2:** roles (Administrador / Arquitecto), máquina de estados del trabajo, prefijo `US-`, límites MVP vs. extensibilidad.

**Cerrado en v0.3:** el Administrador **no** crea trabajos/análisis en nombre de otros (ni asume titularidad de `job` de un arquitecto); solo el Arquitecto crea sus propios trabajos (US-005).

**Pendientes para subir a revisión:**

1. **Desde estado Error:** ¿reintento en el mismo job, nuevo análisis obligatorio, o botón “Reprocesar” solo para admin?
2. **Proveedor IA definitivo** y **contrato** entre US-007–008–009.
3. **Prioridad cuando reglas normativas entran en conflicto** (documento de negocio).
4. **Idioma de la UI** y **contenido de emails**.
5. **Alta del primer Administrador** (bootstrap: script, env, invitación interna).

Cuando definan estos puntos, actualizo versiones y criterios de aceptación afectados.
