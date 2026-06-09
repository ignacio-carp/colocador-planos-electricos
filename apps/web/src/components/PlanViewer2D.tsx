import React, { useCallback, useEffect, useRef, useState } from 'react'

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

export type RenderData = {
  jobId: string
  status: string
  paredes: WallSegment[]
  etiquetas_texto: TextLabel[]
  rooms: Room[]
  coordinate_system: string | null
  scale: { pixels_per_meter?: number; known?: boolean } | null
  room_processing_state: Record<string, 'pendiente' | 'procesando' | 'procesado'>
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
  procesado: '#d4edda',
}

const SELECTED_FILL = '#bfdbfe'
const SELECTED_STROKE = '#2563eb'
const DEFAULT_ROOM_STROKE = '#6b7280'

const ZOOM_FACTOR = 1.2
const MIN_ZOOM = 0.05
const MAX_ZOOM = 50

/** Compute axis-aligned bounding box of all renderable coordinates. */
function computeBBox(data: RenderData): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  for (const w of data.paredes) {
    xs.push(w.inicio.x, w.fin.x)
    ys.push(w.inicio.y, w.fin.y)
  }
  for (const lbl of data.etiquetas_texto) {
    xs.push(lbl.posicion.x)
    ys.push(lbl.posicion.y)
  }
  for (const room of data.rooms) {
    for (const v of room.polygon.vertices) {
      xs.push(v.x)
      ys.push(v.y)
    }
  }
  if (xs.length === 0) return null
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

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
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [initialized, setInitialized] = useState(false)
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const bbox = computeBBox(data)

  /** Fit bbox into container on first render or data change. */
  const fitView = useCallback(() => {
    if (!containerRef.current || !bbox) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    if (width === 0 || height === 0) return
    const pad = 40
    const bw = bbox.maxX - bbox.minX || 1
    const bh = bbox.maxY - bbox.minY || 1
    const scaleX = (width - pad * 2) / bw
    const scaleY = (height - pad * 2) / bh
    const scale = Math.min(scaleX, scaleY, MAX_ZOOM)
    const tx = (width - bw * scale) / 2 - bbox.minX * scale
    const ty = (height - bh * scale) / 2 - bbox.minY * scale
    setTransform({ x: tx, y: ty, scale })
    setInitialized(true)
  }, [bbox])

  useEffect(() => {
    fitView()
  }, [fitView])

  /** Center on selected room when selectedRoomId changes. */
  useEffect(() => {
    if (!selectedRoomId || !containerRef.current) return
    const room = data.rooms.find((r) => r.id === selectedRoomId)
    if (!room) return
    const verts = room.polygon.vertices
    const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
    const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
    const { width, height } = containerRef.current.getBoundingClientRect()
    setTransform((prev) => ({
      ...prev,
      x: width / 2 - cx * prev.scale,
      y: height / 2 - cy * prev.scale,
    }))
  }, [selectedRoomId, data.rooms])

  function zoom(delta: number, originX?: number, originY?: number) {
    setTransform((prev) => {
      const factor = delta > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * factor))
      const ox = originX ?? (containerRef.current?.getBoundingClientRect().width ?? 0) / 2
      const oy = originY ?? (containerRef.current?.getBoundingClientRect().height ?? 0) / 2
      return {
        scale: newScale,
        x: ox - (ox - prev.x) * (newScale / prev.scale),
        y: oy - (oy - prev.y) * (newScale / prev.scale),
      }
    })
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    zoom(-e.deltaY, e.clientX - rect.left, e.clientY - rect.top)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }))
  }

  function onPointerUp(e: React.PointerEvent) {
    dragging.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const hasWalls = data.paredes.length > 0
  const hasRooms = data.rooms.length > 0
  const hasData = hasWalls || hasRooms

  if (!hasData) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center">
        <p className="text-body-sm text-on-surface-variant">
          Sin datos de geometría disponibles aún.
        </p>
      </div>
    )
  }

  const svgTransform = `translate(${transform.x}, ${transform.y}) scale(${transform.scale})`

  return (
    <div className="relative overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      {/* Toolbar */}
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

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 rounded bg-surface-container-highest/80 px-3 py-2 text-technical-label text-on-surface-variant backdrop-blur-sm">
        {data.coordinate_system ? (
          <div className="mb-1 capitalize">{data.coordinate_system.replace(/_/g, ' ')}</div>
        ) : null}
        {data.scale?.known && data.scale.pixels_per_meter ? (
          <div>{data.scale.pixels_per_meter} px/m</div>
        ) : null}
        {!initialized ? <div>Calculando vista…</div> : null}
      </div>

      {/* SVG canvas */}
      <div
        ref={containerRef}
        className="h-[480px] w-full cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <g transform={svgTransform}>
            {/* Room polygons (drawn before walls so walls appear on top) */}
            {data.rooms.map((room) => {
              const isSelected = room.id === selectedRoomId
              const fill = isSelected ? SELECTED_FILL : roomFill(room, data.room_processing_state)
              const stroke = isSelected ? SELECTED_STROKE : DEFAULT_ROOM_STROKE
              const strokeWidth = isSelected ? 3 / transform.scale : 1.5 / transform.scale
              const centroidX =
                room.polygon.vertices.reduce((s, v) => s + v.x, 0) / room.polygon.vertices.length
              const centroidY =
                room.polygon.vertices.reduce((s, v) => s + v.y, 0) / room.polygon.vertices.length
              const fontSize = Math.max(8 / transform.scale, 80)
              return (
                <g key={room.id}>
                  <polygon
                    points={polygonPoints(room.polygon.vertices)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
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

            {/* Wall segments */}
            {data.paredes.map((wall, i) => (
              <line
                key={i}
                x1={wall.inicio.x}
                y1={wall.inicio.y}
                x2={wall.fin.x}
                y2={wall.fin.y}
                stroke="#1f2937"
                strokeWidth={Math.max(2 / transform.scale, 20)}
                strokeLinecap="round"
              />
            ))}

            {/* Text labels */}
            {data.etiquetas_texto.map((lbl, i) => {
              const fontSize = Math.max(8 / transform.scale, 60)
              return (
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
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
