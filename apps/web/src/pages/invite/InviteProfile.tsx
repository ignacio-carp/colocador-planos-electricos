import React, { useEffect, useState } from 'react'
import { AuthShell } from '../../components/AuthShell'
import { Icon } from '../../components/Icon'
import { useInviteOnboarding } from '../../context/InviteOnboardingContext'
import { INVITE_LANDING_PATH, INVITE_SET_PASSWORD_PATH } from '../../lib/inviteRoutes'
import { getSupabaseBrowserClient } from '../../lib/supabaseBrowser'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function InviteProfile({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { flow, legacyToken, password, reset } = useInviteOnboarding()
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!flow) {
      onNavigate(INVITE_LANDING_PATH)
      return
    }
    if (!password) onNavigate(INVITE_SET_PASSWORD_PATH)
  }, [flow, password, onNavigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!flow || !password) return

    setPending(true)
    setError(null)

    if (flow === 'legacy') {
      if (!legacyToken) {
        setPending(false)
        setError('Enlace de invitación no disponible. Volvé a abrir el correo.')
        return
      }
      const res = await fetch(`${apiBase}/api/invites/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: legacyToken, password, fullName: fullName.trim() }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setPending(false)
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      reset()
      onNavigate('/login?activated=1')
      return
    }

    const supabase = getSupabaseBrowserClient()
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) {
      setPending(false)
      setError('Sesión no disponible. Volvé a abrir el enlace del correo.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      data: { full_name: fullName.trim() },
    })
    if (updateError) {
      setPending(false)
      setError(updateError.message)
      return
    }

    const res = await fetch(`${apiBase}/api/invites/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fullName: fullName.trim() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    reset()
    onNavigate('/dashboard')
  }

  if (!flow || !password) return null

  return (
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <div className="mb-2 flex items-center gap-2 text-technical-label text-outline uppercase">
          <span className="rounded-full bg-primary px-2 py-0.5 text-on-primary">2</span>
          <span>de 2</span>
        </div>
        <h1 className="text-headline-md text-on-surface">Completá tu perfil</h1>
        <p className="text-body-sm mt-2 text-on-surface-variant">
          Indicá tu nombre para identificarte en los proyectos del portal.
        </p>

        <form className="mt-6 space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <label className="block space-y-2" htmlFor="invite-full-name">
            <span className="text-button text-on-surface">Nombre completo</span>
            <div className="relative">
              <Icon
                name="person"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="invite-full-name"
                type="text"
                required
                minLength={2}
                autoComplete="name"
                className="input-field"
                placeholder="Ana García"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </label>

          {error ? (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary w-full py-4">
            {pending ? 'Activando…' : 'Activar cuenta'}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
