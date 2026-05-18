import React, { useEffect, useState } from 'react'

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
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Activar cuenta</h1>
      {verify === 'loading' ? <p className="text-sm text-slate-600">Verificando enlace…</p> : null}
      {verify === 'invalid' ? (
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Enlace inválido o caducado. Solicita una nueva invitación al administrador.
        </p>
      ) : null}
      {verify === 'valid' ? (
        <form onSubmit={submit} className="space-y-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">Completa tu perfil para activar tu cuenta de arquitecto.</p>
          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="fullName">
              Nombre completo
            </label>
            <input
              id="fullName"
              type="text"
              required
              minLength={2}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-800" htmlFor="confirmPassword">
              Confirmar contraseña
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? 'Activando…' : 'Activar cuenta'}
          </button>
        </form>
      ) : null}
      <button type="button" className="text-sm text-slate-900 underline" onClick={() => onNavigate('/')}>
        Ir al inicio
      </button>
    </div>
  )
}
