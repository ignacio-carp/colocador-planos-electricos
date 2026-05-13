import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function Invites({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendInvite() {
    if (!session) return
    setPending(true)
    setError(null)
    setMessage(null)
    const res = await fetch(`${apiBase}/api/invites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'demo@example.com' }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    setMessage('Invitación simulada (stub).')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Invitaciones</h1>
        <button type="button" className="text-sm text-slate-900 underline" onClick={() => onNavigate('/dashboard')}>
          Volver
        </button>
      </div>
      {role === 'administrator' ? (
        <div className="rounded border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">Solo administrador puede invitar (US-001 negado para arquitecto).</p>
          <button
            type="button"
            disabled={pending}
            className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={sendInvite}
          >
            {pending ? 'Enviando…' : 'Enviar invitación (stub)'}
          </button>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          {message ? <p className="mt-2 text-sm text-green-700">{message}</p> : null}
        </div>
      ) : role === 'architect' ? (
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
          Como arquitecto no puedes invitar usuarios (US-001). La acción no está disponible en la API.
        </p>
      ) : (
        <p className="text-sm text-amber-800">Asigna rol en Supabase para esta vista.</p>
      )}
    </div>
  )
}
