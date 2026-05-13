import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Job = { id: string; owner_user_id: string; title: string }

export default function Jobs({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = (await res.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setJobs([])
      return
    }
    setJobs(body.jobs ?? [])
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  async function createJob(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setPending(true)
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    })
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    setPending(false)
    if (!res.ok) {
      setError(errBody.error ?? `HTTP ${res.status}`)
      return
    }
    setTitle('')
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Jobs</h1>
        <button type="button" className="text-sm text-slate-900 underline" onClick={() => onNavigate('/dashboard')}>
          Volver
        </button>
      </div>
      {role === 'architect' ? (
        <form onSubmit={createJob} className="rounded border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-medium text-slate-800">Crear job (solo arquitecto, US-005)</h2>
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="Título"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button
              type="submit"
              disabled={pending || !title.trim()}
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Crear
            </button>
          </div>
        </form>
      ) : role === 'administrator' ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Como administrador no puedes crear jobs vía API (US-005). Solo listado global.
        </p>
      ) : (
        <p className="text-sm text-amber-800">Asigna rol en Supabase para usar esta página.</p>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-medium text-slate-800">Listado</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span>{j.title}</span>
              <span className="font-mono text-xs text-slate-500">{j.owner_user_id.slice(0, 8)}…</span>
            </li>
          ))}
          {jobs.length === 0 ? <li className="text-slate-500">Sin jobs.</li> : null}
        </ul>
      </div>
    </div>
  )
}
