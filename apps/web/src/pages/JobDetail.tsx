import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import {
  canDownloadProcessedDxf,
  fileRowStatus,
  formatJobCreatedAt,
  hasRegisteredDxfInput,
} from '../lib/jobPresentation'
import { getAppRole } from '../lib/roles'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type Job = {
  id: string
  owner_user_id: string
  title: string
  status?: string
  created_at?: string
  error?: { code: string; message: string; correlation_id: string }
}

type JobDetailProps = {
  jobId: string
  onNavigate: (path: string) => void
}

export default function JobDetail({ jobId, onNavigate }: JobDetailProps) {
  const { session } = useAuth()
  const role = getAppRole(session?.user)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasInput, setHasInput] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isOwner = job?.owner_user_id === session?.user.id
  const canEdit = role === 'architect' && isOwner

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    const res = await fetch(`${apiBase}/api/jobs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = (await res.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
    setLoading(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setJob(null)
      return
    }
    const found = (body.jobs ?? []).find((j) => j.id === jobId) ?? null
    setJob(found)
    if (!found) {
      setError('Proyecto no encontrado.')
      return
    }
    if (role === 'architect' && found.owner_user_id === session.user.id) {
      try {
        const fr = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/files`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (fr.ok) {
          const fb = (await fr.json()) as { files?: { kind: string }[] }
          setHasInput(hasRegisteredDxfInput(fb.files ?? []))
        }
      } catch {
        setHasInput(false)
      }
    }
  }, [session, jobId, role])

  useEffect(() => {
    void load()
  }, [load])

  async function processJob() {
    if (!session || !job) return
    setProcessing(true)
    setError(null)
    const res = await fetch(
      `${apiBase}/api/jobs/${encodeURIComponent(job.id)}/process?sync=1`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'X-Correlation-Id': crypto.randomUUID(),
        },
      },
    )
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    setProcessing(false)
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!session || !file || !job) return
    if (!file.name.toLowerCase().endsWith('.dxf')) {
      setError('Solo archivos .dxf')
      return
    }
    setError(null)
    try {
      const contentType =
        file.type && file.type.trim() !== '' ? file.type : 'application/octet-stream'
      setUploadLabel('Obteniendo URL firmada…')
      const sur = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(job.id)}/dxf-input/signed-upload-url`, {
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
      setUploadLabel('Subiendo archivo…')
      const put = await fetch(suBody.signedUrl!, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      })
      if (!put.ok) {
        setError(`Fallo al subir (HTTP ${put.status})`)
        return
      }
      setUploadLabel('Registrando archivo…')
      const reg = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(job.id)}/dxf-input/register`, {
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
      setUploadLabel(null)
    }
    await load()
  }

  async function downloadProcessedDxf() {
    if (!session || !job) return
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(job.id)}/download`, {
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
          : `/api/jobs/${encodeURIComponent(job.id)}/dxf-output/stream`
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
      const filename = filenameMatch?.[1] ?? `job-${job.id}-output.dxf`
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
      setDownloading(false)
    }
  }

  const rowStatus = fileRowStatus(job?.status, hasInput)
  const createdLabel = formatJobCreatedAt(job?.created_at)

  return (
    <AppShell
      activeNav="dashboard"
      onNavigate={onNavigate}
      headerTitle="Gestión de archivos DXF"
      showExport={canDownloadProcessedDxf(job?.status)}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".dxf,application/dxf,application/octet-stream"
        className="hidden"
        onChange={onFilePicked}
      />

      {loading ? (
        <p className="text-on-surface-variant">Cargando proyecto…</p>
      ) : !job ? (
        <div>
          <p className="text-on-error-container">{error ?? 'Proyecto no disponible.'}</p>
          <button type="button" className="btn-primary mt-4" onClick={() => onNavigate('/dashboard')}>
            Volver a proyectos
          </button>
        </div>
      ) : (
        <>
          <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <button
                type="button"
                className="text-technical-label mb-2 flex items-center gap-2 tracking-widest text-on-surface-variant uppercase hover:text-primary"
                onClick={() => onNavigate('/dashboard')}
              >
                <Icon name="arrow_back" className="text-[18px]" />
                Volver a proyectos / {job.id.slice(0, 8)}
              </button>
              <h1 className="text-display-lg text-primary">{job.title}</h1>
              <p className="text-body-lg mt-2 text-on-surface-variant">
                Optimización estructural y portal de conversión CAD.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2">
                <Icon name="check_circle" filled className="text-success" />
                <span className="text-technical-label font-bold uppercase">{rowStatus.label}</span>
              </div>
              {createdLabel ? (
                <div className="rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2">
                  <span className="text-technical-label">Creado: {createdLabel}</span>
                </div>
              ) : null}
            </div>
          </section>

          {error ? (
            <p className="mb-6 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-12 gap-6">
            {canEdit ? (
              <div className="col-span-12 flex flex-col lg:col-span-4">
                <div
                  className="group flex min-h-[320px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-lowest p-8 text-center transition-colors hover:border-primary/40"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const f = e.dataTransfer.files?.[0]
                    if (f && fileRef.current) {
                      const dt = new DataTransfer()
                      dt.items.add(f)
                      fileRef.current.files = dt.files
                      fileRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                    }
                  }}
                >
                  <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-fixed transition-transform group-hover:scale-110">
                    <Icon name="cloud_upload" className="text-3xl text-primary" />
                  </div>
                  <h3 className="text-headline-md text-on-surface mb-2">Subir archivos DXF</h3>
                  <p className="text-body-sm mb-6 max-w-[240px] text-on-surface-variant">
                    Arrastrá tus planos aquí o seleccioná un archivo desde tu equipo.
                  </p>
                  <button
                    type="button"
                    className="btn-primary px-8"
                    disabled={Boolean(uploadLabel)}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploadLabel ?? 'Seleccionar archivos'}
                  </button>
                  <p className="text-technical-label mt-4 text-outline uppercase">Solo .dxf</p>
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn-secondary-outline mt-6 text-xs"
                      disabled={processing || !hasInput}
                      onClick={() => void processJob()}
                    >
                      {processing ? 'Procesando…' : 'Ejecutar procesamiento'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className={`col-span-12 ${canEdit ? 'lg:col-span-8' : ''}`}>
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard label="Archivos" value={hasInput ? '1' : '0'} />
                <StatCard
                  label="Procesados"
                  value={canDownloadProcessedDxf(job.status) ? '1' : '0'}
                  tone="success"
                />
                <StatCard
                  label="Pendientes"
                  value={hasInput && !canDownloadProcessedDxf(job.status) ? '1' : '0'}
                  tone="danger"
                />
              </div>

              <div className="overflow-hidden rounded-xl border border-surface-border bg-surface-container-lowest shadow-sm">
                <div className="flex items-center justify-between border-b border-surface-border bg-surface-container-low/30 px-6 py-4">
                  <h3 className="flex items-center gap-2 font-bold text-on-surface">
                    <Icon name="list_alt" className="text-[20px]" />
                    Archivo de proyecto
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr>
                        <th className="text-technical-label border-b border-surface-border px-6 py-4 text-outline uppercase">
                          Archivo original
                        </th>
                        <th className="text-technical-label border-b border-surface-border px-6 py-4 text-outline uppercase">
                          Detalles
                        </th>
                        <th className="text-technical-label border-b border-surface-border px-6 py-4 text-center text-outline uppercase">
                          Estado
                        </th>
                        <th className="text-technical-label border-b border-surface-border px-6 py-4 text-right text-outline uppercase">
                          Archivo procesado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                      <tr className="transition-colors hover:bg-surface-container-low">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-container-high">
                              <Icon name="description" className="text-primary" />
                            </div>
                            <div>
                              <p className="text-body-sm font-bold text-on-surface">
                                {hasInput ? `${job.title.replace(/\s+/g, '_')}.dxf` : '—'}
                              </p>
                              <p className="text-technical-label text-outline">JOB_{job.id.slice(0, 8).toUpperCase()}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-technical-label text-on-surface">
                            {hasInput ? 'DXF registrado' : 'Sin carga'}
                          </p>
                          {createdLabel ? (
                            <p className="text-technical-label text-outline">{createdLabel}</p>
                          ) : null}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className={`text-technical-label inline-flex items-center rounded-full px-3 py-1 ${rowStatus.className}`}
                            >
                              {rowStatus.label}
                            </span>
                            {rowStatus.showProgress ? (
                              <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-surface-container-high">
                                <div
                                  className="h-full bg-primary"
                                  style={{ width: `${rowStatus.progressPct ?? 0}%` }}
                                />
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {(role === 'architect' || role === 'administrator') &&
                          rowStatus.downloadEnabled ? (
                            <button
                              type="button"
                              disabled={downloading}
                              className="btn-primary ml-auto px-4 py-2"
                              onClick={() => void downloadProcessedDxf()}
                            >
                              <Icon name="download" className="text-[18px]" />
                              {downloading ? 'Descargando…' : 'Descargar .DXF'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="ml-auto flex items-center gap-2 rounded bg-surface-container-high px-4 py-2 text-button text-outline opacity-50"
                            >
                              <Icon name="download" className="text-[18px]" />
                              Descargar .DXF
                            </button>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {job.error ? (
                <div className="mt-4 rounded-lg border border-error/30 bg-error-container/40 p-4">
                  <p className="text-body-sm font-semibold text-on-error-container">
                    El procesamiento falló
                  </p>
                  <p className="text-body-sm mt-1 text-on-error-container">
                    {job.error.message || job.error.code} — ID soporte: {job.error.correlation_id}
                  </p>
                  {canEdit && hasInput ? (
                    <button
                      type="button"
                      className="btn-primary mt-4"
                      disabled={processing}
                      onClick={() => void processJob()}
                    >
                      {processing ? 'Reintentando…' : 'Reprocesar análisis'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </AppShell>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'success' | 'danger'
}) {
  const valueClass =
    tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-brand-red' : 'text-primary'
  return (
    <div className="flex flex-col rounded-xl border border-surface-border bg-surface-container-lowest p-6">
      <span className="text-technical-label mb-2 text-on-surface-variant uppercase">{label}</span>
      <span className={`text-headline-lg font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}
