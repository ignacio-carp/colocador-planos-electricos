import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cadWorkerDisabled, inspectDwgFile } from './cadWorkerBridge'
import { DWG_INPUT_BUCKET } from './dwgStorage'
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
  registerMockOutputDwg,
} from './pipelineStubs'
import { DWG_OUTPUT_BUCKET } from './dwgStorage'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

const IA_MAX_ATTEMPTS = 3

async function runCadWorkerInspectForJob(
  jobId: string,
  correlationId: string,
): Promise<Record<string, unknown>> {
  const fixture = process.env.CAD_WORKER_FIXTURE_DWG?.trim()
  if (fixture) {
    const result = await inspectDwgFile(fixture)
    logStructured('info', {
      event: 'cad_worker_inspect',
      job_id: jobId,
      correlation_id: correlationId,
      source: 'fixture',
      entity_count: result.entity_count,
    })
    return result as Record<string, unknown>
  }

  if (isStorageConfigured()) {
    const supabase = getSupabaseServiceRole()
    const input = await findLatestInputForJob(supabase, jobId)
    if (input?.bucket_id === DWG_INPUT_BUCKET && input.object_path) {
      const { data, error } = await supabase.storage.from(input.bucket_id).download(input.object_path)
      if (error || !data) {
        throw new Error(error?.message ?? 'Could not download input DWG for inspect')
      }
      const dir = mkdtempSync(join(tmpdir(), 'cambre-cad-'))
      const localPath = join(dir, 'input.dwg')
      const buf = Buffer.from(await data.arrayBuffer())
      writeFileSync(localPath, buf)
      const result = await inspectDwgFile(localPath)
      logStructured('info', {
        event: 'cad_worker_inspect',
        job_id: jobId,
        correlation_id: correlationId,
        source: 'storage',
        entity_count: result.entity_count,
      })
      return result as Record<string, unknown>
    }
  }

  throw new Error('No CAD_WORKER_FIXTURE_DWG and no input file in storage')
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
): Promise<void> {
  const simulateFailure = process.env.CAD_IA_SIMULATE_FAILURE === 'true'
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

    await sleep(5)

    const ok = !simulateFailure
    if (ok) {
      recordIaCostUsd(jobId, 0.002 * attempt)
      logStructured('info', {
        event: 'ia_attempt_success',
        job_id: jobId,
        correlation_id: correlationId,
        attempt,
      })
      return
    }

    lastMessage = 'IA provider transient failure'
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

  let lastExecutedStep = 'ingest'
  try {
    await runTimedStep(jobId, correlationId, 'ingest', () => sleep(5))

    lastExecutedStep = 'vision_layout'
    let visionResult: ReturnType<typeof buildStubVisionLayoutOutput> | undefined
    await runTimedStep(jobId, correlationId, 'vision_layout', async () => {
      visionResult = buildStubVisionLayoutOutput(jobId, correlationId)
      logStructured('info', {
        event: 'pipeline_us007_stub',
        job_id: jobId,
        correlation_id: correlationId,
        contract_version: PIPELINE_CONTRACT_VERSION,
        rooms: (visionResult.layout_interpretation as { rooms?: unknown[] }).rooms?.length ?? 0,
      })
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
      await runInferWithRetries(jobId, correlationId, 'normative_inference')
      normativeResult = buildStubNormativeInferenceOutput(jobId, correlationId, visionLocked)
      logStructured('info', {
        event: 'pipeline_us008_stub',
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
      let cadInspect: Record<string, unknown> | undefined
      if (!cadWorkerDisabled()) {
        try {
          cadInspect = await runCadWorkerInspectForJob(jobId, correlationId)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          logStructured('warn', {
            event: 'cad_worker_inspect_skipped',
            job_id: jobId,
            correlation_id: correlationId,
            error: message,
          })
        }
      }
      if (cadInspect) {
        await patchJob(jobId, {
          pipeline_metadata: {
            ...(await findJob(jobId))?.pipeline_metadata,
            cad_worker_inspect: cadInspect,
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
          await registerMockOutputDwg(supabase, {
            jobId,
            ownerUserId: job.owner_user_id,
            objectPath: outputObjectPath,
          })
          logStructured('info', {
            event: 'pipeline_us009_registered',
            job_id: jobId,
            correlation_id: correlationId,
            contract_version: PIPELINE_CONTRACT_VERSION,
            bucket: DWG_OUTPUT_BUCKET,
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
    incrementPipelineError(lastExecutedStep)
    const error = {
      code: 'IA_PROVIDER_EXHAUSTED',
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
