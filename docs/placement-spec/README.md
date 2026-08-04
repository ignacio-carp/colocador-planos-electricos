# Motor determinístico de componentes + harness de verificación

**Principio rector: el LLM decide semántica; el código computa geometría.**
Y en la mayoría de los planos ni siquiera hace falta para la semántica: el
arquitecto ya escribió el nombre de cada ambiente en el DXF.

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Spec de conducta | `reglas-dormitorio-tomas-v1.md` | Define "colocar bien" en términos computables |
| Extracción | `cad_worker/extract_geometry.py` | Muros, aberturas, muebles, **etiquetas de local** y **cotas** |
| Ambientes | `cad_worker/detect_rooms.py` | Flood-fill ráster sembrado en cada etiqueta; polygonize de fallback |
| Vocabulario de ambientes | `cad_worker/room_labels.py` | Nombre del local → `room_type`, sin modelo |
| Unidades | `cad_worker/unit_resolution.py` | Cotas + geometría → du/m, con override del header cuando la evidencia manda |
| Catálogo | `cad_worker/symbol_catalog.py` + `symbol_geometry.py` | Símbolos en **milímetros de papel** |
| Colocador | `cad_worker/placement.py` | Polígono + geometría + regla → coordenadas y normal de pared |
| Dibujo | `cad_worker/electrical_layer.py` | Bloques, escala única por documento, rotación y post-condición medida |
| Harness | `cad_worker/harness/` | Fixtures sintéticos + corpus real + validadores + runner |
| Flag de modo | `apps/api/src/pipelineMode.ts` | `PLACEMENT_MODE=deterministic\|llm` (live default: deterministic) |

## Cómo se dimensiona un símbolo

Un símbolo eléctrico es una anotación, no un dibujo a escala del aparato:

```
unidades de dibujo = mm de papel × (escala de ploteo / 1000) × unidades de dibujo por metro
```

La geometría del bloque se declara directamente en milímetros de papel, así que
no queda ningún radio adimensional para multiplicar por una unidad mal
adivinada. Después de escribir el DXF se **mide** el bbox real de cada INSERT: si
alguno cae fuera de la banda de legibilidad, la operación falla en vez de
entregar el archivo.

El tope relativo al ambiente se calcula contra **los ambientes del documento**,
nunca contra los de la corrida. Tomarlo de la corrida hacía que procesar de a un
ambiente —que es como lo usa la UI— dimensionara cada símbolo contra el ambiente
que lo tocó: el DXF del último test traía 9 escalas distintas, de 0,067 a 0,100,
50% de diferencia entre el símbolo de un baño y el del living.

## Cómo se detectan los ambientes

Por cada etiqueta de local del plano se rasteriza el entorno y se hace flood-fill
del espacio libre desde el punto de inserción del texto. El ráster tolera lo que
las operaciones booleanas vectoriales no: juntas con luz, líneas pasadas de
largo, y vanos de puerta.

El vano es un vacío entre cuerpos de muro, no un hueco entre extremos libres: se
sella con cierre morfológico de **radio elegido por ambiente**, porque el radio
que necesita una puerta de 0,9 m taparía un pasillo de 1,0 m. Cada etiqueta
prueba radios crecientes y se queda con el primero que mide como su propio
ambiente.

Ambientes que caen en la misma región se reportan como un único ambiente
integrado con todos sus nombres (una cocina-comedor-living lo es de verdad), no
se descartan ni se les inventa una pared.

Compartir región se decidía sólo por dónde cae el **texto** de cada etiqueta, y
eso deja pasar el caso en que dos rellenos dan la misma región pero ninguno de
los dos textos cae dentro del contorno del otro: alcanza con un rótulo impreso
sobre el muro divisorio. En el plano de Cambre eso produjo una SALA DE MAQUINAS
de 1,5 m² y un BAÑO SERV. de 2,0 m² ocupándose mutuamente por completo, y cada
uno recibió su cuota de tomas: dos símbolos a 8 cm sobre la misma pared. Ahora
la geometría decide lo que los rótulos no pudieron: dos polígonos que comparten
más del 60% del menor son el mismo espacio y se funden, con warning
`MERGED_ROOMS_SHARE_REGION`.

## Dónde puede apoyarse un componente

Un tramo utilizable es **muro menos vano**, no borde menos vano. La diferencia no
es cosmética: derivarlo del borde completo convertía al lado abierto de una
galería (un límite dibujado como solado, sin muro detrás) en el tramo libre más
largo del ambiente, y el ranking de candidatos prefiere el más largo. Sobre el
plano de Cambre eso puso 16 de 64 tomas y llaves a más de 40 cm de todo muro, la
peor a 7,07 m, cada una registrada como apoyada en un «tramo útil de pared». El
mismo perímetro fantasma alimentaba el conteo normativo, así que el defecto
además pedía las tomas que después colocaba en el aire.

Un ambiente sin ningún borde con muro verificable no recibe tomas: se reporta con
`NO_VERIFIED_WALL_FOR_OUTLETS`. Un centro de luz sí, porque va en el techo y no
depende de la pared.

## Correr el loop

```bash
npm run harness                     # desde la raíz del repo
npm run harness -- --render-real    # además rasteriza cada plano real para mirarlo
```

También corre bajo pytest (`tests/test_harness.py`), así que CI lo ejecuta.

El ciclo de trabajo es: cambiar código → `npm run harness` → leer fallos →
corregir → repetir hasta verde.

## Puertas de aceptación sobre planos reales

`fixtures/real/` **no se commitea**: son archivos CAD de cliente de varios MB.
Cuando la carpeta no está, el bloque real se saltea y CI sigue verde. Cuando
está, cada plano se mide contra:

| Puerta | Qué exige |
|---|---|
| G1 ambientes | ≥90% de las etiquetas de local mapean a un polígono plausible |
| G2 tamaño | Todo símbolo dentro de la banda de papel, con escala única por documento |
| G3 orientación | Todo componente de pared trae la normal de su pared |
| G4 colocación | Ningún componente fuera de su polígono |
| G5 cobertura | Todo ambiente cableable recibe componentes o un error explícito |
| G6 higiene | Capas de origen intactas, legacy purgado, reproceso idéntico |
| G7 visual | El render, que lo mira una persona |

## Estado del reporte

`harness-report.json` es la última corrida en verde: **518/518 checks**, ruleset
`cambre-completo-2026.07.2`, y los 4 planos del corpus real.

Sobre `cambre-vivienda-limpio.dxf` (vivienda de dos plantas, 33 locales
rotulados): 26 ambientes detectados, 23 cableados, 87 componentes (36 tomas,
39 centros de luz, 12 llaves), todos entre 4,3 y 5,3 mm de papel y **a una sola
escala**.

Bajó de 27 ambientes a 26 porque dos que ocupaban la misma región ahora se
funden, y de 97 componentes a 87 porque las colocaciones que se apoyaban en un
borde sin muro ya no se emiten. Ninguno de los dos números era mejor por ser más
alto: 10 de esos 97 componentes estaban en el aire.

`traslado-st.dxf` es un layout industrial sin capa de muros reconocible y falla
explícito con `NO_WALLS`. Está en el corpus a propósito: el motor tiene que
fallar fuerte, no inventar.

## Limitaciones conocidas

- 11 de los 24 ambientes cableados quedan sin llave porque su vano no da un tramo
  limpio de perímetro sin muro (espacios integrados, y ambientes donde el tapón
  del cierre morfológico corre el borde). Sale con warning `NO_DOOR_FOR_SWITCH`.
- Los exteriores cuyo límite es solado y no muro quedan sin tomas, con
  `NO_VERIFIED_WALL_FOR_OUTLETS`. Es deliberado: el motor no coloca sobre un
  borde que no pudo verificar. La contrapartida es que una galería con columnas
  en vez de pared necesita colocación manual.
- El relleno todavía devuelve ambientes imposiblemente chicos en plantas densas
  (en el corpus real, dormitorios de 2,4 y 3,8 m²). Sale con warning de área
  fuera de rango, pero el polígono se usa igual, y un ambiente subdimensionado
  recibe menos tomas de las que le corresponden.
- Los centros de luz de un ambiente grande se distribuyen sobre un solo eje. En
  una planta integrada en L eso los alinea en fila.
- Planos sin capa de nombres de local pierden el mejor insumo y caen al detector
  de fallback.
- El alcance no cubre circuitos, tablero, cómputo ni canalización.

## Rollback

`PLACEMENT_MODE=llm` en el entorno de la API restaura el comportamiento anterior
(el LLM emite coordenadas) sin tocar código.
