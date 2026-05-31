import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyElectricalLayer,
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
import { registerOutputDxfFromLocalFile } from './pipelineCadOutput'
import { DXF_INPUT_BUCKET } from './dxfStorage'
import { findLatestInputForJob } from './filesStore'
import { logStructured } from './logger'
import { findJob, patchJob, type JobRow } from './jobsStore'
import { resolveActiveNormativeRulesVersion } from './normativeRules'
import {
  incrementPipelineError,
  recordIaCostUsd,
  recordIaRetry,
  recordStepLatency,
} from './metrics'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import {
  buildStubCadGenerationInput,
  buildStubNormativeInferenceOutput,
  buildStubVisionLayoutOutput,
  registerMockOutputDxf,
} from './pipelineStubs'
import { DXF_OUTPUT_BUCKET } from './dxfStorage'
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

async function runCadWorkerInspectForJob(
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
  })
}

/**
 * When `CAD_IA_SIMULATE_FAILURE=true`, inference attempts fail until retries are exhausted
 * — job ends in `error` with correlation_id in logs and payload.
 */
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

/**
 * MVP synchronous pipeline (integrates with S-01 later). Logs JSON lines with
 * job_id + correlation_id per step for support tracing.
 */
export async function runJobPipeline(jobId: string, correlationId: string): Promise<JobRow | undefined> {
  const job = await findJob(jobId)
  if (!job) {
    logStructured('error', {
      event: 'pipeline_job_missing',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
    })
    return undefined
  }

  await patchJob(jobId, { status: 'procesando' })

  logStructured('info', {
    event: 'pipeline_start',
    job_id: jobId,
    correlation_id: correlationId,
    contract_version: PIPELINE_CONTRACT_VERSION,
    pipeline_mode: getPipelineMode(),
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

    let cadInspectForVision: Record<string, unknown> | undefined
    let geometryExtract: Record<string, unknown> | undefined
    if (!cadWorkerDisabled()) {
      try {
        cadInspectForVision = await runCadWorkerInspectForJob(jobId, correlationId)
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
      if (cadInspectForVision || geometryExtract) {
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            ...(cadInspectForVision ? { cad_worker_inspect: cadInspectForVision } : {}),
            ...(geometryExtract ? { geometry_extract: geometryExtract } : {}),
            pipeline_mode: pipelineMode,
          },
        })
      }
    }

    lastExecutedStep = 'vision_layout'
    let visionResult: ReturnType<typeof buildStubVisionLayoutOutput> | undefined
    await runTimedStep(jobId, correlationId, 'vision_layout', async () => {
      if (pipelineMode === 'live' && (cadInspectForVision || geometryExtract)) {
        visionResult = await buildLiveVisionLayoutOutput(jobId, correlationId, {
          cadInspect: cadInspectForVision,
          geometryExtract,
        })
        logStructured('info', {
          event: 'pipeline_us007_live',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
        })
      } else if (pipelineMode === 'live') {
        visionResult = buildLiveVisionFallback(jobId, correlationId)
        logStructured('warn', {
          event: 'pipeline_us007_live_fallback_stub',
          job_id: jobId,
          correlation_id: correlationId,
        })
      } else {
        visionResult = buildStubVisionLayoutOutput(jobId, correlationId)
        logStructured('info', {
          event: 'pipeline_us007_stub',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
          rooms: (visionResult.layout_interpretation as { rooms?: unknown[] }).rooms?.length ?? 0,
        })
      }
    })
    const visionLocked = visionResult
    if (!visionLocked) {
      throw new Error('Vision layout step produced no output')
    }

    lastExecutedStep = 'normative_inference'
    let normativeResult: ReturnType<typeof buildStubNormativeInferenceOutput> | undefined
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
          normativeResult = await buildLiveNormativeInferenceOutput(
            jobId,
            correlationId,
            visionLocked,
          )
        } else {
          normativeResult = buildStubNormativeInferenceOutput(jobId, correlationId, visionLocked)
        }
      })
      if (!normativeResult) {
        normativeResult = buildStubNormativeInferenceOutput(jobId, correlationId, visionLocked)
      }
      logStructured('info', {
        event: pipelineMode === 'live' ? 'pipeline_us008_live' : 'pipeline_us008_stub',
        job_id: jobId,
        correlation_id: correlationId,
        contract_version: PIPELINE_CONTRACT_VERSION,
        outlets: Number((normativeResult as { outlet_placements?: unknown[] }).outlet_placements?.length ?? 0),
      })
    })
    const normativeLocked = normativeResult
    if (!normativeLocked) {
      throw new Error('Normative inference step produced no output')
    }

    lastExecutedStep = 'cad_generation'
    await runTimedStep(jobId, correlationId, 'cad_generation', async () => {
      const cadInspect = cadInspectForVision
      if (cadInspect) {
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            cad_worker_inspect: cadInspect,
            ...(geometryExtract ? { geometry_extract: geometryExtract } : {}),
            pipeline_mode: pipelineMode,
          },
        })
      }

      const { cadInput, outputObjectPath } = buildStubCadGenerationInput({
        jobId,
        ownerUserId: job.owner_user_id,
        correlationId,
        visionOutput: visionLocked,
        normativeOutput: normativeLocked,
      })
      const placements = (normativeLocked as { outlet_placements?: unknown[] }).outlet_placements ?? []
      let usedCadWorker = false

      if (
        !cadWorkerDisabled() &&
        isStorageConfigured() &&
        placements.length > 0
      ) {
        const supabase = getSupabaseServiceRole()
        const input = await findLatestInputForJob(supabase, jobId)
        if (input?.bucket_id === DXF_INPUT_BUCKET && input.object_path) {
          const { data, error } = await supabase.storage
            .from(input.bucket_id)
            .download(input.object_path)
          if (error || !data) {
            throw new Error(error?.message ?? 'Could not download input DXF for CAD worker')
          }
          try {
            const dir = mkdtempSync(join(tmpdir(), 'cambre-cad-out-'))
            const localIn = join(dir, 'input.dxf')
            const localOut = join(dir, 'output.dxf')
            writeFileSync(localIn, Buffer.from(await data.arrayBuffer()))
            const workerResult = await applyElectricalLayer(localIn, localOut, placements)
            await registerOutputDxfFromLocalFile(supabase, {
              jobId,
              ownerUserId: job.owner_user_id,
              objectPath: outputObjectPath,
              localPath: localOut,
            })
            usedCadWorker = true
            await patchJob(jobId, {
              pipeline_metadata: {
                ...(await findJob(jobId))?.pipeline_metadata,
                cad_worker_apply: workerResult as Record<string, unknown>,
              },
            })
            logStructured('info', {
              event: 'pipeline_us009_live',
              job_id: jobId,
              correlation_id: correlationId,
              contract_version: PIPELINE_CONTRACT_VERSION,
              output_object_path: outputObjectPath,
              outlets: placements.length,
            })
          } catch (e) {
            const message = e instanceof Error ? e.message : 'CAD worker apply failed'
            logStructured('error', {
              event: 'cad_worker_apply_failed',
              job_id: jobId,
              correlation_id: correlationId,
              contract_version: PIPELINE_CONTRACT_VERSION,
              cad_worker_transport: cadWorkerTransport(),
              output_object_path: outputObjectPath,
              error: message,
              error_code: e instanceof CadWorkerError ? e.code : undefined,
            })
            throw e
          }
        }
      }

      if (!usedCadWorker) {
        logStructured('info', {
          event: 'pipeline_us009_stub',
          job_id: jobId,
          correlation_id: correlationId,
          contract_version: PIPELINE_CONTRACT_VERSION,
          output_hint: cadInput.output_dwg as { storage_path_hint?: string } | undefined,
        })
        if (isStorageConfigured()) {
          try {
            const supabase = getSupabaseServiceRole()
            await registerMockOutputDxf(supabase, {
              jobId,
              ownerUserId: job.owner_user_id,
              objectPath: outputObjectPath,
            })
            logStructured('info', {
              event: 'pipeline_us009_registered',
              job_id: jobId,
              correlation_id: correlationId,
              contract_version: PIPELINE_CONTRACT_VERSION,
              bucket: DXF_OUTPUT_BUCKET,
              output_object_path: outputObjectPath,
            })
          } catch (e) {
            const message = e instanceof Error ? e.message : 'registration failed'
            logStructured('warn', {
              event: 'pipeline_us009_register_skipped',
              job_id: jobId,
              correlation_id: correlationId,
              contract_version: PIPELINE_CONTRACT_VERSION,
              error: message,
            })
          }
        }
      }
    })

    const done = await patchJob(jobId, { status: 'procesado', error: undefined })
    logStructured('info', {
      event: 'pipeline_complete',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
    })
    return done
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown pipeline error'
    const code =
      e instanceof CadWorkerError
        ? e.code
        : e instanceof OpenAiClientError
          ? e.code
          : message.includes('exhausted retries')
            ? 'IA_PROVIDER_EXHAUSTED'
            : 'PIPELINE_ERROR'
    incrementPipelineError(lastExecutedStep)
    const error = {
      code,
      message,
      correlation_id: correlationId,
    }
    const failed = await patchJob(jobId, { status: 'error', error })
    logStructured('error', {
      event: 'pipeline_error',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      step: lastExecutedStep,
      error: message,
    })
    return failed
  }
}
