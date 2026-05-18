import type { User } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
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

describe('getAppRole', () => {
  it('prefers app_metadata over user_metadata', () => {
    const user = userWithMetadata({
      app_metadata: { role: 'administrator' },
      user_metadata: { role: 'architect' },
    })

    expect(getAppRole(user)).toBe('administrator')
  })

  it('keeps user_metadata as a legacy fallback', () => {
    const user = userWithMetadata({
      user_metadata: { role: 'ARCHITECT' },
    })

    expect(getAppRole(user)).toBe('architect')
  })
})
