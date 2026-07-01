import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  intent?: 'query' | 'edit' | 'action'
  created_at: string
}

type ChatResponse = {
  reply?: string
  intent?: string
  mutations_applied?: unknown[]
  process_result?: unknown
  messages?: ChatMessage[]
  error?: string
}

type Props = {
  jobId: string
  apiBase: string
  accessToken: string
  /** Returns a PNG data URL of the current rendered viewport, or null. */
  captureView?: (() => string | null) | null
  /** Chat input disabled (e.g. admin read-only or wrong job status). */
  canSend: boolean
  /** Called after the assistant applied mutations or processed rooms. */
  onWorkspaceMutated?: () => void
}

/**
 * US-014 — AI chat next to the plan viewer. On send, the current rendered
 * view is captured (screenshot) and attached as visual reference for the AI.
 */
export default function WorkspaceChatPanel({
  jobId,
  apiBase,
  accessToken,
  captureView,
  canSend,
  onWorkspaceMutated,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/chat`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!res.ok) return
      const body = (await res.json()) as { messages?: ChatMessage[] }
      setMessages(body.messages ?? [])
    } catch {
      // history is not critical — keep panel usable
    }
  }, [apiBase, jobId, accessToken])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  async function send() {
    const message = input.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    setInput('')

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const viewportImage = captureView?.() ?? null
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/chat`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            ...(viewportImage ? { viewport_image: viewportImage } : {}),
          }),
        },
      )
      const body = (await res.json().catch(() => ({}))) as ChatResponse
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setInput(message)
        return
      }
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimistic.id),
          ...body.messages!,
        ])
      }
      const mutated =
        (Array.isArray(body.mutations_applied) && body.mutations_applied.length > 0) ||
        Boolean(body.process_result)
      if (mutated) onWorkspaceMutated?.()
    } catch {
      setError('Error de red al enviar el mensaje.')
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setInput(message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-[480px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
      <div className="flex items-center gap-2 border-b border-outline-variant bg-surface-container-low/30 px-4 py-3">
        <Icon name="smart_toy" className="text-[20px] text-primary" />
        <h3 className="font-bold text-on-surface">Asistente eléctrico</h3>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Chateá conmigo sobre el plano: habitaciones detectadas, tomas propuestas,
            estado de procesamiento o el catálogo eléctrico. También podés pedirme
            cambios («agregá una toma doble en la cocina») o procesar habitaciones
            («procesá el baño»). Al enviar, adjunto una captura de la vista actual.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-body-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-primary text-on-primary'
                    : 'border border-outline-variant bg-surface-container-low text-on-surface'
                }`}
              >
                {m.content}
                {m.role === 'assistant' && m.intent && m.intent !== 'query' ? (
                  <span className="mt-1 block text-technical-label uppercase opacity-70">
                    {m.intent === 'edit' ? 'Capa eléctrica actualizada' : 'Procesamiento ejecutado'}
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
        {sending ? (
          <div className="flex items-center gap-2 text-body-sm text-on-surface-variant">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            La IA está trabajando…
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-outline-variant bg-error-container px-4 py-2 text-body-sm text-on-error-container" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-outline-variant px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={
            canSend
              ? 'Preguntá sobre el plano o pedí un cambio…'
              : 'Chat disponible solo para el arquitecto dueño del proyecto.'
          }
          disabled={!canSend || sending}
          className="flex-1 resize-none rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-sm text-on-surface placeholder:text-outline focus:border-primary focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend || sending || input.trim().length === 0}
          className="btn-primary px-4 py-2"
          aria-label="Enviar mensaje"
        >
          <Icon name="send" className="text-[18px]" />
        </button>
      </form>
    </div>
  )
}
