import React, { useEffect, useState } from 'react'
import { Icon } from './Icon'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Props = {
  jobId: string
  roomId: string
  roomLabel: string
  isReprocess: boolean
  accessToken: string
  open: boolean
  onClose: () => void
  onConfirm: (instruction: string) => void
}

export default function RoomProcessingInstructionModal({
  jobId,
  roomId,
  roomLabel,
  isReprocess,
  accessToken,
  open,
  onClose,
  onConfirm,
}: Props) {
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/rooms/${encodeURIComponent(roomId)}/processing-instruction`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        const body = (await res.json().catch(() => ({}))) as {
          instruction?: string
          error?: string
        }
        if (cancelled) return
        if (!res.ok) {
          setError(body.error ?? `Error HTTP ${res.status}`)
          setInstruction('')
          return
        }
        setInstruction(body.instruction ?? '')
      } catch {
        if (!cancelled) setError('No se pudo cargar la instrucción predeterminada.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, jobId, roomId, accessToken])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-process-instruction-title"
    >
      <div className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg">
        <div className="border-b border-outline-variant px-5 py-4">
          <h2
            id="room-process-instruction-title"
            className="flex items-center gap-2 text-lg font-bold text-on-surface"
          >
            <Icon name="bolt" className="text-[22px] text-primary" />
            {isReprocess ? 'Reprocesar' : 'Procesar'} — {roomLabel}
          </h2>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Revisá y editá la instrucción que recibirá la IA junto con la captura del visor.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-body-sm text-on-surface-variant">Cargando instrucción…</p>
          ) : (
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={14}
              className="w-full resize-y rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              spellCheck={false}
            />
          )}
          {error ? (
            <p className="mt-2 rounded-lg border border-error-container bg-error-container/30 px-3 py-2 text-body-sm text-on-error-container">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-outline-variant px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2 text-body-sm font-semibold text-on-surface-variant hover:bg-surface-container"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading || !instruction.trim()}
            onClick={() => onConfirm(instruction.trim())}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-body-sm font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="send" className="text-[16px]" />
            Enviar a procesar
          </button>
        </div>
      </div>
    </div>
  )
}
