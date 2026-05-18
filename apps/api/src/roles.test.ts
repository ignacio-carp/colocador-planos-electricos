import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '@supabase/supabase-js'
import { getAppRole } from './roles'

function userWithMetadata(metadata: {
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}): User {
  return {
    id: 'user-id',
    aud: 'authenticated',
    app_metadata: metadata.app_metadata ?? {},
    user_metadata: metadata.user_metadata ?? {},
    created_at: new Date(0).toISOString(),
  } as User
}

test('getAppRole prefers app_metadata over user_metadata', () => {
  const user = userWithMetadata({
    app_metadata: { role: 'administrator' },
    user_metadata: { role: 'architect' },
  })

  assert.equal(getAppRole(user), 'administrator')
})

test('getAppRole keeps user_metadata as legacy fallback', () => {
  const user = userWithMetadata({
    user_metadata: { role: 'ARCHITECT' },
  })

  assert.equal(getAppRole(user), 'architect')
})
