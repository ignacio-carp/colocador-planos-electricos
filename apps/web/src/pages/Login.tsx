import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { AuthShell } from '../components/AuthShell'
import { Icon } from '../components/Icon'

function showActivatedBanner(): boolean {
  return new URLSearchParams(window.location.search).get('activated') === '1'
}

export default function Login({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
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
    if (remember) {
      try {
        localStorage.setItem('cambre_remember_email', email)
      } catch {
        /* ignore */
      }
    }
    onNavigate('/dashboard')
  }

  return (
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <div className="mb-8">
          <h2 className="text-headline-md text-on-surface">Acceso al portal de proyectos</h2>
          <p className="text-body-sm mt-2 text-on-surface-variant">
            Ingresá tus credenciales para continuar.
          </p>
        </div>

        {showActivatedBanner() ? (
          <p className="mb-6 rounded-lg border border-success/30 bg-success/10 p-3 text-body-sm text-success">
            Cuenta activada. Iniciá sesión con tu correo y contraseña.
          </p>
        ) : null}

        <form className="space-y-6" onSubmit={(e) => void onSubmit(e)}>
          <div className="space-y-2">
            <label className="text-button block text-on-surface" htmlFor="email">
              Correo electrónico
            </label>
            <div className="relative">
              <Icon
                name="person"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="input-field"
                placeholder="usuario@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-button block text-on-surface" htmlFor="password">
                Contraseña
              </label>
              <button
                type="button"
                className="text-technical-label text-primary uppercase hover:underline"
                onClick={() => onNavigate('/forgot-password')}
              >
                ¿Olvidaste tu clave?
              </button>
            </div>
            <div className="relative">
              <Icon
                name="lock"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="input-field pr-12"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute top-1/2 right-3 -translate-y-1/2 text-outline hover:text-primary"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} className="text-[20px]" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="remember"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
            />
            <label className="text-body-sm text-on-surface-variant" htmlFor="remember">
              Mantener sesión iniciada
            </label>
          </div>

          {error ? (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary w-full py-4">
            <span>{pending ? 'Ingresando…' : 'Iniciar sesión'}</span>
            <Icon name="login" className="text-[18px]" />
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
