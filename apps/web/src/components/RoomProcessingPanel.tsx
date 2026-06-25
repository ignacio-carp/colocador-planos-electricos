/**
 * US-013 — Room processing botonera.
 *
 * Allows an architect to select rooms and:
 *   - Procesar: runs US-008/US-009 incrementally for selected rooms.
 *   - Omitir: marks selected rooms as omitida.
 *   - Marcar procesado: closes the job (sets status = procesado).
 *
 * With normative_rules_enabled=false: shows informational banner — botonera blocked (use chat US-014).
 */

import React, { useCallback, useEffect, useState } from 'react'
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

type RoomProcessingResult = {
  room_id: string
  status: 'procesada' | 'error'
  outlets_added?: number
  error?: { code: string; message: string }
}

export type RoomProcessingPanelProps = {
  jobId: string
  jobStatus: string
  rooms: Room[]
  roomProcessingState: RoomProcessingState
  normativeRulesEnabled: boolean
  accessToken: string
  /** Called after any action succeeds; parent should refresh workspace. */
  onStateChange: () => void
}

function roomStatusBadge(status: RoomProcessingStatus): { label: string; className: string } {
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

function canSelectRoom(status: RoomProcessingStatus): boolean {
  return status === 'pendiente' || status === 'procesada' || status === 'error'
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [processingProgress, setProcessingProgress] = useState<string | null>(null)
  const [omitting, setOmitting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<RoomProcessingResult[]>([])
  const [optimisticState, setOptimisticState] = useState<RoomProcessingState>({})

  const effectiveState: RoomProcessingState = { ...roomProcessingState, ...optimisticState }

  const isRoomProcessingAllowed =
    jobStatus === 'listo_para_editar' || jobStatus === 'parcialmente_procesado'

  const canMarkComplete =
    isRoomProcessingAllowed &&
    rooms.length > 0 &&
    rooms.every((r) => {
      const id = r.id ?? ''
      const s = effectiveState[id] ?? 'pendiente'
      return s === 'procesada' || s === 'omitida'
    })

  // Reset optimistic state when real state updates from parent
  useEffect(() => {
    setOptimisticState({})
  }, [roomProcessingState])

  function toggleSelect(roomId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(roomId)) {
        next.delete(roomId)
      } else {
        next.add(roomId)
      }
      return next
    })
  }

  function toggleAll() {
    const selectable = rooms
      .filter((r) => r.id && canSelectRoom(effectiveState[r.id] ?? 'pendiente'))
      .map((r) => r.id as string)
    if (selectable.every((id) => selected.has(id))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable))
    }
  }

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Correlation-Id': crypto.randomUUID(),
    }),
    [accessToken],
  )

  async function pollUntilRoomsSettled(roomIds: string[], timeoutMs = 300_000): Promise<void> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        const body = (await res.json()) as {
          room_processing_state?: RoomProcessingState
        }
        const state = body.room_processing_state ?? {}
        const stillProcessing = roomIds.some((id) => state[id] === 'procesando')
        const doneCount = roomIds.filter(
          (id) => state[id] === 'procesada' || state[id] === 'error',
        ).length
        setProcessingProgress(`Procesando habitaciones (${doneCount}/${roomIds.length})…`)
        if (!stillProcessing) return
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('Tiempo de espera agotado al procesar habitaciones.')
  }

  async function handleProcess() {
    if (selected.size === 0 || processing) return
    setError(null)
    setResults([])
    const roomIds = [...selected]

    // Optimistic: mark selected as procesando
    const optimistic: RoomProcessingState = {}
    for (const id of roomIds) optimistic[id] = 'procesando'
    setOptimisticState(optimistic)
    setSelected(new Set())
    setProcessing(true)
    setProcessingProgress(`Procesando habitaciones (0/${roomIds.length})…`)

    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/process-rooms`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ room_ids: roomIds, idempotency_key: crypto.randomUUID() }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        rooms?: RoomProcessingResult[]
        error?: string
        code?: string
        queued?: boolean
      }
      if (!res.ok) {
        if (body.code === 'NORMATIVE_RULES_DISABLED') {
          setError('Las reglas normativas están desactivadas. Usá el chat (próximamente) para procesar habitaciones.')
        } else {
          setError(body.error ?? `Error HTTP ${res.status}`)
        }
        return
      }
      if (res.status === 202 || body.queued) {
        await pollUntilRoomsSettled(roomIds)
        onStateChange()
        return
      }
      setResults(body.rooms ?? [])
      onStateChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red al procesar habitaciones.')
    } finally {
      setProcessing(false)
      setProcessingProgress(null)
      setOptimisticState({})
    }
  }

  async function handleOmit() {
    if (selected.size === 0 || omitting) return
    setError(null)
    const roomIds = [...selected]
    setOmitting(true)
    setSelected(new Set())

    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/omit-rooms`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ room_ids: roomIds }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Error HTTP ${res.status}`)
        return
      }
      onStateChange()
    } catch {
      setError('Error de red al omitir habitaciones.')
    } finally {
      setOmitting(false)
    }
  }

  async function handleMarkComplete() {
    if (completing) return
    setError(null)
    setCompleting(true)
    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/mark-complete`, {
        method: 'POST',
        headers: authHeaders(),
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

  const selectableRooms = rooms.filter(
    (r) => r.id && canSelectRoom(effectiveState[r.id] ?? 'pendiente'),
  )
  const allSelected =
    selectableRooms.length > 0 && selectableRooms.every((r) => selected.has(r.id ?? ''))

  const anyProcessing = rooms.some((r) => r.id && effectiveState[r.id] === 'procesando')

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-low/30 px-6 py-4">
        <h3 className="flex items-center gap-2 font-bold text-on-surface">
          <Icon name="bolt" className="text-[20px] text-primary" />
          Procesar habitaciones
        </h3>
        {!normativeRulesEnabled ? (
          <span className="flex items-center gap-1 rounded-md bg-error-container px-3 py-1 text-body-sm text-on-error-container">
            <Icon name="info" className="text-[16px]" />
            Reglas normativas desactivadas — procesamiento disponible solo vía chat (US-014)
          </span>
        ) : null}
      </div>

      {/* Room list */}
      <div className="px-6 py-4">
        {rooms.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No se detectaron habitaciones.</p>
        ) : (
          <>
            {/* Select-all + action bar */}
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableRooms.length === 0 || !normativeRulesEnabled}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-outline text-primary focus:ring-primary disabled:opacity-40"
                />
                <span className="text-body-sm text-on-surface-variant">
                  {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </span>
              </label>
              <span className="text-body-sm text-outline">
                {selected.size > 0 ? `${selected.size} seleccionada${selected.size !== 1 ? 's' : ''}` : ''}
              </span>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room, i) => {
                const roomId = room.id ?? `room-${i}`
                const status = effectiveState[roomId] ?? 'pendiente'
                const badge = roomStatusBadge(status)
                const selectable = canSelectRoom(status) && normativeRulesEnabled
                const isChecked = selected.has(roomId)
                const isProcessing = status === 'procesando'

                return (
                  <label
                    key={roomId}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${isChecked ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-low'} ${!selectable ? 'cursor-default opacity-70' : 'hover:border-primary/50'}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!selectable}
                      onChange={() => selectable && toggleSelect(roomId)}
                      className="mt-1 h-4 w-4 rounded border-outline text-primary focus:ring-primary disabled:opacity-40"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-on-surface">
                            {room.label ?? roomId}
                          </p>
                          <p className="text-technical-label text-outline uppercase">
                            {room.room_type ?? '—'}
                            {room.area_m2 ? ` · ${room.area_m2} m²` : ''}
                          </p>
                        </div>
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-technical-label font-semibold uppercase ${badge.className}`}
                        >
                          {isProcessing ? (
                            <span className="flex items-center gap-1">
                              <svg
                                className="h-3 w-3 animate-spin"
                                fill="none"
                                viewBox="0 0 24 24"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                />
                              </svg>
                              {badge.label}
                            </span>
                          ) : (
                            badge.label
                          )}
                        </span>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>
          </>
        )}

        {processingProgress ? (
          <p className="text-body-sm text-on-surface-variant">{processingProgress}</p>
        ) : null}

        {/* Action buttons */}
        {normativeRulesEnabled && isRoomProcessingAllowed ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleProcess}
              disabled={selected.size === 0 || processing || anyProcessing}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processing ? (
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : (
                <Icon name="bolt" className="text-[16px]" />
              )}
              Procesar
            </button>

            <button
              type="button"
              onClick={handleOmit}
              disabled={selected.size === 0 || omitting || processing}
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="block" className="text-[16px]" />
              Omitir
            </button>

            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={!canMarkComplete || completing || processing}
              className="ml-auto inline-flex items-center gap-2 rounded-lg border border-success bg-success/10 px-4 py-2 text-body-sm font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="check_circle" className="text-[16px]" />
              {completing ? 'Marcando…' : 'Marcar trabajo como procesado'}
            </button>
          </div>
        ) : null}

        {/* Error */}
        {error ? (
          <p className="mt-3 rounded-lg border border-error-container bg-error-container/30 px-4 py-2 text-body-sm text-on-error-container">
            {error}
          </p>
        ) : null}

        {/* Results summary */}
        {results.length > 0 ? (
          <div className="mt-3 rounded-lg border border-outline-variant bg-surface-container-low p-4">
            <p className="mb-2 text-body-sm font-semibold text-on-surface">Resultado del procesamiento:</p>
            <ul className="space-y-1">
              {results.map((r) => (
                <li key={r.room_id} className="flex items-center gap-2 text-body-sm">
                  {r.status === 'procesada' ? (
                    <Icon name="check_circle" className="text-[14px] text-success" />
                  ) : (
                    <Icon name="error" className="text-[14px] text-error" />
                  )}
                  <span className="text-on-surface">
                    {r.room_id}
                    {r.status === 'procesada' && r.outlets_added != null
                      ? ` — ${r.outlets_added} toma${r.outlets_added !== 1 ? 's' : ''}`
                      : ''}
                    {r.status === 'error' && r.error ? ` — ${r.error.message}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
