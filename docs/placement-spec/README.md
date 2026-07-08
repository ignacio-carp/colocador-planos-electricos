# Colocador determinístico + harness de verificación

**Principio rector: el LLM decide semántica; el código computa geometría.**
El LLM clasifica ambientes (US-007) y conversa; las coordenadas x,y de cada
toma las calcula `services/cad-worker/src/cad_worker/placement.py` a partir de
paredes, aberturas y muebles extraídos del DXF. El LLM no emite coordenadas en
modo determinístico.

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Spec de conducta | `reglas-dormitorio-tomas-v1.md` | Define "colocar bien" en términos computables |
| Colocador | `cad_worker/placement.py` | Polígono + geometría + regla → coordenadas exactas |
| Detección determinística de ambientes | `cad_worker/detect_rooms.py` | Polygonize de muros (experimental, valida al LLM) |
| Harness | `cad_worker/harness/` | Fixtures sintéticos + validadores + runner |
| Flag de modo | `apps/api/src/pipelineMode.ts` | `PLACEMENT_MODE=deterministic\|llm` (live default: deterministic) |
| Snap de chat | `apps/api/src/wallSnap.ts` | Elementos agregados por chat anclan a la pared más cercana |

## Correr el loop

```bash
npm run harness                 # desde la raíz del repo
# o directo:
cd services/cad-worker && .venv/bin/python -m cad_worker.cli harness \
  --report ../../docs/placement-spec/harness-report.json
```

También corre bajo pytest (`tests/test_harness.py`), así que CI lo ejecuta.

El ciclo de trabajo es: cambiar código → `npm run harness` → leer fallos →
corregir → repetir hasta verde. Los validadores (§9 de la spec) son la
definición ejecutable de "el plano salió bien": `inside_polygon`, `on_wall`,
`clearance_openings`, `count_matches_rule`, `no_overlap`, `distinct_walls`,
`scale_sane`, `bbox_guard_zero`, `detect_rooms_*`, `determinism` y
`honest_error`.

## Estado del reporte

`harness-report.json` es la última corrida en verde (107/107 checks, ruleset
`cambre-tomas-2026.07.1`). La línea de base en modo `llm` queda pendiente:
requiere la API corriendo con OPENAI_API_KEY y gasto autorizado. El modo
determinístico corre offline y sin costo.

## Rollback

`PLACEMENT_MODE=llm` en el entorno de la API restaura el comportamiento
anterior (el LLM emite coordenadas) sin tocar código.
