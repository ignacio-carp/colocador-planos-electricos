import { loadEnv } from './loadEnv'
loadEnv()

import cors from 'cors'
import express from 'express'
import { getCorsOptions } from './corsConfig'
import { sendSupabaseInvitation } from './email/sendSupabaseInvitation'
import { findUserByEmail } from './bootstrapAdmin'
import { completeSupabaseInvitation } from './inviteComplete'
import {
  assertAllowedDxfContentType,
  buildDxfObjectPath,
  DXF_INPUT_BUCKET,
  DXF_OUTPUT_BUCKET,
  objectPathMatchesJobAndOwner,
} from './dxfStorage'
import { DxfReplaceError, replaceDxfInput } from './dxfInputReplace'
import {
  findLatestInputForJob,
  findLatestOutputForJob,
  insertFileRow,
  listFilesForJob,
} from './filesStore'
import { suggestLayersFromInspect } from './layerSuggestions'
import { acceptInvitation } from './inviteAccept'
import { createInviteRateLimiter } from './inviteRateLimit'
import {
  createInvitationRecord,
  findInviteByRawToken,
  findPendingInviteByEmail,
  generateInviteToken,
  removeInvitationById,
} from './invitesStore'
import { createJob, findJob, listAllJobs, listJobsForOwner, patchJob, type JobRow } from './jobsStore'
import {
  markJobProcessed,
  omitRooms,
  runRoomProcessingPipeline,
} from './roomProcessingPipeline'
import {
  applyDxfQuotaHeaders,
  assertDxfUploadWithinQuota,
  checkJobCreationQuota,
  QuotaExceededError,
} from './quota'
import { cadWorkerConfigSummary, cadWorkerTransport, probeCadWorkerOnStartup } from './cadWorkerBridge'
import { logStructured } from './logger'
import { enqueueJobPipeline, enqueuePreliminaryAnalysis } from './jobQueue'
import { drainPipelineQueueOnce, pipelineWorkerEnabled, startPipelineWorker } from './pipelineWorker'
import { formatPrometheusMetrics, getMetricsSnapshot } from './metrics'
import { correlationMiddleware } from './middleware/correlation'
import { requireAuth, type AuthedRequest } from './middleware/requireAuth'
import { requireArchitectOrAdmin, requireRole } from './middleware/requireRole'
import { getAppRole } from './roles'
import {
  normalizeElectricalElements,
  normalizeRenderLabels,
  normalizeRenderRoomVertices,
  normalizeRenderWalls,
  resolveLayoutInterpretation,
} from './renderDataHelpers'
import { resolveElectricalSymbolRadius } from './symbolScale'
import { listElectricalCatalog } from './electricalCatalog'
import { listChatMessages } from './chatStore'
import {
  CHAT_ALLOWED_STATUSES,
  handleWorkspaceChatMessage,
  WorkspaceChatError,
} from './workspaceChat'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const app = express()
app.use(cors(getCorsOptions()))
// 8mb: workspace chat may attach a base64 screenshot of the rendered viewport.
app.use(express.json({ limit: '8mb' }))
app.use(correlationMiddleware)

const inviteRateLimiter = createInviteRateLimiter()

function publicWebBase(): string {
  const raw = process.env.PUBLIC_WEB_URL?.trim()
  if (!raw) return 'http://localhost:5173'
  return raw.replace(/\/$/, '')
}

const INVITE_TTL_MS = Number(process.env.INVITE_TOKEN_TTL_MS ?? 7 * 24 * 60 * 60 * 1000)

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function requireStorage(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!isStorageConfigured()) {
    res.status(503).json({
      error: 'Storage not configured',
      hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)',
    })
    return
  }
  next()
}

function signedUrlTtlSeconds(): number {
  const raw = process.env.SIGNED_URL_TTL_SECONDS
  const n = raw ? Number(raw) : 3600
  return Number.isFinite(n) && n > 60 && n <= 60 * 60 * 24 ? Math.floor(n) : 3600
}

function respondQuotaExceeded(res: express.Response, err: QuotaExceededError): void {
  res.status(413).json({ error: err.message, code: err.code })
}

function assertJobAccess(userId: string, role: ReturnType<typeof getAppRole>, job: JobRow): boolean {
  if (!role) return false
  if (role === 'administrator') return true
  return job.owner_user_id === userId
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    cad_worker: cadWorkerConfigSummary(),
  })
})

app.get('/api/me', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  res.json({
    id: user.id,
    email: user.email,
    role: getAppRole(user),
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  })
})

/** US-005: solo arquitecto puede crear jobs vía API; administrador recibe 403. */
app.post('/api/jobs', requireAuth, requireRole('architect'), async (req, res) => {
  const { user } = req as AuthedRequest
  const title = String((req.body as { title?: string })?.title ?? '').trim()
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  try {
    checkJobCreationQuota(user.id)
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      respondQuotaExceeded(res, e)
      return
    }
    throw e
  }
  try {
    const job = await createJob(user.id, title)
    res.status(201).json(job)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not create job' })
  }
})

/**
 * S-01: encola pipeline (async). Worker `PIPELINE_WORKER_ENABLED` o drain manual en tests.
 * `?sync=1` ejecuta un ciclo de worker en la misma request (dev/legacy).
 */
app.post(
  '/api/jobs/:jobId/process',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const correlationId = req.correlationId
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    if (job.status === 'procesando' || job.status === 'analizando') {
      res.status(409).json({ error: 'Job already processing' })
      return
    }
    if (job.status === 'procesado') {
      res.status(409).json({ error: 'Job already processed' })
      return
    }
    if (job.status === 'error') {
      await patchJob(jobId, { status: 'pendiente', error: undefined })
    }
    const msg = await enqueueJobPipeline(jobId, correlationId)
    if (!msg) {
      res.status(409).json({ error: 'Cannot enqueue job in current state' })
      return
    }
    const sync =
      req.query.sync === '1' ||
      req.query.sync === 'true' ||
      process.env.PIPELINE_SYNC_PROCESS === 'true'
    if (sync) {
      await drainPipelineQueueOnce()
      const updated = await findJob(jobId)
      if (!updated) {
        res.status(404).json({ error: 'Job not found' })
        return
      }
      res.status(200).json(updated)
      return
    }
    if (pipelineWorkerEnabled()) {
      void drainPipelineQueueOnce()
    }
    res.status(202).json({ queued: true, jobId, correlationId, queueId: msg.id })
  },
)

/** T-07 métricas — JSON y Prometheus; solo administrador. */
app.get('/api/metrics', requireAuth, requireRole('administrator'), (_req, res) => {
  res.json(getMetricsSnapshot())
})

app.get('/api/metrics/prometheus', requireAuth, requireRole('administrator'), (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  res.send(formatPrometheusMetrics())
})

/**
 * US-004 / US-010: listado respeta rol — arquitecto solo ve sus jobs; admin ve todos con dueño.
 */
app.get('/api/jobs', requireAuth, requireArchitectOrAdmin, async (req, res) => {
  const { user } = req as AuthedRequest
  const role = getAppRole(user)
  if (!role) {
    res.status(403).json({ error: 'Missing role', hint: 'Set app_metadata.role in Supabase' })
    return
  }
  try {
    if (role === 'administrator') {
      res.json({ jobs: await listAllJobs() })
      return
    }
    res.json({ jobs: await listJobsForOwner(user.id) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not list jobs' })
  }
})

/**
 * US-006: URL firmada de subida (sin URL pública permanente). Solo dueño del job (arquitecto).
 */
app.post(
  '/api/jobs/:jobId/dxf-input/signed-upload-url',
  requireAuth,
  requireStorage,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    let contentType: string
    const uploadBody = req.body as { contentType?: string; sizeBytes?: number }
    try {
      contentType = String(uploadBody.contentType ?? '').trim()
      assertAllowedDxfContentType(contentType)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid content type' })
      return
    }

    const optionalSize = uploadBody.sizeBytes
    if (optionalSize !== undefined) {
      if (typeof optionalSize !== 'number' || !Number.isFinite(optionalSize) || optionalSize < 1) {
        res.status(400).json({ error: 'sizeBytes must be a positive number' })
        return
      }
      try {
        assertDxfUploadWithinQuota({
          sizeBytes: optionalSize,
          userId: user.id,
          jobId: job.id,
        })
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          respondQuotaExceeded(res, e)
          return
        }
        throw e
      }
    }

    const objectPath = buildDxfObjectPath(job.owner_user_id, job.id)
    try {
      const sb = getSupabaseServiceRole()
      const { data, error } = await sb.storage.from(DXF_INPUT_BUCKET).createSignedUploadUrl(objectPath, {
        upsert: true,
      })
      if (error || !data) {
        console.error(error)
        res.status(502).json({ error: 'Could not create signed upload URL' })
        return
      }
      applyDxfQuotaHeaders(res.setHeader.bind(res))
      res.status(200).json({
        bucket: DXF_INPUT_BUCKET,
        objectPath: data.path,
        signedUrl: data.signedUrl,
        token: data.token,
        contentType,
        note: 'Upload via PUT to signedUrl with file body; then call POST .../dxf-input/register',
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Storage error' })
    }
  },
)

/**
 * US-006: registra fila `files` enlazada al job tras subida exitosa a Storage.
 */
app.post(
  '/api/jobs/:jobId/dxf-input/register',
  requireAuth,
  requireStorage,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    const body = req.body as { objectPath?: string; contentType?: string; sizeBytes?: number }
    const objectPath = String(body.objectPath ?? '').trim()
    const parsed = objectPathMatchesJobAndOwner(objectPath, job.owner_user_id, job.id)
    if (!parsed) {
      res.status(400).json({ error: 'objectPath does not match job/owner or is not a valid .dxf path' })
      return
    }
    try {
      assertAllowedDxfContentType(body.contentType)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid content type' })
      return
    }
    const sizeBytes = body.sizeBytes
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 1) {
      res.status(400).json({ error: 'sizeBytes must be a positive number' })
      return
    }

    try {
      assertDxfUploadWithinQuota({
        sizeBytes,
        userId: user.id,
        jobId: job.id,
      })
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        respondQuotaExceeded(res, e)
        return
      }
      throw e
    }

    try {
      const sb = getSupabaseServiceRole()
      const row = await insertFileRow(sb, {
        job_id: job.id,
        owner_user_id: job.owner_user_id,
        bucket_id: DXF_INPUT_BUCKET,
        object_path: objectPath,
        kind: 'input_dxf',
        content_type: String(body.contentType).split(';')[0]?.trim() ?? null,
        size_bytes: Math.floor(sizeBytes),
      })
      applyDxfQuotaHeaders(res.setHeader.bind(res))
      const correlationId = req.correlationId
      const queued = await enqueuePreliminaryAnalysis(job.id, correlationId)
      if (pipelineWorkerEnabled() && queued) {
        void drainPipelineQueueOnce()
      }
      res.status(201).json({ file: row, pipelineQueued: Boolean(queued) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('duplicate') || msg.includes('unique')) {
        res.status(409).json({ error: 'File row already exists for this storage path' })
        return
      }
      console.error(e)
      res.status(500).json({ error: 'Could not register file' })
    }
  },
)

/**
 * Replace active input DXF and restart preliminary analysis (resets workspace progress).
 */
app.post(
  '/api/jobs/:jobId/dxf-input/replace',
  requireAuth,
  requireStorage,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    const body = req.body as { objectPath?: string; contentType?: string; sizeBytes?: number }
    const objectPath = String(body.objectPath ?? '').trim()
    const parsed = objectPathMatchesJobAndOwner(objectPath, job.owner_user_id, job.id)
    if (!parsed) {
      res.status(400).json({ error: 'objectPath does not match job/owner or is not a valid .dxf path' })
      return
    }
    try {
      assertAllowedDxfContentType(body.contentType)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid content type' })
      return
    }
    const sizeBytes = body.sizeBytes
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 1) {
      res.status(400).json({ error: 'sizeBytes must be a positive number' })
      return
    }
    try {
      assertDxfUploadWithinQuota({ sizeBytes, userId: user.id, jobId: job.id })
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        respondQuotaExceeded(res, e)
        return
      }
      throw e
    }
    try {
      const result = await replaceDxfInput({
        jobId: job.id,
        ownerUserId: job.owner_user_id,
        objectPath,
        contentType: String(body.contentType).split(';')[0]?.trim() ?? null,
        sizeBytes,
        correlationId: req.correlationId,
      })
      applyDxfQuotaHeaders(res.setHeader.bind(res))
      res.status(200).json(result)
    } catch (e) {
      if (e instanceof DxfReplaceError) {
        const status = e.code === 'JOB_NOT_FOUND' ? 404 : e.code === 'NOT_JOB_OWNER' ? 403 : 409
        res.status(status).json({ error: e.message, code: e.code })
        return
      }
      console.error(e)
      res.status(500).json({ error: 'Could not replace DXF input' })
    }
  },
)

/** Lista metadatos `files` del job (dueño o admin). */
app.get('/api/jobs/:jobId/files', requireAuth, requireStorage, requireArchitectOrAdmin, async (req, res) => {
  const { user } = req as AuthedRequest
  const role = getAppRole(user)
  if (!role) {
    res.status(403).json({ error: 'Missing role' })
    return
  }
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' })
    return
  }
  const job = await findJob(jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  if (!assertJobAccess(user.id, role, job)) {
    res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
    return
  }
  try {
    const sb = getSupabaseServiceRole()
    const files = await listFilesForJob(sb, jobId)
    res.json({ files })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not list files' })
  }
})

/**
 * US-010: metadatos de descarga — URL firmada temporal (no pública permanente) o referencia a stream autenticado.
 */
app.get('/api/jobs/:jobId/download', requireAuth, requireStorage, requireArchitectOrAdmin, async (req, res) => {
  const { user } = req as AuthedRequest
  const role = getAppRole(user)
  if (!role) {
    res.status(403).json({ error: 'Missing role' })
    return
  }
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId' })
    return
  }
  const job = await findJob(jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  if (!assertJobAccess(user.id, role, job)) {
    res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
    return
  }
  try {
    const sb = getSupabaseServiceRole()
    const output = await findLatestOutputForJob(sb, jobId)
    if (!output) {
      res.status(404).json({
        error: 'No output file yet',
        hint: 'Pipeline must register an output_dxf row (e.g. cad-worker) before download is available',
      })
      return
    }
    const ttl = signedUrlTtlSeconds()
    const { data, error } = await sb.storage.from(output.bucket_id).createSignedUrl(output.object_path, ttl)
    if (error || !data?.signedUrl) {
      console.error(error)
      res.status(502).json({ error: 'Could not create signed download URL' })
      return
    }
    res.json({
      jobId: job.id,
      owner_user_id: job.owner_user_id,
      signedUrl: data.signedUrl,
      expiresInSeconds: ttl,
      streamUrl: `/api/jobs/${encodeURIComponent(jobId)}/dxf-output/stream`,
      file: { id: output.id, bucket_id: output.bucket_id, object_path: output.object_path, kind: output.kind },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Download error' })
  }
})

/** US-010: stream autenticado del .dxf de salida (alternativa a URL firmada). */
app.get(
  '/api/jobs/:jobId/dxf-output/stream',
  requireAuth,
  requireStorage,
  requireArchitectOrAdmin,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const role = getAppRole(user)
    if (!role) {
      res.status(403).json({ error: 'Missing role' })
      return
    }
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (!assertJobAccess(user.id, role, job)) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    try {
      const sb = getSupabaseServiceRole()
      const output = await findLatestOutputForJob(sb, jobId)
      if (!output) {
        res.status(404).json({ error: 'No output file yet' })
        return
      }
      const { data, error } = await sb.storage.from(output.bucket_id).download(output.object_path)
      if (error || !data) {
        console.error(error)
        res.status(502).json({ error: 'Could not read object from storage' })
        return
      }
      const buf = Buffer.from(await data.arrayBuffer())
      const ct = output.content_type ?? 'application/octet-stream'
      res.setHeader('Content-Type', ct)
      res.setHeader('Content-Disposition', `attachment; filename="job-${jobId}-output.dxf"`)
      res.send(buf)
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Stream error' })
    }
  },
)

/** US-009/US-010: registrar .dxf de salida (p. ej. worker con service role vía API interna futura). Stub de desarrollo: solo service key en header (opcional). */
app.post(
  '/api/jobs/:jobId/dxf-output/register',
  requireAuth,
  requireStorage,
  requireRole('administrator'),
  async (req, res) => {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    const body = req.body as { objectPath?: string; contentType?: string; sizeBytes?: number }
    const objectPath = String(body.objectPath ?? '').trim()
    const parsed = objectPathMatchesJobAndOwner(objectPath, job.owner_user_id, job.id)
    if (!parsed) {
      res.status(400).json({ error: 'objectPath does not match job/owner or is not a valid .dxf path' })
      return
    }
    if (typeof body.sizeBytes !== 'number' || !Number.isFinite(body.sizeBytes) || body.sizeBytes < 1) {
      res.status(400).json({ error: 'sizeBytes must be a positive number' })
      return
    }
    try {
      assertAllowedDxfContentType(body.contentType)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid content type' })
      return
    }
    try {
      const sb = getSupabaseServiceRole()
      const row = await insertFileRow(sb, {
        job_id: job.id,
        owner_user_id: job.owner_user_id,
        bucket_id: DXF_OUTPUT_BUCKET,
        object_path: objectPath,
        kind: 'output_dxf',
        content_type: String(body.contentType).split(';')[0]?.trim() ?? null,
        size_bytes: Math.floor(body.sizeBytes),
      })
      res.status(201).json({ file: row })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Could not register output file' })
    }
  },
)

/**
 * US-012: workspace summary — rooms + recommendations + normative flag.
 * Disponible cuando job está en listo_para_editar, analizando o error.
 */
app.get(
  '/api/jobs/:jobId/workspace',
  requireAuth,
  requireArchitectOrAdmin,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const role = getAppRole(user)
    if (!role) {
      res.status(403).json({ error: 'Missing role' })
      return
    }
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (!assertJobAccess(user.id, role, job)) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }

    const meta = job.pipeline_metadata ?? {}
    const visionLayout = meta.vision_layout as
      | { layout_interpretation?: { rooms?: unknown[] } }
      | undefined
    const rooms = visionLayout?.layout_interpretation?.rooms ?? []
    const cadInspect = meta.cad_worker_inspect as { layers?: unknown } | undefined
    const layerSuggestions = suggestLayersFromInspect(cadInspect)
    const geometryExtract = meta.geometry_extract as
      | { capas_clasificadas?: Record<string, string[]> }
      | undefined

    res.json({
      jobId: job.id,
      status: job.status,
      normative_rules_enabled: meta.normative_rules_enabled !== false,
      rooms,
      preliminary_recommendations: meta.preliminary_recommendations ?? [],
      room_processing_state: meta.room_processing_state ?? {},
      room_processing_runs: meta.room_processing_runs ?? [],
      preliminary_analysis_completed_at: meta.preliminary_analysis_completed_at ?? null,
      normative_rules_version: meta.normative_rules_version ?? null,
      outlet_placements: meta.outlet_placements ?? [],
      layer_suggestions: layerSuggestions,
      layer_classification: geometryExtract?.capas_clasificadas ?? null,
      dxf_stream_url: `/api/jobs/${encodeURIComponent(jobId)}/workspace/dxf-stream`,
    })
  },
)

/**
 * US-011 Flow B: stream autenticado del DXF para visor en cliente.
 * Prefiere output_dxf (con capa eléctrica) si existe; si no, input_dxf.
 */
app.get(
  '/api/jobs/:jobId/workspace/dxf-stream',
  requireAuth,
  requireStorage,
  requireArchitectOrAdmin,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const role = getAppRole(user)
    if (!role) {
      res.status(403).json({ error: 'Missing role' })
      return
    }
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (!assertJobAccess(user.id, role, job)) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    try {
      const sb = getSupabaseServiceRole()
      const output = await findLatestOutputForJob(sb, jobId)
      const input = await findLatestInputForJob(sb, jobId)
      const file = output ?? input
      if (!file) {
        res.status(404).json({ error: 'No DXF file registered for this job' })
        return
      }
      const { data, error } = await sb.storage.from(file.bucket_id).download(file.object_path)
      if (error || !data) {
        console.error(error)
        res.status(502).json({ error: 'Could not read DXF from storage' })
        return
      }
      const buf = Buffer.from(await data.arrayBuffer())
      const ct = file.content_type ?? 'application/dxf'
      res.setHeader('Content-Type', ct)
      res.setHeader('X-Dxf-Kind', file.kind)
      res.setHeader('Content-Disposition', `inline; filename="job-${jobId}.dxf"`)
      res.send(buf)
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'DXF stream error' })
    }
  },
)

/**
 * US-011: payload de render 2D para el visor SVG.
 * Disponible en listo_para_editar, parcialmente_procesado, procesado.
 * En analizando se responde en modo degradado si hay datos parciales.
 */
app.get(
  '/api/jobs/:jobId/workspace/render-data',
  requireAuth,
  requireArchitectOrAdmin,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const role = getAppRole(user)
    if (!role) {
      res.status(403).json({ error: 'Missing role' })
      return
    }
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (!assertJobAccess(user.id, role, job)) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }

    const renderableStatuses = new Set([
      'listo_para_editar',
      'parcialmente_procesado',
      'procesado',
      'analizando',
    ])
    if (!renderableStatuses.has(job.status)) {
      res.status(409).json({
        error: 'Render data not available in current job status',
        code: 'WRONG_STATUS',
        status: job.status,
      })
      return
    }

    const meta = job.pipeline_metadata ?? {}

    const geometryExtract = meta.geometry_extract as
      | {
          paredes?: Array<{ inicio: { x: number; y: number }; fin: { x: number; y: number } }>
          etiquetas_texto?: Array<{ texto: string; posicion: { x: number; y: number } }>
        }
      | undefined

    const layout = resolveLayoutInterpretation(meta.vision_layout)
    const layoutRooms = layout?.rooms

    const geometryWalls = normalizeRenderWalls(geometryExtract?.paredes)
    const visionWalls = normalizeRenderWalls(layout?.walls)
    const paredes = geometryWalls.length > 0 ? geometryWalls : visionWalls

    const rooms = (Array.isArray(layoutRooms) ? layoutRooms : [])
      .map((room) => {
        if (!room || typeof room !== 'object') return null
        const r = room as Record<string, unknown>
        const vertices = normalizeRenderRoomVertices(r.polygon)
        const id = typeof r.id === 'string' ? r.id : null
        if (!id || vertices.length < 3) return null
        return {
          id,
          label: typeof r.label === 'string' ? r.label : id,
          room_type: typeof r.room_type === 'string' ? r.room_type : 'unknown',
          polygon: { vertices },
          area_m2: typeof r.area_m2 === 'number' ? r.area_m2 : null,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    res.json({
      jobId: job.id,
      status: job.status,
      paredes,
      etiquetas_texto: normalizeRenderLabels(geometryExtract?.etiquetas_texto),
      rooms,
      coordinate_system: layout?.coordinate_system ?? null,
      scale: layout?.scale ?? null,
      room_processing_state: meta.room_processing_state ?? {},
      electrical_elements: normalizeElectricalElements(meta.outlet_placements),
      electrical_symbol_radius_drawing_units: resolveElectricalSymbolRadius(
        meta,
        paredes,
        geometryExtract,
      ),
    })
  },
)

/** Catálogo de elementos eléctricos disponibles para el chat / motor de reglas. */
app.get('/api/catalog/electrical', requireAuth, requireArchitectOrAdmin, async (_req, res) => {
  try {
    const items = await listElectricalCatalog()
    res.json({ items })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Could not list electrical catalog' })
  }
})

/** US-014: historial del chat del workspace (dueño o admin lectura). */
app.get(
  '/api/jobs/:jobId/workspace/chat',
  requireAuth,
  requireArchitectOrAdmin,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const role = getAppRole(user)
    if (!role) {
      res.status(403).json({ error: 'Missing role' })
      return
    }
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (!assertJobAccess(user.id, role, job)) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    try {
      const messages = await listChatMessages(jobId)
      res.json({ jobId, messages })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Could not list chat messages' })
    }
  },
)

/**
 * US-014: mensaje de chat con la IA sobre la capa eléctrica.
 * Body: { message, viewport_image? } — viewport_image es un data URL PNG con la
 * captura de lo renderizado al momento de enviar el prompt.
 */
app.post(
  '/api/jobs/:jobId/workspace/chat',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    if (!CHAT_ALLOWED_STATUSES.has(job.status)) {
      res.status(409).json({
        error: `Chat no disponible con el trabajo en estado '${job.status}'.`,
        code: 'WRONG_STATUS',
        status: job.status,
      })
      return
    }

    const body = req.body as { message?: unknown; viewport_image?: unknown }
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
      res.status(400).json({ error: 'message is required' })
      return
    }
    if (message.length > 4000) {
      res.status(400).json({ error: 'message too long (max 4000 chars)' })
      return
    }
    let viewportImage: string | undefined
    if (typeof body.viewport_image === 'string' && body.viewport_image.length > 0) {
      if (!body.viewport_image.startsWith('data:image/')) {
        res.status(400).json({ error: 'viewport_image must be a data:image/* URL' })
        return
      }
      if (body.viewport_image.length > 6 * 1024 * 1024) {
        res.status(413).json({ error: 'viewport_image too large (max ~6MB)' })
        return
      }
      viewportImage = body.viewport_image
    }

    const correlationId = req.correlationId ?? crypto.randomUUID()
    try {
      const result = await handleWorkspaceChatMessage({
        jobId,
        userId: user.id,
        message,
        viewportImage,
        correlationId,
      })
      res.json({
        job_id: jobId,
        reply: result.reply,
        intent: result.intent,
        mutations_applied: result.mutations_applied,
        process_result: result.process_result ?? null,
        messages: result.messages,
      })
    } catch (e) {
      if (e instanceof WorkspaceChatError) {
        res.status(e.code === 'WRONG_STATUS' ? 409 : 500).json({ error: e.message, code: e.code })
        return
      }
      console.error(e)
      res.status(500).json({ error: 'Chat processing failed' })
    }
  },
)

/**
 * US-012: toggle normative_rules_enabled antes del análisis.
 * Solo permitido cuando job está en pendiente.
 */
app.patch(
  '/api/jobs/:jobId/normative-rules',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    if (job.status !== 'pendiente') {
      res.status(409).json({
        error: 'normative_rules_enabled can only be changed when job is in pendiente state',
        code: 'WRONG_STATUS',
      })
      return
    }
    const body = req.body as { normative_rules_enabled?: boolean }
    if (typeof body.normative_rules_enabled !== 'boolean') {
      res.status(400).json({ error: 'normative_rules_enabled must be a boolean' })
      return
    }
    const updated = await patchJob(jobId, {
      pipeline_metadata: {
        ...(job.pipeline_metadata ?? {}),
        normative_rules_enabled: body.normative_rules_enabled,
      },
    })
    res.json({ jobId, normative_rules_enabled: body.normative_rules_enabled, job: updated })
  },
)

/**
 * US-013: process selected rooms incrementally.
 * Allows job in listo_para_editar or parcialmente_procesado.
 * With normative_rules_enabled=false returns 422 (botonera blocked, use chat US-014).
 */
app.post(
  '/api/jobs/:jobId/workspace/process-rooms',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }

    const body = req.body as { room_ids?: unknown; idempotency_key?: unknown }
    if (!Array.isArray(body.room_ids) || body.room_ids.length === 0) {
      res.status(400).json({ error: 'room_ids must be a non-empty array' })
      return
    }
    const roomIds = (body.room_ids as unknown[]).map(String).filter(Boolean)
    if (roomIds.length === 0) {
      res.status(400).json({ error: 'room_ids contains no valid ids' })
      return
    }
    const idempotencyKey =
      typeof body.idempotency_key === 'string' ? body.idempotency_key : undefined
    const correlationId = req.correlationId ?? crypto.randomUUID()

    try {
      const result = await runRoomProcessingPipeline(jobId, roomIds, correlationId, idempotencyKey)
      if (result.normative_rules_blocked) {
        res.status(422).json({
          error:
            'Room processing blocked: normative_rules_enabled=false. Use chat (US-014) to process rooms.',
          code: 'NORMATIVE_RULES_DISABLED',
          job_id: jobId,
        })
        return
      }
      res.json(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Room processing failed'
      const isStatus = message.includes('not allowed in status')
      res.status(isStatus ? 409 : 500).json({ error: message })
    }
  },
)

/**
 * US-013: omit rooms (mark as omitida without running pipeline).
 */
app.post(
  '/api/jobs/:jobId/workspace/omit-rooms',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }

    const body = req.body as { room_ids?: unknown }
    if (!Array.isArray(body.room_ids) || body.room_ids.length === 0) {
      res.status(400).json({ error: 'room_ids must be a non-empty array' })
      return
    }
    const roomIds = (body.room_ids as unknown[]).map(String).filter(Boolean)
    const correlationId = req.correlationId ?? crypto.randomUUID()

    try {
      const updated = await omitRooms(jobId, roomIds, correlationId)
      res.json({ job_id: jobId, omitted: roomIds, job: updated })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Omit rooms failed'
      res.status(409).json({ error: message })
    }
  },
)

/**
 * US-013: mark job as procesado (architect closes workspace).
 */
app.post(
  '/api/jobs/:jobId/workspace/mark-complete',
  requireAuth,
  requireRole('architect'),
  async (req, res) => {
    const { user } = req as AuthedRequest
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = await findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    const correlationId = req.correlationId ?? crypto.randomUUID()

    try {
      const updated = await markJobProcessed(jobId, correlationId)
      res.json({ job_id: jobId, status: updated?.status ?? 'procesado', job: updated })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Mark complete failed'
      res.status(409).json({ error: message })
    }
  },
)

/** US-002: activar cuenta de arquitecto invitado. */
app.post('/api/invites/accept', async (req, res) => {
  const body = req.body as { token?: string; password?: string; fullName?: string }
  const result = await acceptInvitation({
    token: String(body.token ?? ''),
    password: String(body.password ?? ''),
    fullName: String(body.fullName ?? ''),
  })
  if (!result.ok) {
    res.status(result.status).json({ error: result.message, code: result.code })
    return
  }
  res.status(201).json({ ok: true, userId: result.userId, email: result.email })
})

/** Verificación pública de token (US-002). */
app.get('/api/invites/verify', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!token) {
    res.status(400).json({ valid: false, error: 'token is required' })
    return
  }
  try {
    const row = await findInviteByRawToken(token)
    if (!row) {
      res.status(404).json({ valid: false, error: 'invalid_or_expired_token' })
      return
    }
    res.json({ valid: true, email: row.email_normalized })
  } catch (e) {
    console.error(e)
    res.status(500).json({ valid: false, error: 'verification_failed' })
  }
})

/** US-002: arquitecto completa perfil tras aceptar invitación de Supabase Auth. */
app.post('/api/invites/complete', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest
  const fullName = String((req.body as { fullName?: string })?.fullName ?? '').trim()
  const result = await completeSupabaseInvitation({
    userId: user.id,
    email: user.email ?? '',
    fullName,
  })
  if (!result.ok) {
    res.status(result.status).json({ error: result.message, code: result.code })
    return
  }
  res.json({ ok: true })
})

/** US-001 + T-06: administrador envía invitación por correo (Supabase Auth). */
app.post(
  '/api/invites',
  requireAuth,
  requireRole('administrator'),
  requireStorage,
  inviteRateLimiter,
  async (req, res) => {
    const { user } = req as AuthedRequest
    const email = String((req.body as { email?: string })?.email ?? '').trim()
    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: 'valid email is required' })
      return
    }
    const existing = await findPendingInviteByEmail(email)
    if (existing) {
      res.status(409).json({
        error: 'Ya existe una invitación pendiente para este correo.',
        code: 'INVITE_PENDING',
        invitationId: existing.id,
      })
      return
    }

    const sb = getSupabaseServiceRole()
    try {
      const existingUser = await findUserByEmail(sb.auth.admin, email)
      if (existingUser) {
        res.status(409).json({
          error: 'Ya existe una cuenta con este correo.',
          code: 'USER_ALREADY_EXISTS',
        })
        return
      }
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Could not verify email availability' })
      return
    }

    const token = generateInviteToken()
    const base = publicWebBase()
    const redirectTo = `${base}/invite`
    const inviterDisplay =
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
      user.email ||
      'Un administrador'

    let row
    try {
      row = await createInvitationRecord({
        email,
        token,
        invitedByUserId: user.id,
        ttlMs: INVITE_TTL_MS,
      })
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Could not create invitation' })
      return
    }

    const sent = await sendSupabaseInvitation({
      email,
      redirectTo,
      inviterDisplay,
      supabase: sb,
    })
    if (!sent.ok) {
      await removeInvitationById(row.id)
      if (sent.code === 'AUTH_NOT_CONFIGURED') {
        res.status(503).json({
          error: 'Supabase Auth no configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
          code: sent.code,
        })
        return
      }
      if (sent.code === 'USER_ALREADY_EXISTS') {
        res.status(409).json({
          error: 'Ya existe una cuenta con este correo.',
          code: sent.code,
        })
        return
      }
      res.status(502).json({
        error: 'No se pudo enviar la invitación. Revisá la configuración de correo en Supabase.',
        code: 'INVITE_SEND_FAILED',
        detail: sent.detail,
      })
      return
    }

    res.status(201).json({
      ok: true,
      invitationId: row.id,
      email: row.email_normalized,
      userId: sent.userId,
    })
  },
)

const port = Number(process.env.API_PORT ?? 3001)

app.listen(port, () => {
  logStructured('info', {
    event: 'api_listening',
    port,
    cad_worker_transport: cadWorkerTransport(),
    pipeline_worker_enabled: pipelineWorkerEnabled(),
    ...cadWorkerConfigSummary(),
  })
  void probeCadWorkerOnStartup()
  startPipelineWorker()
})
