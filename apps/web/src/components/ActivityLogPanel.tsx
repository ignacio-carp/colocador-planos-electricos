/**
 * Activity/log panel — surfaces job processing events to the owner/admin so
 * they can monitor failures and progress without opening backend logs.
 *
 * Data is derived from information the workspace endpoint already exposes
 * (room_processing_runs, room_processing_state, preliminary analysis) plus the
 * job-level error. No new backend infrastructure is required.
 *
 * Collapsed by default (minified); expand to see the full timeline.
 */

import React, { useMemo, useState } from 'react'
import { Icon } from './Icon'
import type { RoomProcessingState } from './RoomProcessingPanel'

export type RoomProcessingRun = {
  room_id: string
  correlation_id: string
  rules_version?: string
  started_at: string
  completed_at?: string
  outlet_count?: number
  error?: { code: string; message: string; correlation_id?: string }
}

type Room = {
  id?: string
  label?: string
}

type JobError = {
  code: string
  message: string
  correlation_id: string
}

type LogLevel = 'info' | 'success' | 'warn' | 'error'

export type ActivityLogEntry = {
  id: string
  level: LogLevel
  timestamp: string | null
  title: string
  detail?: string
  correlationId?: string
}

export type ActivityLogPanelProps = {
  rooms: Room[]
  roomProcessingRuns: RoomProcessingRun[]
  roomProcessingState: RoomProcessingState
  preliminaryAnalysisCompletedAt?: string | null
  jobError?: JobError | null
  /** Expanded on first render when true (default: collapsed/minified). */
  defaultOpen?: boolean
  onRefresh?: () => void
}

const LEVEL_META: Record<LogLevel, { icon: string; className: string; label: string }> = {
  info: { icon: 'info', className: 'text-on-surface-variant', label: 'Info' },
  success: { icon: 'check_circle', className: 'text-success', label: 'OK' },
  warn: { icon: 'warning', className: 'text-brand-red', label: 'Aviso' },
  error: { icon: 'error', className: 'text-on-error-container', label: 'Error' },
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

function buildEntries(props: ActivityLogPanelProps): ActivityLogEntry[] {
  const labelById = new Map<string, string>()
  for (const room of props.rooms) {
    if (room.id) labelById.set(room.id, room.label ?? room.id)
  }
  const roomLabel = (id: string) => labelById.get(id) ?? id

  const entries: ActivityLogEntry[] = []

  if (props.preliminaryAnalysisCompletedAt) {
    entries.push({
      id: `preliminary-${props.preliminaryAnalysisCompletedAt}`,
      level: 'success',
      timestamp: props.preliminaryAnalysisCompletedAt,
      title: 'Análisis preliminar completado',
      detail: `${props.rooms.length} habitación${props.rooms.length !== 1 ? 'es' : ''} detectada${props.rooms.length !== 1 ? 's' : ''}.`,
    })
  }

  for (const run of props.roomProcessingRuns) {
    const when = run.completed_at ?? run.started_at
    if (run.error) {
      entries.push({
        id: `run-${run.room_id}-${when}-error`,
        level: 'error',
        timestamp: when,
        title: `Falló el procesamiento de "${roomLabel(run.room_id)}"`,
        detail: `${run.error.message || run.error.code} (${run.error.code})`,
        correlationId: run.error.correlation_id ?? run.correlation_id,
      })
    } else {
      const outlets = run.outlet_count ?? 0
      entries.push({
        id: `run-${run.room_id}-${when}-ok`,
        level: 'success',
        timestamp: when,
        title: `Habitación "${roomLabel(run.room_id)}" procesada`,
        detail: `${outlets} elemento${outlets !== 1 ? 's' : ''} aplicado${outlets !== 1 ? 's' : ''}${run.rules_version ? ` · reglas v${run.rules_version}` : ''}.`,
        correlationId: run.correlation_id,
      })
    }
  }

  // Rooms currently in progress (no completed run yet).
  for (const [roomId, status] of Object.entries(props.roomProcessingState ?? {})) {
    if (status === 'procesando') {
      entries.push({
        id: `state-${roomId}-procesando`,
        level: 'info',
        timestamp: null,
        title: `Procesando "${roomLabel(roomId)}"…`,
      })
    }
  }

  if (props.jobError) {
    entries.push({
      id: `job-error-${props.jobError.correlation_id}`,
      level: 'error',
      timestamp: null,
      title: 'El procesamiento del plano falló',
      detail: props.jobError.message || props.jobError.code,
      correlationId: props.jobError.correlation_id,
    })
  }

  // Newest first; entries without timestamp (in-progress / job error) float to top.
  return entries.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0
    if (!a.timestamp) return -1
    if (!b.timestamp) return 1
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })
}

export function ActivityLogPanel(props: ActivityLogPanelProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const entries = useMemo(() => buildEntries(props), [props])

  const errorCount = entries.filter((e) => e.level === 'error').length
  const inProgressCount = entries.filter((e) => e.level === 'info' && !e.timestamp).length

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low/30 px-4 py-3 text-left hover:bg-surface-container-low/50"
      >
        <span className="flex items-center gap-2 font-bold text-on-surface">
          <Icon name="receipt_long" className="text-[20px] text-primary" />
          Registro de actividad
          <span className="text-technical-label font-normal text-on-surface-variant uppercase">
            — {entries.length} evento{entries.length !== 1 ? 's' : ''}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {errorCount > 0 ? (
            <span className="rounded-full bg-error-container px-2 py-0.5 text-[10px] font-semibold text-on-error-container uppercase">
              {errorCount} error{errorCount !== 1 ? 'es' : ''}
            </span>
          ) : null}
          {inProgressCount > 0 ? (
            <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold text-on-secondary-container uppercase">
              {inProgressCount} en curso
            </span>
          ) : null}
          <Icon
            name={open ? 'expand_less' : 'expand_more'}
            className="text-[20px] text-on-surface-variant"
          />
        </span>
      </button>

      {open ? (
        <div className="px-4 py-3">
          {props.onRefresh ? (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                className="btn-secondary-outline text-xs"
                onClick={() => props.onRefresh?.()}
              >
                <Icon name="refresh" className="mr-1 text-[16px]" />
                Refrescar
              </button>
            </div>
          ) : null}

          {entries.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">
              Todavía no hay actividad registrada. Los eventos de procesamiento y
              los errores van a aparecer acá.
            </p>
          ) : (
            <ul className="space-y-2">
              {entries.map((entry) => {
                const meta = LEVEL_META[entry.level]
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2"
                  >
                    <Icon name={meta.icon} className={`mt-0.5 text-[18px] ${meta.className}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-body-sm font-semibold text-on-surface">{entry.title}</p>
                        <span className="text-technical-label text-outline">
                          {formatTime(entry.timestamp)}
                        </span>
                      </div>
                      {entry.detail ? (
                        <p className="text-body-sm text-on-surface-variant">{entry.detail}</p>
                      ) : null}
                      {entry.correlationId ? (
                        <p className="text-technical-label mt-0.5 text-outline">
                          ID soporte: {entry.correlationId}
                        </p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default ActivityLogPanel
