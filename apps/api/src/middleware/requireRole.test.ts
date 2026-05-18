import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '@supabase/supabase-js'
import type { Request, Response } from 'express'
import { requireRole } from './requireRole'
import type { AuthedRequest } from './requireAuth'

function mockRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res as Response & { statusCode?: number; body?: unknown }
}

function userWithRole(role: string): User {
  return {
    id: 'u1',
    aud: 'authenticated',
    app_metadata: { role },
    user_metadata: {},
    created_at: new Date(0).toISOString(),
  } as User
}

test('requireRole allows administrator for admin-only route (US-001 AC2 inverse)', () => {
  const req = { user: userWithRole('administrator') } as AuthedRequest
  const res = mockRes()
  let nextCalled = false
  requireRole('administrator')(req as Request, res, () => {
    nextCalled = true
  })
  assert.equal(nextCalled, true)
})

test('requireRole denies architect from administrator route (US-001 AC2)', () => {
  const req = { user: userWithRole('architect') } as AuthedRequest
  const res = mockRes()
  let nextCalled = false
  requireRole('administrator')(req as Request, res, () => {
    nextCalled = true
  })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'Forbidden', code: 'ROLE_DENIED' })
})
