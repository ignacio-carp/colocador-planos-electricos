import React, { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { InviteOnboardingProvider } from './context/InviteOnboardingContext'
import { usePathname } from './hooks/usePathname'
import { getAppRole } from './lib/roles'
import {
  INVITE_LANDING_PATH,
  INVITE_PROFILE_PATH,
  INVITE_SET_PASSWORD_PATH,
  isInviteOnboardingPath,
} from './lib/inviteRoutes'
import { resolveAuthRedirect } from './lib/routeGuards'
import { isJobDetailPath, parseJobIdFromPath } from './lib/routes'
import Health from './pages/Health'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import JobDetail from './pages/JobDetail'
import JobsNew from './pages/JobsNew'
import Invites from './pages/Invites'
import NormativeRules from './pages/NormativeRules'
import InviteLanding from './pages/invite/InviteLanding'
import InviteSetPassword from './pages/invite/InviteSetPassword'
import InviteProfile from './pages/invite/InviteProfile'

function AppRoutes() {
  const { pathname, navigate } = usePathname()
  const { session, loading } = useAuth()
  const role = getAppRole(session?.user)
  const jobId = parseJobIdFromPath(pathname)

  useEffect(() => {
    if (pathname === '/healthz') document.title = 'healthz'
    else if (pathname === '/login') document.title = 'Iniciar sesión — Cambre Planos'
    else if (pathname === '/dashboard') document.title = 'Mis proyectos — Cambre Planos'
    else if (isJobDetailPath(pathname)) document.title = 'Archivos DXF — Cambre Planos'
    else if (pathname === '/jobs/new') document.title = 'Nuevo proyecto — Cambre Planos'
    else if (pathname === '/invites') document.title = 'Invitaciones — Cambre Planos'
    else if (pathname === '/admin/normative-rules') document.title = 'Reglas normativas — Cambre Planos'
    else if (pathname === INVITE_SET_PASSWORD_PATH) document.title = 'Contraseña — Cambre Planos'
    else if (pathname === INVITE_PROFILE_PATH) document.title = 'Perfil — Cambre Planos'
    else if (isInviteOnboardingPath(pathname)) document.title = 'Invitación — Cambre Planos'
    else document.title = 'Cambre Planos'
  }, [pathname])

  useEffect(() => {
    if (loading) return
    const redirect = resolveAuthRedirect({
      pathname,
      hasSession: Boolean(session),
      role,
    })
    if (redirect && redirect !== pathname) navigate(redirect)
  }, [loading, pathname, session, role, navigate])

  if (pathname === '/healthz') {
    return <Health />
  }

  const showProtected = !loading && session
  const isAuthPage =
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    isInviteOnboardingPath(pathname)

  return (
    <>
      {pathname === '/' ? (
        <main className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="max-w-lg text-center">
            <h1 className="text-headline-lg text-primary">Cambre Planos</h1>
            <p className="text-body-md mt-4 text-on-surface-variant">
              Portal técnico para análisis de luminarias en planos DXF.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button type="button" className="btn-primary" onClick={() => navigate('/login')}>
                Iniciar sesión
              </button>
              {showProtected ? (
                <button type="button" className="btn-secondary-outline" onClick={() => navigate('/dashboard')}>
                  Mis proyectos
                </button>
              ) : null}
            </div>
          </div>
        </main>
      ) : null}

      {pathname === '/login' ? <Login onNavigate={navigate} /> : null}
      {pathname === '/forgot-password' ? <ForgotPassword onNavigate={navigate} /> : null}
      {pathname === '/reset-password' ? <ResetPassword onNavigate={navigate} /> : null}
      {pathname === '/dashboard' && showProtected ? <Dashboard onNavigate={navigate} /> : null}
      {showProtected && jobId ? <JobDetail jobId={jobId} onNavigate={navigate} /> : null}
      {pathname === '/jobs/new' && showProtected ? <JobsNew onNavigate={navigate} /> : null}
      {pathname === '/invites' && showProtected && role === 'administrator' ? (
        <Invites onNavigate={navigate} />
      ) : null}
      {pathname === '/admin/normative-rules' && showProtected && role === 'administrator' ? (
        <NormativeRules onNavigate={navigate} />
      ) : null}
      {pathname === INVITE_LANDING_PATH ? <InviteLanding onNavigate={navigate} /> : null}
      {pathname === INVITE_SET_PASSWORD_PATH ? <InviteSetPassword onNavigate={navigate} /> : null}
      {pathname === INVITE_PROFILE_PATH ? <InviteProfile onNavigate={navigate} /> : null}

      {loading && !isAuthPage && pathname !== '/' ? (
        <main className="flex min-h-screen items-center justify-center bg-background">
          <p className="text-on-surface-variant">Cargando sesión…</p>
        </main>
      ) : null}
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <InviteOnboardingProvider>
        <AppRoutes />
      </InviteOnboardingProvider>
    </AuthProvider>
  )
}
