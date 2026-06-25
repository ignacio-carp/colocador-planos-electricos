import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeRenderData } from './normalizeRenderData'
import {
  centerViewBoxOn,
  computeBBox,
  fitViewBoxFromBBox,
  isValidViewBox,
  labelFontSize,
  panViewBox,
  toSvgGeometry,
  usesCadYUp,
  zoomViewBox,
  type ViewBox,
} from './planViewerMath'

export type WallSegment = {
  inicio: { x: number; y: number }
  fin: { x: number; y: number }
}

export type TextLabel = {
  texto: string
  posicion: { x: number; y: number }
}

export type RoomVertex = { x: number; y: number }

export type Room = {
  id: string
  label: string
  room_type: string
  polygon: { vertices: RoomVertex[] }
  area_m2: number | null
}

export type ElectricalElement = {
  id: string
  room_id: string | null
  position: { x: number; y: number }
  outlet_type: string
  /** Vivienda ruleset element (centro, toma, llave, …); preferred over outlet_type for symbology. */
  element?: string | null
  catalog_sku: string | null
  source: string | null
  label: string | null
}

export type RenderData = {
  jobId: string
  status: string
  paredes: WallSegment[]
  etiquetas_texto: TextLabel[]
  rooms: Room[]
  coordinate_system: string | null
  scale: { pixels_per_meter?: number; known?: boolean } | null
  room_processing_state: Record<
    string,
    'pendiente' | 'procesando' | 'procesada' | 'error' | 'omitida'
  >
  electrical_elements?: ElectricalElement[]
  /** Radius of electrical symbols in DXF drawing units (~3 cm diameter). */
  electrical_symbol_radius_drawing_units?: number
}

type Props = {
  data: RenderData
  selectedRoomId?: string | null
  onRoomClick?: (roomId: string) => void
}

const ROOM_TYPE_COLORS: Record<string, string> = {
  living: '#d4edda',
  bedroom: '#cce5ff',
  kitchen: '#fff3cd',
  bathroom: '#d1ecf1',
  hallway: '#e2e3e5',
  office: '#f8d7da',
  storage: '#ffeeba',
  other: '#e9ecef',
  unknown: '#f8f9fa',
}

const ROOM_PROCESSING_COLORS: Record<string, string> = {
  pendiente: '#e9ecef',
  procesando: '#fff3cd',
  procesada: '#d4edda',
  error: '#f8d7da',
  omitida: '#e2e3e5',
}

const SELECTED_FILL = '#bfdbfe'
const SELECTED_STROKE = '#2563eb'
const DEFAULT_ROOM_STROKE = '#6b7280'

const ZOOM_FACTOR = 1.2

function roomFill(room: Room, processingState: Record<string, string>): string {
  const ps = processingState[room.id]
  if (ps) return ROOM_PROCESSING_COLORS[ps] ?? '#e9ecef'
  return ROOM_TYPE_COLORS[room.room_type] ?? '#e9ecef'
}

function polygonPoints(vertices: RoomVertex[]): string {
  return vertices.map((v) => `${v.x},${v.y}`).join(' ')
}

export default function PlanViewer2D({ data, selectedRoomId, onRoomClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewBox, setViewBox] = useState<ViewBox | null>(null)
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const cadYUp = usesCadYUp(data.coordinate_system)
  const normalized = useMemo(() => normalizeRenderData(data), [data])
  const sourceBBox = useMemo(() => computeBBox(normalized), [normalized])
  const renderGeometry = useMemo(() => {
    if (!sourceBBox) return normalized
    return toSvgGeometry(normalized, sourceBBox, cadYUp)
  }, [normalized, sourceBBox, cadYUp])
  const bbox = useMemo(() => computeBBox(renderGeometry), [renderGeometry])
  const bboxKey = bbox ? `${bbox.minX}:${bbox.minY}:${bbox.maxX}:${bbox.maxY}` : 'empty'

  const fitView = useCallback(() => {
    if (!bbox) return
    const next = fitViewBoxFromBBox(bbox)
    if (isValidViewBox(next)) setViewBox(next)
  }, [bbox])

  useEffect(() => {
    fitView()
  }, [data.jobId, bboxKey, fitView])

  useEffect(() => {
    if (!selectedRoomId) return
    const room = renderGeometry.rooms.find((r) => r.id === selectedRoomId)
    if (!room || !viewBox) return
    const verts = room.polygon.vertices
    const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
    const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
    setViewBox((prev) => (prev ? centerViewBoxOn(prev, cx, cy) : prev))
  }, [selectedRoomId, renderGeometry.rooms])

  const zoom = useCallback((delta: number, originX = 0.5, originY = 0.5) => {
    setViewBox((prev) => {
      if (!prev) return prev
      const factor = delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      return zoomViewBox(prev, factor, originX, originY)
    })
  }, [])

  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      zoomRef.current(
        -e.deltaY,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      )
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [bboxKey])

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setViewBox((prev) =>
      prev ? panViewBox(prev, dx, dy, rect.width, rect.height) : prev,
    )
  }

  function onPointerUp(e: React.PointerEvent) {
    dragging.current = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const hasWalls = renderGeometry.paredes.length > 0
  const hasRooms = renderGeometry.rooms.length > 0
  const hasData = hasWalls || hasRooms
  const fontSize = viewBox ? labelFontSize(viewBox) : 12
  const strokeScale = viewBox ? Math.max(viewBox.w / 400, 0.5) : 1

  if (!hasData) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
        <p className="text-body-sm text-on-surface-variant">
          Sin datos de geometría disponibles aún.
          <span className="mt-2 block text-technical-label text-outline">
            Paredes: {data.paredes.length} · Habitaciones: {data.rooms.length}
          </span>
        </p>
      </div>
    )
  }

  const viewBoxAttr = viewBox ? `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}` : undefined

  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Acercar"
          className="flex h-8 w-8 items-center justify-center rounded bg-surface-container-high text-on-surface shadow hover:bg-surface-container focus:outline-none"
          onClick={() => zoom(1)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Alejar"
          className="flex h-8 w-8 items-center justify-center rounded bg-surface-container-high text-on-surface shadow hover:bg-surface-container focus:outline-none"
          onClick={() => zoom(-1)}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Ajustar vista"
          className="flex h-8 w-8 items-center justify-center rounded bg-surface-container-high text-on-surface shadow hover:bg-surface-container focus:outline-none text-xs"
          onClick={fitView}
        >
          ⊡
        </button>
      </div>

      <div className="absolute bottom-3 left-3 z-10 rounded bg-surface-container-highest/80 px-3 py-2 text-technical-label text-on-surface-variant backdrop-blur-sm">
        {data.coordinate_system ? (
          <div className="mb-1 capitalize">{data.coordinate_system.replace(/_/g, ' ')}</div>
        ) : null}
        {data.scale?.known && data.scale.pixels_per_meter ? (
          <div>{data.scale.pixels_per_meter} px/m</div>
        ) : null}
        <div>
          {renderGeometry.paredes.length} paredes · {renderGeometry.rooms.length} hab.
        </div>
      </div>

      <div
        ref={containerRef}
        className="h-[480px] w-full cursor-grab active:cursor-grabbing select-none bg-white"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={viewBoxAttr}
          preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg"
        >
          {renderGeometry.rooms.map((room) => {
            const isSelected = room.id === selectedRoomId
            const fill = isSelected ? SELECTED_FILL : roomFill(room, data.room_processing_state)
            const stroke = isSelected ? SELECTED_STROKE : DEFAULT_ROOM_STROKE
            const centroidX =
              room.polygon.vertices.reduce((s, v) => s + v.x, 0) / room.polygon.vertices.length
            const centroidY =
              room.polygon.vertices.reduce((s, v) => s + v.y, 0) / room.polygon.vertices.length
            return (
              <g key={room.id}>
                <polygon
                  points={polygonPoints(room.polygon.vertices)}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={(isSelected ? 3 : 1.5) * strokeScale}
                  fillOpacity={0.65}
                  style={{ cursor: onRoomClick ? 'pointer' : 'default' }}
                  onClick={() => onRoomClick?.(room.id)}
                  role={onRoomClick ? 'button' : undefined}
                  aria-label={room.label}
                />
                <text
                  x={centroidX}
                  y={centroidY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill={isSelected ? '#1d4ed8' : '#374151'}
                  fontWeight={isSelected ? 'bold' : 'normal'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {room.label}
                </text>
              </g>
            )
          })}

          {renderGeometry.paredes.map((wall, i) => (
            <line
              key={i}
              x1={wall.inicio.x}
              y1={wall.inicio.y}
              x2={wall.fin.x}
              y2={wall.fin.y}
              stroke="#1f2937"
              strokeWidth={2 * strokeScale}
              strokeLinecap="round"
            />
          ))}

          {renderGeometry.etiquetas_texto.map((lbl, i) => (
            <text
              key={i}
              x={lbl.posicion.x}
              y={lbl.posicion.y}
              fontSize={fontSize}
              fill="#6b7280"
              textAnchor="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {lbl.texto}
            </text>
          ))}
        </svg>
      </div>
    </div>
  )
}
