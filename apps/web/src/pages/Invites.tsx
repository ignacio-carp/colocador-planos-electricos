import React, { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function Invites({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function sendInvite() {
    if (!session) return
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Indica un correo electrónico.')
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    const res = await fetch(`${apiBase}/api/invites`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: trimmed }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      code?: string
      invitationId?: string
    }
    setPending(false)
    if (res.status === 409 && body.code === 'INVITE_PENDING') {
      setError(body.error ?? 'Ya hay una invitación pendiente para este correo.')
      return
    }
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    setEmail('')
    setMessage(
      body.invitationId
        ? `Invitación enviada (id ${body.invitationId}). El arquitecto recibirá el correo de Supabase con el enlace.`
        : 'Invitación enviada. El arquitecto recibirá el correo de Supabase con el enlace.',
    )
  }

  return (
    <AppShell activeNav="invites" onNavigate={onNavigate} headerTitle="Invitaciones">
      <div className="mx-auto max-w-xl">
        {role === 'administrator' ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
            <h1 className="text-headline-md text-primary">Invitar arquitecto</h1>
            <p className="text-body-sm mt-2 text-on-surface-variant">
              Solo el administrador puede enviar invitaciones (US-001). El correo lo envía Supabase Auth.
            </p>
            <label className="mt-6 block space-y-2" htmlFor="invite-email">
              <span className="text-button text-on-surface">Correo del arquitecto</span>
              <input
                id="invite-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-4"
                placeholder="nombre@ejemplo.com"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              className="btn-primary mt-6"
              onClick={() => void sendInvite()}
            >
              {pending ? 'Enviando…' : 'Enviar invitación'}
            </button>
            {error ? (
              <p className="mt-4 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-body-sm text-success">
                {message}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            No tenés permisos para esta sección.
          </p>
        )}
      </div>
    </AppShell>
  )
}
