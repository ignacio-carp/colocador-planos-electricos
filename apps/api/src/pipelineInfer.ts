import { OpenAiClientError } from './openaiClient'
import { logStructured } from './logger'
import { getPipelineMode } from './pipelineMode'
import { PIPELINE_CONTRACT_VERSION } from './pipelineContracts'
import { recordIaCostUsd, recordIaRetry } from './metrics'

const IA_MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function runInferWithRetries(
  jobId: string,
  correlationId: string,
  step: string,
  work: () => Promise<void>,
  options?: { pipelineKind?: string },
): Promise<void> {
  const simulateFailure =
    process.env.CAD_IA_SIMULATE_FAILURE === 'true' && getPipelineMode() === 'stub'
  let lastMessage = 'IA provider error'
  const pipelineKind = options?.pipelineKind

  for (let attempt = 1; attempt <= IA_MAX_ATTEMPTS; attempt++) {
    logStructured('info', {
      event: 'ia_attempt',
      job_id: jobId,
      correlation_id: correlationId,
      contract_version: PIPELINE_CONTRACT_VERSION,
      step,
      attempt,
      max_attempts: IA_MAX_ATTEMPTS,
      ...(pipelineKind ? { pipeline_kind: pipelineKind } : {}),
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
