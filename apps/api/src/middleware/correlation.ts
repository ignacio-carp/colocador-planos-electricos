import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

/**
 * Propagates or creates `X-Correlation-Id`. API responses echo the id;
 * S-01 / workers should forward the same header on downstream calls.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.get('x-correlation-id')?.trim()
  const correlationId = raw && raw.length > 0 ? raw : randomUUID()
  req.correlationId = correlationId
  res.setHeader('X-Correlation-Id', correlationId)
  next()
}
