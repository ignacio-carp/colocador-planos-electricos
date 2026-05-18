import rateLimit from 'express-rate-limit'
import type { AuthedRequest } from './middleware/requireAuth'

export function createInviteRateLimiter() {
  const windowMs = Number(process.env.INVITE_RATE_LIMIT_WINDOW_MS ?? 3_600_000)
  const max = Number(process.env.INVITE_RATE_LIMIT_MAX ?? 30)
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const user = (req as AuthedRequest).user
      return user?.id ?? req.ip ?? 'anonymous'
    },
  })
}
