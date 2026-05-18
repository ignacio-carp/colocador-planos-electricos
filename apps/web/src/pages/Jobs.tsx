import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Job = {
  id: string
  owner_user_id: string
  title: string
  status?: string
  error?: { code: string; message: string; correlation_id: string }
}

export default function Jobs({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pickJobId, setPickJobId] = useState<string | null>(null)

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

  async function processJob(jobId: string) {
    if (!session) return
    setProcessingId(jobId)
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/process`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'X-Correlation-Id': crypto.randomUUID(),
      },
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    setProcessingId(null)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  function openPicker(jobId: string) {
    setPickJobId(jobId)
    queueMicrotask(() => fileRef.current?.click())
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const jobId = pickJobId
    e.target.value = ''
    setPickJobId(null)
    if (!session || !file || !jobId) return
    if (!file.name.toLowerCase().endsWith('.dwg')) {
      setError('Solo archivos .dwg')
      return
    }
    setBusyJobId(jobId)
    setError(null)
    try {
      const contentType =
        file.type && file.type.trim() !== '' ? file.type : 'application/octet-stream'
      const sur = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/dwg-input/signed-upload-url`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentType }),
      })
      const suBody = (await sur.json().catch(() => ({}))) as {
        signedUrl?: string
        objectPath?: string
        error?: string
      }
      if (!sur.ok) {
        setError(suBody.error ?? `Upload URL HTTP ${sur.status}`)
        return
      }
      const put = await fetch(suBody.signedUrl!, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
      if (!put.ok) {
        setError(`Fallo al subir a Storage (HTTP ${put.status})`)
        return
      }
      const reg = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/dwg-input/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          objectPath: suBody.objectPath,
          contentType,
          sizeBytes: file.size,
        }),
      })
      const regBody = (await reg.json().catch(() => ({}))) as { error?: string }
      if (!reg.ok) {
        setError(regBody.error ?? `Register HTTP ${reg.status}`)
        return
      }
    } finally {
      setBusyJobId(null)
    }
    await load()
  }

  async function tryDownload(jobId: string) {
    if (!session) return
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/download`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = (await res.json().catch(() => ({}))) as { signedUrl?: string; error?: string; hint?: string }
    if (!res.ok) {
      setError(body.error ?? body.hint ?? `HTTP ${res.status}`)
      return
    }
    if (body.signedUrl) window.open(body.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept=".dwg,application/acad,application/octet-stream"
        className="hidden"
        onChange={onFilePicked}
      />
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
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{j.title}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Estado: {j.status ?? 'pending'}
                  {j.error ? (
                    <span className="ml-2 text-red-600">
                      {j.error.code} — correlation: {j.error.correlation_id}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{j.owner_user_id.slice(0, 8)}…</span>
                {role === 'architect' && j.owner_user_id === session?.user.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busyJobId === j.id}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800 disabled:opacity-50"
                      onClick={() => openPicker(j.id)}
                    >
                      {busyJobId === j.id ? 'Subiendo…' : 'Subir .dwg'}
                    </button>
                    <button
                      type="button"
                      disabled={processingId === j.id || j.status === 'processing'}
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800 disabled:opacity-50"
                      onClick={() => void processJob(j.id)}
                    >
                      {processingId === j.id ? 'Procesando…' : 'Procesar'}
                    </button>
                  </>
                ) : null}
                {role === 'architect' || role === 'administrator' ? (
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                    onClick={() => void tryDownload(j.id)}
                  >
                    Descarga firmada
                  </button>
                ) : null}
              </div>
            </li>
          ))}
          {jobs.length === 0 ? <li className="text-slate-500">Sin jobs.</li> : null}
        </ul>
      </div>
    </div>
  )
}
