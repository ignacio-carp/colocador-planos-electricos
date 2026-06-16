import assert from 'node:assert/strict'
import test from 'node:test'
import { sendSupabaseInvitation } from './sendSupabaseInvitation'

test('sendSupabaseInvitation returns AUTH_NOT_CONFIGURED without Supabase', async () => {
  const prevUrl = process.env.SUPABASE_URL
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY

  const result = await sendSupabaseInvitation({
    email: 'arch@example.com',
    redirectTo: 'http://localhost:5174/invite',
    inviterDisplay: 'Admin',
  })

  process.env.SUPABASE_URL = prevUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey

  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'AUTH_NOT_CONFIGURED')
})

test('sendSupabaseInvitation returns USER_ALREADY_EXISTS when email is taken', async () => {
  const result = await sendSupabaseInvitation({
    email: 'existing@example.com',
    redirectTo: 'http://localhost:5174/invite',
    inviterDisplay: 'Admin',
    supabase: {
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: [{ id: 'u1', email: 'existing@example.com', app_metadata: {} }] },
            error: null,
          }),
          inviteUserByEmail: async () => {
            throw new Error('should not invite')
          },
          updateUserById: async () => ({ data: { user: null }, error: null }),
        },
      },
    } as never,
  })

  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'USER_ALREADY_EXISTS')
})
