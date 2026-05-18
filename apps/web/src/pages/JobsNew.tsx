import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

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
    const errBody = (await res.json().catch(() => ({}))) as { error?: string }
    setPending(false)
    if (!res.ok) {
      setError(errBody.error ?? `HTTP ${res.status}`)
      return
    }
    setTitle('')
    onNavigate('/jobs')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#191c1d]">Nuevo análisis</h1>
        <button
          type="button"
          className="text-sm font-semibold text-[#00346f] underline decoration-[#00346f]/30 underline-offset-2 hover:decoration-[#00346f]"
          onClick={() => onNavigate('/jobs')}
        >
          Volver a trabajos
        </button>
      </div>
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-lg border border-[#E2E8F0] bg-white p-6 shadow-[0px_10px_25px_rgba(0,52,111,0.06)]"
      >
        <p className="text-sm text-[#424751]">
          Creá un trabajo nuevo para subir el plano DWG y ejecutar el pipeline de análisis.
        </p>
        <label className="mt-5 block">
          <span className="text-sm font-medium text-[#191c1d]">Título del trabajo</span>
          <input
            className="mt-1.5 w-full rounded border border-[#c2c6d3] px-3 py-2 text-sm text-[#191c1d] outline-none focus:border-[#00346f] focus:ring-2 focus:ring-[#00346f]/50"
            placeholder="Ej. Planta baja — revisión luminaria"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-[#ba1a1a]">{error}</p> : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={pending || !title.trim()}
            className="rounded bg-[#00346f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#004a99] disabled:opacity-50"
          >
            {pending ? 'Creando…' : 'Crear trabajo'}
          </button>
          <button
            type="button"
            className="rounded border border-[#00346f] bg-transparent px-4 py-2 text-sm font-semibold text-[#00346f] hover:bg-[#00346f]/5"
            onClick={() => onNavigate('/dashboard')}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}
