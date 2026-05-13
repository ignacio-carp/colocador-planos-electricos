import React, { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { usePathname } from './hooks/usePathname'
import Health from './pages/Health'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'

function AppRoutes() {
  const { pathname, navigate } = usePathname()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (pathname === '/healthz') document.title = 'healthz'
    else if (pathname === '/login') document.title = 'Login'
    else if (pathname === '/dashboard') document.title = 'Dashboard'
    else document.title = 'VanguardIA'
  }, [pathname])

  useEffect(() => {
    if (loading) return
    if (pathname === '/dashboard' && !session) {
      navigate('/login')
    }
    if ((pathname === '/login' || pathname === '/forgot-password') && session) {
      navigate('/dashboard')
    }
  }, [loading, pathname, session, navigate])

  if (pathname === '/healthz') {
    return <Health />
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        {pathname === '/' ? (
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">VanguardIA</h1>
            <p className="mt-4 text-slate-700">
              MVP con Supabase Auth.{' '}
              <button type="button" className="text-slate-900 underline" onClick={() => navigate('/login')}>
                Ir a login
              </button>{' '}
              ·{' '}
              <button type="button" className="text-slate-900 underline" onClick={() => navigate('/dashboard')}>
                Área autenticada
              </button>{' '}
              · Healthcheck:{' '}
              <code className="rounded bg-slate-200 px-2 py-1">/healthz</code>
            </p>
          </div>
        ) : null}
        {pathname === '/login' ? <Login onNavigate={navigate} /> : null}
        {pathname === '/forgot-password' ? <ForgotPassword onNavigate={navigate} /> : null}
        {pathname === '/reset-password' ? <ResetPassword onNavigate={navigate} /> : null}
        {pathname === '/dashboard' ? (
          loading ? (
            <p className="text-slate-600">Cargando…</p>
          ) : session ? (
            <Dashboard onNavigate={navigate} />
          ) : null
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
