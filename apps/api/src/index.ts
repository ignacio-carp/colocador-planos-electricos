import express from 'express'

const app = express()

app.use(express.json())

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

const port = Number(process.env.API_PORT ?? 3001)

app.listen(port, () => {
  // Keep logs minimal; useful for container healthchecks and local debugging.
  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${port}`)
})

