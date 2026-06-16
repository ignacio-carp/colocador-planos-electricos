import type { SupabaseClient } from '@supabase/supabase-js'
import { findPendingInviteByEmail, markInvitationAccepted } from './invitesStore'
import { upsertProfile } from './profilesStore'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type CompleteInvitationInput = {
  userId: string
  email: string
  fullName: string
}

export type CompleteInvitationResult =
  | { ok: true }
  | { ok: false; code: string; message: string; status: number }

export function validateCompleteInvitationInput(input: CompleteInvitationInput): string | null {
  const fullName = input.fullName.trim()
  if (fullName.length < 2) return 'fullName must be at least 2 characters'
  if (!input.userId.trim()) return 'userId is required'
  if (!input.email.trim()) return 'email is required'
  return null
}

export async function completeSupabaseInvitation(
  input: CompleteInvitationInput,
  deps?: { supabase?: SupabaseClient },
): Promise<CompleteInvitationResult> {
  const validationError = validateCompleteInvitationInput(input)
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

  const sb = deps?.supabase ?? getSupabaseServiceRole()
  const normalizedEmail = input.email.trim().toLowerCase()

  try {
    const { data, error } = await sb.auth.admin.getUserById(input.userId)
    if (error || !data.user) {
      return { ok: false, code: 'USER_NOT_FOUND', message: 'Usuario no encontrado', status: 404 }
    }

    const userEmail = data.user.email?.trim().toLowerCase()
    if (userEmail !== normalizedEmail) {
      return {
        ok: false,
        code: 'EMAIL_MISMATCH',
        message: 'El correo no coincide con la invitación',
        status: 403,
      }
    }

    const pending = await findPendingInviteByEmail(normalizedEmail)
    if (pending) {
      await markInvitationAccepted(pending.id)
    }

    await upsertProfile(input.userId, { display_name: input.fullName.trim() })
    return { ok: true }
  } catch (e) {
    console.error(e)
    return { ok: false, code: 'COMPLETE_FAILED', message: 'Activation failed', status: 500 }
  }
}
