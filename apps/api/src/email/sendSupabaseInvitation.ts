import type { SupabaseClient } from '@supabase/supabase-js'
import { findUserByEmail, normalizeBootstrapAdminEmail } from '../bootstrapAdmin'
import { getSupabaseServiceRole, isStorageConfigured } from '../supabaseService'

const ARCHITECT_ROLE = 'architect'

export type SendSupabaseInvitationResult =
  | { ok: true; userId: string }
  | {
      ok: false
      code: 'AUTH_NOT_CONFIGURED' | 'USER_ALREADY_EXISTS' | 'INVITE_FAILED'
      detail?: string
    }

function withArchitectAppMetadata(
  current: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(typeof current === 'object' && current !== null && !Array.isArray(current) ? current : {}),
    role: ARCHITECT_ROLE,
  }
}

export async function sendSupabaseInvitation(params: {
  email: string
  redirectTo: string
  inviterDisplay: string
  supabase?: SupabaseClient
}): Promise<SendSupabaseInvitationResult> {
  if (!isStorageConfigured()) {
    return { ok: false, code: 'AUTH_NOT_CONFIGURED' }
  }

  const sb = params.supabase ?? getSupabaseServiceRole()
  const admin = sb.auth.admin
  const normalizedEmail = normalizeBootstrapAdminEmail(params.email)

  try {
    const existing = await findUserByEmail(admin, normalizedEmail)
    if (existing) {
      return { ok: false, code: 'USER_ALREADY_EXISTS' }
    }

    const { data, error } = await admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: params.redirectTo,
      data: {
        invited_by: params.inviterDisplay,
      },
    })

    if (error || !data.user) {
      return {
        ok: false,
        code: 'INVITE_FAILED',
        detail: error?.message ?? 'inviteUserByEmail returned no user',
      }
    }

    const { error: updateError } = await admin.updateUserById(data.user.id, {
      app_metadata: withArchitectAppMetadata(data.user.app_metadata),
    })

    if (updateError) {
      return { ok: false, code: 'INVITE_FAILED', detail: updateError.message }
    }

    return { ok: true, userId: data.user.id }
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'invite failed'
    return { ok: false, code: 'INVITE_FAILED', detail }
  }
}
