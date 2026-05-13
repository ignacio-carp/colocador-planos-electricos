import type { User } from '@supabase/supabase-js'
import type { NextFunction, Request, Response } from 'express'
import { getUserFromBearerToken } from '../auth'

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
    console.error(err)
    res.status(500).json({ error: 'Auth configuration error' })
  }
}
