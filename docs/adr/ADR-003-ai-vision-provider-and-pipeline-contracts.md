# ADR-003: Proveedor IA de visión y contratos del pipeline (US-007–008–009)

## Estado

Aceptado (MVP) — proveedor y `contract_version` **1.0.0**; umbrales de rate limit del proveedor y backoff fino **TBD** (alineación S-01).

## Contexto

Las historias US-007 (interpretación visual), US-008 (inferencia normativa) y US-009 (capa CAD) comparten un pipeline orquestado desde `apps/api` (stub en `jobsPipeline.ts`, integración futura con S-01). Hasta ahora el contrato request/response entre pasos estaba **pendiente**, bloqueando implementación sin ambigüedad.

Opciones de visión evaluadas para layout/DWG (vía rasterización o vector temporal):

| Criterio | OpenAI GPT-4o | Anthropic Claude 3.5 Sonnet | Notas |
|----------|---------------|-----------------------------|--------|
| Calidad layout arquitectónico | Muy buena en planos raster; JSON mode estable | Muy buena; contexto largo útil en planos densos | Validación final con suite golden Cambre (Sprint 4) |
| Latencia típica (imagen ~2–4 MP) | ~8–25 s según región/carga | ~10–30 s | Objetivo MVP p95 &lt; 45 s por paso visión |
| Coste orientativo (visión, por job) | ~$0.01–0.05 según tokens/imagen | Similar orden de magnitud | Métrica `recordIaCostUsd` en API |
| Integración stack Node | SDK oficial maduro; ya alineado con propuesta MVP | SDK disponible; segundo proveedor si hace falta failover | |
| Salida estructurada | `response_format: json_schema` / JSON mode | Tool use + JSON | Contratos en `docs/contracts/pipeline/` |

## Decisión (MVP)

1. **Proveedor de visión (US-007):** [OpenAI GPT-4o](https://platform.openai.com/docs/models/gpt-4o) (`gpt-4o`, multimodal imagen).
   - **Motivos:** encaje con la propuesta técnica del MVP, API de visión madura, salida JSON predecible para encadenar US-008, ecosistema Node ya previsto en el monorepo.
   - **Alternativa no descartada:** Claude 3.5 Sonnet como proveedor secundario o A/B de calidad; cambiar implica adaptador en capa IA sin romper schemas si se respeta `contract_version`.

2. **Inferencia normativa (US-008):** mismo proveedor LLM (GPT-4o) con prompt versionado (`normative_rules_version` en payload); motor de reglas determinista puede sustituir parte del LLM más adelante sin cambiar el contrato de salida hacia US-009.

3. **Versionado de contrato:** semver en metadata de cada payload y en logs del pipeline:
   - Constante de código: `PIPELINE_CONTRACT_VERSION = '1.0.0'` (`apps/api/src/pipelineContracts.ts`).
   - Campo obligatorio: `contract_version` (string semver) en input/output de cada paso y en `pipeline_*` logs.

4. **Flujo de datos:**

   ```text
   DWG (Storage) → raster/vector (ingest) → vision-layout (US-007)
        → normative-inference (US-008) → cad-generation (US-009) → DWG resultado
   ```

   Schemas: `docs/contracts/pipeline/*.json` y ejemplos en `docs/contracts/pipeline/examples/`.

## Timeouts, reintentos y rate limits

| Aspecto | MVP / código actual | Contrato / seguimiento |
|---------|---------------------|-------------------------|
| Reintentos por paso IA | `IA_MAX_ATTEMPTS = 3` en `jobsPipeline.ts` (simulación y futuro proveedor) | Mismo valor documentado para US-007 y US-008; fallo terminal → job **Error** con `correlation_id` |
| Backoff entre reintentos | Stub: `sleep(5)` fijo entre intentos | **TBD** exponencial (p. ej. 2^n s, cap 30 s) al integrar S-01 / cola |
| Timeout por llamada proveedor | **TBD** negocio; sugerido 60 s visión, 45 s normativa | Registrar en env `VISION_API_TIMEOUT_MS`, `NORMATIVE_API_TIMEOUT_MS` |
| Rate limit proveedor (429) | Cuenta como intento fallido; reintento si `attempt < IA_MAX_ATTEMPTS` | Política global rate limit plataforma: **TBD** (no confundir con `INVITE_RATE_LIMIT_*`) |
| Observabilidad | Logs JSON: `job_id`, `correlation_id`, `contract_version`, `step` | Métricas existentes: latencia por step, `recordIaRetry`, coste USD |

## Variables de entorno (previstas)

| Variable | Descripción |
|----------|-------------|
| `OPENAI_API_KEY` | Clave API OpenAI para US-007/US-008 cuando se sustituya el stub. |
| `OPENAI_VISION_MODEL` | Default `gpt-4o`. |
| `VISION_API_TIMEOUT_MS` | Timeout HTTP paso visión (TBD default 60000). |
| `NORMATIVE_API_TIMEOUT_MS` | Timeout paso normativa (TBD default 45000). |
| `CAD_IA_SIMULATE_FAILURE` | Ya existente: fuerza fallos para probar reintentos y estado **Error**. |

## Criterios de aceptación (T-11)

- Contrato publicado en repo (`docs/contracts/pipeline/` + este ADR).
- Salida US-007 (`vision-layout-output.json`) es instancia válida de entrada US-008 (`normative-inference-input.json` vía `layout_interpretation`).
- Fixture cruzado en `examples/us007-output-us008-input.json` demuestra encadenamiento parseable.

## Consecuencias

- Implementadores de US-007/008/009 pueden avanzar contra schemas draft-07 sin esperar el proveedor real en producción.
- Cambios breaking en payloads requieren bump de `contract_version` (minor si aditivo, major si rompe compatibilidad) y entrada ADR nueva o sección de migración.
- QA Sprint 4 validará calidad DWG contra golden set; este ADR no fija umbrales de precisión normativa.

## Referencias

- US-007, US-008, US-009: `docs/user-stories/cambre-planos-mvp-historias.md`
- ADR-002 (estilo): `docs/adr/ADR-002-transactional-email-provider.md`
- Contratos: `docs/contracts/pipeline/README.md`
