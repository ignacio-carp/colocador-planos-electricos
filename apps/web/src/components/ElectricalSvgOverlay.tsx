import React, { useMemo } from 'react'
import { worldToScreen, type ViewTransform } from '@cadview/core'
import type { ElectricalElement } from './PlanViewer2D'

const LEGACY_TO_ELEMENT: Record<string, string> = {
  standard: 'toma',
  double: 'toma',
  switch: 'llave',
  dedicated_appliance: 'toma_especial',
  emergency: 'toma_especial',
}

/** Colors per element / outlet_type (matches cad-worker symbol catalog). */
const SYMBOL_COLORS: Record<string, string> = {
  toma: '#dc2626',
  standard: '#dc2626',
  double: '#b91c1c',
  centro: '#dc2626',
  brazo: '#dc2626',
  llave: '#7c3aed',
  switch: '#7c3aed',
  toma_especial: '#ea580c',
  dedicated_appliance: '#ea580c',
  emergency: '#16a34a',
  tablero: '#1f2937',
  puesta_tierra: '#059669',
}

const DEFAULT_COLOR = '#dc2626'

function resolveSymbolKind(element: ElectricalElement): string {
  if (element.element) return element.element
  return LEGACY_TO_ELEMENT[element.outlet_type] ?? element.outlet_type
}

function worldLengthToScreen(
  viewTransform: ViewTransform,
  x: number,
  y: number,
  worldLength: number,
): number {
  const [x1, y1] = worldToScreen(viewTransform, x, y)
  const [x2, y2] = worldToScreen(viewTransform, x + worldLength, y)
  return Math.hypot(x2 - x1, y2 - y1)
}

type SymbolGlyphProps = {
  kind: string
  x: number
  y: number
  r: number
  color: string
  stroke: number
}

function SymbolGlyph({ kind, x, y, r, color, stroke }: SymbolGlyphProps) {
  const legX = r * 0.4
  const legTop = r * 0.25
  const legBottom = r * 1.3

  if (kind === 'centro') {
    return <circle cx={x} cy={y} r={r} fill={color} stroke={color} strokeWidth={stroke} />
  }

  if (kind === 'toma' || kind === 'standard' || kind === 'double') {
    return (
      <>
        <circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.85)" stroke={color} strokeWidth={stroke} />
        <line x1={x - legX} y1={y + legTop} x2={x - legX} y2={y + legBottom} stroke={color} strokeWidth={stroke * 0.85} />
        <line x1={x + legX} y1={y + legTop} x2={x + legX} y2={y + legBottom} stroke={color} strokeWidth={stroke * 0.85} />
      </>
    )
  }

  if (kind === 'toma_especial' || kind === 'dedicated_appliance' || kind === 'emergency') {
    const bar = r * 1.2
    return (
      <>
        <circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.85)" stroke={color} strokeWidth={stroke} />
        <line x1={x - legX} y1={y + legTop} x2={x - legX} y2={y + legBottom} stroke={color} strokeWidth={stroke * 0.85} />
        <line x1={x + legX} y1={y + legTop} x2={x + legX} y2={y + legBottom} stroke={color} strokeWidth={stroke * 0.85} />
        <line x1={x - bar} y1={y + bar} x2={x + bar} y2={y + bar} stroke={color} strokeWidth={stroke * 0.85} />
      </>
    )
  }

  if (kind === 'llave' || kind === 'switch') {
    const dot = r * 0.3
    const ox = x - r * 0.85
    const oy = y - r * 0.85
    const tip = r * 0.7
    return (
      <>
        <circle cx={ox} cy={oy} r={dot} fill={color} stroke={color} strokeWidth={stroke * 0.5} />
        <line x1={ox} y1={oy} x2={x + tip} y2={y + tip} stroke={color} strokeWidth={stroke} />
        <line x1={x + tip} y1={y + tip} x2={x + tip * 0.3} y2={y + tip * 1.35} stroke={color} strokeWidth={stroke} />
      </>
    )
  }

  if (kind === 'brazo') {
    return (
      <>
        <path
          d={`M ${x - r} ${y} A ${r} ${r} 0 0 1 ${x + r} ${y}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
        />
        <line x1={x - r} y1={y} x2={x + r} y2={y} stroke={color} strokeWidth={stroke} />
      </>
    )
  }

  if (kind === 'tablero') {
    const w = r * 2
    const h = r * 1.25
    return (
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        fill="rgba(255,255,255,0.85)"
        stroke={color}
        strokeWidth={stroke}
      />
    )
  }

  // Fallback: legacy circle+cross
  return (
    <>
      <circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.85)" stroke={color} strokeWidth={stroke} />
      <line x1={x - r} y1={y} x2={x + r} y2={y} stroke={color} strokeWidth={stroke * 0.85} />
      <line x1={x} y1={y - r} x2={x} y2={y + r} stroke={color} strokeWidth={stroke * 0.85} />
    </>
  )
}

type Props = {
  elements: ElectricalElement[]
  viewTransform: ViewTransform | null
  width: number
  height: number
  /** Symbol radius in DXF drawing units; scales with zoom. */
  symbolRadiusDrawingUnits?: number
}

/**
 * SVG overlay of electrical elements (Cambre_Electrical layer) over the DXF viewer.
 * Renders vivienda symbology (toma IRAM, centro, llave, etc.) per cad-worker catalog.
 */
export default function ElectricalSvgOverlay({
  elements,
  viewTransform,
  width,
  height,
  symbolRadiusDrawingUnits = 15,
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
        const kind = resolveSymbolKind(element)
        const color = SYMBOL_COLORS[kind] ?? SYMBOL_COLORS[element.outlet_type] ?? DEFAULT_COLOR
        const r = Math.max(
          2,
          worldLengthToScreen(viewTransform, element.position.x, element.position.y, symbolRadiusDrawingUnits),
        )
        const stroke = Math.max(0.75, r * 0.18)
        const title = [element.label ?? kind, element.catalog_sku].filter(Boolean).join(' · ')
        return (
          <g key={element.id}>
            <title>{title}</title>
            <SymbolGlyph kind={kind} x={x} y={y} r={r} color={color} stroke={stroke} />
            {element.source === 'chat' ? (
              <circle cx={x + r} cy={y - r} r={Math.max(1.5, r * 0.2)} fill="#2563eb" />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
