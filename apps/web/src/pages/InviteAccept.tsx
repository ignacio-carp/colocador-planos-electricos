import React, { useEffect, useState } from 'react'
import { AuthShell } from '../components/AuthShell'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function getLegacyToken(): string | null {
  const token = new URLSearchParams(window.location.search).get('token')?.trim()
  return token || null
}

type VerifyState = 'idle' | 'loading' | 'valid' | 'invalid'

function LegacyInviteAccept({ onNavigate }: { onNavigate: (path: string) => void }) {
  const token = getLegacyToken() ?? ''
  const [verify, setVerify] = useState<VerifyState>('idle')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    setVerify('loading')
    void (async () => {
      const res = await fetch(`${apiBase}/api/invites/verify?token=${encodeURIComponent(token)}`)
      if (cancelled) return
      setVerify(res.ok ? 'valid' : 'invalid')
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setPending(true)
    setError(null)
    const res = await fetch(`${apiBase}/api/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password, fullName: fullName.trim() }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    onNavigate('/login?activated=1')
  }

  return (
    <>
      {verify === 'loading' ? (
        <p className="text-body-sm mt-4 text-on-surface-variant">Verificando enlace…</p>
      ) : null}
      {verify === 'invalid' ? (
        <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container">
          Enlace inválido o caducado. Solicitá una nueva invitación al administrador.
        </p>
      ) : null}
      {verify === 'valid' ? (
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
          <p className="text-body-sm text-on-surface-variant">
            Completá tu perfil para activar tu cuenta de arquitecto.
          </p>
          <label className="block space-y-2" htmlFor="fullName">
            <span className="text-button text-on-surface">Nombre completo</span>
            <input
              id="fullName"
              type="text"
              required
              minLength={2}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="input-field pl-4"
            />
          </label>
          <label className="block space-y-2" htmlFor="password">
            <span className="text-button text-on-surface">Contraseña</span>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field pl-4"
            />
          </label>
          <label className="block space-y-2" htmlFor="confirmPassword">
            <span className="text-button text-on-surface">Confirmar contraseña</span>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="input-field pl-4"
            />
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
      ) : null}
    </>
  )
}

function SupabaseInviteAccept({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [ready, setReady] = useState(false)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setReady(!!session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setPending(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token
    if (!accessToken) {
      setPending(false)
      setError('Sesión no disponible. Abrí el enlace del correo de invitación.')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
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
    onNavigate('/dashboard')
  }

  if (!ready) {
    return (
      <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container">
        Abrí esta página desde el enlace del correo de invitación de Supabase.
      </p>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
      <p className="text-body-sm text-on-surface-variant">
        Completá tu perfil y definí tu contraseña para activar tu cuenta de arquitecto.
      </p>
      <label className="block space-y-2" htmlFor="fullName">
        <span className="text-button text-on-surface">Nombre completo</span>
        <input
          id="fullName"
          type="text"
          required
          minLength={2}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input-field pl-4"
        />
      </label>
      <label className="block space-y-2" htmlFor="password">
        <span className="text-button text-on-surface">Contraseña</span>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field pl-4"
        />
      </label>
      <label className="block space-y-2" htmlFor="confirmPassword">
        <span className="text-button text-on-surface">Confirmar contraseña</span>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="input-field pl-4"
        />
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
  )
}

export default function InviteAccept({ onNavigate }: { onNavigate: (path: string) => void }) {
  const legacyToken = getLegacyToken()
  const isLegacyFlow = Boolean(legacyToken)

  return (
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <h1 className="text-headline-md text-on-surface">Activar cuenta</h1>
        {isLegacyFlow ? (
          <LegacyInviteAccept onNavigate={onNavigate} />
        ) : (
          <SupabaseInviteAccept onNavigate={onNavigate} />
        )}
        <button
          type="button"
          className="text-button mt-6 font-semibold text-primary hover:underline"
          onClick={() => onNavigate('/login')}
        >
          Ir al inicio de sesión
        </button>
      </div>
    </AuthShell>
  )
}
