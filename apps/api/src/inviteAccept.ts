import type { SupabaseClient, User } from '@supabase/supabase-js'
import { findUserByEmail, normalizeBootstrapAdminEmail } from './bootstrapAdmin'
import {
  findInviteByRawToken,
  markInvitationAccepted,
  type InvitationRow,
} from './invitesStore'
import { upsertProfile } from './profilesStore'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const ARCHITECT_ROLE = 'architect'

export type AcceptInvitationInput = {
  token: string
  password: string
  fullName: string
}

export type AcceptInvitationResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; code: string; message: string; status: number }

function withArchitectAppMetadata(
  current: User['app_metadata'] | null | undefined,
): Record<string, unknown> {
  return {
    ...(typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}),
    role: ARCHITECT_ROLE,
  }
}

export function validateAcceptInvitationInput(input: AcceptInvitationInput): string | null {
  const fullName = input.fullName.trim()
  if (fullName.length < 2) return 'fullName must be at least 2 characters'
  if (input.password.length < 8) return 'password must be at least 8 characters'
  if (!input.token.trim()) return 'token is required'
  return null
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  deps?: { supabase?: SupabaseClient },
): Promise<AcceptInvitationResult> {
  const validationError = validateAcceptInvitationInput(input)
  if (validationError) {
    return { ok: false, code: 'VALIDATION_ERROR', message: validationError, status: 400 }
  }

  if (!isStorageConfigured()) {
    return {
      ok: false,
      code: 'AUTH_NOT_CONFIGURED',
      message: 'Supabase is required for account activation',
      status: 503,
    }
  }

  let invite: InvitationRow | undefined
  try {
    invite = await findInviteByRawToken(input.token.trim())
  } catch (e) {
    console.error(e)
    return { ok: false, code: 'STORE_ERROR', message: 'Could not verify invitation', status: 500 }
  }

  if (!invite) {
    return {
      ok: false,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'Enlace inválido o caducado',
      status: 404,
    }
  }

  const sb = deps?.supabase ?? getSupabaseServiceRole()
  const admin = sb.auth.admin
  const email = invite.email_normalized

  try {
    const existing = await findUserByEmail(admin, email)
    if (existing) {
      return {
        ok: false,
        code: 'USER_ALREADY_EXISTS',
        message: 'Ya existe una cuenta con este correo. Inicia sesión o solicita recuperación.',
        status: 409,
      }
    }

    const normalizedEmail = normalizeBootstrapAdminEmail(email)
    const { data, error } = await admin.createUser({
      email: normalizedEmail,
      password: input.password,
      email_confirm: true,
      app_metadata: withArchitectAppMetadata(null),
      user_metadata: { full_name: input.fullName.trim() },
    })

    if (error || !data.user) {
      console.error(error)
      return {
        ok: false,
        code: 'CREATE_USER_FAILED',
        message: 'No se pudo crear la cuenta',
        status: 502,
      }
    }

    await markInvitationAccepted(invite.id)
    try {
      await upsertProfile(data.user.id, { display_name: input.fullName.trim() })
    } catch (profileErr) {
      console.error(profileErr)
    }
    return { ok: true, userId: data.user.id, email: normalizedEmail }
  } catch (e) {
    console.error(e)
    return { ok: false, code: 'ACCEPT_FAILED', message: 'Activation failed', status: 500 }
  }
}
