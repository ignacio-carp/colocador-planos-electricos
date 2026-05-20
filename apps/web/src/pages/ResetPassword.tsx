import React, { useEffect, useState } from 'react'
import { AuthShell } from '../components/AuthShell'
import { Icon } from '../components/Icon'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'

/**
 * Tras el enlace de recuperación de Supabase, la sesión queda disponible en el cliente;
 * aquí el usuario define una contraseña nueva.
 */
export default function ResetPassword({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const supabase = getSupabaseBrowserClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setPending(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onNavigate('/login')
  }

  if (!ready) {
    return (
      <AuthShell showBrand={false}>
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-[var(--shadow-ambient)]">
          <p className="text-body-sm text-on-surface-variant">
            Abrí esta página desde el enlace del correo de recuperación.
          </p>
          <button type="button" className="btn-primary mt-6" onClick={() => onNavigate('/login')}>
            Ir al inicio de sesión
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell showBrand={false}>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <h1 className="text-headline-md text-on-surface">Nueva contraseña</h1>
        <form className="mt-6 space-y-6" onSubmit={(e) => void onSubmit(e)}>
          <label className="block space-y-2" htmlFor="new-password">
            <span className="text-button text-on-surface">Contraseña nueva</span>
            <div className="relative">
              <Icon
                name="lock"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="new-password"
                type="password"
                required
                minLength={6}
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </label>
          {error ? (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={pending} className="btn-primary w-full py-4">
            {pending ? 'Guardando…' : 'Guardar contraseña'}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
