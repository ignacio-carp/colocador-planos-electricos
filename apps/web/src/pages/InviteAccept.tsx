import React, { useEffect, useState } from 'react'
import { AuthShell } from '../components/AuthShell'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function getTokenFromLocation(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('token')?.trim() ?? ''
}

type VerifyState = 'idle' | 'loading' | 'valid' | 'invalid'

export default function InviteAccept({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [verify, setVerify] = useState<VerifyState>('idle')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const token = getTokenFromLocation()

  useEffect(() => {
    if (!token) {
      setVerify('invalid')
      return
    }
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
    if (!token) return
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
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <h1 className="text-headline-md text-on-surface">Activar cuenta</h1>
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
