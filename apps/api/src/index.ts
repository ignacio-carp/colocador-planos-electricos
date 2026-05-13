import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { requireAuth, type AuthedRequest } from './middleware/requireAuth'
import { requireArchitectOrAdmin, requireRole } from './middleware/requireRole'
import { getAppRole } from './roles'
import { createJob, findJob, listAllJobs, listJobsForOwner } from './jobsStore'

const app = express()
app.use(express.json())

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

/** US-001: solo administrador puede invitar; arquitecto recibe 403. */
app.post('/api/invites', requireAuth, requireRole('administrator'), (_req, res) => {
  res.status(201).json({ ok: true, stub: true })
})

const port = Number(process.env.API_PORT ?? 3001)

app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`)
})
