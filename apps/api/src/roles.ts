import type { User } from '@supabase/supabase-js'

export type AppRole = 'administrator' | 'architect'

/**
 * Rol de aplicación leído de `user_metadata.role` o `app_metadata.role` (Supabase).
 * Valores esperados: `administrator` | `architect` (sin distinguir mayúsculas).
 */
export function getAppRole(user: User): AppRole | null {
  const fromUser =
    typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : undefined
  const fromApp =
    typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : undefined
  const raw = (fromUser ?? fromApp ?? '').trim().toLowerCase()
  if (raw === 'administrator' || raw === 'architect') return raw
  return null
}
