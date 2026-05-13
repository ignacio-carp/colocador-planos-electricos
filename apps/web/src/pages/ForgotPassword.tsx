import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setPending(true)
    const { error: resetError } = await requestPasswordReset(email)
    setPending(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setMessage('Si el correo existe, recibirás un enlace de recuperación (revisa política de mensajes en Supabase).')
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Recuperar contraseña</h1>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="fp-email">
            Email
          </label>
          <input
            id="fp-email"
            type="email"
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-green-700">{message}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
      <p className="mt-4 text-center text-sm">
        <button type="button" className="text-slate-900 underline" onClick={() => onNavigate('/login')}>
          Volver al login
        </button>
      </p>
    </div>
  )
}
