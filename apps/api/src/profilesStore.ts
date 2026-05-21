import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type ProfileRow = {
  user_id: string
  display_name: string | null
  professional_title: string | null
  license_number: string | null
  created_at: string
  updated_at: string
}

const memoryProfiles = new Map<string, ProfileRow>()

function useMemoryStore(): boolean {
  if (process.env.PROFILES_USE_MEMORY === '1') return true
  return !isStorageConfigured()
}

function rowFromDb(data: Record<string, unknown>): ProfileRow {
  return {
    user_id: String(data.user_id),
    display_name: data.display_name != null ? String(data.display_name) : null,
    professional_title: data.professional_title != null ? String(data.professional_title) : null,
    license_number: data.license_number != null ? String(data.license_number) : null,
    created_at: new Date(String(data.created_at)).toISOString(),
    updated_at: new Date(String(data.updated_at)).toISOString(),
  }
}

export async function findProfile(userId: string): Promise<ProfileRow | undefined> {
  if (useMemoryStore()) return memoryProfiles.get(userId)
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowFromDb(data as Record<string, unknown>) : undefined
}

export async function upsertProfile(
  userId: string,
  patch: { display_name?: string | null; professional_title?: string | null; license_number?: string | null },
): Promise<ProfileRow> {
  const now = new Date().toISOString()
  if (useMemoryStore()) {
    const existing = memoryProfiles.get(userId)
    const row: ProfileRow = {
      user_id: userId,
      display_name: patch.display_name ?? existing?.display_name ?? null,
      professional_title: patch.professional_title ?? existing?.professional_title ?? null,
      license_number: patch.license_number ?? existing?.license_number ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    }
    memoryProfiles.set(userId, row)
    return row
  }

  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        ...patch,
        updated_at: now,
      },
      { onConflict: 'user_id' },
    )
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'upsert profile failed')
  return rowFromDb(data as Record<string, unknown>)
}

/** Test helper — reset in-memory profiles. */
export function clearProfilesForTests(): void {
  memoryProfiles.clear()
}

export async function insertProfileForTests(sb: SupabaseClient, row: ProfileRow): Promise<void> {
  const { error } = await sb.from('profiles').insert({
    user_id: row.user_id,
    display_name: row.display_name,
    professional_title: row.professional_title,
    license_number: row.license_number,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })
  if (error) throw new Error(error.message)
}
