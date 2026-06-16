import React, { useEffect, useState } from 'react'
import { AuthShell } from '../../components/AuthShell'
import { Icon } from '../../components/Icon'
import { useInviteOnboarding } from '../../context/InviteOnboardingContext'
import { getLegacyInviteToken, INVITE_SET_PASSWORD_PATH } from '../../lib/inviteRoutes'
import { getSupabaseBrowserClient } from '../../lib/supabaseBrowser'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type LandingState = 'loading' | 'invalid' | 'ready'

export default function InviteLanding({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { setSupabaseFlow, setLegacyFlow } = useInviteOnboarding()
  const [state, setState] = useState<LandingState>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let unsubscribeAuth: (() => void) | undefined
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setState((current) => {
        if (current === 'loading') {
          setError('Abrí esta página desde el enlace del correo de invitación.')
          return 'invalid'
        }
        return current
      })
    }, 4000)

    const legacyToken = getLegacyInviteToken()

    void (async () => {
      if (legacyToken) {
        const res = await fetch(`${apiBase}/api/invites/verify?token=${encodeURIComponent(legacyToken)}`)
        if (cancelled) return
        window.clearTimeout(timeoutId)
        if (!res.ok) {
          setState('invalid')
          setError('Enlace inválido o caducado. Solicitá una nueva invitación al administrador.')
          return
        }
        setLegacyFlow(legacyToken)
        setState('ready')
        onNavigate(INVITE_SET_PASSWORD_PATH)
        return
      }

      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) {
        window.clearTimeout(timeoutId)
        setSupabaseFlow()
        setState('ready')
        onNavigate(INVITE_SET_PASSWORD_PATH)
        return
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled || !session) return
        window.clearTimeout(timeoutId)
        setSupabaseFlow()
        setState('ready')
        onNavigate(INVITE_SET_PASSWORD_PATH)
      })
      unsubscribeAuth = () => subscription.unsubscribe()
    })()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      unsubscribeAuth?.()
    }
  }, [onNavigate, setLegacyFlow, setSupabaseFlow])

  return (
    <AuthShell>
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-[var(--shadow-ambient)]">
        {state === 'loading' ? (
          <>
            <Icon name="mail" className="mx-auto text-5xl text-primary/60" />
            <h1 className="text-headline-md mt-6 text-on-surface">Verificando invitación</h1>
            <p className="text-body-sm mt-3 text-on-surface-variant">
              Estamos confirmando tu enlace de invitación…
            </p>
          </>
        ) : null}
        {state === 'invalid' ? (
          <>
            <h1 className="text-headline-md text-on-surface">Invitación no válida</h1>
            <p className="mt-4 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container">
              {error}
            </p>
            <button type="button" className="btn-primary mt-6 w-full py-4" onClick={() => onNavigate('/login')}>
              Ir al inicio de sesión
            </button>
          </>
        ) : null}
      </div>
    </AuthShell>
  )
}
