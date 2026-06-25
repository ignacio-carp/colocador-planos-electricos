import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CadWorkerError,
  cadWorkerConfigSummary,
  cadWorkerDisabled,
  cadWorkerTransport,
  extractGeometryFromDxf,
  inspectDxfFile,
  renderPlanFromDxf,
} from './cadWorkerBridge'
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
import { incrementPipelineError, recordStepLatency } from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { buildStubVisionLayoutOutput } from './pipelineStubs'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'
import { buildPlanRenderMetadata, type PlanRenderMetadata } from './llmRenderContext'

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
  })
  return geometry as Record<string, unknown>
}

async function runCadWorkerPlanRender(
  jobId: string,
  correlationId: string,
  localPath: string,
): Promise<{ localPngPath: string; metadata: PlanRenderMetadata } | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'cambre-render-'))
  const localPngPath = join(dir, 'plan.png')
  const result = await renderPlanFromDxf(localPath, localPngPath)
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
      try {
        cadInspect = await runCadWorkerInspect(jobId, correlationId, local.localPath)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logStructured('warn', {
          event: 'cad_worker_inspect_skipped',
          job_id: jobId,
          correlation_id: correlationId,
          cad_worker_transport: cadWorkerTransport(),
          error: message,
          error_code: e instanceof CadWorkerError ? e.code : undefined,
        })
      }
      try {
        geometryExtract = await runCadWorkerGeometryExtract(jobId, correlationId, local.localPath)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logStructured('warn', {
          event: 'cad_worker_geometry_extract_skipped',
          job_id: jobId,
          correlation_id: correlationId,
          error: message,
        })
      }
      try {
        planRender = await runCadWorkerPlanRender(jobId, correlationId, local.localPath)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logStructured('warn', {
          event: 'cad_worker_render_plan_skipped',
          job_id: jobId,
          correlation_id: correlationId,
          error: message,
        })
      }
      if (cadInspect || geometryExtract || planRender) {
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            ...(cadInspect ? { cad_worker_inspect: cadInspect } : {}),
            ...(geometryExtract ? { geometry_extract: geometryExtract } : {}),
            ...(planRender ? { plan_render: planRender.metadata } : {}),
            pipeline_mode: pipelineMode,
          },
        })
      }
    }

    lastExecutedStep = 'vision_layout'
    let visionResult: Record<string, unknown> | undefined
    await runTimedStep(jobId, correlationId, 'vision_layout', async () => {
      const hasCadContext = Boolean(cadInspect || geometryExtract || planRender)
      if (pipelineMode === 'live' && hasCadContext) {
        visionResult = await buildLiveVisionLayoutOutput(jobId, correlationId, {
          cadInspect,
          geometryExtract,
          planRender,
        })
        logStructured('info', {
          event: 'preliminary_us007_live',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
          has_plan_image: Boolean(planRender),
        })
      } else if (pipelineMode === 'live') {
        visionResult = buildLiveVisionFallback(jobId, correlationId) as Record<string, unknown>
        logStructured('warn', {
          event: 'preliminary_us007_live_fallback_stub',
          job_id: jobId,
          correlation_id: correlationId,
        })
      } else {
        visionResult = buildStubVisionLayoutOutput(jobId, correlationId) as Record<string, unknown>
        const rooms =
          (visionResult.layout_interpretation as { rooms?: unknown[] } | undefined)?.rooms ?? []
        logStructured('info', {
          event: 'preliminary_us007_stub',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
          rooms: rooms.length,
        })
      }
    })

    if (!visionResult) {
      throw new Error('Vision layout step produced no output')
    }

    const visionLayout = visionResult.layout_interpretation as { rooms?: Room[] } | undefined
    const rooms: Room[] = visionLayout?.rooms ?? []

    if (rooms.length === 0) {
      throw new Error('US-007 returned no rooms — cannot proceed with preliminary analysis')
    }

    const roomProcessingState: Record<string, RoomProcessingStatus> = {}
    for (const room of rooms) {
      if (room.id) roomProcessingState[room.id] = 'pendiente'
    }

    const completedAt = new Date().toISOString()
    const existingMeta = { ...((await findJob(jobId))?.pipeline_metadata ?? {}) }
    delete existingMeta.outlet_placements
    delete existingMeta.normative_rules_version

    const done = await patchJob(jobId, {
      status: 'listo_para_editar',
      error: undefined,
      pipeline_metadata: {
        ...existingMeta,
        vision_layout: visionResult,
        preliminary_recommendations: [],
        room_processing_state: roomProcessingState,
        preliminary_analysis_completed_at: completedAt,
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
