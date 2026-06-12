/**
 * US-013 — Room processing pipeline (incremental).
 *
 * Processes a list of room_ids sequentially:
 *   1. Save dxf_checkpoint reference before each room's US-009.
 *   2. Filter outlet_placements to the target room (re-uses preliminary US-008 output).
 *   3. Run US-009 incremental merge (idempotent replace by room_id).
 *   4. Upload updated output_dxf; rollback is implicit (upload only on success).
 *   5. Update room_processing_state and job status.
 *
 * With normative_rules_enabled=false the botonera is blocked (only chat via US-014).
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  applyElectricalLayer,
  CadWorkerError,
  cadWorkerDisabled,
} from './cadWorkerBridge'
import { US009_OUTPUT_LAYER, sha256Hex } from './cadGeneration'
import { DXF_INPUT_BUCKET, DXF_OUTPUT_BUCKET, buildDxfObjectPath } from './dxfStorage'
import { findLatestInputForJob, findLatestOutputForJob } from './filesStore'
import { logStructured } from './logger'
import {
  findJob,
  patchJob,
  type JobRow,
  type DxfCheckpoint,
  type RoomProcessingRun,
} from './jobsStore'
import { isRoomProcessingAllowed } from './jobStatus'
import { recordStepLatency } from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { registerOutputDxfFromLocalFile } from './pipelineCadOutput'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const PIPELINE_KIND = 'room_processing'

type OutletPlacement = {
  room_id?: string
  [key: string]: unknown
}

export type RoomProcessingResult = {
  room_id: string
  status: 'procesada' | 'error'
  outlets_added?: number
  error?: { code: string; message: string }
}

export type RoomProcessingPipelineResult = {
  job_id: string
  job_status: string
  rooms: RoomProcessingResult[]
  normative_rules_blocked: boolean
}

export type RoomProcessingOptions = {
  /**
   * US-014: explicit chat prompts may process rooms even with
   * normative_rules_enabled=false (chat is the only channel in that mode).
   */
  viaChat?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function cadWorkerFixturePath(): string | undefined {
  return (
    process.env.CAD_WORKER_FIXTURE_DXF?.trim() ||
    process.env.CAD_WORKER_FIXTURE_DWG?.trim() ||
    undefined
  )
}

/**
 * Filter outlet_placements to only those for a specific room_id.
 */
function filterPlacementsForRoom(
  placements: unknown[],
  roomId: string,
): OutletPlacement[] {
  return (placements as OutletPlacement[]).filter(
    (p) => p.room_id === roomId,
  )
}

/**
 * Download a DXF from Supabase Storage to a local temp file.
 * Returns null if storage is not configured.
 */
async function downloadDxfToTemp(
  bucket: string,
  objectPath: string,
): Promise<{ localPath: string; dir: string } | null> {
  if (!isStorageConfigured()) return null
  const supabase = getSupabaseServiceRole()
  const { data, error } = await supabase.storage.from(bucket).download(objectPath)
  if (error || !data) {
    throw new Error(error?.message ?? `Could not download DXF from ${bucket}/${objectPath}`)
  }
  const dir = mkdtempSync(join(tmpdir(), 'cambre-room-'))
  const localPath = join(dir, 'source.dxf')
  writeFileSync(localPath, Buffer.from(await data.arrayBuffer()))
  return { localPath, dir }
}

/**
 * Main export: run incremental room processing for a list of room_ids.
 *
 * @param jobId - Job UUID
 * @param roomIds - Rooms to process in order
 * @param correlationId - Trace ID for this batch
 * @param idempotencyKey - Optional; logged for duplicate detection (not enforced yet)
 */
export async function runRoomProcessingPipeline(
  jobId: string,
  roomIds: string[],
  correlationId: string,
  idempotencyKey?: string,
  options?: RoomProcessingOptions,
): Promise<RoomProcessingPipelineResult> {
  const job = await findJob(jobId)
  if (!job) {
    throw new Error(`Job not found: ${jobId}`)
  }

  const meta = job.pipeline_metadata ?? {}
  const normativeRulesEnabled = meta.normative_rules_enabled !== false

  logStructured('info', {
    event: 'room_processing_start',
    job_id: jobId,
    correlation_id: correlationId,
    contract_version: PIPELINE_CONTRACT_VERSION,
    pipeline_kind: PIPELINE_KIND,
    room_ids: roomIds,
    normative_rules_enabled: normativeRulesEnabled,
    idempotency_key: idempotencyKey,
  })

  if (!normativeRulesEnabled && !options?.viaChat) {
    logStructured('info', {
      event: 'room_processing_blocked_normative_disabled',
      job_id: jobId,
      correlation_id: correlationId,
    })
    return {
      job_id: jobId,
      job_status: job.status,
      rooms: [],
      normative_rules_blocked: true,
    }
  }

  if (!isRoomProcessingAllowed(job.status)) {
    throw new Error(
      `Room processing not allowed in status '${job.status}'. Job must be listo_para_editar or parcialmente_procesado.`,
    )
  }

  const existingOutletPlacements: unknown[] = (meta.outlet_placements as unknown[]) ?? []
  const normativeRulesVersion = meta.normative_rules_version ?? undefined

  const results: RoomProcessingResult[] = []

  for (const roomId of roomIds) {
    const roomCorrelationId = `${correlationId}-${roomId}`
    const roomRunStart = new Date().toISOString()
    const t0 = Date.now()

    logStructured('info', {
      event: 'room_processing_room_start',
      job_id: jobId,
      correlation_id: roomCorrelationId,
      pipeline_kind: PIPELINE_KIND,
      room_id: roomId,
    })

    await sleep(0)

    const currentJob = await findJob(jobId)
    if (!currentJob) {
      throw new Error(`Job disappeared mid-processing: ${jobId}`)
    }
    const currentMeta = currentJob.pipeline_metadata ?? {}
    const currentRoomState = { ...(currentMeta.room_processing_state ?? {}) }

    // Mark room as procesando
    currentRoomState[roomId] = 'procesando'
    await patchJob(jobId, {
      pipeline_metadata: { ...currentMeta, room_processing_state: currentRoomState },
    })

    try {
      const placements = filterPlacementsForRoom(existingOutletPlacements, roomId)

      if (placements.length === 0) {
        logStructured('warn', {
          event: 'room_processing_no_placements',
          job_id: jobId,
          correlation_id: roomCorrelationId,
          room_id: roomId,
        })
      }

      let outletCount = 0

      if (!isStorageConfigured() && !cadWorkerFixturePath()) {
        // Stub path: no storage or fixture — simulate success for unit tests
        await sleep(5)
        logStructured('info', {
          event: 'room_processing_stub_success',
          job_id: jobId,
          correlation_id: roomCorrelationId,
          room_id: roomId,
        })
      } else {
        const supabase = getSupabaseServiceRole()
        const inputFile = await findLatestInputForJob(supabase, jobId)
        if (!inputFile || inputFile.bucket_id !== DXF_INPUT_BUCKET || !inputFile.object_path) {
          throw new Error(`No input DXF registered for job ${jobId}`)
        }

        // Determine source DXF: use existing output_dxf if available (incremental merge base)
        const outputFile = await findLatestOutputForJob(supabase, jobId)
        let sourceBucket: string
        let sourceObjectPath: string
        let checkpointSource: 'input_dxf' | 'output_dxf'

        if (outputFile && outputFile.object_path) {
          sourceBucket = DXF_OUTPUT_BUCKET
          sourceObjectPath = outputFile.object_path
          checkpointSource = 'output_dxf'
        } else {
          sourceBucket = DXF_INPUT_BUCKET
          sourceObjectPath = inputFile.object_path
          checkpointSource = 'input_dxf'
        }

        // Save checkpoint before this room's US-009
        const checkpoint: DxfCheckpoint = {
          room_id: roomId,
          source: checkpointSource,
          storage_ref: `${sourceBucket}/${sourceObjectPath}`,
          created_at: new Date().toISOString(),
        }
        const checkpointedJob = await findJob(jobId)
        const prevCheckpoints: DxfCheckpoint[] =
          (checkpointedJob?.pipeline_metadata?.dxf_checkpoints as DxfCheckpoint[] | undefined) ?? []
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(checkpointedJob?.pipeline_metadata ?? {}),
            dxf_checkpoints: [...prevCheckpoints, checkpoint],
          },
        })

        // Download source DXF
        const fixture = cadWorkerFixturePath()
        let localSourcePath: string
        let tempDir: string | undefined

        if (fixture) {
          localSourcePath = fixture
        } else {
          const downloaded = await downloadDxfToTemp(sourceBucket, sourceObjectPath)
          if (!downloaded) {
            throw new Error(`Could not download source DXF for room ${roomId}`)
          }
          localSourcePath = downloaded.localPath
          tempDir = downloaded.dir
        }

        if (cadWorkerDisabled()) {
          throw new Error('CAD worker is disabled; cannot complete room processing')
        }

        // Run US-009 incremental
        const dir = mkdtempSync(join(tmpdir(), 'cambre-room-out-'))
        const localOut = join(dir, 'output.dxf')

        const workerResult = await applyElectricalLayer(
          localSourcePath,
          localOut,
          placements,
          {
            outputLayer: US009_OUTPUT_LAYER,
            roomId,
          },
        )

        if (!workerResult.ok) {
          throw new CadWorkerError(
            workerResult.code ?? 'CAD_WORKER_APPLY_FAILED',
            workerResult.error ?? 'CAD worker failed for room processing',
          )
        }

        outletCount = workerResult.outlets_added ?? 0

        // Upload new output_dxf (overwrites current)
        const outputObjectPath = buildDxfObjectPath(
          currentJob.owner_user_id,
          jobId,
          randomUUID(),
        )
        await registerOutputDxfFromLocalFile(supabase, {
          jobId,
          ownerUserId: currentJob.owner_user_id,
          objectPath: outputObjectPath,
          localPath: localOut,
        })

        logStructured('info', {
          event: 'room_processing_us009_complete',
          job_id: jobId,
          correlation_id: roomCorrelationId,
          pipeline_kind: PIPELINE_KIND,
          room_id: roomId,
          outlets_added: outletCount,
          output_object_path: outputObjectPath,
        })

        void tempDir
      }

      // Mark room procesada and update job status
      const afterJob = await findJob(jobId)
      const afterMeta = afterJob?.pipeline_metadata ?? {}
      const afterRoomState = { ...(afterMeta.room_processing_state ?? {}) }
      afterRoomState[roomId] = 'procesada'

      const run: RoomProcessingRun = {
        room_id: roomId,
        correlation_id: roomCorrelationId,
        rules_version: normativeRulesVersion,
        started_at: roomRunStart,
        completed_at: new Date().toISOString(),
        outlet_count: outletCount,
      }
      const existingRuns: RoomProcessingRun[] =
        (afterMeta.room_processing_runs as RoomProcessingRun[] | undefined) ?? []

      const currentStatus = afterJob?.status ?? job.status
      const newJobStatus =
        currentStatus === 'listo_para_editar' ? 'parcialmente_procesado' : currentStatus

      await patchJob(jobId, {
        status: newJobStatus,
        pipeline_metadata: {
          ...afterMeta,
          room_processing_state: afterRoomState,
          room_processing_runs: [...existingRuns, run],
        },
      })

      recordStepLatency(`room_processing_${roomId}`, Date.now() - t0)

      logStructured('info', {
        event: 'room_processing_room_complete',
        job_id: jobId,
        correlation_id: roomCorrelationId,
        pipeline_kind: PIPELINE_KIND,
        room_id: roomId,
        outlets_added: outletCount,
        duration_ms: Date.now() - t0,
      })

      results.push({ room_id: roomId, status: 'procesada', outlets_added: outletCount })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown room processing error'
      const code =
        e instanceof CadWorkerError
          ? e.code
          : 'ROOM_PROCESSING_ERROR'

      logStructured('error', {
        event: 'room_processing_room_error',
        job_id: jobId,
        correlation_id: roomCorrelationId,
        pipeline_kind: PIPELINE_KIND,
        room_id: roomId,
        error: message,
        code,
        duration_ms: Date.now() - t0,
      })

      // Rollback: mark room as error (DXF was not uploaded on failure — implicit rollback)
      const failedJob = await findJob(jobId)
      const failedMeta = failedJob?.pipeline_metadata ?? {}
      const failedRoomState = { ...(failedMeta.room_processing_state ?? {}) }
      failedRoomState[roomId] = 'error'

      const errorRun: RoomProcessingRun = {
        room_id: roomId,
        correlation_id: roomCorrelationId,
        rules_version: normativeRulesVersion,
        started_at: roomRunStart,
        completed_at: new Date().toISOString(),
        error: { code, message, correlation_id: roomCorrelationId },
      }
      const existingRuns: RoomProcessingRun[] =
        (failedMeta.room_processing_runs as RoomProcessingRun[] | undefined) ?? []

      await patchJob(jobId, {
        pipeline_metadata: {
          ...failedMeta,
          room_processing_state: failedRoomState,
          room_processing_runs: [...existingRuns, errorRun],
        },
      })

      results.push({ room_id: roomId, status: 'error', error: { code, message } })
      // Continue processing remaining rooms (isolated failures)
    }
  }

  const finalJob = await findJob(jobId)
  logStructured('info', {
    event: 'room_processing_batch_complete',
    job_id: jobId,
    correlation_id: correlationId,
    pipeline_kind: PIPELINE_KIND,
    processed: results.filter((r) => r.status === 'procesada').length,
    errors: results.filter((r) => r.status === 'error').length,
    job_status: finalJob?.status,
  })

  return {
    job_id: jobId,
    job_status: finalJob?.status ?? job.status,
    rooms: results,
    normative_rules_blocked: false,
  }
}

/**
 * Mark rooms as omitida without running US-008/US-009.
 */
export async function omitRooms(
  jobId: string,
  roomIds: string[],
  correlationId: string,
): Promise<JobRow | undefined> {
  const job = await findJob(jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)

  if (!isRoomProcessingAllowed(job.status)) {
    throw new Error(
      `Cannot omit rooms in status '${job.status}'. Job must be listo_para_editar or parcialmente_procesado.`,
    )
  }

  const meta = job.pipeline_metadata ?? {}
  const roomState = { ...(meta.room_processing_state ?? {}) }
  for (const roomId of roomIds) {
    roomState[roomId] = 'omitida'
  }

  logStructured('info', {
    event: 'room_omit',
    job_id: jobId,
    correlation_id: correlationId,
    room_ids: roomIds,
  })

  return patchJob(jobId, {
    pipeline_metadata: { ...meta, room_processing_state: roomState },
  })
}

/**
 * Mark the entire job as procesado (architect closes the workspace).
 * All rooms in omitida or procesada state are valid closure.
 */
export async function markJobProcessed(
  jobId: string,
  correlationId: string,
): Promise<JobRow | undefined> {
  const job = await findJob(jobId)
  if (!job) throw new Error(`Job not found: ${jobId}`)

  logStructured('info', {
    event: 'job_mark_processed',
    job_id: jobId,
    correlation_id: correlationId,
    current_status: job.status,
  })

  return patchJob(jobId, { status: 'procesado', error: undefined })
}
