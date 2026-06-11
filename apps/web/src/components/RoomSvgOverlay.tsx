import React, { useMemo } from 'react'
import { worldToScreen, type ViewTransform } from '@cadview/core'
import type { Room } from './PlanViewer2D'

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

const SELECTED_FILL = 'rgba(191, 219, 254, 0.55)'
const SELECTED_STROKE = '#2563eb'
const DEFAULT_STROKE = '#6b7280'

type Props = {
  rooms: Room[]
  viewTransform: ViewTransform | null
  width: number
  height: number
  selectedRoomId?: string | null
  roomProcessingState: Record<string, string>
  onRoomClick?: (roomId: string) => void
}

function projectPoint(
  x: number,
  y: number,
  vt: ViewTransform,
): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const [sx, sy] = worldToScreen(vt, x, y)
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null
  return { x: sx, y: sy }
}

export default function RoomSvgOverlay({
  rooms,
  viewTransform,
  width,
  height,
  selectedRoomId,
  roomProcessingState,
  onRoomClick,
}: Props) {
  const projected = useMemo(() => {
    if (!viewTransform || width <= 0 || height <= 0) return []
    return rooms
      .map((room) => {
        const points = room.polygon.vertices
          .map((v) => projectPoint(v.x, v.y, viewTransform))
          .filter((p): p is { x: number; y: number } => p !== null)
        if (points.length < 3) return null
        const centroid = points.reduce(
          (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
          { x: 0, y: 0 },
        )
        return {
          room,
          points,
          centroid: { x: centroid.x / points.length, y: centroid.y / points.length },
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
  }, [rooms, viewTransform, width, height])

  if (!viewTransform || projected.length === 0) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {projected.map(({ room, points, centroid }) => {
        const isSelected = room.id === selectedRoomId
        const fill =
          isSelected
            ? SELECTED_FILL
            : `${ROOM_TYPE_COLORS[room.room_type] ?? '#e9ecef'}aa`
        const stroke = isSelected ? SELECTED_STROKE : DEFAULT_STROKE
        const poly = points.map((p) => `${p.x},${p.y}`).join(' ')
        return (
          <g key={room.id} className="pointer-events-auto">
            <polygon
              points={poly}
              fill={fill}
              stroke={stroke}
              strokeWidth={isSelected ? 2.5 : 1.5}
              style={{ cursor: onRoomClick ? 'pointer' : 'default' }}
              onClick={() => onRoomClick?.(room.id)}
            />
            <text
              x={centroid.x}
              y={centroid.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={12}
              fill={isSelected ? '#1d4ed8' : '#374151'}
              fontWeight={isSelected ? 'bold' : 'normal'}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {room.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
