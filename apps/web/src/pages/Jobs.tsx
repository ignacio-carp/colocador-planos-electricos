import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { formatJobCreatedAt, hasRegisteredDwgInput } from '../lib/jobPresentation'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** Align with API `jobsStore` JobStatus plus legacy/Spanish labels if ever exposed. */
function canDownloadProcessedDwg(status?: string): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'completed' || s === 'procesado'
}

type Job = {
  id: string
  owner_user_id: string
  title: string
  status?: string
  created_at?: string
  error?: { code: string; message: string; correlation_id: string }
}

type DwgRegistryState = 'pending' | 'uploaded' | 'unknown'

export default function Jobs({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [jobs, setJobs] = useState<Job[]>([])
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pickJobId, setPickJobId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [dwgRegistry, setDwgRegistry] = useState<Record<string, DwgRegistryState>>({})
  const [uploadProgress, setUploadProgress] = useState<{ jobId: string; label: string } | null>(null)

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

  useEffect(() => {
    if (!session || role !== 'architect') {
      setDwgRegistry({})
      return
    }
    const mine = jobs.filter((j) => j.owner_user_id === session.user.id)
    if (mine.length === 0) {
      setDwgRegistry({})
      return
    }
    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        mine.map(async (j) => {
          try {
            const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(j.id)}/files`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            })
            if (!res.ok) return [j.id, 'unknown' as const] as const
            const body = (await res.json().catch(() => ({}))) as { files?: { kind: string }[] }
            const uploaded = hasRegisteredDwgInput(body.files ?? [])
            return [j.id, uploaded ? ('uploaded' as const) : ('pending' as const)] as const
          } catch {
            return [j.id, 'unknown' as const] as const
          }
        }),
      )
      if (!cancelled) setDwgRegistry(Object.fromEntries(results) as Record<string, DwgRegistryState>)
    })()
    return () => {
      cancelled = true
    }
  }, [session, role, jobs])

  async function processJob(jobId: string) {
    if (!session) return
    setProcessingId(jobId)
    setError(null)
    const res = await fetch(
      `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/process?sync=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'X-Correlation-Id': crypto.randomUUID(),
        },
      },
    )
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
    setError(null)
    try {
      const contentType =
        file.type && file.type.trim() !== '' ? file.type : 'application/octet-stream'
      setUploadProgress({ jobId, label: 'Obteniendo URL firmada…' })
      const sur = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/dwg-input/signed-upload-url`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentType, sizeBytes: file.size }),
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
      setUploadProgress({ jobId, label: 'Subiendo archivo al almacenamiento seguro…' })
      const put = await fetch(suBody.signedUrl!, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
      if (!put.ok) {
        setError(`Fallo al subir a Storage (HTTP ${put.status})`)
        return
      }
      setUploadProgress({ jobId, label: 'Registrando archivo en el trabajo…' })
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
      setUploadProgress(null)
    }
    await load()
  }

  async function downloadProcessedDwg(jobId: string) {
    if (!session) return
    setDownloadingId(jobId)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/download`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = (await res.json().catch(() => ({}))) as {
        signedUrl?: string
        streamUrl?: string
        error?: string
        hint?: string
      }
      if (!res.ok) {
        setError(body.error ?? body.hint ?? `HTTP ${res.status}`)
        return
      }
      if (body.signedUrl) {
        window.open(body.signedUrl, '_blank', 'noopener,noreferrer')
        return
      }
      const streamPath =
        body.streamUrl && body.streamUrl.startsWith('/')
          ? body.streamUrl
          : `/api/jobs/${encodeURIComponent(jobId)}/dwg-output/stream`
      const streamRes = await fetch(`${apiBase}${streamPath}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!streamRes.ok) {
        const errBody = (await streamRes.json().catch(() => ({}))) as { error?: string }
        setError(errBody.error ?? `Descarga HTTP ${streamRes.status}`)
        return
      }
      const blob = await streamRes.blob()
      const dispo = streamRes.headers.get('Content-Disposition')
      const filenameMatch = dispo?.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? `job-${jobId}-output.dwg`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloadingId(null)
    }
  }

  function dwgBadge(state: DwgRegistryState | undefined) {
    if (state === 'uploaded') {
      return (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-[#10B981] ring-1 ring-[#10B981]/25">
          DWG cargado
        </span>
      )
    }
    if (state === 'pending') {
      return (
        <span className="rounded-full bg-[#edeeef] px-2 py-0.5 text-xs font-medium text-[#424751]">
          DWG pendiente
        </span>
      )
    }
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900 ring-1 ring-amber-200/80">
        DWG — sin datos
      </span>
    )
  }

  const uploadingThis = (jid: string) => uploadProgress?.jobId === jid

  return (
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept=".dwg,application/acad,application/octet-stream"
        className="hidden"
        onChange={onFilePicked}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[#191c1d]">Trabajos</h1>
        <div className="flex flex-wrap items-center gap-3">
          {role === 'architect' ? (
            <button
              type="button"
              className="rounded bg-[#00346f] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#004a99]"
              onClick={() => onNavigate('/jobs/new')}
            >
              Nuevo análisis
            </button>
          ) : null}
          <button
            type="button"
            className="text-sm font-semibold text-[#00346f] underline decoration-[#00346f]/30 underline-offset-2"
            onClick={() => onNavigate('/dashboard')}
          >
            Volver al panel
          </button>
        </div>
      </div>

      {role === 'administrator' ? (
        <p className="rounded-lg border border-[#c2c6d3] bg-[#f3f4f5] p-3 text-sm text-[#424751]">
          Como administrador ves todos los trabajos del sistema. La creación de trabajos está reservada a cuentas de
          arquitecto.
        </p>
      ) : role !== 'architect' ? (
        <p className="text-sm text-amber-800">Asigná rol en Supabase para usar esta página.</p>
      ) : null}

      {error ? <p className="text-sm text-[#ba1a1a]">{error}</p> : null}

      <div className="rounded-lg border border-[#E2E8F0] bg-white p-5 shadow-[0px_10px_25px_rgba(0,52,111,0.06)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#424751]">Listado</h2>
        <ul className="mt-3 space-y-3">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E8F0] pb-3 last:border-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[#191c1d]">{j.title}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#424751]">
                  <span className="rounded-full bg-[#e7e8e9] px-2 py-0.5 font-mono text-[11px] text-[#191c1d]">
                    {j.status ?? 'pending'}
                  </span>
                  {formatJobCreatedAt(j.created_at) ? (
                    <span className="font-mono text-[11px]">{formatJobCreatedAt(j.created_at)}</span>
                  ) : null}
                  {role === 'administrator' ? (
                    <span className="font-mono text-[11px]" title={j.owner_user_id}>
                      dueño {j.owner_user_id.slice(0, 8)}…
                    </span>
                  ) : null}
                  {role === 'architect' && j.owner_user_id === session?.user.id ? dwgBadge(dwgRegistry[j.id]) : null}
                </div>
                {uploadingThis(j.id) ? (
                  <p className="mt-2 font-mono text-[11px] text-[#00346f]">{uploadProgress?.label}</p>
                ) : null}
                {j.error ? (
                  <p className="mt-2 text-xs text-[#ba1a1a]">
                    {j.error.code} — correlation: {j.error.correlation_id}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {role === 'architect' && j.owner_user_id === session?.user.id ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(uploadProgress)}
                      className="rounded border border-[#00346f]/40 px-2 py-1 text-xs font-semibold text-[#00346f] hover:bg-[#00346f]/5 disabled:opacity-50"
                      onClick={() => openPicker(j.id)}
                    >
                      {uploadingThis(j.id) ? 'Subiendo…' : 'Subir .dwg'}
                    </button>
                    <button
                      type="button"
                      disabled={
                        processingId === j.id ||
                        j.status === 'procesando' ||
                        j.status === 'processing' ||
                        Boolean(uploadProgress)
                      }
                      className="rounded border border-[#737783] px-2 py-1 text-xs text-[#191c1d] disabled:opacity-50"
                      onClick={() => void processJob(j.id)}
                    >
                      {processingId === j.id ? 'Procesando…' : 'Procesar'}
                    </button>
                  </>
                ) : null}
                {role === 'architect' || role === 'administrator' ? (
                  canDownloadProcessedDwg(j.status) ? (
                    <button
                      type="button"
                      disabled={downloadingId === j.id || Boolean(uploadProgress)}
                      className="rounded border border-[#00346f]/40 px-2 py-1 text-xs font-semibold text-[#00346f] hover:bg-[#00346f]/5 disabled:opacity-50"
                      onClick={() => void downloadProcessedDwg(j.id)}
                    >
                      {downloadingId === j.id ? 'Descargando…' : 'Descargar .dwg'}
                    </button>
                  ) : null
                ) : null}
              </div>
            </li>
          ))}
          {jobs.length === 0 ? (
            <li className="py-6 text-center text-sm text-[#424751]">
              Sin trabajos.
              {role === 'architect' ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="font-semibold text-[#00346f] underline decoration-[#00346f]/30"
                    onClick={() => onNavigate('/jobs/new')}
                  >
                    Crear nuevo análisis
                  </button>
                </>
              ) : null}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  )
}
