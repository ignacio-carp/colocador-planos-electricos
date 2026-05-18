import assert from 'node:assert/strict'
import test from 'node:test'
import type { User } from '@supabase/supabase-js'
import {
  bootstrapAdministrator,
  findUserByEmail,
  normalizeBootstrapAdminEmail,
  readBootstrapAdminConfig,
  withAdministratorAppMetadata,
} from './bootstrapAdmin'

function authUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-id',
    aud: 'authenticated',
    email: 'admin@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date(0).toISOString(),
    ...overrides,
  } as User
}

test('normalizeBootstrapAdminEmail trims, lowercases, and validates', () => {
  assert.equal(normalizeBootstrapAdminEmail('  Admin@Example.COM '), 'admin@example.com')
  assert.throws(() => normalizeBootstrapAdminEmail('not-an-email'), /valid email/)
  assert.throws(() => normalizeBootstrapAdminEmail(undefined), /must be set/)
})

test('readBootstrapAdminConfig requires Supabase server credentials and admin email', () => {
  assert.deepEqual(
    readBootstrapAdminConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.com',
    }),
    {
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      adminEmail: 'admin@example.com',
    },
  )
  assert.throws(
    () => readBootstrapAdminConfig({ BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com' }),
    /SUPABASE_URL/,
  )
})

test('withAdministratorAppMetadata preserves existing app metadata and overwrites role', () => {
  assert.deepEqual(withAdministratorAppMetadata({ provider: 'email', role: 'architect' }), {
    provider: 'email',
    role: 'administrator',
  })
})

test('findUserByEmail searches paginated Supabase Auth users', async () => {
  const calls: number[] = []
  const firstPage = Array.from({ length: 1000 }, (_, i) =>
    authUser({ id: `user-${i}`, email: `user-${i}@example.com` }),
  )
  const target = authUser({ id: 'target-id', email: 'Admin@Example.com' })
  const admin = {
    listUsers: async ({ page }: { page: number }) => {
      calls.push(page)
      return { data: { users: page === 1 ? firstPage : [target] }, error: null }
    },
  } as unknown as Parameters<typeof findUserByEmail>[0]

  const found = await findUserByEmail(admin, 'admin@example.com')

  assert.equal(found?.id, 'target-id')
  assert.deepEqual(calls, [1, 2])
})

test('bootstrapAdministrator updates an existing user to administrator app_metadata', async () => {
  const existing = authUser({
    id: 'existing-id',
    app_metadata: { provider: 'email', role: 'architect' },
    user_metadata: { role: 'architect' },
  })
  const updates: unknown[] = []
  const admin = {
    listUsers: async () => ({ data: { users: [existing] }, error: null }),
    updateUserById: async (id: string, attributes: unknown) => {
      updates.push({ id, attributes })
      return {
        data: {
          user: authUser({
            id,
            app_metadata: { provider: 'email', role: 'administrator' },
          }),
        },
        error: null,
      }
    },
  } as unknown as Parameters<typeof bootstrapAdministrator>[0]

  const result = await bootstrapAdministrator(admin, 'admin@example.com')

  assert.equal(result.status, 'updated')
  assert.deepEqual(updates, [
    {
      id: 'existing-id',
      attributes: { app_metadata: { provider: 'email', role: 'administrator' } },
    },
  ])
})

test('bootstrapAdministrator creates a confirmed administrator when none exists', async () => {
  const createCalls: unknown[] = []
  const admin = {
    listUsers: async () => ({ data: { users: [] }, error: null }),
    createUser: async (attributes: unknown) => {
      createCalls.push(attributes)
      return {
        data: {
          user: authUser({ id: 'created-id', email: 'admin@example.com' }),
        },
        error: null,
      }
    },
  } as unknown as Parameters<typeof bootstrapAdministrator>[0]

  const result = await bootstrapAdministrator(admin, 'Admin@Example.com')

  assert.equal(result.status, 'created')
  assert.equal(result.userId, 'created-id')
  assert.deepEqual(createCalls, [
    {
      email: 'admin@example.com',
      email_confirm: true,
      app_metadata: { role: 'administrator' },
    },
  ])
})
