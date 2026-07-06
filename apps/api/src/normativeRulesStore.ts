import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'
import type { NormativeRulesBundle } from './normativeRules'

export type NormativeRulesetRow = {
  version: string
  bundle: NormativeRulesBundle
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

function rowFromDb(data: Record<string, unknown>): NormativeRulesetRow {
  return {
    version: String(data.version),
    bundle: data.bundle as NormativeRulesBundle,
    description: typeof data.description === 'string' ? data.description : null,
    is_active: Boolean(data.is_active),
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
    updated_by: typeof data.updated_by === 'string' ? data.updated_by : null,
  }
}

export async function findActiveNormativeRuleset(
  client?: SupabaseClient,
): Promise<NormativeRulesetRow | null> {
  const supabase = client ?? getSupabaseServiceRole()
  const { data, error } = await supabase
    .from('normative_rulesets')
    .select('version, bundle, description, is_active, created_at, updated_at, updated_by')
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  if (!data) return null
  return rowFromDb(data as Record<string, unknown>)
}

export async function activateNormativeRuleset(
  bundle: NormativeRulesBundle,
  updatedBy?: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getSupabaseServiceRole()
  const description =
    typeof bundle.title === 'string' && bundle.title.trim() ? bundle.title.trim() : null
  const { error } = await supabase.rpc('activate_normative_ruleset', {
    p_version: bundle.version,
    p_bundle: bundle,
    p_description: description,
    p_updated_by: updatedBy ?? null,
  })
  if (error) {
    throw new Error(error.message)
  }
}

export function isNormativeRulesDatabaseEnabled(): boolean {
  return isStorageConfigured()
}
