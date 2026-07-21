import type { CorsOptions } from 'cors'

const LOCALHOST_ORIGIN = /^http:\/\/localhost:\d+$/

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim()
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export function getCorsOptions(): CorsOptions {
  const allowed = allowedOrigins()

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }
      if (allowed.includes(origin)) {
        callback(null, true)
        return
      }
      if (allowed.length === 0) {
        callback(null, true)
        return
      }
      if (isDev() && LOCALHOST_ORIGIN.test(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
    credentials: true,
    exposedHeaders: ['X-Dxf-Kind'],
  }
}
