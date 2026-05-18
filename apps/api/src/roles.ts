import type { User } from '@supabase/supabase-js'

export type AppRole = 'administrator' | 'architect'

/**
 * Rol de aplicación leído primero de `app_metadata.role` (no editable por usuarios)
 * y luego de `user_metadata.role` como compatibilidad legacy.
 * Valores esperados: `administrator` | `architect` (sin distinguir mayúsculas).
 */
export function getAppRole(user: User): AppRole | null {
  const fromApp = typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : undefined
  const fromUser =
    typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : undefined
  const raw = (fromApp ?? fromUser ?? '').trim().toLowerCase()
  if (raw === 'administrator' || raw === 'architect') return raw
  return null
}
