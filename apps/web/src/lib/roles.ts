import type { User } from '@supabase/supabase-js'

export type AppRole = 'administrator' | 'architect'

export function getAppRole(user: User | null | undefined): AppRole | null {
  if (!user) return null
  const fromUser =
    typeof user.user_metadata?.role === 'string' ? user.user_metadata.role : undefined
  const fromApp =
    typeof user.app_metadata?.role === 'string' ? user.app_metadata.role : undefined
  const raw = (fromUser ?? fromApp ?? '').trim().toLowerCase()
  if (raw === 'administrator' || raw === 'architect') return raw
  return null
}
