# ESTADO.md

> Foto del presente, no historial. El historial vive en git.

## Qué es

`colocador-planos-electricos` (VanguardIA — Cambre Planos Eléctricos) es un
motor CAD que coloca tomas, centros de luz y llaves sobre planos eléctricos
DXF reales de un cliente (Cambre). Monorepo npm workspaces:

- `apps/web`: frontend React + Vite.
- `apps/api`: backend Node + Express + TypeScript.
- `services/cad-worker`: motor Python (extracción de geometría, detección de
  ambientes, colocación, dibujo).

Principio rector (`docs/placement-spec/README.md`): el LLM decide semántica —
y en la mayoría de los planos ni eso, porque el arquitecto ya nombró cada
ambiente en el DXF —, el código computa geometría. Las coordenadas de
colocación salen de reglas determinísticas, no de un LLM emitiendo puntos.
`PLACEMENT_MODE=deterministic` es el modo live; `PLACEMENT_MODE=llm` restaura
el comportamiento anterior sin tocar código (rollback).

## Dónde quedó

Rama activa (`git branch --show-current`): `fix/motor-colocacion-y-simbologia`.

Todo lo de esa rama está pusheado a `origin` — `git status -sb` devuelve
`fix/motor-colocacion-y-simbologia...origin/fix/motor-colocacion-y-simbologia`,
sin ahead/behind. **No hay riesgo de pérdida.** Es desprolijidad de ramas, no
una emergencia.

La rama activa está **17 commits adelante de `main`**
(`git log --oneline main..HEAD`, del 2026-07-20 al 2026-08-04), incluido un
merge del 2026-08-04 (`82fa5fe`, "Merge branch 'main' into
fix/motor-colocacion-y-simbologia"). `main` no se mueve desde el
**6 de julio de 2026** (`5058afb`, "fix(cad-worker): bundle matplotlib fonts
for headless render-plan."). Hoy es 2026-08-18: son casi seis semanas de
trabajo real viviendo fuera de `main`.

## El estado de las ramas

Commits por delante de `main` (`git log --oneline main..<rama> | wc -l`):

- `main`: último commit `5058afb`, 2026-07-06. No se movió desde entonces.
- `fix/motor-colocacion-y-simbologia` (activa, HEAD): **17** commits adelante.
  Último commit `82fa5fe`, 2026-08-04.
- `feature/motor-dibujo-componentes`: **9** commits adelante. Último commit
  `123ae42`, 2026-07-27. Su punta ya es ancestro de la rama activa (`git
  merge-base --is-ancestor feature/motor-dibujo-componentes HEAD`): su
  trabajo está incluido en `fix/motor-colocacion-y-simbologia`, aunque no en
  `main`.
- `feature/escala-lineage-hardening`: **7** commits adelante. Último commit
  `002a2c8`, 2026-07-21. No es ancestro de la rama activa: trabajo aparte, sin
  mergear a ningún lado.
- `feature/harness-colocador-deterministico`: **3** commits adelante. Último
  commit `62ecd39`, 2026-07-08. Tampoco es ancestro de la rama activa: trabajo
  aparte, sin mergear a ningún lado.

Las cuatro ramas locales trackean su equivalente en `origin`.

## Limitaciones conocidas

De `docs/placement-spec/README.md`, sección "Limitaciones conocidas" (sobre
el corpus real, `cambre-vivienda-limpio.dxf`: 26 ambientes, 23 cableados):

- 11 de los 24 ambientes cableados quedan sin llave: su vano no da un tramo
  limpio de perímetro sin muro. Warning `NO_DOOR_FOR_SWITCH`.
- Los exteriores cuyo límite es solado y no muro quedan sin tomas
  (`NO_VERIFIED_WALL_FOR_OUTLETS`). Es deliberado: no coloca sobre un borde
  que no pudo verificar. Una galería con columnas en vez de pared necesita
  colocación manual.
- El relleno todavía devuelve ambientes imposiblemente chicos en plantas
  densas (dormitorios de 2,4 y 3,8 m² en el corpus real). El polígono se usa
  igual y recibe menos tomas de las que le corresponden.
- Los centros de luz de un ambiente grande se distribuyen sobre un solo eje;
  en una planta integrada en L eso los alinea en fila.
- Planos sin capa de nombres de local pierden el mejor insumo y caen al
  detector de fallback.
- El alcance no cubre circuitos, tablero, cómputo ni canalización.

## Cómo se verifica

Comando declarado en `package.json` de la raíz: `npm run harness` (corre
`bash scripts/harness.sh`, que invoca `cad_worker.cli harness`). También
corre bajo pytest (`tests/test_harness.py`), así que CI lo ejecuta.

`fixtures/real/` no se commitea (son archivos CAD de cliente de varios MB).
En este checkout local sí están presentes (`cambre-vivienda-limpio.dxf`,
`cambre-vivienda-contaminado.dxf`, `cambre-vivienda-simbolos-3cm.dxf`,
`traslado-st.dxf`); no se abrieron sus contenidos para este documento. Cuando
la carpeta no está, el bloque real se saltea y CI sigue verde.

El último reporte grabado (`docs/placement-spec/harness-report.json`) declara
**518/518 checks en verde**, ruleset `cambre-completo-2026.07.2`, 4 planos del
corpus real. Ese archivo se modificó por última vez en el commit `123ae42`
(2026-07-27). La rama activa tiene **8 commits después de ese**: tres del
26 y 27 de julio que tocan el motor mismo —`b6a1966` (motor de dibujo de
componentes sobre geometría medida), `a650039` (el motor dejaba de dibujar con
polígonos que no calzan con los muros) y `0478680`—, cuatro del 4 de agosto
—`dae4652`, `344ec9c`, `ccdab7b`, `995128c`— y el merge `82fa5fe`.

Osea que el 518/518 **no está confirmado contra el HEAD actual**, y no por un
margen menor: tres de esos ocho cambian la detección de ambientes y el dibujo,
que es exactamente lo que el harness mide. No se corrió el harness para este
documento.

## Próximo paso

La decisión sobre qué hacer con las cuatro ramas está **pendiente de Nacho**.

**Estado al 18-ago-2026:** Nacho le consultó a Juan Cruz Riera —creador principal del
proyecto— en qué estado están sus commits. La decisión queda esperando esa respuesta:
no es sólo una cuestión de higiene de ramas, porque es un repositorio compartido y el
criterio de integración lo fija él. No mergear nada hasta que conteste.

Datos para tomarla:

- `main` está congelado desde el 2026-07-06 (`5058afb`); no recibe commits
  desde entonces.
- `fix/motor-colocacion-y-simbologia` (activa) le lleva 17 commits, todos
  pusheados a `origin` (sin riesgo de pérdida).
- Las otras tres ramas locales (`feature/escala-lineage-hardening`,
  `feature/motor-dibujo-componentes`, `feature/harness-colocador-deterministico`)
  también están pusheadas y sin mergear a `main`; `feature/motor-dibujo-componentes`
  ya está contenida dentro de la rama activa, las otras dos no.
- El último harness registrado (518/518) es del commit `123ae42`
  (2026-07-27); la rama activa avanzó después de esa corrida y no se volvió a
  correr para este documento.
