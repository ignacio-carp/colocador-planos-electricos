import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { requireAuth, type AuthedRequest } from './middleware/requireAuth'

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
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  })
})

const port = Number(process.env.API_PORT ?? 3001)

app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`)
})
