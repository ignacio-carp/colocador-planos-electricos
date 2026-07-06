/**
 * US-013 — Workspace completion panel.
 *
 * "Marcar trabajo como procesado" when every room is procesada or omitida.
 * Per-room Procesar/Omitir live in RoomListSidebar (Capítulo 5).
 */

import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export type RoomProcessingStatus =
  | 'pendiente'
  | 'procesando'
  | 'procesada'
  | 'error'
  | 'omitida'

export type Room = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

export type RoomProcessingState = Record<string, RoomProcessingStatus>

export type RoomProcessingPanelProps = {
  jobId: string
  jobStatus: string
  rooms: Room[]
  roomProcessingState: RoomProcessingState
  normativeRulesEnabled: boolean
  accessToken: string
  onStateChange: () => void
}

export function canProcessRoom(status: RoomProcessingStatus): boolean {
  return status === 'pendiente' || status === 'procesada' || status === 'error'
}

export function canOmitRoom(status: RoomProcessingStatus): boolean {
  return status === 'pendiente'
}

export function RoomProcessingPanel({
  jobId,
  jobStatus,
  rooms,
  roomProcessingState,
  normativeRulesEnabled,
  accessToken,
  onStateChange,
}: RoomProcessingPanelProps) {
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRoomProcessingAllowed =
    jobStatus === 'listo_para_editar' || jobStatus === 'parcialmente_procesado'

  const canMarkComplete =
    isRoomProcessingAllowed &&
    rooms.length > 0 &&
    rooms.every((r) => {
      const id = r.id ?? ''
      const s = roomProcessingState[id] ?? 'pendiente'
      return s === 'procesada' || s === 'omitida'
    })

  const pendingCount = rooms.filter((r) => {
    const id = r.id ?? ''
    const s = roomProcessingState[id] ?? 'pendiente'
    return s === 'pendiente' || s === 'procesando' || s === 'error'
  }).length

  useEffect(() => {
    setError(null)
  }, [roomProcessingState])

  async function handleMarkComplete() {
    if (completing) return
    setError(null)
    setCompleting(true)
    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/mark-complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Error HTTP ${res.status}`)
        return
      }
      onStateChange()
    } catch {
      setError('Error de red al marcar como procesado.')
    } finally {
      setCompleting(false)
    }
  }

  if (!isRoomProcessingAllowed) return null

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-low/30 px-6 py-4">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-on-surface">
            <Icon name="task_alt" className="text-[20px] text-primary" />
            Cerrar trabajo
          </h3>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Procesá o omití cada habitación desde la lista lateral. Cuando todas estén listas, marcá el
            trabajo como procesado.
          </p>
        </div>
        {!normativeRulesEnabled ? (
          <span className="flex items-center gap-1 rounded-md bg-error-container px-3 py-1 text-body-sm text-on-error-container">
            <Icon name="info" className="text-[16px]" />
            Reglas normativas desactivadas — procesamiento vía chat
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 px-6 py-4">
        {pendingCount > 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            {pendingCount} habitación{pendingCount !== 1 ? 'es' : ''} pendiente
            {pendingCount !== 1 ? 's' : ''} de procesar u omitir.
          </p>
        ) : (
          <p className="text-body-sm text-success">Todas las habitaciones están procesadas u omitidas.</p>
        )}

        <button
          type="button"
          onClick={handleMarkComplete}
          disabled={!canMarkComplete || completing}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-success bg-success/10 px-4 py-2 text-body-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="check_circle" className="text-[16px]" />
          {completing ? 'Marcando…' : 'Marcar trabajo como procesado'}
        </button>
      </div>

      {error ? (
        <p className="mx-6 mb-4 rounded-lg border border-error-container bg-error-container/30 px-4 py-2 text-body-sm text-on-error-container">
          {error}
        </p>
      ) : null}
    </div>
  )
}
