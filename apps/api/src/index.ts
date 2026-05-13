import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { sendInvitationEmail } from './email/sendInvitationEmail'
import { createInviteRateLimiter } from './inviteRateLimit'
import {
  createInvitationRecord,
  findInviteByRawToken,
  findPendingInviteByEmail,
  generateInviteToken,
  removeInvitationById,
} from './invitesStore'
import { requireAuth, type AuthedRequest } from './middleware/requireAuth'
import { requireArchitectOrAdmin, requireRole } from './middleware/requireRole'
import { getAppRole } from './roles'
import { createJob, findJob, listAllJobs, listJobsForOwner } from './jobsStore'

const app = express()
app.use(express.json())

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

const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
)

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
  const job = createJob(user.id, title)
  res.status(201).json(job)
})

/**
 * US-004 / US-010: listado respeta rol — arquitecto solo ve sus jobs; admin ve todos con dueño.
 */
app.get('/api/jobs', requireAuth, requireArchitectOrAdmin, (req, res) => {
  const { user } = req as AuthedRequest
  const role = getAppRole(user)
  if (!role) {
    res.status(403).json({ error: 'Missing role', hint: 'Set user_metadata.role in Supabase' })
    return
  }
  if (role === 'administrator') {
    res.json({ jobs: listAllJobs() })
    return
  }
  res.json({ jobs: listJobsForOwner(user.id) })
})

/** US-004 / US-010: descarga (stub) — arquitecto solo si es dueño. */
app.get('/api/jobs/:jobId/download', requireAuth, requireArchitectOrAdmin, (req, res) => {
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
  if (role === 'architect' && job.owner_user_id !== user.id) {
    res.status(403).json({ error: 'Forbidden', code: 'NOT_JOB_OWNER' })
    return
  }
  res.json({
    jobId: job.id,
    owner_user_id: job.owner_user_id,
    download: 'stub-url',
  })
})

/** Verificación pública de token (US-002 puede extender). */
app.get('/api/invites/verify', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  if (!token) {
    res.status(400).json({ valid: false, error: 'token is required' })
    return
  }
  const row = findInviteByRawToken(token)
  if (!row) {
    res.status(404).json({ valid: false, error: 'invalid_or_expired_token' })
    return
  }
  res.json({ valid: true })
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
    if (findPendingInviteByEmail(email)) {
      res.status(409).json({
        error: 'Ya existe una invitación pendiente para este correo.',
        code: 'INVITE_PENDING',
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

    const row = createInvitationRecord({
      email,
      token,
      invitedByUserId: user.id,
      ttlMs: INVITE_TTL_MS,
    })

    const sent = await sendInvitationEmail({ to: email, inviteUrl, inviterDisplay })
    if (!sent.ok) {
      removeInvitationById(row.id)
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
