import React from 'react'
import { Icon } from './Icon'
import type { RoomProcessingState, RoomProcessingStatus } from './RoomProcessingPanel'

export type WorkspaceRoom = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

export function canProcessRoom(status: RoomProcessingStatus): boolean {
  return status === 'pendiente' || status === 'procesada' || status === 'error'
}

export function canOmitRoom(status: RoomProcessingStatus): boolean {
  return status === 'pendiente'
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'procesada':
      return { label: 'Procesada', className: 'bg-success/15 text-success' }
    case 'procesando':
      return { label: 'Procesando…', className: 'bg-secondary-container text-on-secondary-container' }
    case 'error':
      return { label: 'Error', className: 'bg-error-container text-on-error-container' }
    case 'omitida':
      return { label: 'Omitida', className: 'bg-surface-container-high text-outline' }
    default:
      return { label: 'Pendiente', className: 'bg-surface-container text-on-surface-variant' }
  }
}

type Props = {
  rooms: WorkspaceRoom[]
  roomProcessingState: RoomProcessingState
  selectedRoomId: string | null
  onSelectRoom: (roomId: string) => void
  completedAt?: string | null
  normativeRulesEnabled?: boolean
  processingRoomId?: string | null
  onProcessRoom?: (roomId: string) => void
  onOmitRoom?: (roomId: string) => void
  omittingRoomId?: string | null
}

export default function RoomListSidebar({
  rooms,
  roomProcessingState,
  selectedRoomId,
  onSelectRoom,
  completedAt,
  normativeRulesEnabled = true,
  processingRoomId = null,
  onProcessRoom,
  onOmitRoom,
  omittingRoomId = null,
}: Props) {
  const selectedStatus = selectedRoomId
    ? (roomProcessingState[selectedRoomId] ?? 'pendiente')
    : null
  const showActions =
    Boolean(selectedRoomId) &&
    normativeRulesEnabled &&
    selectedStatus !== 'procesando' &&
    selectedStatus !== 'omitida'

  return (
    <aside className="flex max-h-[min(72vh,720px)] min-h-[480px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="border-b border-outline-variant bg-surface-container-low/30 px-3 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface">
          <Icon name="home_work" className="text-[18px] text-primary" />
          Habitaciones
        </h3>
        <p className="text-technical-label mt-1 text-outline">
          {rooms.length === 0
            ? 'Sin ambientes detectados'
            : `${rooms.length} detectada${rooms.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {rooms.length === 0 ? (
          <p className="px-2 py-4 text-body-sm text-on-surface-variant">
            Seleccioná un área en el visor o usá el chat para trabajar manualmente.
          </p>
        ) : (
          <ul className="space-y-1">
            {rooms.map((room, i) => {
              const roomId = room.id ?? `room-${i}`
              const isSelected = selectedRoomId === roomId
              const status = roomProcessingState[roomId] ?? 'pendiente'
              const badge = statusBadge(status)
              const isProcessing = processingRoomId === roomId || status === 'procesando'
              return (
                <li key={roomId}>
                  <button
                    type="button"
                    onClick={() => onSelectRoom(roomId)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary-fixed/30'
                        : 'border-transparent bg-surface-container-low hover:border-outline-variant'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-on-surface">
                          {room.label ?? roomId}
                        </p>
                        <p className="text-technical-label truncate text-outline uppercase">
                          {room.room_type ?? '—'}
                          {room.area_m2 ? ` · ${room.area_m2} m²` : ''}
                        </p>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.className}`}
                      >
                        {isProcessing ? 'Procesando…' : badge.label}
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {showActions && selectedRoomId && selectedStatus ? (
        <div className="space-y-2 border-t border-outline-variant p-3">
          {canProcessRoom(selectedStatus) && onProcessRoom ? (
            <button
              type="button"
              onClick={() => onProcessRoom(selectedRoomId)}
              disabled={Boolean(processingRoomId)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="bolt" className="text-[16px]" />
              {selectedStatus === 'procesada' || selectedStatus === 'error'
                ? 'Reprocesar'
                : 'Procesar'}
            </button>
          ) : null}
          {canOmitRoom(selectedStatus) && onOmitRoom ? (
            <button
              type="button"
              onClick={() => onOmitRoom(selectedRoomId)}
              disabled={Boolean(omittingRoomId) || Boolean(processingRoomId)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="block" className="text-[16px]" />
              Omitir
            </button>
          ) : null}
        </div>
      ) : null}

      {!normativeRulesEnabled ? (
        <p className="border-t border-outline-variant px-3 py-2 text-technical-label text-on-surface-variant">
          Reglas normativas desactivadas — procesá vía chat.
        </p>
      ) : null}

      {completedAt ? (
        <p className="border-t border-outline-variant px-3 py-2 text-technical-label text-outline">
          Análisis:{' '}
          {new Intl.DateTimeFormat('es', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(completedAt))}
        </p>
      ) : null}
    </aside>
  )
}
