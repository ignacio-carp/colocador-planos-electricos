import { loadEnv } from './loadEnv'
loadEnv()
import './websocketPolyfill'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

const ADMIN_ROLE = 'administrator'
const LIST_USERS_PER_PAGE = 1000

type SupabaseAdminAuth = SupabaseClient['auth']['admin']

export type BootstrapAdminConfig = {
  supabaseUrl: string
  serviceRoleKey: string
  adminEmail: string
}

export type BootstrapAdminResult = {
  status: 'created' | 'updated' | 'unchanged'
  userId: string
  email: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeBootstrapAdminEmail(raw: string | undefined): string {
  const email = raw?.trim().toLowerCase() ?? ''
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL must be set')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address')
  }
  return email
}

export function readBootstrapAdminConfig(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapAdminConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? ''
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return {
    supabaseUrl,
    serviceRoleKey,
    adminEmail: normalizeBootstrapAdminEmail(env.BOOTSTRAP_ADMIN_EMAIL),
  }
}

export function withAdministratorAppMetadata(
  current: User['app_metadata'] | null | undefined,
): Record<string, unknown> {
  return {
    ...(isRecord(current) ? current : {}),
    role: ADMIN_ROLE,
  }
}

function hasAdministratorAppRole(user: User): boolean {
  return (
    typeof user.app_metadata?.role === 'string' &&
    user.app_metadata.role.toLowerCase() === ADMIN_ROLE
  )
}

export async function findUserByEmail(
  admin: SupabaseAdminAuth,
  email: string,
): Promise<User | null> {
  const normalizedEmail = normalizeBootstrapAdminEmail(email)

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE })
    if (error) throw error

    const users = data.users ?? []
    const match = users.find((user) => user.email?.trim().toLowerCase() === normalizedEmail)
    if (match) return match
    if (users.length < LIST_USERS_PER_PAGE) return null
  }
}

async function ensureAdministratorAppRole(
  admin: SupabaseAdminAuth,
  user: User,
): Promise<BootstrapAdminResult> {
  if (hasAdministratorAppRole(user)) {
    return {
      status: 'unchanged',
      userId: user.id,
      email: user.email ?? '',
    }
  }

  const { data, error } = await admin.updateUserById(user.id, {
    app_metadata: withAdministratorAppMetadata(user.app_metadata),
  })
  if (error) throw error
  const updatedUser = data.user ?? user
  return {
    status: 'updated',
    userId: updatedUser.id,
    email: updatedUser.email ?? user.email ?? '',
  }
}

function isDuplicateUserError(error: unknown): boolean {
  if (!isRecord(error)) return false
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  const status = typeof error.status === 'number' ? error.status : undefined
  const code = typeof error.code === 'string' ? error.code.toLowerCase() : ''
  return (
    status === 422 ||
    code.includes('already') ||
    message.includes('already') ||
    message.includes('exists')
  )
}

export async function bootstrapAdministrator(
  admin: SupabaseAdminAuth,
  email: string,
): Promise<BootstrapAdminResult> {
  const normalizedEmail = normalizeBootstrapAdminEmail(email)
  const existing = await findUserByEmail(admin, normalizedEmail)
  if (existing) return ensureAdministratorAppRole(admin, existing)

  const { data, error } = await admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    app_metadata: withAdministratorAppMetadata(null),
  })

  if (error) {
    if (isDuplicateUserError(error)) {
      const user = await findUserByEmail(admin, normalizedEmail)
      if (user) return ensureAdministratorAppRole(admin, user)
    }
    throw error
  }

  if (!data.user) {
    throw new Error('Supabase did not return the created user')
  }

  return {
    status: 'created',
    userId: data.user.id,
    email: data.user.email ?? normalizedEmail,
  }
}

export function createBootstrapAdminClient(config: BootstrapAdminConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function runBootstrapAdmin(): Promise<BootstrapAdminResult> {
  const config = readBootstrapAdminConfig()
  const supabase = createBootstrapAdminClient(config)
  return bootstrapAdministrator(supabase.auth.admin, config.adminEmail)
}

if (require.main === module) {
  runBootstrapAdmin()
    .then((result) => {
      console.log(`Bootstrap admin ${result.status}: ${result.email} (${result.userId})`)
      console.log(
        'Use the password recovery flow to send a one-time link and set the initial password.',
      )
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
