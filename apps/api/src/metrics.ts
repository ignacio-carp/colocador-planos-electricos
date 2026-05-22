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
    note: 'Prometheus text at GET /api/metrics/prometheus (admin).',
  }
}

/** Prometheus exposition format (minimal counters/gauges for scraping). */
export function formatPrometheusMetrics(): string {
  const lines: string[] = [
    '# HELP cambre_pipeline_step_latency_ms Last recorded step latencies (buffered).',
    '# TYPE cambre_pipeline_step_latency_ms gauge',
  ]
  const snapshot = getMetricsSnapshot()
  for (const { step, ms } of snapshot.step_latencies.slice(-100)) {
    lines.push(`cambre_pipeline_step_latency_ms{step="${step.replace(/"/g, '')}"} ${ms}`)
  }
  lines.push('# HELP cambre_pipeline_errors_total Pipeline errors by step/reason.')
  lines.push('# TYPE cambre_pipeline_errors_total counter')
  for (const [reason, count] of Object.entries(snapshot.pipeline_errors)) {
    lines.push(`cambre_pipeline_errors_total{reason="${reason.replace(/"/g, '')}"} ${count}`)
  }
  lines.push('# HELP cambre_ia_retries_total IA retries by job_id.')
  lines.push('# TYPE cambre_ia_retries_total counter')
  for (const [jobId, count] of Object.entries(snapshot.ia_retries_by_job)) {
    lines.push(`cambre_ia_retries_total{job_id="${jobId}"} ${count}`)
  }
  lines.push('# HELP cambre_ia_cost_usd_total Estimated IA cost USD by job_id.')
  lines.push('# TYPE cambre_ia_cost_usd_total counter')
  for (const [jobId, usd] of Object.entries(snapshot.ia_cost_usd_by_job)) {
    lines.push(`cambre_ia_cost_usd_total{job_id="${jobId}"} ${usd}`)
  }
  return `${lines.join('\n')}\n`
}
