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
} from './cadWorkerBridge'
import { OpenAiClientError } from './openaiClient'
import {
  buildLiveNormativeInferenceOutput,
  buildLiveVisionFallback,
  buildLiveVisionLayoutOutput,
} from './pipelineLive'
import { aiConfigured, getPipelineMode } from './pipelineMode'
import { DXF_INPUT_BUCKET } from './dxfStorage'
import { findLatestInputForJob } from './filesStore'
import { logStructured } from './logger'
import { findJob, patchJob, type JobRow, type PreliminaryRecommendation } from './jobsStore'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import {
  incrementPipelineError,
  recordIaCostUsd,
  recordIaRetry,
  recordStepLatency,
} from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { buildStubNormativeInferenceOutput, buildStubVisionLayoutOutput } from './pipelineStubs'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const IA_MAX_ATTEMPTS = 3

function cadWorkerFixturePath(): string | undefined {
  return (
    process.env.CAD_WORKER_FIXTURE_DXF?.trim() ||
    process.env.CAD_WORKER_FIXTURE_DWG?.trim() ||
    undefined
  )
}

async function downloadInputDxfToTemp(
  jobId: string,
): Promise<{ localPath: string; dir: string } | null> {
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
): Promise<Record<string, unknown>> {
  const fixture = cadWorkerFixturePath()
  if (fixture) {
    const result = await inspectDxfFile(fixture)
    logStructured('info', {
      event: 'cad_worker_inspect',
      job_id: jobId,
      correlation_id: correlationId,
      source: 'fixture',
      cad_worker_transport: cadWorkerTransport(),
      entity_count: result.entity_count,
    })
    return result as Record<string, unknown>
  }

  const downloaded = await downloadInputDxfToTemp(jobId)
  if (downloaded) {
    const result = await inspectDxfFile(downloaded.localPath)
    logStructured('info', {
      event: 'cad_worker_inspect',
      job_id: jobId,
      correlation_id: correlationId,
      source: 'storage',
      cad_worker_transport: cadWorkerTransport(),
      entity_count: result.entity_count,
    })
    return result as Record<string, unknown>
  }

  throw new Error('No CAD_WORKER_FIXTURE_DXF and no input file in storage')
}

async function runCadWorkerGeometryExtract(
  jobId: string,
  correlationId: string,
): Promise<Record<string, unknown> | undefined> {
  const fixture = cadWorkerFixturePath()
  if (fixture) {
    const geometry = await extractGeometryFromDxf(fixture)
    logStructured('info', {
      event: 'cad_worker_geometry_extract',
      job_id: jobId,
      correlation_id: correlationId,
      source: 'fixture',
      wall_count: geometry.paredes?.length ?? 0,
    })
    return geometry as Record<string, unknown>
  }

  const downloaded = await downloadInputDxfToTemp(jobId)
  if (!downloaded) return undefined

  const geometry = await extractGeometryFromDxf(downloaded.localPath)
  logStructured('info', {
    event: 'cad_worker_geometry_extract',
    job_id: jobId,
    correlation_id: correlationId,
    source: 'storage',
    wall_count: geometry.paredes?.length ?? 0,
  })
  return geometry as Record<string, unknown>
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

async function runInferWithRetries(
  jobId: string,
  correlationId: string,
  step: string,
  work: () => Promise<void>,
): Promise<void> {
  const simulateFailure =
    process.env.CAD_IA_SIMULATE_FAILURE === 'true' && getPipelineMode() === 'stub'
  let lastMessage = 'IA provider error'

  for (let attempt = 1; attempt <= IA_MAX_ATTEMPTS; attempt++) {
    logStructured('info', {
      event: 'ia_attempt',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      step,
      attempt,
      max_attempts: IA_MAX_ATTEMPTS,
      pipeline_kind: 'preliminary',
    })

    if (!simulateFailure) {
      try {
        await work()
        recordIaCostUsd(jobId, 0.002 * attempt)
        logStructured('info', {
          event: 'ia_attempt_success',
          job_id: jobId,
          correlation_id: correlationId,
          attempt,
          step,
        })
        return
      } catch (e) {
        lastMessage = e instanceof Error ? e.message : 'IA provider error'
        if (e instanceof OpenAiClientError && e.code === 'OPENAI_RATE_LIMIT') {
          lastMessage = e.message
        }
      }
    } else {
      await sleep(5)
      lastMessage = 'IA provider transient failure (simulated)'
    }
    logStructured('warn', {
      event: 'ia_attempt_failed',
      job_id: jobId,
      correlation_id: correlationId,
      step,
      attempt,
      max_attempts: IA_MAX_ATTEMPTS,
      error: lastMessage,
    })
    if (attempt < IA_MAX_ATTEMPTS) {
      recordIaRetry(jobId)
    }
  }

  recordIaCostUsd(jobId, 0.0005 * IA_MAX_ATTEMPTS)
  throw new Error('IA provider exhausted retries')
}

type Room = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

type OutletPlacement = {
  room_id?: string
  outlet_type?: string
  rule_ids?: string[]
}

/**
 * Genera recomendaciones en español por habitación a partir de la salida de US-008.
 * Solo se llama cuando normative_rules_enabled = true.
 */
function buildPreliminaryRecommendations(
  visionOutput: Record<string, unknown>,
  normativeOutput: Record<string, unknown>,
): PreliminaryRecommendation[] {
  const layout = visionOutput.layout_interpretation as { rooms?: Room[] } | undefined
  const rooms: Room[] = layout?.rooms ?? []
  const placements = (normativeOutput.outlet_placements as OutletPlacement[] | undefined) ?? []

  return rooms.map((room) => {
    const roomId = room.id ?? 'unknown'
    const roomLabel = room.label ?? roomId
    const roomPlacements = placements.filter((p) => p.room_id === roomId)
    const outletCount = roomPlacements.length

    const allRuleIds = [...new Set(roomPlacements.flatMap((p) => p.rule_ids ?? []))]

    const recommendations: string[] = []
    if (outletCount === 0) {
      recommendations.push(
        `No se proponen tomas para "${roomLabel}" según las reglas normativas activas.`,
      )
    } else {
      recommendations.push(
        `Se proponen ${outletCount} toma${outletCount !== 1 ? 's' : ''} de corriente en "${roomLabel}".`,
      )
      const typeGroups: Record<string, number> = {}
      for (const p of roomPlacements) {
        const t = p.outlet_type ?? 'estándar'
        typeGroups[t] = (typeGroups[t] ?? 0) + 1
      }
      for (const [type, count] of Object.entries(typeGroups)) {
        recommendations.push(
          `  • ${count} toma${count !== 1 ? 's' : ''} tipo "${type}".`,
        )
      }
      if (allRuleIds.length > 0) {
        recommendations.push(`Reglas aplicadas: ${allRuleIds.join(', ')}.`)
      }
    }

    return {
      room_id: roomId,
      room_label: roomLabel,
      recommendations,
      outlet_count: outletCount,
      rule_ids: allRuleIds,
    }
  })
}

/**
 * Pipeline de análisis preliminar (US-012):
 * inspect + geometry + US-007 + US-008 (si normative_rules_enabled).
 * Termina en listo_para_editar sin escribir output_dxf.
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

  function isNormativeRulesEnabled(meta: JobRow['pipeline_metadata'] | undefined): boolean {
    return meta?.normative_rules_enabled !== false
  }

  let normativeRulesEnabled = isNormativeRulesEnabled(job.pipeline_metadata)

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
  if (pipelineMode === 'live' && !aiConfigured()) {
    throw new OpenAiClientError(
      'LLM_NOT_CONFIGURED',
      'CAD_PIPELINE_MODE=live requires OPENROUTER_API_KEY or OPENAI_API_KEY',
    )
  }

  let lastExecutedStep = 'ingest'
  try {
    await runTimedStep(jobId, correlationId, 'ingest', () => sleep(5))

    let cadInspect: Record<string, unknown> | undefined
    let geometryExtract: Record<string, unknown> | undefined

    if (!cadWorkerDisabled()) {
      try {
        cadInspect = await runCadWorkerInspect(jobId, correlationId)
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
        geometryExtract = await runCadWorkerGeometryExtract(jobId, correlationId)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        logStructured('warn', {
          event: 'cad_worker_geometry_extract_skipped',
          job_id: jobId,
          correlation_id: correlationId,
          error: message,
        })
      }
      if (cadInspect || geometryExtract) {
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            ...(cadInspect ? { cad_worker_inspect: cadInspect } : {}),
            ...(geometryExtract ? { geometry_extract: geometryExtract } : {}),
            pipeline_mode: pipelineMode,
          },
        })
      }
    }

    lastExecutedStep = 'vision_layout'
    let visionResult: Record<string, unknown> | undefined
    await runTimedStep(jobId, correlationId, 'vision_layout', async () => {
      if (pipelineMode === 'live' && (cadInspect || geometryExtract)) {
        visionResult = await buildLiveVisionLayoutOutput(jobId, correlationId, {
          cadInspect,
          geometryExtract,
        })
        logStructured('info', {
          event: 'preliminary_us007_live',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
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
        const rooms = (visionResult.layout_interpretation as { rooms?: unknown[] } | undefined)?.rooms ?? []
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

    await patchJob(jobId, {
      pipeline_metadata: {
        ...(await findJob(jobId))?.pipeline_metadata,
        vision_layout: visionResult,
      },
    })

    const roomProcessingState: Record<string, 'pendiente' | 'procesando' | 'procesado'> = {}
    for (const room of rooms) {
      if (room.id) roomProcessingState[room.id] = 'pendiente'
    }

    let normativeResult: Record<string, unknown> | undefined
    let preliminaryRecommendations: PreliminaryRecommendation[] = []

    normativeRulesEnabled = isNormativeRulesEnabled((await findJob(jobId))?.pipeline_metadata)

    if (normativeRulesEnabled) {
      lastExecutedStep = 'normative_inference'
      await runTimedStep(jobId, correlationId, 'normative_inference', async () => {
        const rulesVersion = resolveActiveNormativeRulesVersion()
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            normative_rules_version: rulesVersion,
          },
        })
        await runInferWithRetries(jobId, correlationId, 'normative_inference', async () => {
          if (pipelineMode === 'live') {
            normativeResult = (await buildLiveNormativeInferenceOutput(
              jobId,
              correlationId,
              visionResult as Parameters<typeof buildLiveNormativeInferenceOutput>[2],
            )) as Record<string, unknown>
          } else {
            normativeResult = buildStubNormativeInferenceOutput(
              jobId,
              correlationId,
              visionResult as Parameters<typeof buildStubNormativeInferenceOutput>[2],
            ) as Record<string, unknown>
          }
        })
        if (!normativeResult) {
          normativeResult = buildStubNormativeInferenceOutput(
            jobId,
            correlationId,
            visionResult as Parameters<typeof buildStubNormativeInferenceOutput>[2],
          ) as Record<string, unknown>
        }
        logStructured('info', {
          event:
            pipelineMode === 'live'
              ? 'preliminary_us008_live'
              : 'preliminary_us008_stub',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
          outlets: Number(
            (normativeResult as { outlet_placements?: unknown[] }).outlet_placements?.length ?? 0,
          ),
        })
      })

      if (normativeResult) {
        preliminaryRecommendations = buildPreliminaryRecommendations(visionResult, normativeResult)
      }
    } else {
      logStructured('info', {
        event: 'preliminary_us008_skipped',
        job_id: jobId,
        correlation_id: correlationId,
        reason: 'normative_rules_enabled=false',
      })
    }

    const completedAt = new Date().toISOString()
    const existingMeta = { ...((await findJob(jobId))?.pipeline_metadata ?? {}) }
    if (!normativeRulesEnabled) {
      delete existingMeta.outlet_placements
      delete existingMeta.normative_rules_version
    }

    const done = await patchJob(jobId, {
      status: 'listo_para_editar',
      error: undefined,
      pipeline_metadata: {
        ...existingMeta,
        preliminary_recommendations: preliminaryRecommendations,
        room_processing_state: roomProcessingState,
        preliminary_analysis_completed_at: completedAt,
        normative_rules_enabled: normativeRulesEnabled,
        ...(normativeRulesEnabled && normativeResult
          ? {
              outlet_placements: (normativeResult as { outlet_placements?: unknown[] })
                .outlet_placements,
              normative_rules_version:
                (normativeResult as { normative_rules_version?: string }).normative_rules_version ??
                resolveActiveNormativeRulesVersion(),
            }
          : {}),
      },
    })

    logStructured('info', {
      event: 'preliminary_pipeline_complete',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      rooms: rooms.length,
      normative_rules_enabled: normativeRulesEnabled,
      recommendations: preliminaryRecommendations.length,
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
