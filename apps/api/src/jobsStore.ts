import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertJobStatusTransition } from './jobStatus'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type JobStatus =
  | 'pendiente'
  | 'procesando'
  | 'procesado'
  | 'error'
  | 'analizando'
  | 'listo_para_editar'
  | 'parcialmente_procesado'

export type JobErrorPayload = {
  code: string
  message: string
  correlation_id: string
}

export type PreliminaryRecommendation = {
  room_id: string
  room_label: string
  recommendations: string[]
  outlet_count: number
  rule_ids: string[]
}

export type RoomProcessingStatus = 'pendiente' | 'procesando' | 'procesada' | 'error' | 'omitida'

export type RoomProcessingError = {
  code: string
  message: string
  correlation_id: string
}

export type PlacementsRejectedSummary = {
  total: number
  by_reason: Record<string, number>
}

export type RoomProcessingRun = {
  room_id: string
  correlation_id: string
  rules_version?: string
  started_at: string
  completed_at?: string
  outlet_count?: number
  header_insunits?: number | null
  effective_insunits?: number | null
  insunits_overridden?: boolean
  unit_confidence?: number
  drawing_units_per_meter?: number
  nominal_symbol_scale?: number
  final_symbol_scale?: number
  scale_clamped?: boolean
  clamp_reason?: string | null
  legacy_entities_removed?: number
  legacy_blocks_purged?: number
  placements_rejected?: PlacementsRejectedSummary
  generation_id?: string
  error?: RoomProcessingError
}

export type DxfCheckpoint = {
  room_id: string
  source: 'input_dxf' | 'output_dxf'
  storage_ref?: string
  created_at: string
}

export type JobPipelineMetadata = {
  normative_rules_version?: string
  normative_rules_enabled?: boolean
  cad_worker_inspect?: Record<string, unknown>
  cad_worker_apply?: Record<string, unknown>
  geometry_extract?: Record<string, unknown>
  cad_generation?: Record<string, unknown>
  pipeline_mode?: string
  vision_layout?: Record<string, unknown>
  outlet_placements?: unknown[]
  preliminary_recommendations?: PreliminaryRecommendation[]
  room_processing_state?: Record<string, RoomProcessingStatus>
  room_processing_runs?: RoomProcessingRun[]
  dxf_checkpoints?: DxfCheckpoint[]
  preliminary_analysis_completed_at?: string
  preliminary_analysis_warnings?: string[]
  analysis_degraded?: boolean
  analysis_degraded_reason?: string
  /**
   * Room segmentation computed from the drawing's own geometry and room-name
   * labels. Present only when the deterministic detector answered; absent means
   * the plan fell back to the vision model.
   */
  detected_rooms?: {
    detector: string
    labels_total: number
    labels_resolved: number
    unresolved_labels: { label?: string; reason?: string }[]
    room_types: Record<string, string>
    room_warnings: Record<string, string[]>
  }
  /**
   * Why the geometric detector did not answer, when it did not. Its presence is
   * the signal that the rooms in this job were drawn by a model rather than
   * measured from the plan.
   */
  room_detection_failure?: string
}

export type JobRow = {
  id: string
  owner_user_id: string
  title: string
  status: JobStatus
  /** ISO 8601 — US-004 list/detail display */
  created_at: string
  error?: JobErrorPayload
  pipeline_metadata?: JobPipelineMetadata
}

const memoryJobs: JobRow[] = []

function useMemoryStore(): boolean {
  if (process.env.JOBS_USE_MEMORY === '1') return true
  return !isStorageConfigured()
}

function rowFromDb(data: Record<string, unknown>): JobRow {
  const errorRaw = data.error
  let error: JobErrorPayload | undefined
  if (errorRaw && typeof errorRaw === 'object' && !Array.isArray(errorRaw)) {
    const e = errorRaw as Record<string, unknown>
    if (typeof e.code === 'string' && typeof e.message === 'string' && typeof e.correlation_id === 'string') {
      error = {
        code: e.code,
        message: e.message,
        correlation_id: e.correlation_id,
      }
    }
  }
  const metaRaw = data.pipeline_metadata
  const pipeline_metadata =
    metaRaw && typeof metaRaw === 'object' && !Array.isArray(metaRaw)
      ? (metaRaw as JobPipelineMetadata)
      : undefined

  return {
    id: String(data.id),
    owner_user_id: String(data.owner_user_id),
    title: String(data.title),
    status: data.status as JobStatus,
    created_at: new Date(String(data.created_at)).toISOString(),
    error,
    pipeline_metadata,
  }
}

function dbPatchFromPartial(patch: Partial<JobRow>): Record<string, unknown> {
  const out: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) out.title = patch.title
  if (patch.status !== undefined) out.status = patch.status
  if (patch.error !== undefined) out.error = patch.error ?? null
  if (patch.pipeline_metadata !== undefined) out.pipeline_metadata = patch.pipeline_metadata ?? null
  return out
}

export async function listAllJobs(): Promise<JobRow[]> {
  if (useMemoryStore()) return [...memoryJobs]
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowFromDb(row as Record<string, unknown>))
}

export async function listJobsForOwner(ownerId: string): Promise<JobRow[]> {
  if (useMemoryStore()) return memoryJobs.filter((j) => j.owner_user_id === ownerId)
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('jobs')
    .select('*')
    .eq('owner_user_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => rowFromDb(row as Record<string, unknown>))
}

export async function findJob(id: string): Promise<JobRow | undefined> {
  if (useMemoryStore()) return memoryJobs.find((j) => j.id === id)
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb.from('jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowFromDb(data as Record<string, unknown>) : undefined
}

export async function createJob(ownerUserId: string, title: string): Promise<JobRow> {
  const row: JobRow = {
    id: randomUUID(),
    owner_user_id: ownerUserId,
    title,
    status: 'pendiente',
    created_at: new Date().toISOString(),
  }
  if (useMemoryStore()) {
    memoryJobs.push(row)
    return row
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('jobs')
    .insert({
      id: row.id,
      owner_user_id: row.owner_user_id,
      title: row.title,
      status: row.status,
    })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'insert job failed')
  return rowFromDb(data as Record<string, unknown>)
}

export async function patchJob(id: string, patch: Partial<JobRow>): Promise<JobRow | undefined> {
  if (useMemoryStore()) {
    const idx = memoryJobs.findIndex((j) => j.id === id)
    if (idx === -1) return undefined
    if (patch.status !== undefined && patch.status !== memoryJobs[idx].status) {
      assertJobStatusTransition(memoryJobs[idx].status, patch.status)
    }
    memoryJobs[idx] = { ...memoryJobs[idx], ...patch }
    return memoryJobs[idx]
  }

  const existing = await findJob(id)
  if (!existing) return undefined
  if (patch.status !== undefined && patch.status !== existing.status) {
    assertJobStatusTransition(existing.status, patch.status)
  }

  const sb = getSupabaseServiceRole()
  const { data, error } = await sb.from('jobs').update(dbPatchFromPartial(patch)).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data ? rowFromDb(data as Record<string, unknown>) : undefined
}

/** Test helper — reset in-memory store. */
export function clearJobsForTests(): void {
  memoryJobs.length = 0
}

export function getJobsMemorySnapshot(): readonly JobRow[] {
  return memoryJobs
}

export async function insertJobForTests(
  sb: SupabaseClient,
  row: JobRow,
): Promise<void> {
  const { error } = await sb.from('jobs').insert({
    id: row.id,
    owner_user_id: row.owner_user_id,
    title: row.title,
    status: row.status,
    error: row.error ?? null,
    pipeline_metadata: row.pipeline_metadata ?? null,
    created_at: row.created_at,
  })
  if (error) throw new Error(error.message)
}
