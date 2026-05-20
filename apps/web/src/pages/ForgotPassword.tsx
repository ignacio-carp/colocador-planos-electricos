import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { AuthShell } from '../components/AuthShell'
import { Icon } from '../components/Icon'

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
    setMessage('Si el correo existe, recibirás un enlace de recuperación.')
  }

  return (
    <AuthShell showBrand={false}>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <div className="mb-8">
          <h2 className="text-headline-md text-on-surface">Recuperar contraseña</h2>
          <p className="text-body-sm mt-2 text-on-surface-variant">
            Te enviaremos un enlace para restablecer el acceso.
          </p>
        </div>
        <form className="space-y-6" onSubmit={(e) => void onSubmit(e)}>
          <div className="space-y-2">
            <label className="text-button block text-on-surface" htmlFor="fp-email">
              Correo electrónico
            </label>
            <div className="relative">
              <Icon
                name="mail"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="fp-email"
                type="email"
                required
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-body-sm text-success">
              {message}
            </p>
          ) : null}
          <button type="submit" disabled={pending} className="btn-primary w-full py-4">
            {pending ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </form>
        <p className="mt-6 text-center text-body-sm">
          <button
            type="button"
            className="text-button font-semibold text-primary hover:underline"
            onClick={() => onNavigate('/login')}
          >
            Volver al inicio de sesión
          </button>
        </p>
      </div>
    </AuthShell>
  )
}
