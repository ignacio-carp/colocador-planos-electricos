import type { User } from '@supabase/supabase-js'
import { getSupabaseForAuth } from './supabaseServer'

export async function getUserFromBearerToken(
  authorization: string | undefined,
): Promise<User | null> {
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  if (!token) return null
  const supabase = getSupabaseForAuth()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
}
