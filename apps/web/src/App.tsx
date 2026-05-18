import React, { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { usePathname } from './hooks/usePathname'
import { getAppRole } from './lib/roles'
import { resolveAuthRedirect } from './lib/routeGuards'
import Health from './pages/Health'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import Jobs from './pages/Jobs'
import JobsNew from './pages/JobsNew'
import Invites from './pages/Invites'
import InviteAccept from './pages/InviteAccept'

function AppRoutes() {
  const { pathname, navigate } = usePathname()
  const { session, loading } = useAuth()
  const role = getAppRole(session?.user)

  useEffect(() => {
    if (pathname === '/healthz') document.title = 'healthz'
    else if (pathname === '/login') document.title = 'Login'
    else if (pathname === '/dashboard') document.title = 'Dashboard'
    else if (pathname === '/jobs') document.title = 'Jobs'
    else if (pathname === '/jobs/new') document.title = 'Nuevo análisis'
    else if (pathname === '/invites') document.title = 'Invites'
    else if (pathname === '/invite') document.title = 'Invitación'
    else document.title = 'VanguardIA'
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

  return (
    <main className="min-h-screen bg-[#f8f9fa]">
      <div className="mx-auto max-w-4xl px-6 py-16">
        {pathname === '/' ? (
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">VanguardIA</h1>
            <p className="mt-4 text-slate-700">
              MVP con Supabase Auth y RBAC ({role ?? 'sin rol'}).{' '}
              <button type="button" className="text-slate-900 underline" onClick={() => navigate('/login')}>
                Ir a login
              </button>{' '}
              ·{' '}
              <button type="button" className="text-slate-900 underline" onClick={() => navigate('/dashboard')}>
                Área autenticada
              </button>{' '}
              ·{' '}
              <button type="button" className="text-slate-900 underline" onClick={() => navigate('/jobs')}>
                Jobs
              </button>
              {role === 'administrator' ? (
                <>
                  {' '}
                  ·{' '}
                  <button type="button" className="text-slate-900 underline" onClick={() => navigate('/invites')}>
                    Invites
                  </button>
                </>
              ) : null}
              {' '}
              · Healthcheck: <code className="rounded bg-slate-200 px-2 py-1">/healthz</code>
            </p>
          </div>
        ) : null}
        {pathname === '/login' ? <Login onNavigate={navigate} /> : null}
        {pathname === '/forgot-password' ? <ForgotPassword onNavigate={navigate} /> : null}
        {pathname === '/reset-password' ? <ResetPassword onNavigate={navigate} /> : null}
        {pathname === '/dashboard' && showProtected ? <Dashboard onNavigate={navigate} /> : null}
        {pathname === '/jobs' && showProtected ? <Jobs onNavigate={navigate} /> : null}
        {pathname === '/jobs/new' && showProtected ? <JobsNew onNavigate={navigate} /> : null}
        {pathname === '/invites' && showProtected && role === 'administrator' ? (
          <Invites onNavigate={navigate} />
        ) : null}
        {pathname === '/invite' ? <InviteAccept onNavigate={navigate} /> : null}
        {loading && pathname !== '/login' && pathname !== '/invite' && pathname !== '/' ? (
          <p className="text-slate-600">Cargando sesión…</p>
        ) : null}
      </div>
    </main>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
