import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'
import { formatJobCreatedAt } from '../lib/jobPresentation'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Job = {
  id: string
  owner_user_id: string
  title: string
  status?: string
  created_at?: string
  error?: { code: string; message: string; correlation_id: string }
}

export default function Dashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session, signOut, loading } = useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  const role = getAppRole(session?.user)

  const loadJobs = useCallback(async () => {
    if (!session) return
    setJobsLoading(true)
    setJobsError(null)
    const res = await fetch(`${apiBase}/api/jobs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = (await res.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
    setJobsLoading(false)
    if (!res.ok) {
      setJobsError(body.error ?? `HTTP ${res.status}`)
      setJobs([])
      return
    }
    setJobs(body.jobs ?? [])
  }, [session])

  useEffect(() => {
    if (loading || !session) return
    void loadJobs()
  }, [loading, session, loadJobs])

  async function handleLogout() {
    await signOut()
    onNavigate('/login')
  }

  if (loading) {
    return <p className="text-[#424751]">Cargando sesión…</p>
  }

  const sortedJobs = [...jobs].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-6 shadow-[0px_10px_25px_rgba(0,52,111,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#191c1d]">Panel</h1>
            <p className="mt-2 text-sm text-[#424751]">
              Usuario: <span className="font-mono text-xs text-[#424751]">{session?.user.email}</span>
              {role ? (
                <span className="ml-2 rounded-full bg-[#edeeef] px-2 py-0.5 font-mono text-xs text-[#424751]">
                  {role}
                </span>
              ) : (
                <span className="ml-2 text-xs text-amber-800">
                  (sin rol — configurá app_metadata.role en Supabase)
                </span>
              )}
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              className="font-semibold text-[#00346f] underline decoration-[#00346f]/30 underline-offset-2"
              onClick={() => onNavigate('/jobs')}
            >
              Trabajos
            </button>
            {role === 'architect' ? (
              <button
                type="button"
                className="rounded bg-[#00346f] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#004a99]"
                onClick={() => onNavigate('/jobs/new')}
              >
                Nuevo análisis
              </button>
            ) : null}
            {role === 'administrator' ? (
              <button
                type="button"
                className="font-semibold text-[#00346f] underline decoration-[#00346f]/30 underline-offset-2"
                onClick={() => onNavigate('/invites')}
              >
                Invitaciones
              </button>
            ) : null}
            <button
              type="button"
              className="rounded border border-[#737783] px-3 py-1.5 text-sm text-[#191c1d]"
              onClick={() => void handleLogout()}
            >
              Cerrar sesión
            </button>
          </nav>
        </div>
      </div>

      <section className="rounded-lg border border-[#E2E8F0] bg-white p-6 shadow-[0px_10px_25px_rgba(0,52,111,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#191c1d]">Trabajos</h2>
          {jobsLoading ? <span className="text-xs text-[#424751]">Actualizando…</span> : null}
        </div>
        {jobsError ? <p className="mt-3 text-sm text-[#ba1a1a]">{jobsError}</p> : null}

        {!jobsLoading && sortedJobs.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-[#c2c6d3] bg-[#f8f9fa] px-6 py-10 text-center">
            <p className="text-sm text-[#424751]">No hay trabajos para mostrar.</p>
            {role === 'architect' ? (
              <button
                type="button"
                className="mt-4 rounded bg-[#00346f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004a99]"
                onClick={() => onNavigate('/jobs/new')}
              >
                Crear nuevo análisis
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[#E2E8F0]">
            {sortedJobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-left font-medium text-[#191c1d] hover:text-[#00346f]"
                    onClick={() => onNavigate('/jobs')}
                  >
                    {j.title}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-[#424751]">
                    <span>
                      Estado:{' '}
                      <span className="rounded-full bg-[#e7e8e9] px-2 py-0.5 text-[#191c1d]">{j.status ?? 'pending'}</span>
                    </span>
                    {formatJobCreatedAt(j.created_at) ? (
                      <span>Creado: {formatJobCreatedAt(j.created_at)}</span>
                    ) : null}
                    {role === 'administrator' ? (
                      <span title={j.owner_user_id}>Dueño: {j.owner_user_id.slice(0, 10)}…</span>
                    ) : null}
                  </div>
                  {j.error ? (
                    <p className="mt-1 text-xs text-[#ba1a1a]">
                      {j.error.code} — {j.error.correlation_id}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
