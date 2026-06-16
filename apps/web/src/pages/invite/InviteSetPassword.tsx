import React, { useEffect, useState } from 'react'
import { AuthShell } from '../../components/AuthShell'
import { Icon } from '../../components/Icon'
import { useInviteOnboarding } from '../../context/InviteOnboardingContext'
import { INVITE_LANDING_PATH, INVITE_PROFILE_PATH } from '../../lib/inviteRoutes'
import { getSupabaseBrowserClient } from '../../lib/supabaseBrowser'

export default function InviteSetPassword({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { flow, setPassword } = useInviteOnboarding()
  const [passwordValue, setPasswordValue] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!flow) onNavigate(INVITE_LANDING_PATH)
  }, [flow, onNavigate])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!flow) return
    if (passwordValue.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (passwordValue !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setPending(true)
    setError(null)

    if (flow === 'supabase') {
      const supabase = getSupabaseBrowserClient()
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        setPending(false)
        setError('Sesión no disponible. Volvé a abrir el enlace del correo.')
        return
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: passwordValue })
      if (updateError) {
        setPending(false)
        setError(updateError.message)
        return
      }
    }

    setPassword(passwordValue)
    setPending(false)
    onNavigate(INVITE_PROFILE_PATH)
  }

  if (!flow) return null

  return (
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]">
        <div className="mb-2 flex items-center gap-2 text-technical-label text-outline uppercase">
          <span className="rounded-full bg-primary px-2 py-0.5 text-on-primary">1</span>
          <span>de 2</span>
        </div>
        <h1 className="text-headline-md text-on-surface">Creá tu contraseña</h1>
        <p className="text-body-sm mt-2 text-on-surface-variant">
          Definí una contraseña segura para acceder al portal de arquitectos.
        </p>

        <form className="mt-6 space-y-5" onSubmit={(e) => void onSubmit(e)}>
          <label className="block space-y-2" htmlFor="invite-password">
            <span className="text-button text-on-surface">Contraseña</span>
            <div className="relative">
              <Icon
                name="lock"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="invite-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                className="input-field pr-12"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
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
          </label>

          <label className="block space-y-2" htmlFor="invite-confirm-password">
            <span className="text-button text-on-surface">Confirmar contraseña</span>
            <div className="relative">
              <Icon
                name="lock"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[20px] text-outline"
              />
              <input
                id="invite-confirm-password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                className="input-field pr-12"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </label>

          {error ? (
            <p className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={pending} className="btn-primary w-full py-4">
            {pending ? 'Guardando…' : 'Continuar'}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
