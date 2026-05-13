import type { User } from '@supabase/supabase-js'
import type { NextFunction, Request, Response } from 'express'
import { getUserFromBearerToken } from '../auth'
import { logStructured, redactAuthorizationHeader } from '../logger'

export type AuthedRequest = Request & { user: User }

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getUserFromBearerToken(req.headers.authorization)
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    ;(req as AuthedRequest).user = user
    next()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logStructured('error', {
      event: 'auth_configuration_error',
      correlation_id: req.correlationId,
      error: message,
      authorization: redactAuthorizationHeader(req.headers.authorization),
    })
    res.status(500).json({ error: 'Auth configuration error' })
  }
}
