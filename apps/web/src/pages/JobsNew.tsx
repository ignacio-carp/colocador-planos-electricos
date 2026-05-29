import React, { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { jobDetailPath } from '../lib/routes'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export default function JobsNew({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    const t = title.trim()
    if (!t) return
    setPending(true)
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: t }),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    if (body.id) {
      onNavigate(jobDetailPath(body.id))
      return
    }
    onNavigate('/dashboard')
  }

  return (
    <AppShell activeNav="dashboard" onNavigate={onNavigate} headerTitle="Nuevo proyecto">
      <div className="mx-auto max-w-xl">
        <button
          type="button"
          className="text-technical-label mb-6 flex items-center gap-2 tracking-widest text-on-surface-variant uppercase hover:text-primary"
          onClick={() => onNavigate('/dashboard')}
        >
          <Icon name="arrow_back" className="text-[18px]" />
          Volver a proyectos
        </button>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-xl border border-outline-variant bg-surface-container-lowest p-8 shadow-[var(--shadow-ambient)]"
        >
          <h1 className="text-headline-md text-primary">Crear proyecto</h1>
          <p className="text-body-sm mt-2 text-on-surface-variant">
            Definí un nombre para el trabajo. Después podrás subir el plano DXF y ejecutar el análisis.
          </p>
          <label className="mt-6 block space-y-2">
            <span className="text-button text-on-surface">Título del proyecto</span>
            <input
              className="input-field pl-4"
              placeholder="Ej. Planta baja — revisión luminaria"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
            />
          </label>
          {error ? (
            <p className="mt-4 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="submit" disabled={pending || !title.trim()} className="btn-primary">
              {pending ? 'Creando…' : 'Crear proyecto'}
            </button>
            <button type="button" className="btn-secondary-outline" onClick={() => onNavigate('/dashboard')}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
