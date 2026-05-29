import React, { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'
import { formatJobModifiedLabel, projectStatusChip } from '../lib/jobPresentation'
import { jobDetailPath } from '../lib/routes'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Job = {
  id: string
  owner_user_id: string
  title: string
  status?: string
  created_at?: string
}

const CARD_GRADIENTS = [
  'from-primary/20 via-surface-container to-surface-container-high',
  'from-secondary-container/60 via-surface-container-low to-surface-container',
  'from-primary-container/30 via-surface-container to-surface-variant',
  'from-surface-variant via-surface-container-low to-surface-container-high',
]

export default function Dashboard({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session, loading } = useAuth()
  const role = getAppRole(session?.user)
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)

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

  const sortedJobs = [...jobs].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0
    return tb - ta
  })

  const activeCount = sortedJobs.filter((j) => {
    const s = (j.status ?? '').toLowerCase()
    return s !== 'completed' && s !== 'procesado'
  }).length

  if (loading) {
    return (
      <AppShell activeNav="dashboard" onNavigate={onNavigate}>
        <p className="text-on-surface-variant">Cargando sesión…</p>
      </AppShell>
    )
  }

  return (
    <AppShell activeNav="dashboard" onNavigate={onNavigate} headerTitle="Portal de gestión de proyectos">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-headline-lg text-primary">Mis proyectos</h2>
          <p className="text-body-md mt-1 text-on-surface-variant">
            Gestioná y accedé a tus desarrollos arquitectónicos activos.
          </p>
        </div>
        {role === 'architect' ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigate('/jobs/new')}
          >
            <Icon name="add" className="text-sm" />
            Nuevo proyecto
          </button>
        ) : null}
      </header>

      {jobsError ? (
        <p className="mb-6 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container" role="alert">
          {jobsError}
        </p>
      ) : null}

      {jobsLoading ? (
        <p className="text-body-sm text-on-surface-variant">Cargando proyectos…</p>
      ) : sortedJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low px-8 py-16 text-center">
          <Icon name="folder_open" className="mb-4 text-4xl text-primary" />
          <p className="text-headline-md text-primary">Sin proyectos todavía</p>
          <p className="text-body-sm mt-2 max-w-sm text-on-surface-variant">
            {role === 'architect'
              ? 'Creá un proyecto para subir planos DXF y ejecutar el análisis de luminarias.'
              : 'No hay trabajos visibles para tu cuenta.'}
          </p>
          {role === 'architect' ? (
            <button type="button" className="btn-primary mt-6" onClick={() => onNavigate('/jobs/new')}>
              Crear primer proyecto
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedJobs.map((job, index) => {
            const chip = projectStatusChip(job.status)
            const modified = formatJobModifiedLabel(job.created_at)
            return (
              <article
                key={job.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest transition-shadow hover:shadow-[var(--shadow-card-hover)]"
              >
                <div
                  className={`relative flex h-48 items-center justify-center bg-gradient-to-br ${CARD_GRADIENTS[index % CARD_GRADIENTS.length]}`}
                >
                  <Icon name="architecture" className="text-5xl text-primary/40" />
                  <div className="absolute top-3 right-3">
                    <span
                      className={`text-technical-label rounded px-2 py-1 font-medium uppercase ${chip.className}`}
                    >
                      {chip.label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="text-headline-md leading-tight text-primary">{job.title}</h3>
                  {modified ? (
                    <div className="text-technical-label mt-3 flex items-center gap-2 text-on-surface-variant">
                      <Icon name="schedule" className="text-sm" />
                      Modificado: {modified}
                    </div>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between border-t border-outline-variant pt-4">
                    <span className="text-technical-label text-outline">ID {job.id.slice(0, 8)}…</span>
                    <button
                      type="button"
                      className="btn-primary px-5 py-2"
                      onClick={() => onNavigate(jobDetailPath(job.id))}
                    >
                      Abrir
                    </button>
                  </div>
                </div>
              </article>
            )
          })}

          {role === 'architect' ? (
            <button
              type="button"
              onClick={() => onNavigate('/jobs/new')}
              className="group flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low p-8 transition-all hover:border-primary hover:bg-surface-container"
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest transition-transform group-hover:scale-110">
                <Icon name="add_circle" className="text-3xl text-primary" />
              </div>
              <span className="text-headline-md text-primary">Nuevo proyecto</span>
              <p className="text-body-sm mt-2 text-center text-on-surface-variant">
                Importá un DXF o iniciá un análisis de luminarias.
              </p>
            </button>
          ) : null}
        </div>
      )}

      {sortedJobs.length > 0 ? (
        <section className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="relative overflow-hidden rounded-xl bg-primary p-8 text-on-primary lg:col-span-2">
            <div className="relative z-10">
              <h4 className="text-headline-md mb-2">Resumen de la división</h4>
              <p className="text-body-md max-w-md text-on-primary-container/90">
                Tenés {activeCount} proyecto{activeCount === 1 ? '' : 's'} activo
                {activeCount === 1 ? '' : 's'} de {sortedJobs.length} en total.
              </p>
            </div>
            <Icon
              name="architecture"
              filled
              className="pointer-events-none absolute right-0 bottom-0 hidden text-[160px] opacity-10 md:block"
            />
          </div>
          <div className="rounded-xl border border-surface-border bg-surface-container-lowest p-6">
            <h4 className="text-technical-label mb-4 tracking-widest text-on-surface-variant uppercase">
              Estadísticas rápidas
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-technical-label text-on-surface-variant">Proyectos</p>
                <p className="text-headline-md text-primary">{sortedJobs.length}</p>
              </div>
              <div>
                <p className="text-technical-label text-on-surface-variant">Activos</p>
                <p className="text-headline-md text-success">{activeCount}</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </AppShell>
  )
}
