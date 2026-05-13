import type { NextFunction, Request, Response } from 'express'
import type { AuthedRequest } from './requireAuth'
import { getAppRole, type AppRole } from '../roles'

export function requireRole(allowed: AppRole | AppRole[]) {
  const allowedList = Array.isArray(allowed) ? allowed : [allowed]
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getAppRole((req as AuthedRequest).user)
    if (!role || !allowedList.includes(role)) {
      res.status(403).json({ error: 'Forbidden', code: 'ROLE_DENIED' })
      return
    }
    next()
  }
}

/** Acceso a recursos compartidos por administrador y arquitecto (con filtrado en handler). */
export const requireArchitectOrAdmin = requireRole(['architect', 'administrator'])
