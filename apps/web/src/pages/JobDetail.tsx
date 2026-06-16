import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import ProjectFileBar from '../components/ProjectFileBar'
import DxfWorkspaceViewer from '../components/DxfWorkspaceViewer'
import type { LayerSuggestions } from '../components/DxfLayerPanel'
import { type RenderData } from '../components/PlanViewer2D'
import {
  RoomProcessingPanel,
  type RoomProcessingState,
} from '../components/RoomProcessingPanel'
import WorkspaceChatPanel from '../components/WorkspaceChatPanel'
import { useAuth } from '../context/AuthContext'
import {
  canDownloadProcessedDxf,
  fileRowStatus,
  formatJobCreatedAt,
  hasRegisteredDxfInput,
  isAnalyzing,
  isReadyForWorkspace,
  isRoomProcessingAvailable,
  JOB_ANALYSIS_INITIAL_WAIT_MS,
  JOB_ANALYSIS_RETRY_WAIT_MS,
  ROOM_PROCESSING_POLL_MS,
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

type Room = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

type PreliminaryRecommendation = {
  room_id: string
  room_label: string
  recommendations: string[]
  outlet_count: number
  rule_ids: string[]
}

type WorkspaceSummary = {
  status: string
  normative_rules_enabled: boolean
  rooms: Room[]
  preliminary_recommendations: PreliminaryRecommendation[]
  room_processing_state: RoomProcessingState
  normative_rules_version: string | null
  preliminary_analysis_completed_at: string | null
  layer_suggestions?: LayerSuggestions | null
  dxf_stream_url?: string | null
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
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [togglingRules, setTogglingRules] = useState(false)
  const [renderData, setRenderData] = useState<RenderData | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [dxfReloadToken, setDxfReloadToken] = useState(0)
  const captureViewRef = useRef<(() => string | null) | null>(null)

  const handleCaptureReady = useCallback((capture: (() => string | null) | null) => {
    captureViewRef.current = capture
  }, [])

  const isOwner = job?.owner_user_id === session?.user.id
  const canEdit = role === 'architect' && isOwner

  const loadWorkspace = useCallback(async (currentSession: typeof session) => {
    if (!currentSession) return
    try {
      const res = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace`, {
        headers: { Authorization: `Bearer ${currentSession.access_token}` },
      })
      if (res.ok) {
        const data = (await res.json()) as WorkspaceSummary
        setWorkspace(data)
      }
    } catch {
      // workspace not critical — ignore
    }
  }, [jobId])

  const loadRenderData = useCallback(async (currentSession: typeof session) => {
    if (!currentSession) return
    try {
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/render-data`,
        { headers: { Authorization: `Bearer ${currentSession.access_token}` } },
      )
      const body = (await res.json().catch(() => ({}))) as RenderData & {
        error?: string
        code?: string
        status?: string
      }
      if (res.ok) {
        setRenderData(body)
        setRenderError(null)
      } else {
        setRenderData(null)
        setRenderError(
          body.error ??
            (body.code === 'WRONG_STATUS'
              ? `Datos de render no disponibles (estado: ${body.status ?? 'desconocido'})`
              : `No se pudo cargar el plano (HTTP ${res.status})`),
        )
      }
    } catch {
      setRenderError('Error de red al cargar datos del plano.')
    }
  }, [jobId])

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!session) return
    const silent = options?.silent === true
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    const res = await fetch(`${apiBase}/api/jobs`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = (await res.json().catch(() => ({}))) as { jobs?: Job[]; error?: string }
    if (!silent) setLoading(false)
    if (!res.ok) {
      if (!silent) {
        setError(body.error ?? `HTTP ${res.status}`)
        setJob(null)
      }
      return
    }
    const found = (body.jobs ?? []).find((j) => j.id === jobId) ?? null
    setJob(found)
    if (!found) {
      if (!silent) setError('Proyecto no encontrado.')
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
        if (!silent) setHasInput(false)
      }
    }
    const renderableStatuses = [
      'listo_para_editar',
      'parcialmente_procesado',
      'procesado',
      'analizando',
    ]
    if (found && renderableStatuses.includes(found.status ?? '')) {
      const skipRenderRefresh = silent && isAnalyzing(found.status)
      const tasks: Promise<void>[] = [loadWorkspace(session)]
      if (!skipRenderRefresh) tasks.push(loadRenderData(session))
      await Promise.all(tasks)
    }
  }, [session, jobId, role, loadWorkspace, loadRenderData])

  const fetchJobStatus = useCallback(async (): Promise<string | null> => {
    if (!session) return null
    try {
      const res = await fetch(`${apiBase}/api/jobs`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return null
      const body = (await res.json()) as { jobs?: Job[] }
      return body.jobs?.find((j) => j.id === jobId)?.status ?? null
    } catch {
      return null
    }
  }, [session, jobId])

  useEffect(() => {
    void load()
  }, [load])

  // While IA analyzes: check status in the background without updating the UI until it changes.
  const hasProcessingRooms = workspace
    ? Object.values(workspace.room_processing_state ?? {}).some((s) => s === 'procesando')
    : false
  const analyzing = job ? isAnalyzing(job.status) : false

  useEffect(() => {
    if (!session || !job || !analyzing) return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        void checkStatus()
      }, delayMs)
    }

    const checkStatus = async () => {
      if (cancelled) return
      const status = await fetchJobStatus()
      if (cancelled) return
      if (!status || isAnalyzing(status)) {
        schedule(JOB_ANALYSIS_RETRY_WAIT_MS)
        return
      }
      await load()
    }

    schedule(JOB_ANALYSIS_INITIAL_WAIT_MS)

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [session, job?.id, analyzing, fetchJobStatus, load])

  useEffect(() => {
    if (!job) return
    if (analyzing || !hasProcessingRooms) return
    const timer = setInterval(() => {
      void load({ silent: true })
    }, ROOM_PROCESSING_POLL_MS)
    return () => clearInterval(timer)
  }, [job, load, analyzing, hasProcessingRooms])

  async function toggleNormativeRules(enabled: boolean) {
    if (!session || !job) return
    setTogglingRules(true)
    try {
      const res = await fetch(
        `${apiBase}/api/jobs/${encodeURIComponent(job.id)}/normative-rules`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ normative_rules_enabled: enabled }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `HTTP ${res.status}`)
      } else {
        setWorkspace((prev) =>
          prev ? { ...prev, normative_rules_enabled: enabled } : prev,
        )
      }
    } finally {
      setTogglingRules(false)
    }
  }

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

  async function uploadDxfFile(file: File, mode: 'upload' | 'replace') {
    if (!session || !job) return
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
      setUploadLabel(mode === 'replace' ? 'Reemplazando archivo…' : 'Registrando archivo…')
      const endpoint =
        mode === 'replace'
          ? `${apiBase}/api/jobs/${encodeURIComponent(job.id)}/dxf-input/replace`
          : `${apiBase}/api/jobs/${encodeURIComponent(job.id)}/dxf-input/register`
      const reg = await fetch(endpoint, {
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
        setError(regBody.error ?? `HTTP ${reg.status}`)
        return
      }
      if (mode === 'replace') {
        setDxfReloadToken((t) => t + 1)
        setRenderData(null)
        setWorkspace(null)
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
  const canDownload =
    (role === 'architect' || role === 'administrator') && rowStatus.downloadEnabled

  return (
    <AppShell
      activeNav="dashboard"
      onNavigate={onNavigate}
      headerTitle="Gestión de archivos DXF"
      showExport={canDownload}
      onExportClick={canDownload ? () => void downloadProcessedDxf() : undefined}
    >
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
              {createdLabel ? (
                <div className="rounded-lg border border-outline-variant bg-surface-container-high px-4 py-2">
                  <span className="text-technical-label">Creado: {createdLabel}</span>
                </div>
              ) : null}
            </div>
          </section>

          <ProjectFileBar
            jobTitle={job.title}
            jobId={job.id}
            hasInput={hasInput}
            canEdit={canEdit}
            rowStatus={rowStatus}
            createdLabel={createdLabel}
            downloading={downloading}
            uploadLabel={uploadLabel}
            downloadEnabled={Boolean(canDownload)}
            onDownload={() => void downloadProcessedDxf()}
            onFileSelected={(file, mode) => void uploadDxfFile(file, mode)}
          />

          {error ? (
            <p className="mb-6 rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          {isAnalyzing(job.status) ? (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-body-sm text-on-surface-variant">
                Analizando plano DXF… La página no se actualizará hasta que el análisis termine.
              </p>
            </div>
          ) : null}

          {renderError ? (
            <div className="mb-6 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-4">
              <h3 className="mb-2 flex items-center gap-2 font-bold text-on-surface">
                <Icon name="map" className="text-[20px] text-primary" />
                Vista 2D del plano
              </h3>
              <p className="text-body-sm text-on-surface-variant">{renderError}</p>
            </div>
          ) : null}

          {renderData && session ? (
            <div className="mb-6">
              <h3 className="mb-3 flex items-center gap-2 font-bold text-on-surface">
                <Icon name="map" className="text-[20px] text-primary" />
                Vista 2D del plano
              </h3>
              <p className="mb-3 text-body-sm text-on-surface-variant">
                Plano DXF original con control de capas. La capa eléctrica (
                <span className="font-mono text-xs">Cambre_Electrical</span>) se modifica desde el
                chat o al procesar habitaciones con el motor de reglas.
              </p>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <DxfWorkspaceViewer
                  jobId={jobId}
                  apiBase={apiBase}
                  accessToken={session.access_token}
                  layerSuggestions={workspace?.layer_suggestions ?? null}
                  renderData={renderData}
                  selectedRoomId={selectedRoomId}
                  onRoomClick={(id) => setSelectedRoomId((prev) => (prev === id ? null : id))}
                  onCaptureReady={handleCaptureReady}
                  reloadToken={dxfReloadToken}
                />
                <WorkspaceChatPanel
                  jobId={jobId}
                  apiBase={apiBase}
                  accessToken={session.access_token}
                  captureView={() => captureViewRef.current?.() ?? null}
                  canSend={canEdit && isReadyForWorkspace(job.status)}
                  onWorkspaceMutated={() => {
                    setDxfReloadToken((t) => t + 1)
                    void load()
                  }}
                />
              </div>
            </div>
          ) : null}

          {(isReadyForWorkspace(job.status) || (isAnalyzing(job.status) && workspace)) &&
          workspace ? (
            <WorkspacePanel
              workspace={workspace}
              jobStatus={job.status}
              canEdit={canEdit && job.status === 'pendiente'}
              togglingRules={togglingRules}
              onToggleRules={(v) => void toggleNormativeRules(v)}
              selectedRoomId={selectedRoomId}
              onSelectRoom={(id) => setSelectedRoomId((prev) => (prev === id ? null : id))}
            />
          ) : null}

          {canEdit &&
          isRoomProcessingAvailable(job.status) &&
          workspace &&
          session ? (
            <RoomProcessingPanel
              jobId={job.id}
              jobStatus={job.status ?? 'pendiente'}
              rooms={workspace.rooms}
              roomProcessingState={workspace.room_processing_state ?? {}}
              normativeRulesEnabled={workspace.normative_rules_enabled}
              accessToken={session.access_token}
              onStateChange={() => void load()}
            />
          ) : null}

          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

              {canEdit && hasInput ? (
                <div className="mb-4 flex justify-end">
                  <button
                    type="button"
                    className="btn-secondary-outline text-xs"
                    disabled={processing}
                    onClick={() => void processJob()}
                  >
                    {processing ? 'Procesando…' : 'Ejecutar procesamiento completo'}
                  </button>
                </div>
              ) : null}

              {job.error ? (
                <div className="rounded-lg border border-error/30 bg-error-container/40 p-4">
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

function WorkspacePanel({
  workspace,
  jobStatus,
  canEdit,
  togglingRules,
  onToggleRules,
  selectedRoomId,
  onSelectRoom,
}: {
  workspace: WorkspaceSummary
  jobStatus?: string
  canEdit: boolean
  togglingRules: boolean
  onToggleRules: (enabled: boolean) => void
  selectedRoomId?: string | null
  onSelectRoom?: (id: string) => void
}) {
  const isReady = isReadyForWorkspace(jobStatus)
  const roomCount = workspace.rooms.length
  const recsMap = new Map<string, PreliminaryRecommendation>()
  for (const rec of workspace.preliminary_recommendations) {
    recsMap.set(rec.room_id, rec)
  }

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low/30 px-4 py-3">
        <h3 className="flex items-center gap-2 font-bold text-on-surface">
          <Icon name="home_work" className="text-[20px] text-primary" />
          Análisis preliminar del plano
          {!isReady ? (
            <span className="ml-2 text-technical-label font-normal text-on-surface-variant uppercase">
              — en proceso
            </span>
          ) : null}
        </h3>
        <div className="flex items-center gap-3">
          {workspace.normative_rules_version ? (
            <span className="text-technical-label text-outline">
              v{workspace.normative_rules_version}
            </span>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <span className="text-body-sm text-on-surface-variant">Reglas normativas</span>
            <button
              type="button"
              role="switch"
              aria-checked={workspace.normative_rules_enabled}
              disabled={!canEdit || togglingRules}
              onClick={() => onToggleRules(!workspace.normative_rules_enabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${workspace.normative_rules_enabled ? 'bg-primary' : 'bg-surface-container-high'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${workspace.normative_rules_enabled ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </label>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="text-body-sm mb-3 text-on-surface-variant">
          {roomCount === 0
            ? 'No se detectaron habitaciones en el plano.'
            : `${roomCount} habitación${roomCount !== 1 ? 'es' : ''} detectada${roomCount !== 1 ? 's' : ''}.`}
        </p>

        {roomCount > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {workspace.rooms.map((room, i) => {
              const roomId = room.id ?? `room-${i}`
              const rec = recsMap.get(roomId)
              const isSelected = selectedRoomId === roomId
              const showRecs = isSelected && rec
              return (
                <div
                  key={roomId}
                  className={`rounded-lg border p-2.5 transition-colors ${isSelected ? 'border-primary bg-primary-fixed/30' : 'border-outline-variant bg-surface-container-low'} ${onSelectRoom ? 'cursor-pointer' : ''}`}
                  onClick={() => onSelectRoom?.(roomId)}
                  role={onSelectRoom ? 'button' : undefined}
                  tabIndex={onSelectRoom ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onSelectRoom && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      onSelectRoom(roomId)
                    }
                  }}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">
                        {room.label ?? roomId}
                      </p>
                      <p className="text-technical-label truncate text-outline uppercase">
                        {room.room_type ?? '—'}
                        {room.area_m2 ? ` · ${room.area_m2} m²` : ''}
                      </p>
                    </div>
                    {rec && rec.outlet_count > 0 ? (
                      <span className="flex-shrink-0 rounded-full bg-primary-fixed px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">
                        {rec.outlet_count} toma{rec.outlet_count !== 1 ? 's' : ''}
                      </span>
                    ) : null}
                  </div>
                  {showRecs ? (
                    <ul className="space-y-0.5">
                      {rec.recommendations.map((r, ri) => (
                        <li key={ri} className="text-body-sm line-clamp-2 text-on-surface-variant" title={r}>
                          {r}
                        </li>
                      ))}
                    </ul>
                  ) : rec && !isSelected ? (
                    <p className="text-body-sm text-outline italic">
                      {rec.recommendations[0] ?? 'Ver recomendaciones'}
                    </p>
                  ) : !workspace.normative_rules_enabled ? (
                    <p className="text-body-sm text-outline italic">
                      Reglas normativas desactivadas.
                    </p>
                  ) : (
                    <p className="text-body-sm text-outline italic">Sin recomendaciones.</p>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}

        {workspace.preliminary_analysis_completed_at ? (
          <p className="mt-4 text-technical-label text-outline">
            Análisis completado:{' '}
            {new Intl.DateTimeFormat('es', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(workspace.preliminary_analysis_completed_at))}
          </p>
        ) : null}
      </div>
    </div>
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
    <div className="flex flex-col rounded-xl border border-surface-border bg-surface-container-lowest p-4">
      <span className="text-technical-label mb-1 text-on-surface-variant uppercase">{label}</span>
      <span className={`text-headline-lg font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}
