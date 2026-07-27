import React, { useMemo } from 'react'
import { worldToScreen, type ViewTransform } from '@cadview/core'
import type { ElectricalElement } from './PlanViewer2D'

const LEGACY_TO_ELEMENT: Record<string, string> = {
  standard: 'toma',
  double: 'toma_doble',
  switch: 'llave',
  dedicated_appliance: 'toma_especial',
  emergency: 'toma_especial',
}

/**
 * Colors per element, mirroring the ACI colours the worker puts on each INSERT
 * so the preview and the delivered DXF read the same way.
 */
const SYMBOL_COLORS: Record<string, string> = {
  toma: '#dc2626',
  toma_doble: '#dc2626',
  standard: '#dc2626',
  double: '#dc2626',
  centro: '#2563eb',
  brazo: '#2563eb',
  llave: '#c026d3',
  llave_2_puntos: '#c026d3',
  llave_3_puntos: '#c026d3',
  llave_combinacion: '#c026d3',
  switch: '#c026d3',
  toma_especial: '#ea580c',
  dedicated_appliance: '#ea580c',
  emergency: '#ea580c',
  tablero: '#1f2937',
  puesta_tierra: '#059669',
}

const DEFAULT_COLOR = '#dc2626'

/** Elements drawn on the ceiling keep the drawing's orientation. */
const CEILING_ELEMENTS = new Set(['centro'])

/**
 * Rotation, in SVG degrees, that points the symbol's local +Y along the wall's
 * inward normal. Screen Y grows downward, so the sign is flipped against the
 * worker's model-space formula.
 */
function rotationFor(element: ElectricalElement, kind: string): number {
  if (CEILING_ELEMENTS.has(kind)) return 0
  const normal = element.wall_normal
  if (!normal) return 0
  return -(Math.atan2(normal[1], normal[0]) * (180 / Math.PI) - 90)
}

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
  r: number
  color: string
  stroke: number
}

/**
 * Glyphs in the symbol's own frame: origin on the wall, body growing along -Y
 * (screen up). Same conventions as cad_worker/symbol_geometry.py, so the
 * preview cannot claim a shape the DXF does not contain. `r` is half the
 * symbol's paper size, in screen pixels.
 */
function SymbolGlyph({ kind, r, color, stroke }: SymbolGlyphProps) {
  const fill = 'rgba(255,255,255,0.85)'
  const thin = stroke * 0.85

  if (kind === 'centro') {
    const d = r * Math.cos(Math.PI / 4)
    return (
      <>
        <circle cx={0} cy={0} r={r} fill={fill} stroke={color} strokeWidth={stroke} />
        <line x1={-d} y1={-d} x2={d} y2={d} stroke={color} strokeWidth={thin} />
        <line x1={-d} y1={d} x2={d} y2={-d} stroke={color} strokeWidth={thin} />
      </>
    )
  }

  if (kind === 'toma' || kind === 'toma_doble' || kind === 'standard' || kind === 'double') {
    const bodyR = r * 0.69
    const cy = -(r * 2 - bodyR)
    return (
      <>
        <line x1={-r * 0.28} y1={0} x2={-r * 0.28} y2={cy + bodyR} stroke={color} strokeWidth={thin} />
        <line x1={r * 0.28} y1={0} x2={r * 0.28} y2={cy + bodyR} stroke={color} strokeWidth={thin} />
        <circle cx={0} cy={cy} r={bodyR} fill={fill} stroke={color} strokeWidth={stroke} />
        {kind === 'toma_doble' || kind === 'double' ? (
          <line x1={0} y1={cy - bodyR} x2={0} y2={cy + bodyR} stroke={color} strokeWidth={thin} />
        ) : null}
      </>
    )
  }

  if (kind === 'toma_especial' || kind === 'dedicated_appliance' || kind === 'emergency') {
    const bodyR = r * 0.64
    const cy = -(r * 2 - bodyR)
    return (
      <>
        <line x1={-r * 0.27} y1={0} x2={-r * 0.27} y2={cy + bodyR} stroke={color} strokeWidth={thin} />
        <line x1={r * 0.27} y1={0} x2={r * 0.27} y2={cy + bodyR} stroke={color} strokeWidth={thin} />
        <circle cx={0} cy={cy} r={bodyR} fill={fill} stroke={color} strokeWidth={stroke} />
        <line x1={-r * 0.67} y1={-r * 0.33} x2={r * 0.67} y2={-r * 0.33} stroke={color} strokeWidth={thin} />
      </>
    )
  }

  if (kind.startsWith('llave') || kind === 'switch') {
    const poles = kind === 'llave_3_puntos' ? 3 : kind === 'llave_2_puntos' ? 2 : 1
    const tipX = r * 0.68
    const tipY = -r * 1.0
    const angle = Math.atan2(tipY, tipX)
    const nx = -Math.sin(angle)
    const ny = Math.cos(angle)
    const tickLength = r * 0.2
    return (
      <>
        <circle cx={0} cy={0} r={r * 0.17} fill={color} stroke={color} strokeWidth={stroke * 0.5} />
        <line x1={0} y1={0} x2={tipX} y2={tipY} stroke={color} strokeWidth={stroke} />
        {Array.from({ length: poles }, (_, index) => {
          const along = 0.62 + index * 0.34
          const bx = tipX * along
          const by = tipY * along
          return (
            <line
              key={index}
              x1={bx - nx * tickLength}
              y1={by - ny * tickLength}
              x2={bx + nx * tickLength}
              y2={by + ny * tickLength}
              stroke={color}
              strokeWidth={thin}
            />
          )
        })}
        {kind === 'llave_combinacion' ? (
          <line x1={0} y1={0} x2={tipX * 0.55} y2={tipY * 0.95} stroke={color} strokeWidth={thin} />
        ) : null}
      </>
    )
  }

  if (kind === 'brazo') {
    return (
      <>
        <line x1={-r} y1={0} x2={r} y2={0} stroke={color} strokeWidth={stroke} />
        <path
          d={`M ${-r * 0.84} 0 A ${r * 0.84} ${r * 0.84} 0 0 1 ${r * 0.84} 0`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
        />
        <line x1={0} y1={0} x2={0} y2={-r * 0.84} stroke={color} strokeWidth={thin} />
      </>
    )
  }

  if (kind === 'tablero') {
    const halfWidth = r * 0.81
    const height = r * 2
    return (
      <>
        <rect
          x={-halfWidth}
          y={-height}
          width={halfWidth * 2}
          height={height}
          fill={fill}
          stroke={color}
          strokeWidth={stroke}
        />
        <line x1={-halfWidth} y1={0} x2={halfWidth} y2={-height} stroke={color} strokeWidth={thin} />
      </>
    )
  }

  if (kind === 'puesta_tierra') {
    return (
      <>
        <line x1={0} y1={0} x2={0} y2={-r * 1.07} stroke={color} strokeWidth={stroke} />
        <line x1={-r * 0.71} y1={0} x2={r * 0.71} y2={0} stroke={color} strokeWidth={thin} />
        <line x1={-r * 0.47} y1={r * 0.33} x2={r * 0.47} y2={r * 0.33} stroke={color} strokeWidth={thin} />
        <line x1={-r * 0.22} y1={r * 0.67} x2={r * 0.22} y2={r * 0.67} stroke={color} strokeWidth={thin} />
      </>
    )
  }

  return <circle cx={0} cy={0} r={r} fill={fill} stroke={color} strokeWidth={stroke} />
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
          <g key={element.id} transform={`translate(${x} ${y}) rotate(${rotationFor(element, kind)})`}>
            <title>{title}</title>
            <SymbolGlyph kind={kind} r={r} color={color} stroke={stroke} />
            {element.source === 'chat' ? (
              <circle cx={r} cy={-r} r={Math.max(1.5, r * 0.2)} fill="#2563eb" />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
