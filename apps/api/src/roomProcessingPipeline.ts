/**
 * US-013 — Room processing pipeline (incremental).
 *
 * Processes a list of room_ids sequentially:
 *   1. US-008 multimodal (rules + room PNG + scoped geometry) per room.
 *   2. Merge outlet_placements for the room.
 *   3. Save dxf_checkpoint reference before each room's US-009.
 *   4. Run US-009 incremental merge (idempotent replace by room_id).
 *   5. Upload updated output_dxf; rollback is implicit (upload only on success).
 *   6. Update room_processing_state and job status.
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
  renderRoomFromDxf,
} from './cadWorkerBridge'
import { US009_OUTPUT_LAYER } from './cadGeneration'
import { DXF_INPUT_BUCKET, DXF_OUTPUT_BUCKET, buildDxfObjectPath } from './dxfStorage'
import { findLatestInputForJob, findLatestOutputForJob } from './filesStore'
import { logStructured } from './logger'
import {
  findJob,
  patchJob,
  type JobRow,
  type DxfCheckpoint,
  type RoomProcessingRun,
  type PreliminaryRecommendation,
} from './jobsStore'
import { isRoomProcessingAllowed } from './jobStatus'
import {
  buildPlanRenderMetadata,
  roomPolygonFromLayout,
  scopeGeometryForRoom,
  type PlanRenderMetadata,
} from './llmRenderContext'
import {
  buildRecommendationForRoom,
  mergeOutletPlacementsForRoom,
  mergePreliminaryRecommendation,
} from './normativeRoomMerge'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import { recordStepLatency } from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { buildLiveNormativeInferenceOutput } from './pipelineLive'
import { getPipelineMode } from './pipelineMode'
import { runInferWithRetries } from './pipelineInfer'
import { registerOutputDxfFromLocalFile } from './pipelineCadOutput'
import {
  buildStubNormativeInferenceOutput,
  type VisionLayoutOutputDoc,
} from './pipelineStubs'
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
  /**
   * US-014: after chat edits, re-apply US-009 only — preserve outlet_placements
   * already written by mutations (do not re-run US-008 for that room).
   */
  skipUs008?: boolean
  /** Architect-edited US-008 directive (sidebar or chat). */
  processingInstruction?: string
  /** Client viewport PNG data URL sent with US-008. */
  viewportImageDataUrl?: string
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

async function runUs008ForRoom(params: {
  jobId: string
  roomCorrelationId: string
  roomId: string
  visionLayout: Record<string, unknown>
  geometryExtract?: Record<string, unknown>
  inputDxfPath?: string
  processingInstruction?: string
  viewportImageDataUrl?: string
}): Promise<{ outletPlacements: unknown[]; rulesVersion: string }> {
  const pipelineMode = getPipelineMode()
  const rulesVersion = resolveActiveNormativeRulesVersion()
  const visionDoc = params.visionLayout as VisionLayoutOutputDoc
  const roomPolygon = roomPolygonFromLayout(params.visionLayout, params.roomId)
  const polygonVertices =
    roomPolygon && typeof roomPolygon === 'object' && Array.isArray((roomPolygon as { vertices?: unknown[] }).vertices)
      ? ((roomPolygon as { vertices: unknown[] }).vertices)
      : []

  let roomRender:
    | { localPngPath: string; metadata: PlanRenderMetadata; roomId: string }
    | undefined

  if (params.inputDxfPath && polygonVertices.length >= 3 && !cadWorkerDisabled()) {
    const renderDir = mkdtempSync(join(tmpdir(), 'cambre-room-render-'))
    const localPngPath = join(renderDir, `${params.roomId}.png`)
    try {
      const renderResult = await renderRoomFromDxf(params.inputDxfPath, localPngPath, {
        polygonVertices,
      })
      const metadata = buildPlanRenderMetadata(renderResult)
      if (metadata) {
        roomRender = { localPngPath, metadata, roomId: params.roomId }
      }
    } catch (e) {
      logStructured('warn', {
        event: 'room_processing_render_skipped',
        job_id: params.jobId,
        correlation_id: params.roomCorrelationId,
        room_id: params.roomId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const geometryExtractScoped = scopeGeometryForRoom(params.geometryExtract, roomPolygon)

  let normativeResult: Record<string, unknown> | undefined

  await runInferWithRetries(
    params.jobId,
    params.roomCorrelationId,
    'normative_inference',
    async () => {
      if (pipelineMode === 'live') {
        normativeResult = (await buildLiveNormativeInferenceOutput(
          params.jobId,
          params.roomCorrelationId,
          visionDoc,
          {
            roomIds: [params.roomId],
            geometryExtractScoped,
            roomRender: roomRender?.metadata
              ? {
                  localPngPath: roomRender.localPngPath,
                  metadata: roomRender.metadata,
                  roomId: params.roomId,
                }
              : undefined,
            architectInstruction: params.processingInstruction,
            viewportImageDataUrl: params.viewportImageDataUrl,
          },
        )) as Record<string, unknown>
      } else {
        normativeResult = buildStubNormativeInferenceOutput(
          params.jobId,
          params.roomCorrelationId,
          visionDoc,
          [params.roomId],
        ) as Record<string, unknown>
      }
    },
    { pipelineKind: PIPELINE_KIND },
  )

  if (!normativeResult) {
    normativeResult = buildStubNormativeInferenceOutput(
      params.jobId,
      params.roomCorrelationId,
      visionDoc,
      [params.roomId],
    ) as Record<string, unknown>
  }

  logStructured('info', {
    event: 'room_processing_us008_complete',
    job_id: params.jobId,
    correlation_id: params.roomCorrelationId,
    pipeline_kind: PIPELINE_KIND,
    room_id: params.roomId,
    outlets: Number((normativeResult.outlet_placements as unknown[] | undefined)?.length ?? 0),
    has_room_image: Boolean(roomRender),
  })

  return {
    outletPlacements: (normativeResult.outlet_placements as unknown[]) ?? [],
    rulesVersion:
      typeof normativeResult.normative_rules_version === 'string'
        ? normativeResult.normative_rules_version
        : rulesVersion,
  }
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
      const visionLayout = currentMeta.vision_layout as Record<string, unknown> | undefined
      if (!visionLayout) {
        throw new Error(`No vision_layout for job ${jobId}; run preliminary analysis first`)
      }

      const geometryExtract = currentMeta.geometry_extract as Record<string, unknown> | undefined
      let inputDxfPath: string | undefined
      const fixture = cadWorkerFixturePath()

      if (fixture) {
        inputDxfPath = fixture
      } else if (isStorageConfigured()) {
        const supabase = getSupabaseServiceRole()
        const inputFile = await findLatestInputForJob(supabase, jobId)
        if (inputFile?.bucket_id === DXF_INPUT_BUCKET && inputFile.object_path) {
          const downloaded = await downloadDxfToTemp(DXF_INPUT_BUCKET, inputFile.object_path)
          inputDxfPath = downloaded?.localPath
        }
      }

      const us008 = options?.skipUs008
        ? {
            outletPlacements: filterPlacementsForRoom(
              (currentMeta.outlet_placements as unknown[]) ?? [],
              roomId,
            ),
            rulesVersion:
              (currentMeta.normative_rules_version as string | undefined) ??
              resolveActiveNormativeRulesVersion(),
          }
        : await runUs008ForRoom({
            jobId,
            roomCorrelationId,
            roomId,
            visionLayout,
            geometryExtract,
            inputDxfPath,
            processingInstruction: options?.processingInstruction,
            viewportImageDataUrl: options?.viewportImageDataUrl,
          })

      const mergedPlacements = options?.skipUs008
        ? ((currentMeta.outlet_placements as unknown[]) ?? [])
        : mergeOutletPlacementsForRoom(
            (currentMeta.outlet_placements as unknown[]) ?? [],
            roomId,
            us008.outletPlacements,
          )
      const recommendation = options?.skipUs008
        ? undefined
        : buildRecommendationForRoom(visionLayout, {
            outlet_placements: us008.outletPlacements,
          }, roomId)
      const preliminaryRecommendations: PreliminaryRecommendation[] = recommendation
        ? mergePreliminaryRecommendation(
            (currentMeta.preliminary_recommendations as PreliminaryRecommendation[]) ?? [],
            recommendation,
          )
        : ((currentMeta.preliminary_recommendations as PreliminaryRecommendation[]) ?? [])

      await patchJob(jobId, {
        pipeline_metadata: {
          ...currentMeta,
          outlet_placements: mergedPlacements,
          normative_rules_version: us008.rulesVersion,
          preliminary_recommendations: preliminaryRecommendations,
        },
      })

      const placements = filterPlacementsForRoom(mergedPlacements, roomId)
      const normativeRulesVersion = us008.rulesVersion

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
        // Stub path: no storage or fixture — simulate US-009 success for unit tests
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
        rules_version:
          (failedMeta.normative_rules_version as string | undefined) ??
          resolveActiveNormativeRulesVersion(),
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
