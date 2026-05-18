import { logStructured } from './logger'
import { findJob, patchJob, type JobRow } from './jobsStore'
import {
  incrementPipelineError,
  recordIaCostUsd,
  recordIaRetry,
  recordStepLatency,
} from './metrics'

const IA_MAX_ATTEMPTS = 3

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
    step,
  })
}

/**
 * When `CAD_IA_SIMULATE_FAILURE=true`, every IA attempt fails until retries are
 * exhausted — job ends in `error` with correlation_id in logs and payload (US-007).
 */
async function runIaWithRetries(jobId: string, correlationId: string): Promise<void> {
  const simulateFailure = process.env.CAD_IA_SIMULATE_FAILURE === 'true'
  let lastMessage = 'IA provider error'

  for (let attempt = 1; attempt <= IA_MAX_ATTEMPTS; attempt++) {
    logStructured('info', {
      event: 'ia_attempt',
      job_id: jobId,
      correlation_id: correlationId,
      step: 'ia_generate',
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
      step: 'ia_generate',
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
  const job = findJob(jobId)
  if (!job) {
    logStructured('error', {
      event: 'pipeline_job_missing',
      job_id: jobId,
      correlation_id: correlationId,
    })
    return undefined
  }

  patchJob(jobId, { status: 'processing' })

  try {
    await runTimedStep(jobId, correlationId, 'ingest', () => sleep(5))
    await runTimedStep(jobId, correlationId, 'normativa', () => sleep(5))
    await runTimedStep(jobId, correlationId, 'ia_generate', () => runIaWithRetries(jobId, correlationId))
    await runTimedStep(jobId, correlationId, 'cad_export', () => sleep(5))

    const done = patchJob(jobId, { status: 'completed', error: undefined })
    logStructured('info', {
      event: 'pipeline_complete',
      job_id: jobId,
      correlation_id: correlationId,
    })
    return done
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown pipeline error'
    incrementPipelineError('ia_generate')
    const error = {
      code: 'IA_PROVIDER_EXHAUSTED',
      message,
      correlation_id: correlationId,
    }
    const failed = patchJob(jobId, { status: 'error', error })
    logStructured('error', {
      event: 'pipeline_error',
      job_id: jobId,
      correlation_id: correlationId,
      step: 'ia_generate',
      error: message,
    })
    return failed
  }
}
