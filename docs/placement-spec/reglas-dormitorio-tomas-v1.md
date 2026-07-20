# Spec de emplazamiento determinístico — Tomacorrientes v1

> **Estado: BORRADOR — pendiente de validación.** Este documento define qué significa "colocar bien una toma" en términos computables. Es la fuente de verdad del colocador determinístico (`place-elements`) y de los validadores del test harness. Los fixtures sintéticos codifican estas reglas como respuesta esperada: si esta spec está mal, todo lo que se verifique contra ella está mal.
>
> Cada parámetro declara su fuente: **[ruleset]** = ya definido en `rules/cambre-normative/2026.07.1/rules.json` (vigente); **[propuesto]** = valor elegido para esta spec, requiere validación de Cambre/matriculado antes de considerarse norma.

## Alcance v1

- **Solo tomacorrientes TUG** (`outlet_type: standard`, `mounting: wall`), alineado al ruleset activo `cambre-tomas-2026.07.1`.
- **Vertical en detalle: dormitorio.** El resto de los ambientes usa el algoritmo genérico (§6) con la regla del ruleset que les corresponda.
- Fuera de alcance v1: llaves, centros de iluminación, TUE, colocación sobre mesada de cocina (la cocina recibe el genérico con `height_mm` de su regla y warning), cómputo de materiales.

## 1. Entradas

| Entrada | Origen | Notas |
|---|---|---|
| Polígono del ambiente + `room_type` | `layout_interpretation` (LLM, US-007) | El LLM sigue decidiendo el **qué** (tipo de ambiente); nunca el **dónde**. |
| Paredes (segmentos `{inicio, fin}`) | `extract_geometry.py` | Coordenadas exactas en drawing_units. |
| Aberturas (segmentos) | `extract_geometry.py` | Puertas y ventanas, sin distinguir todavía. |
| Muebles (bloque + inserción + **footprint**) | `extract_geometry.py` **extendido** | Hoy solo hay punto de inserción; el footprint (bbox del bloque) es extensión requerida por esta spec. |
| Regla activa por `room_type` | `normativeRules.ts` / bundle | `min_outlets`, `height_mm`, etc. |
| Factor de unidades (drawing_units por mm) | `$INSUNITS` del DXF; heurística solo como fallback | Todos los umbrales de esta spec están en **mm reales** y se convierten con este factor. |

## 2. Definiciones computables

1. **Pared del ambiente:** segmento de pared cuya proyección dista ≤ `tol_pared_ambiente` del borde del polígono del ambiente. (Las paredes vienen del plano completo; hay que asociarlas a cada ambiente.)
2. **Vano:** proyección de un segmento de abertura sobre la pared que lo contiene.
3. **Tramo útil:** porción de una pared del ambiente que queda después de restar cada vano expandido ± `clearance_from_opening_mm` a cada lado.
4. **Punto de toma:** punto sobre un tramo útil, del lado interior del muro (dentro del polígono), a distancia ≤ `tol_on_wall` del segmento de pared.
5. **Paredes distintas:** dos tomas están en paredes distintas si sus segmentos de pared no son colineales (ángulo > 15° o separación > `tol_colineal`).

## 3. Parámetros

| Parámetro | Valor | Fuente |
|---|---|---|
| `min_outlets` dormitorio | 2 | **[ruleset]** RULE-DORMITORIO |
| `height_mm` dormitorio | 300 | **[ruleset]** RULE-DORMITORIO |
| `clearance_from_opening_mm` | 150 | **[ruleset]** defaults |
| Preferencia paredes distintas | sí, "cuando el polígono lo permita" | **[ruleset]** RULE-DORMITORIO |
| `tol_on_wall` (validador) | 50 mm | **[propuesto]** — brief de reunión |
| `sep_min_tomas` (entre dos tomas del mismo ambiente) | 600 mm | **[propuesto]** — evita tomas apiladas; no aplica al par de cabecera |
| `offset_cama` (toma respecto del borde del footprint de la cama) | 200 mm | **[propuesto]** — mesa de luz típica |
| `tol_pared_ambiente` | 100 mm | **[propuesto]** — asociación pared↔polígono |
| Largo mínimo de tramo útil para alojar una toma | 300 mm | **[propuesto]** |
| Tokens de detección de cama en nombre de bloque | `cama`, `bed`, `matrim`, `single`, `queen`, `king` | **[propuesto]** — extender con los bloques reales de los estudios |

## 4. Algoritmo — dormitorio con cama detectada

1. **Detectar cama:** mueble dentro del polígono cuyo nombre de bloque matchea los tokens. Si hay más de una, tratar cada una en orden de área de footprint descendente.
2. **Pared de cabecera:** la pared del ambiente más cercana a un lado del footprint de la cama (distancia ≤ `tol_pared_ambiente`). Si la cama no toca ninguna pared, saltar a §5 con warning `BED_NOT_AGAINST_WALL`.
3. **Par de cabecera:** una toma a cada lado de la cama sobre la pared de cabecera, a `offset_cama` del borde del footprint, altura `height_mm`. Cada punto debe caer en tramo útil; si un lado no tiene tramo útil (esquina, puerta), se coloca solo el lado viable.
4. **Completar hasta `min_outlets`:** si el par de cabecera aportó menos de `min_outlets`, colocar las restantes con el algoritmo genérico (§6) **en paredes distintas** a la de cabecera cuando exista tramo útil ahí.
5. **Resultado esperado dormitorio típico (3×4, cama contra una pared, una puerta):** 2 tomas, una a cada lado de la cama, misma pared, a 200 mm del footprint. Este es el fixture canónico del harness.

## 5. Algoritmo — dormitorio sin cama detectada

- Warning `NO_BED_DETECTED` + algoritmo genérico (§6). La colocación sigue siendo válida normativamente (cantidad + paredes distintas); pierde la optimización mueble-relativa.

## 6. Algoritmo genérico (todo ambiente / fallback)

1. Calcular tramos útiles de todas las paredes del ambiente.
2. Ordenar tramos por longitud descendente.
3. Colocar `min_outlets` tomas: una en el **punto medio** de cada tramo elegido, eligiendo tramos de **paredes distintas** mientras existan; si no alcanzan, repetir pared maximizando separación perimetral (≥ `sep_min_tomas`).
4. `height_mm` y cantidad según la regla del `room_type` (RULE-ESTAR, RULE-COCINA, etc. del ruleset activo). Para `spacing_along_wall_m` (estar, pasillo): una toma adicional por cada múltiplo del spacing sobre el perímetro útil.
5. Cocina v1: genérico + `height_mm: 1100` de RULE-COCINA + warning `KITCHEN-COUNTER-UNVERIFIED` (sin conciencia de mesada hasta que haya detección de mesada por mueble).

## 7. Degradación honesta (innegociable)

- **Sin paredes asociadas al polígono** (extracción vacía o capas no clasificadas): **error explícito** `NO_WALLS_FOR_ROOM`. Nunca colocar en el centroide ni "estimar". Un ambiente sin colocar y con error visible vale más que una toma inventada.
- **No entra `min_outlets` en los tramos útiles:** colocar las que entren + warning `INSUFFICIENT_WALL_SPACE` con el detalle (requeridas vs colocadas).
- Todo warning viaja en `warnings[]` del contrato existente — sin cambios de schema.

## 8. Salida

Mismo contrato US-008 (`outlet_placements[]`): `id`, `room_id`, `position {x, y, unit: drawing_units}`, `outlet_type: standard`, `mounting: wall`, `height_mm` de la regla, `rule_ids` de la regla aplicada, `rationale` **generado por código** (ej.: `"lado izquierdo de cama, pared norte, tramo útil 1.8m"`). US-009 no cambia.

## 9. Invariantes = validadores del harness

| Validador | Regla de esta spec |
|---|---|
| `inside_polygon` | §2.4 — el punto cae dentro del polígono del ambiente correcto |
| `on_wall` | §2.4 — distancia al segmento de pared ≤ `tol_on_wall` |
| `clearance_openings` | §2.3 — fuera de vanos ± 150 mm |
| `count_matches_rule` | §3 — cantidad ≥ `min_outlets` de la regla activa (o warning §7) |
| `no_overlap` | §3 — separación ≥ `sep_min_tomas` (excepto par de cabecera: ancho cama + 2×offset) |
| `scale_sane` | símbolo ≈ 3 cm reales según unidades del DXF |
| `determinism` | dos corridas sobre el mismo fixture → JSON de placements byte-idéntico |
