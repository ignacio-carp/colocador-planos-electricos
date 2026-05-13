import React, { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function Dashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session, signOut, loading } = useAuth()
  const [me, setMe] = useState<unknown>(null)
  const [meError, setMeError] = useState<string | null>(null)
  const role = getAppRole(session?.user)

  useEffect(() => {
    if (loading || !session) return
    const ac = new AbortController()
    ;(async () => {
      setMeError(null)
      const res = await fetch(`${apiBase}/api/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: ac.signal,
      })
      if (!res.ok) {
        setMeError(`API ${res.status}`)
        setMe(null)
        return
      }
      setMe(await res.json())
    })().catch((e: Error) => {
      if (e.name !== 'AbortError') setMeError(e.message)
    })
    return () => ac.abort()
  }, [session, loading])

  async function handleLogout() {
    await signOut()
    onNavigate('/login')
  }

  if (loading) {
    return <p className="text-slate-600">Cargando sesión…</p>
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Área autenticada</h1>
      <p className="mt-2 text-slate-700">
        Usuario: <span className="font-mono text-sm">{session?.user.email}</span>
        {role ? (
          <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 font-mono text-xs text-slate-800">
            rol: {role}
          </span>
        ) : (
          <span className="ml-2 text-sm text-amber-700">
            (sin rol en metadata — configurar <code className="text-xs">user_metadata.role</code> en Supabase)
          </span>
        )}
      </p>
      <nav className="mt-4 flex flex-wrap gap-3 text-sm">
        <button type="button" className="text-slate-900 underline" onClick={() => onNavigate('/jobs')}>
          Trabajos (jobs)
        </button>
        {role === 'administrator' ? (
          <button type="button" className="text-slate-900 underline" onClick={() => onNavigate('/invites')}>
            Invitaciones
          </button>
        ) : null}
        {role === 'architect' ? (
          <span className="text-slate-500">Invitaciones ocultas (solo administrador)</span>
        ) : null}
      </nav>
      <div className="mt-4">
        <h2 className="text-sm font-medium text-slate-800">Validación JWT en API</h2>
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-800">
          {meError ? meError : JSON.stringify(me, null, 2)}
        </pre>
      </div>
      <button
        type="button"
        className="mt-6 rounded border border-slate-300 px-4 py-2 text-slate-900"
        onClick={handleLogout}
      >
        Cerrar sesión
      </button>
    </div>
  )
}
