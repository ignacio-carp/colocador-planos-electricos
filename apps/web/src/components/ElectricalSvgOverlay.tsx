import React, { useMemo } from 'react'
import { worldToScreen, type ViewTransform } from '@cadview/core'
import type { ElectricalElement } from './PlanViewer2D'

/** Colors per outlet_type (matches CAMBRE_OUTLET symbol semantics). */
const OUTLET_TYPE_COLORS: Record<string, string> = {
  standard: '#dc2626',
  double: '#b91c1c',
  switch: '#7c3aed',
  dedicated_appliance: '#ea580c',
  emergency: '#16a34a',
}

const DEFAULT_COLOR = '#dc2626'
const SYMBOL_RADIUS = 7

type Props = {
  elements: ElectricalElement[]
  viewTransform: ViewTransform | null
  width: number
  height: number
}

/**
 * SVG overlay of electrical elements (Cambre_Electrical layer) over the DXF
 * viewer: circle + cross symbol per element, like the CAMBRE_OUTLET block.
 */
export default function ElectricalSvgOverlay({
  elements,
  viewTransform,
  width,
  height,
}: Props) {
  const projected = useMemo(() => {
    if (!viewTransform || width <= 0 || height <= 0) return []
    const out: Array<{ element: ElectricalElement; x: number; y: number }> = []
    for (const element of elements) {
      const { x, y } = element.position
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const [sx, sy] = worldToScreen(viewTransform, x, y)
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
      out.push({ element, x: sx, y: sy })
    }
    return out
  }, [elements, viewTransform, width, height])

  if (!viewTransform || projected.length === 0) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {projected.map(({ element, x, y }) => {
        const color = OUTLET_TYPE_COLORS[element.outlet_type] ?? DEFAULT_COLOR
        const r = SYMBOL_RADIUS
        const title = [element.label ?? element.outlet_type, element.catalog_sku]
          .filter(Boolean)
          .join(' · ')
        return (
          <g key={element.id}>
            <title>{title}</title>
            <circle
              cx={x}
              cy={y}
              r={r}
              fill="rgba(255,255,255,0.85)"
              stroke={color}
              strokeWidth={2}
            />
            <line x1={x - r} y1={y} x2={x + r} y2={y} stroke={color} strokeWidth={1.5} />
            <line x1={x} y1={y - r} x2={x} y2={y + r} stroke={color} strokeWidth={1.5} />
            {element.source === 'chat' ? (
              <circle cx={x + r} cy={y - r} r={2.5} fill="#2563eb" />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
