# Reglas normativas: qué dibuja el sistema y qué no

Esta es la única página que define el alcance. Si un ruleset dice otra cosa, gana
esta página y el ruleset está mal.

## Alcance vigente

Ruleset activo: **`cambre-completo-2026.07.2`** (`rules/cambre-normative/2026.07.2/rules.json`).

El sistema coloca y dibuja, por ambiente detectado:

| Componente | Criterio |
|---|---|
| **Tomacorrientes** | Mínimo por tipo de ambiente, más uno cada N metros de perímetro útil. Sobre muro, a 150 mm de cualquier abertura, a 600 mm entre sí |
| **Centros de luz** | Uno por ambiente, más según área. En un punto garantizado interior al polígono |
| **Llaves** | Una junto a la puerta principal, del lado con más pared libre, con 1, 2 o 3 puntos según cuántas bocas comanda |

Y dibuja la **referencia de simbología** al costado del plano, con cada símbolo
usado, su nombre y su cantidad.

## Lo que deliberadamente NO hace

Esto no es una lista de pendientes. Es lo que el sistema no promete:

- **Circuitos.** No agrupa bocas en circuitos ni dimensiona protecciones
- **Tablero.** El símbolo existe en el catálogo, pero nada lo ubica ni lo calcula
- **Canalización y cableado.** No dibuja cañerías ni conductores
- **Cómputo de materiales.** No emite lista de materiales
- **Exteriores.** Terrazas, patios y pérgolas se detectan y se reportan, no se
  cablean: requieren grado de protección IP y criterio de intemperie que este
  alcance no cubre

Un plano que salga de acá es un **anteproyecto de bocas**, no un proyecto
eléctrico firmado. Esa distinción va en cualquier material que vea un cliente.

## Cómo se decide el tipo de ambiente

Del nombre que el arquitecto escribió en el plano. `room_labels.py` mapea
`COCINA` a `cocina`, `BAÑO SUITE` a `bano`, y así. Ese tipo elige la regla en
`reglas_por_habitacion`.

Cuando varios ambientes caen en una misma región (una cocina-comedor-living
integrada), se tratan como un solo ambiente con el nombre compuesto y la regla
más exigente del grupo.

## Historial, y por qué hubo cuatro rulesets

El alcance se movió tres veces sin que quedara escrito por qué. Queda escrito acá:

| Versión | Alcance | Por qué se retiró |
|---|---|---|
| `2026.05.1` | Stub del MVP | Nunca pasó de stub |
| `2026.06.3` | Todo: AEA 770/771, PMU, circuitos, tablero, cómputo | Declaraba un alcance que el motor nunca implementó. Un ruleset no puede prometer más de lo que el sistema hace |
| `2026.07.1` | Solo tomacorrientes | Excluía llaves e iluminación, que son parte del entregable mínimo de un plano eléctrico |
| `2026.07.2` | Tomas, luces y llaves | **Activo** |

Los archivos retirados quedan en el repo por trazabilidad de trabajos viejos.
`manifest.json` los marca `status: retired` con el motivo; ninguno se activa.

## Cómo cambiar el alcance

1. Nuevo directorio con versión y `rules.json`
2. Entrada en `manifest.json` con `status: active`, y la anterior a `retired` con su motivo
3. Actualizar esta página: qué entra y qué sale
4. `npm run harness` en verde, incluidas las puertas sobre planos reales

Cambiar reglas sin actualizar esta página es cómo se llegó a tener cuatro
rulesets contradictorios.

## Edición desde la app

`NormativeRulesEditor` deja a un arquitecto editar el ruleset activo. La API
protege la estructura: las secciones obligatorias no se pueden borrar. No permite
activar una versión retirada.
