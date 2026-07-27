import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CadWorkerError,
  cadWorkerConfigSummary,
  cadWorkerDisabled,
  cadWorkerTransport,
  detectRoomsFromGeometry,
  extractGeometryFromDxf,
  inspectDxfFile,
  renderPlanFromDxf,
  type CadWorkerDetectRoomsResult,
} from './cadWorkerBridge'
import {
  buildVisionLayoutFromDetectedRooms,
  detectedRoomsMetadata,
  hasUsableRooms,
} from './deterministicRooms'
import { OpenAiClientError } from './openaiClient'
import {
  buildLiveVisionFallback,
  buildLiveVisionLayoutOutput,
} from './pipelineLive'
import { aiConfigured, getPipelineMode } from './pipelineMode'
import { DXF_INPUT_BUCKET } from './dxfStorage'
import { findLatestInputForJob } from './filesStore'
import { logStructured } from './logger'
import {
  findJob,
  patchJob,
  type JobRow,
  type RoomProcessingStatus,
} from './jobsStore'
import { incrementPipelineError, recordIaRetry, recordStepLatency } from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { buildStubVisionLayoutOutput } from './pipelineStubs'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'
import { buildPlanRenderMetadata, type PlanRenderMetadata } from './llmRenderContext'
import {
  PRELIMINARY_WARNING_ANALYSIS_DEGRADED,
  PRELIMINARY_WARNING_NO_ROOMS,
} from './preliminaryAnalysis'

export type RetriedAnalysisResult<T> = {
  value: T
  degraded: boolean
  reason?: string
}

/** LLM classification/name step: one initial attempt plus exactly one retry. */
export async function runAnalysisWithSingleRetry<T>(
  work: (attempt: 1 | 2) => Promise<T>,
  fallback: () => T,
  onRetry?: (reason: string) => void,
): Promise<RetriedAnalysisResult<T>> {
  let lastReason = 'analysis failed'
  for (const attempt of [1, 2] as const) {
    try {
      return { value: await work(attempt), degraded: false }
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e)
      if (attempt === 1) onRetry?.(lastReason)
    }
  }
  return {
    value: fallback(),
    degraded: true,
    reason: lastReason.slice(0, 500),
  }
}

function cadWorkerFixturePath(): string | undefined {
  return (
    process.env.CAD_WORKER_FIXTURE_DXF?.trim() ||
    process.env.CAD_WORKER_FIXTURE_DWG?.trim() ||
    undefined
  )
}

async function resolveInputDxfLocalPath(
  jobId: string,
): Promise<{ localPath: string; dir: string } | null> {
  const fixture = cadWorkerFixturePath()
  if (fixture) return { localPath: fixture, dir: '' }

  if (!isStorageConfigured()) return null
  const supabase = getSupabaseServiceRole()
  const input = await findLatestInputForJob(supabase, jobId)
  if (input?.bucket_id !== DXF_INPUT_BUCKET || !input.object_path) return null
  const { data, error } = await supabase.storage.from(input.bucket_id).download(input.object_path)
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not download input DXF')
  }
  const dir = mkdtempSync(join(tmpdir(), 'cambre-cad-'))
  const localPath = join(dir, 'input.dxf')
  writeFileSync(localPath, Buffer.from(await data.arrayBuffer()))
  return { localPath, dir }
}

async function runCadWorkerInspect(
  jobId: string,
  correlationId: string,
  localPath: string,
): Promise<Record<string, unknown>> {
  const result = await inspectDxfFile(localPath)
  logStructured('info', {
    event: 'cad_worker_inspect',
    job_id: jobId,
    correlation_id: correlationId,
    source: cadWorkerFixturePath() ? 'fixture' : 'storage',
    cad_worker_transport: cadWorkerTransport(),
    entity_count: result.entity_count,
  })
  return result as Record<string, unknown>
}

async function runCadWorkerGeometryExtract(
  jobId: string,
  correlationId: string,
  localPath: string,
): Promise<Record<string, unknown>> {
  const geometry = await extractGeometryFromDxf(localPath)
  logStructured('info', {
    event: 'cad_worker_geometry_extract',
    job_id: jobId,
    correlation_id: correlationId,
    source: cadWorkerFixturePath() ? 'fixture' : 'storage',
    wall_count: geometry.paredes?.length ?? 0,
    furniture_count: geometry.muebles?.length ?? 0,
  })
  return geometry as Record<string, unknown>
}

/**
 * Deterministic room segmentation. A failure is reported and the pipeline falls
 * back to the vision model, because some drawings genuinely cannot be segmented
 * from their own geometry (no wall layer, no room names).
 */
async function runRoomDetection(
  jobId: string,
  correlationId: string,
  geometryExtract: Record<string, unknown>,
): Promise<CadWorkerDetectRoomsResult | undefined> {
  const insunits = geometryExtract.insunits
  try {
    const result = await detectRoomsFromGeometry(
      geometryExtract,
      typeof insunits === 'number' ? insunits : undefined,
    )
    logStructured('info', {
      event: 'cad_worker_detect_rooms',
      job_id: jobId,
      correlation_id: correlationId,
      detector: result.detector,
      rooms: result.rooms?.length ?? 0,
      labels_total: result.labels_total,
      labels_resolved: result.labels_resolved,
    })
    return result
  } catch (e) {
    logStructured('warn', {
      event: 'cad_worker_detect_rooms_failed',
      job_id: jobId,
      correlation_id: correlationId,
      error: e instanceof Error ? e.message : String(e),
      code: e instanceof CadWorkerError ? e.code : 'DETECT_ROOMS_ERROR',
      note: 'falls back to the vision model for this plan',
    })
    return undefined
  }
}

async function runCadWorkerPlanRender(
  jobId: string,
  correlationId: string,
  localPath: string,
): Promise<{ localPngPath: string; metadata: PlanRenderMetadata } | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'cambre-render-'))
  const localPngPath = join(dir, 'plan.png')
  let result
  try {
    result = await renderPlanFromDxf(localPath, localPngPath)
  } catch (e) {
    if (e instanceof CadWorkerError) {
      logStructured('warn', {
        event: 'cad_worker_render_plan_skipped',
        job_id: jobId,
        correlation_id: correlationId,
        error: e.message,
        code: e.code,
      })
      return undefined
    }
    throw e
  }
  if (!result.ok) {
    logStructured('warn', {
      event: 'cad_worker_render_plan_skipped',
      job_id: jobId,
      correlation_id: correlationId,
      error: result.error,
      code: result.code,
    })
    return undefined
  }
  const metadata = buildPlanRenderMetadata(result)
  if (!metadata) return undefined
  logStructured('info', {
    event: 'cad_worker_render_plan',
    job_id: jobId,
    correlation_id: correlationId,
    width_px: metadata.width_px,
    height_px: metadata.height_px,
  })
  return { localPngPath, metadata }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runTimedStep(
  jobId: string,
  correlationId: string,
  step: string,
  work: () => Promise<void>,
): Promise<void> {
  const t0 = Date.now()
  logStructured('info', {
    event: 'pipeline_step_start',
    job_id: jobId,
    correlation_id: correlationId,
    contract_version: PIPELINE_CONTRACT_VERSION,
    step,
    pipeline_kind: 'preliminary',
  })
  try {
    await work()
  } finally {
    recordStepLatency(step, Date.now() - t0)
  }
  logStructured('info', {
    event: 'pipeline_step_end',
    job_id: jobId,
    correlation_id: correlationId,
    contract_version: PIPELINE_CONTRACT_VERSION,
    step,
    pipeline_kind: 'preliminary',
  })
}

type Room = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

/**
 * Pipeline de análisis preliminar (US-012):
 * inspect + geometry + render-plan + US-007 (multimodal).
 * Termina en listo_para_editar sin US-008 ni output_dxf.
 */
export async function runPreliminaryAnalysisPipeline(
  jobId: string,
  correlationId: string,
): Promise<JobRow | undefined> {
  const job = await findJob(jobId)
  if (!job) {
    logStructured('error', {
      event: 'preliminary_pipeline_job_missing',
      job_id: jobId,
      correlation_id: correlationId,
    })
    return undefined
  }

  const normativeRulesEnabled = job.pipeline_metadata?.normative_rules_enabled !== false

  await patchJob(jobId, { status: 'analizando' })

  logStructured('info', {
    event: 'preliminary_pipeline_start',
    job_id: jobId,
    correlation_id: correlationId,
    contract_version: PIPELINE_CONTRACT_VERSION,
    pipeline_mode: getPipelineMode(),
    normative_rules_enabled: normativeRulesEnabled,
    ...cadWorkerConfigSummary(),
  })

  const pipelineMode = getPipelineMode()
  let lastExecutedStep = 'ingest'
  try {
    if (pipelineMode === 'live' && !aiConfigured()) {
      throw new OpenAiClientError(
        'LLM_NOT_CONFIGURED',
        'CAD_PIPELINE_MODE=live requires OPENROUTER_API_KEY or OPENAI_API_KEY',
      )
    }

    await runTimedStep(jobId, correlationId, 'ingest', () => sleep(5))

    let cadInspect: Record<string, unknown> | undefined
    let geometryExtract: Record<string, unknown> | undefined
    let planRender: { localPngPath: string; metadata: PlanRenderMetadata } | undefined

    if (!cadWorkerDisabled()) {
      const local = await resolveInputDxfLocalPath(jobId)
      if (!local) {
        throw new Error('No CAD_WORKER_FIXTURE_DXF and no input file in storage')
      }
      cadInspect = await runCadWorkerInspect(jobId, correlationId, local.localPath)
      geometryExtract = await runCadWorkerGeometryExtract(jobId, correlationId, local.localPath)
      planRender = await runCadWorkerPlanRender(jobId, correlationId, local.localPath)
      await patchJob(jobId, {
        pipeline_metadata: {
          ...(await findJob(jobId))?.pipeline_metadata,
          ...(cadInspect ? { cad_worker_inspect: cadInspect } : {}),
          ...(geometryExtract ? { geometry_extract: geometryExtract } : {}),
          ...(planRender ? { plan_render: planRender.metadata } : {}),
          pipeline_mode: pipelineMode,
        },
      })
    } else if (pipelineMode === 'live') {
      throw new Error('CAD worker is required for preliminary analysis in live mode')
    }

    lastExecutedStep = 'detect_rooms'
    const detection = geometryExtract
      ? await runRoomDetection(jobId, correlationId, geometryExtract)
      : undefined

    lastExecutedStep = 'vision_layout'
    let visionResult: Record<string, unknown> | undefined
    let analysisDegradedReason: string | undefined

    if (hasUsableRooms(detection)) {
      // Geometry answered the question. The model is not asked to guess it.
      visionResult = buildVisionLayoutFromDetectedRooms(
        jobId,
        correlationId,
        detection as CadWorkerDetectRoomsResult,
      ) as Record<string, unknown>
      logStructured('info', {
        event: 'preliminary_rooms_deterministic',
        job_id: jobId,
        correlation_id: correlationId,
        contract_version: PIPELINE_CONTRACT_VERSION,
        detector: detection?.detector,
        rooms: detection?.rooms?.length ?? 0,
        labels_total: detection?.labels_total,
        labels_resolved: detection?.labels_resolved,
      })
    }

    if (!visionResult) await runTimedStep(jobId, correlationId, 'vision_layout', async () => {
      const outcome = await runAnalysisWithSingleRetry(
        async (attempt) => {
          if (process.env.CAD_IA_SIMULATE_FAILURE === 'true' && pipelineMode === 'stub') {
            throw new Error(`Vision classification failure (simulated), attempt ${attempt}`)
          }

          const hasCadContext = Boolean(cadInspect || geometryExtract || planRender)
          if (pipelineMode === 'live' && hasCadContext) {
            const result = await buildLiveVisionLayoutOutput(jobId, correlationId, {
              cadInspect,
              geometryExtract,
              planRender,
            })
            logStructured('info', {
              event: 'preliminary_us007_live',
              job_id: jobId,
              correlation_id: correlationId,
              contract_version: PIPELINE_CONTRACT_VERSION,
              attempt,
              has_plan_image: Boolean(planRender),
            })
            return result as Record<string, unknown>
          }
          if (pipelineMode === 'live') {
            throw new Error('Vision classification unavailable: CAD context missing')
          }

          const result = buildStubVisionLayoutOutput(jobId, correlationId) as Record<string, unknown>
          const rooms =
            (result.layout_interpretation as { rooms?: unknown[] } | undefined)?.rooms ?? []
          logStructured('info', {
            event: 'preliminary_us007_stub',
            job_id: jobId,
            correlation_id: correlationId,
            contract_version: PIPELINE_CONTRACT_VERSION,
            rooms: rooms.length,
          })
          return result
        },
        () => buildLiveVisionFallback(jobId, correlationId) as Record<string, unknown>,
        (reason) => {
          recordIaRetry(jobId)
          logStructured('warn', {
            event: 'preliminary_analysis_retry',
            job_id: jobId,
            correlation_id: correlationId,
            reason: reason.slice(0, 500),
          })
        },
      )
      visionResult = outcome.value
      analysisDegradedReason = outcome.reason
      if (outcome.degraded) {
        logStructured('warn', {
          event: 'preliminary_analysis_degraded',
          job_id: jobId,
          correlation_id: correlationId,
          reason: outcome.reason,
        })
      }
    })

    if (!visionResult) {
      throw new Error('Vision layout step produced no output')
    }

    const visionLayout = visionResult.layout_interpretation as { rooms?: Room[] } | undefined
    const rooms: Room[] = visionLayout?.rooms ?? []

    const preliminaryWarnings: string[] = []
    if (analysisDegradedReason) {
      preliminaryWarnings.push(PRELIMINARY_WARNING_ANALYSIS_DEGRADED)
    }
    if (rooms.length === 0) {
      preliminaryWarnings.push(PRELIMINARY_WARNING_NO_ROOMS)
      logStructured('warn', {
        event: 'preliminary_no_rooms_detected',
        job_id: jobId,
        correlation_id: correlationId,
        contract_version: PIPELINE_CONTRACT_VERSION,
      })
    }

    const roomProcessingState: Record<string, RoomProcessingStatus> = {}
    for (const room of rooms) {
      if (room.id) roomProcessingState[room.id] = 'pendiente'
    }

    const completedAt = new Date().toISOString()
    const existingMeta = { ...((await findJob(jobId))?.pipeline_metadata ?? {}) }
    delete existingMeta.outlet_placements
    delete existingMeta.normative_rules_version
    delete existingMeta.analysis_degraded_reason
    // A re-analysis that falls back to the vision model must not keep the room
    // types from a previous deterministic run.
    delete existingMeta.detected_rooms

    const done = await patchJob(jobId, {
      status: 'listo_para_editar',
      error: undefined,
      pipeline_metadata: {
        ...existingMeta,
        vision_layout: visionResult,
        ...(hasUsableRooms(detection)
          ? { detected_rooms: detectedRoomsMetadata(detection as CadWorkerDetectRoomsResult) }
          : {}),
        preliminary_recommendations: [],
        room_processing_state: roomProcessingState,
        preliminary_analysis_completed_at: completedAt,
        preliminary_analysis_warnings: preliminaryWarnings,
        analysis_degraded: Boolean(analysisDegradedReason),
        ...(analysisDegradedReason
          ? { analysis_degraded_reason: analysisDegradedReason }
          : {}),
        normative_rules_enabled: normativeRulesEnabled,
      },
    })

    logStructured('info', {
      event: 'preliminary_pipeline_complete',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      rooms: rooms.length,
      normative_rules_enabled: normativeRulesEnabled,
    })

    return done
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown preliminary pipeline error'
    const code =
      e instanceof CadWorkerError
        ? e.code
        : e instanceof OpenAiClientError
          ? e.code
          : message.includes('exhausted retries')
            ? 'IA_PROVIDER_EXHAUSTED'
            : 'PRELIMINARY_PIPELINE_ERROR'
    incrementPipelineError(lastExecutedStep)
    const error = {
      code,
      message,
      correlation_id: correlationId,
    }
    const failed = await patchJob(jobId, { status: 'error', error })
    logStructured('error', {
      event: 'preliminary_pipeline_error',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      step: lastExecutedStep,
      error: message,
    })
    return failed
  }
}
