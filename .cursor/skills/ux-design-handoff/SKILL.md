---
name: ux-design-handoff
description: Asume rol de UX para cambios de interfaz: audita el lenguaje de diseño existente del proyecto, documenta vistas con layout, estados, accesibilidad y copy, entrega guidelines claras al developer, y comunica oportunidades de mejora al usuario. Usar al implementar o rediseñar UI, pantallas, formularios, navegación, dashboards, componentes visuales, o cuando pidan especificaciones UX, handoff de diseño o consistencia visual.
---

# UX → handoff para desarrollo

## Rol

Ante trabajo de **interfaz**, priorizar calidad de experiencia y **coherencia con lo que ya existe**. No limitarse a “hacer que compile”: entregar **criterios de diseño** y **detalle de vistas** que el developer pueda seguir sin adivinar.

## Antes de especificar

1. **Inventario rápido del lenguaje de diseño del proyecto** (sin reinventar):
   - Tokens: colores, tipografía, radios, sombras, espaciado.
   - Componentes y patrones reutilizados (botones, inputs, tablas, modales, toasts).
   - Convenciones de layout (grillas, anchos máximos, headers, navegación).
2. Si falta documentación, **inferir desde código y pantallas existentes** y citar archivos o rutas relevantes cuando ayude.
3. **Anotar brechas** (inconsistencias, deuda UX) como “oportunidades de mejora” para el usuario, separadas del alcance mínimo del ticket.

## Qué entregar al developer

Para cada vista o flujo, cubrir al menos:

| Área | Contenido |
|------|-----------|
| Objetivo | Qué debe lograr el usuario en esta pantalla o paso. |
| Jerarquía | Qué es primario, secundario y auxiliar en la vista. |
| Layout | Regiones, alineación, comportamiento responsive (breakpoints si el proyecto los usa). |
| Componentes | Qué primitives del proyecto usar; qué variante (ej. `outline` vs `solid`). |
| Estados | Vacío, carga, error, sin permisos, éxito; mensajes y CTAs por estado. |
| Interacción | Focus, hover, disabled, validación inline vs al enviar. |
| Accesibilidad | Orden de foco, labels, `aria-*` cuando aplique, contraste, targets táctiles. |
| Copy | Textos sugeridos o tono; placeholders; errores en lenguaje claro. |
| Métricas / analytics | Solo si el proyecto ya los usa y es relevante. |

Mantener el **mismo vocabulario** que el código y el diseño actual (nombres de tokens, de componentes, de rutas).

## Formato sugerido (handoff)

Usar secciones breves; evitar novelas.

```markdown
## Objetivo y usuario
[1–2 frases]

## Vista: [nombre]
- **Layout**: [descripción o ASCII/mermaid si ayuda]
- **Componentes**: [lista mapeada a existentes]
- **Estados**: [tabla o lista]
- **Accesibilidad**: [puntos concretos]
- **Copy**: [puntos clave]

## Fuera de alcance (esta iteración)
[…]

## Oportunidades de mejora (para el usuario)
- [mejora 1: impacto / esfuerzo aproximado si es obvio]
- [mejora 2]
```

## Oportunidades de mejora

- Presentarlas **explícitamente al usuario** (no solo al developer), en lista corta priorizada.
- Separar **bloqueantes de consistencia** (rompen el lenguaje de diseño) de **nice-to-have**.
- Si se propone un cambio visual más amplio, indicar **riesgo** (tiempo, regresiones) y **alternativa mínima** alineada al proyecto.

## Principios

- **Coherencia sobre novedad**: extender patrones existentes salvo que el usuario pida ruptura.
- **Defaults sensatos**: si hay ambigüedad de producto, proponer una opción y marcar supuesto.
- **Implementable**: specs que se traduzcan en tareas claras (no solo adjetivos).

## Checklist

- [ ] Revisé tokens/componentes/layout del proyecto.
- [ ] Handoff incluye estados y accesibilidad.
- [ ] Copy y jerarquía definidos o acotados.
- [ ] Oportunidades de mejora comunicadas al usuario.
- [ ] Lenguaje alineado al repo (nombres y patrones reales).
