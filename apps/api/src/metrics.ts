/**
 * In-memory metrics stub (T-07). Replace with OpenTelemetry / Prometheus exporter
 * when S-01 orchestrator exposes a scrape endpoint or push gateway.
 */
type StepLatency = { step: string; ms: number }

const stepLatencies: StepLatency[] = []
const pipelineErrorsByReason: Record<string, number> = {}
const iaRetriesByJob = new Map<string, number>()
const iaCostUsdByJob = new Map<string, number>()

const MAX_LATENCY_BUFFER = 5000

export function recordStepLatency(step: string, ms: number): void {
  stepLatencies.push({ step, ms })
  if (stepLatencies.length > MAX_LATENCY_BUFFER) stepLatencies.splice(0, stepLatencies.length - MAX_LATENCY_BUFFER)
}

export function recordIaRetry(jobId: string): void {
  iaRetriesByJob.set(jobId, (iaRetriesByJob.get(jobId) ?? 0) + 1)
}

/** Stub IA cost until billing API is wired (USD). */
export function recordIaCostUsd(jobId: string, usd: number): void {
  iaCostUsdByJob.set(jobId, (iaCostUsdByJob.get(jobId) ?? 0) + usd)
}

export function incrementPipelineError(reason: string): void {
  pipelineErrorsByReason[reason] = (pipelineErrorsByReason[reason] ?? 0) + 1
}

export function getMetricsSnapshot(): {
  step_latencies: StepLatency[]
  pipeline_errors: Record<string, number>
  ia_retries_by_job: Record<string, number>
  ia_cost_usd_by_job: Record<string, number>
  note: string
} {
  return {
    step_latencies: [...stepLatencies],
    pipeline_errors: { ...pipelineErrorsByReason },
    ia_retries_by_job: Object.fromEntries(iaRetriesByJob),
    ia_cost_usd_by_job: Object.fromEntries(iaCostUsdByJob),
    note: 'TBD: export to dashboard (Prometheus histogram/sum or vendor billing).',
  }
}
