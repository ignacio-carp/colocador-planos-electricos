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
import ActivityLogPanel, {
  type RoomProcessingRun,
} from '../components/ActivityLogPanel'
import RoomListSidebar from '../components/RoomListSidebar'
import RoomProcessingInstructionModal from '../components/RoomProcessingInstructionModal'
import FloatingWorkspaceChat from '../components/FloatingWorkspaceChat'
import { useAuth } from '../context/AuthContext'
import {
  canDownloadProcessedDxf,
  canStartPreliminaryAnalysis,
  canReprocessPreliminaryAnalysis,
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
  preliminary_analysis_warnings?: string[]
  /** Why the geometric room detector did not answer, when it did not. */
  room_detection_failure?: string | null
  room_processing_state: RoomProcessingState
  room_processing_runs?: RoomProcessingRun[]
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
  const [startingAnalysis, setStartingAnalysis] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [togglingRules, setTogglingRules] = useState(false)
  const [renderData, setRenderData] = useState<RenderData | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [dxfReloadToken, setDxfReloadToken] = useState(0)
  const [instructionModalRoomId, setInstructionModalRoomId] = useState<string | null>(null)
  const [processingRoomId, setProcessingRoomId] = useState<string | null>(null)
  const [omittingRoomId, setOmittingRoomId] = useState<string | null>(null)
  const [roomProcessError, setRoomProcessError] = useState<string | null>(null)
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
      let inputRegistered = false
      try {
        const fr = await fetch(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}/files`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (fr.ok) {
          const fb = (await fr.json()) as { files?: { kind: string }[] }
          inputRegistered = hasRegisteredDxfInput(fb.files ?? [])
          setHasInput(inputRegistered)
        }
      } catch {
        if (!silent) setHasInput(false)
      }

      const renderableStatuses = [
        'listo_para_editar',
        'parcialmente_procesado',
        'procesado',
        'analizando',
      ]
      const needsWorkspace =
        (found.status === 'pendiente' && inputRegistered) ||
        renderableStatuses.includes(found.status ?? '')
      if (found && needsWorkspace) {
        await loadWorkspace(session)
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

  const refreshWorkspace = useCallback(() => {
    setDxfReloadToken((t) => t + 1)
    void load({ silent: true })
  }, [load])

  const processRoomWithInstruction = useCallback(
    async (roomId: string, instruction: string) => {
      if (!session) return
      setRoomProcessError(null)
      setProcessingRoomId(roomId)
      setInstructionModalRoomId(null)
      const viewportImage = captureViewRef.current?.() ?? null
      try {
        const res = await fetch(
          `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/process-rooms?sync=1`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              'X-Correlation-Id': crypto.randomUUID(),
            },
            body: JSON.stringify({
              room_ids: [roomId],
              idempotency_key: crypto.randomUUID(),
              processing_instruction: instruction,
              ...(viewportImage ? { viewport_image: viewportImage } : {}),
            }),
          },
        )
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          setRoomProcessError(body.error ?? `Error HTTP ${res.status}`)
          return
        }
        refreshWorkspace()
      } catch {
        setRoomProcessError('Error de red al procesar la habitación.')
      } finally {
        setProcessingRoomId(null)
      }
    },
    [jobId, session, refreshWorkspace],
  )

  const omitRoom = useCallback(
    async (roomId: string) => {
      if (!session) return
      setRoomProcessError(null)
      setOmittingRoomId(roomId)
      try {
        const res = await fetch(
          `${apiBase}/api/jobs/${encodeURIComponent(jobId)}/workspace/omit-rooms`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              'X-Correlation-Id': crypto.randomUUID(),
            },
            body: JSON.stringify({ room_ids: [roomId] }),
          },
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setRoomProcessError(body.error ?? `Error HTTP ${res.status}`)
          return
        }
        refreshWorkspace()
      } catch {
        setRoomProcessError('Error de red al omitir la habitación.')
      } finally {
        setOmittingRoomId(null)
      }
    },
    [jobId, session, refreshWorkspace],
  )

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
    let timeoutId: number | undefined

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

  async function startPreliminaryAnalysis() {
    if (!session || !job) return
    setStartingAnalysis(true)
    setError(null)
    const res = await fetch(
      `${apiBase}/api/jobs/${encodeURIComponent(job.id)}/workspace/start-analysis`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'X-Correlation-Id': crypto.randomUUID(),
        },
      },
    )
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    setStartingAnalysis(false)
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

          {canEdit && canStartPreliminaryAnalysis(job.status, hasInput) ? (
            <PreAnalysisSetup
              normativeRulesEnabled={workspace?.normative_rules_enabled ?? true}
              togglingRules={togglingRules}
              startingAnalysis={startingAnalysis}
              onToggleRules={(v) => void toggleNormativeRules(v)}
              onStartAnalysis={() => void startPreliminaryAnalysis()}
            />
          ) : null}

          {canEdit &&
          canReprocessPreliminaryAnalysis(
            job.status,
            workspace?.rooms.length,
            workspace?.preliminary_analysis_warnings,
          ) &&
          !canStartPreliminaryAnalysis(job.status, hasInput) ? (
            <NoRoomsDetectedBanner
              startingAnalysis={startingAnalysis}
              onReprocess={() => void startPreliminaryAnalysis()}
            />
          ) : null}

          {workspace?.preliminary_analysis_warnings?.includes('ROOMS_FROM_VISION_MODEL') ? (
            <div className="mb-6 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-4">
              <p className="text-body-sm font-bold text-on-surface">
                Ambientes estimados por IA, no medidos del plano
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                El detector geométrico no pudo segmentar este plano, así que los ambientes los
                estimó un modelo a partir de la imagen. Las posiciones de los componentes van a
                ser aproximadas y pueden cambiar entre corridas.
                {workspace?.room_detection_failure ? (
                  <span className="text-technical-label mt-2 block text-outline">
                    {workspace.room_detection_failure}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}

          {isAnalyzing(job.status) ? (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-6 py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-body-sm text-on-surface-variant">
                Analizando plano DXF… La página no se actualizará hasta que el análisis termine.
              </p>
            </div>
          ) : null}

          {session && isReadyForWorkspace(job.status) ? (
            <div className="relative mb-24">
              <h3 className="mb-3 flex items-center gap-2 font-bold text-on-surface">
                <Icon name="map" className="text-[20px] text-primary" />
                Workspace
              </h3>
              <p className="mb-3 text-body-sm text-on-surface-variant">
                Seleccioná una habitación para enfocar el plano. La capa eléctrica (
                <span className="font-mono text-xs">Cambre_Electrical</span>) se modifica desde el
                chat o al procesar habitaciones.
              </p>
              {renderError ? (
                <p className="mb-3 rounded-lg bg-surface-container-low px-3 py-2 text-body-sm text-on-surface-variant">
                  {renderError}
                </p>
              ) : null}
              <div
                className={`grid gap-4 ${(workspace?.rooms.length ?? 0) > 0 ? 'lg:grid-cols-[220px_minmax(0,1fr)]' : ''}`}
              >
                {(workspace?.rooms.length ?? 0) > 0 ? (
                  <RoomListSidebar
                    rooms={workspace?.rooms ?? []}
                    roomProcessingState={workspace?.room_processing_state ?? {}}
                    selectedRoomId={selectedRoomId}
                    onSelectRoom={(id) => setSelectedRoomId((prev) => (prev === id ? null : id))}
                    completedAt={workspace?.preliminary_analysis_completed_at}
                    normativeRulesEnabled={workspace?.normative_rules_enabled ?? true}
                    processingRoomId={processingRoomId}
                    omittingRoomId={omittingRoomId}
                    onProcessRoom={
                      canEdit && (workspace?.normative_rules_enabled ?? true)
                        ? (id) => setInstructionModalRoomId(id)
                        : undefined
                    }
                    onOmitRoom={canEdit ? omitRoom : undefined}
                  />
                ) : null}
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
              </div>
              <FloatingWorkspaceChat
                jobId={jobId}
                apiBase={apiBase}
                accessToken={session.access_token}
                captureView={() => captureViewRef.current?.() ?? null}
                canSend={canEdit && isReadyForWorkspace(job.status)}
                onWorkspaceMutated={refreshWorkspace}
              />
              {roomProcessError ? (
                <p className="mt-3 rounded-lg border border-error-container bg-error-container/30 px-4 py-2 text-body-sm text-on-error-container">
                  {roomProcessError}
                </p>
              ) : null}
              {instructionModalRoomId && session ? (
                <RoomProcessingInstructionModal
                  open
                  jobId={jobId}
                  roomId={instructionModalRoomId}
                  roomLabel={
                    workspace?.rooms.find((r) => r.id === instructionModalRoomId)?.label ??
                    instructionModalRoomId
                  }
                  isReprocess={
                    (workspace?.room_processing_state?.[instructionModalRoomId] ?? 'pendiente') ===
                      'procesada' ||
                    workspace?.room_processing_state?.[instructionModalRoomId] === 'error'
                  }
                  accessToken={session.access_token}
                  onClose={() => setInstructionModalRoomId(null)}
                  onConfirm={(instruction) =>
                    void processRoomWithInstruction(instructionModalRoomId, instruction)
                  }
                />
              ) : null}
            </div>
          ) : null}

          {canEdit &&
          isReadyForWorkspace(job.status) &&
          workspace &&
          session &&
          (isRoomProcessingAvailable(job.status) || job.status === 'procesado') ? (
            <RoomProcessingPanel
              jobId={job.id}
              jobStatus={job.status ?? 'pendiente'}
              rooms={workspace.rooms}
              roomProcessingState={workspace.room_processing_state ?? {}}
              normativeRulesEnabled={workspace.normative_rules_enabled}
              accessToken={session.access_token}
              onStateChange={refreshWorkspace}
            />
          ) : null}

          {(isOwner || role === 'administrator') && workspace ? (
            <ActivityLogPanel
              rooms={workspace.rooms}
              roomProcessingRuns={workspace.room_processing_runs ?? []}
              roomProcessingState={workspace.room_processing_state ?? {}}
              preliminaryAnalysisCompletedAt={workspace.preliminary_analysis_completed_at}
              jobError={job.error ?? null}
              onRefresh={refreshWorkspace}
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

              {job.error ? (
                <div className="rounded-lg border border-error/30 bg-error-container/40 p-4">
                  <p className="text-body-sm font-semibold text-on-error-container">
                    El análisis falló
                  </p>
                  <p className="text-body-sm mt-1 text-on-error-container">
                    {job.error.message || job.error.code} — ID soporte: {job.error.correlation_id}
                  </p>
                  {canEdit && hasInput ? (
                    <button
                      type="button"
                      className="btn-primary mt-4"
                      disabled={startingAnalysis}
                      onClick={() => void startPreliminaryAnalysis()}
                    >
                      {startingAnalysis ? 'Reintentando…' : 'Reintentar análisis'}
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

function NoRoomsDetectedBanner({
  startingAnalysis,
  onReprocess,
}: {
  startingAnalysis: boolean
  onReprocess: () => void
}) {
  return (
    <div className="mb-6 rounded-xl border border-secondary-container bg-secondary-container/30 px-6 py-4">
      <h3 className="mb-1 flex items-center gap-2 font-bold text-on-surface">
        <Icon name="warning" className="text-[20px] text-secondary" />
        No se detectaron habitaciones
      </h3>
      <p className="text-body-sm mb-4 text-on-surface-variant">
        El análisis terminó sin identificar ambientes en el plano. Podés reprocesar el análisis o
        trabajar manualmente con el chat y el visor.
      </p>
      <button
        type="button"
        className="btn-secondary-outline"
        disabled={startingAnalysis}
        onClick={onReprocess}
      >
        {startingAnalysis ? 'Reprocesando…' : 'Reprocesar análisis'}
      </button>
    </div>
  )
}

function PreAnalysisSetup({
  normativeRulesEnabled,
  togglingRules,
  startingAnalysis,
  onToggleRules,
  onStartAnalysis,
}: {
  normativeRulesEnabled: boolean
  togglingRules: boolean
  startingAnalysis: boolean
  onToggleRules: (enabled: boolean) => void
  onStartAnalysis: () => void
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-low/30 px-4 py-3">
        <h3 className="flex items-center gap-2 font-bold text-on-surface">
          <Icon name="upload_file" className="text-[20px] text-primary" />
          Listo para analizar
        </h3>
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <span className="text-body-sm text-on-surface-variant">Reglas normativas</span>
          <button
            type="button"
            role="switch"
            aria-checked={normativeRulesEnabled}
            disabled={togglingRules || startingAnalysis}
            onClick={() => onToggleRules(!normativeRulesEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${normativeRulesEnabled ? 'bg-primary' : 'bg-surface-container-high'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${normativeRulesEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <p className="text-body-sm max-w-xl text-on-surface-variant">
          El plano DXF está registrado. Configurá las reglas normativas y pulsá iniciar análisis
          cuando quieras detectar habitaciones y preparar el workspace.
        </p>
        <button
          type="button"
          className="btn-primary shrink-0"
          disabled={startingAnalysis}
          onClick={onStartAnalysis}
        >
          {startingAnalysis ? 'Iniciando…' : 'Iniciar análisis'}
        </button>
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
