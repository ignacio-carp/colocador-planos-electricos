import { loadEnv } from './loadEnv'
loadEnv()

import cors from 'cors'
import express from 'express'
import { getCorsOptions } from './corsConfig'
import { sendInvitationEmail } from './email/sendInvitationEmail'
import {
  assertAllowedDwgContentType,
  buildDwgObjectPath,
  DWG_INPUT_BUCKET,
  DWG_OUTPUT_BUCKET,
  objectPathMatchesJobAndOwner,
} from './dwgStorage'
import { findLatestOutputForJob, insertFileRow, listFilesForJob } from './filesStore'
import { acceptInvitation } from './inviteAccept'
import { createInviteRateLimiter } from './inviteRateLimit'
import {
  createInvitationRecord,
  findInviteByRawToken,
  findPendingInviteByEmail,
  generateInviteToken,
  removeInvitationById,
} from './invitesStore'
import { createJob, findJob, listAllJobs, listJobsForOwner } from './jobsStore'
import {
  applyDwgQuotaHeaders,
  assertDwgUploadWithinQuota,
  checkJobCreationQuota,
  QuotaExceededError,
} from './quota'
import { runJobPipeline } from './jobsPipeline'
import { getMetricsSnapshot } from './metrics'
import { correlationMiddleware } from './middleware/correlation'
import { requireAuth, type AuthedRequest } from './middleware/requireAuth'
import { requireArchitectOrAdmin, requireRole } from './middleware/requireRole'
import { getAppRole } from './roles'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const app = express()
app.use(cors(getCorsOptions()))
app.use(express.json())
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

function assertJobAccess(
  userId: string,
  role: ReturnType<typeof getAppRole>,
  job: NonNullable<ReturnType<typeof findJob>>,
): boolean {
  if (!role) return false
  if (role === 'administrator') return true
  return job.owner_user_id === userId
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' })
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
app.post('/api/jobs', requireAuth, requireRole('architect'), (req, res) => {
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
  const job = createJob(user.id, title)
  res.status(201).json(job)
})

/**
 * T-07: ejecuta pipeline MVP (sincrónico). Propaga `X-Correlation-Id` del request;
 * logs JSON incluyen job_id + correlation_id. Para simular fallo de inferencia (US-008)
 * tras reintentos: `CAD_IA_SIMULATE_FAILURE=true`.
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
    const job = findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    if (job.owner_user_id !== user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
      return
    }
    if (job.status === 'processing') {
      res.status(409).json({ error: 'Job already processing' })
      return
    }
    const result = await runJobPipeline(jobId, correlationId)
    if (!result) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    res.status(200).json(result)
  },
)

/** T-07 métricas stub — consumo TBD por dashboard; solo administrador. */
app.get('/api/metrics', requireAuth, requireRole('administrator'), (_req, res) => {
  res.json(getMetricsSnapshot())
})

/**
 * US-004 / US-010: listado respeta rol — arquitecto solo ve sus jobs; admin ve todos con dueño.
 */
app.get('/api/jobs', requireAuth, requireArchitectOrAdmin, (req, res) => {
  const { user } = req as AuthedRequest
  const role = getAppRole(user)
  if (!role) {
    res.status(403).json({ error: 'Missing role', hint: 'Set app_metadata.role in Supabase' })
    return
  }
  if (role === 'administrator') {
    res.json({ jobs: listAllJobs() })
    return
  }
  res.json({ jobs: listJobsForOwner(user.id) })
})

/**
 * US-006: URL firmada de subida (sin URL pública permanente). Solo dueño del job (arquitecto).
 */
app.post(
  '/api/jobs/:jobId/dwg-input/signed-upload-url',
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
    const job = findJob(jobId)
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
      assertAllowedDwgContentType(contentType)
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
        assertDwgUploadWithinQuota({
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

    const objectPath = buildDwgObjectPath(job.owner_user_id, job.id)
    try {
      const sb = getSupabaseServiceRole()
      const { data, error } = await sb.storage.from(DWG_INPUT_BUCKET).createSignedUploadUrl(objectPath, {
        upsert: true,
      })
      if (error || !data) {
        console.error(error)
        res.status(502).json({ error: 'Could not create signed upload URL' })
        return
      }
      applyDwgQuotaHeaders(res.setHeader.bind(res))
      res.status(200).json({
        bucket: DWG_INPUT_BUCKET,
        objectPath: data.path,
        signedUrl: data.signedUrl,
        token: data.token,
        contentType,
        note: 'Upload via PUT to signedUrl with file body; then call POST .../dwg-input/register',
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
  '/api/jobs/:jobId/dwg-input/register',
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
    const job = findJob(jobId)
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
      res.status(400).json({ error: 'objectPath does not match job/owner or is not a valid .dwg path' })
      return
    }
    try {
      assertAllowedDwgContentType(body.contentType)
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
      assertDwgUploadWithinQuota({
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
        bucket_id: DWG_INPUT_BUCKET,
        object_path: objectPath,
        kind: 'input_dwg',
        content_type: String(body.contentType).split(';')[0]?.trim() ?? null,
        size_bytes: Math.floor(sizeBytes),
      })
      applyDwgQuotaHeaders(res.setHeader.bind(res))
      res.status(201).json({ file: row })
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
  const job = findJob(jobId)
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
  const job = findJob(jobId)
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
        hint: 'Pipeline must register an output_dwg row (e.g. cad-worker) before download is available',
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
      streamUrl: `/api/jobs/${encodeURIComponent(jobId)}/dwg-output/stream`,
      file: { id: output.id, bucket_id: output.bucket_id, object_path: output.object_path, kind: output.kind },
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Download error' })
  }
})

/** US-010: stream autenticado del .dwg de salida (alternativa a URL firmada). */
app.get(
  '/api/jobs/:jobId/dwg-output/stream',
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
    const job = findJob(jobId)
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
      res.setHeader('Content-Disposition', `attachment; filename="job-${jobId}-output.dwg"`)
      res.send(buf)
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: 'Stream error' })
    }
  },
)

/** US-009/US-010: registrar .dwg de salida (p. ej. worker con service role vía API interna futura). Stub de desarrollo: solo service key en header (opcional). */
app.post(
  '/api/jobs/:jobId/dwg-output/register',
  requireAuth,
  requireStorage,
  requireRole('administrator'),
  async (req, res) => {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : req.params.jobId?.[0]
    if (!jobId) {
      res.status(400).json({ error: 'Missing jobId' })
      return
    }
    const job = findJob(jobId)
    if (!job) {
      res.status(404).json({ error: 'Job not found' })
      return
    }
    const body = req.body as { objectPath?: string; contentType?: string; sizeBytes?: number }
    const objectPath = String(body.objectPath ?? '').trim()
    const parsed = objectPathMatchesJobAndOwner(objectPath, job.owner_user_id, job.id)
    if (!parsed) {
      res.status(400).json({ error: 'objectPath does not match job/owner or is not a valid .dwg path' })
      return
    }
    if (typeof body.sizeBytes !== 'number' || !Number.isFinite(body.sizeBytes) || body.sizeBytes < 1) {
      res.status(400).json({ error: 'sizeBytes must be a positive number' })
      return
    }
    try {
      assertAllowedDwgContentType(body.contentType)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid content type' })
      return
    }
    try {
      const sb = getSupabaseServiceRole()
      const row = await insertFileRow(sb, {
        job_id: job.id,
        owner_user_id: job.owner_user_id,
        bucket_id: DWG_OUTPUT_BUCKET,
        object_path: objectPath,
        kind: 'output_dwg',
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

/** US-001 + T-06: administrador envía invitación por correo (Resend). */
app.post(
  '/api/invites',
  requireAuth,
  requireRole('administrator'),
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

    const token = generateInviteToken()
    const base = publicWebBase()
    const inviteUrl = `${base}/invite?token=${encodeURIComponent(token)}`
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

    const sent = await sendInvitationEmail({ to: email, inviteUrl, inviterDisplay })
    if (!sent.ok) {
      await removeInvitationById(row.id)
      if (sent.code === 'MISSING_API_KEY' || sent.code === 'MISSING_FROM') {
        res.status(503).json({
          error: 'Email provider not configured (RESEND_API_KEY / EMAIL_FROM).',
          code: sent.code,
        })
        return
      }
      res.status(502).json({
        error: 'No se pudo enviar el correo. Reintenta más tarde.',
        code: 'EMAIL_SEND_FAILED',
        detail: sent.detail,
      })
      return
    }

    res.status(201).json({
      ok: true,
      invitationId: row.id,
      email: row.email_normalized,
      providerMessageId: sent.providerMessageId,
    })
  },
)

const port = Number(process.env.API_PORT ?? 3001)

app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`)
})
