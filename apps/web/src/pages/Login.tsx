import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

function showActivatedBanner(): boolean {
  return new URLSearchParams(window.location.search).get('activated') === '1'
}

export default function Login({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const { error: signError } = await signInWithPassword(email, password)
    setPending(false)
    if (signError) {
      setError('Credenciales incorrectas. Verifica tu correo y contraseña.')
      return
    }
    onNavigate('/dashboard')
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Iniciar sesión</h1>
      {showActivatedBanner() ? (
        <p className="mt-2 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Cuenta activada. Inicia sesión con tu correo y contraseña.
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-600">Supabase Auth (email y contraseña).</p>
      )}
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        <button type="button" className="text-slate-900 underline" onClick={() => onNavigate('/forgot-password')}>
          ¿Olvidaste tu contraseña?
        </button>
      </p>
    </div>
  )
}
