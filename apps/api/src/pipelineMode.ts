/** `stub` (default) | `live` — live requires OPENAI_API_KEY for US-007/008. */
export type PipelineMode = 'stub' | 'live'

export function getPipelineMode(): PipelineMode {
  const raw = process.env.CAD_PIPELINE_MODE?.trim().toLowerCase()
  if (raw === 'live') return 'live'
  return 'stub'
}

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim())
}

export function visionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o'
}

export function visionTimeoutMs(): number {
  const n = Number(process.env.VISION_API_TIMEOUT_MS ?? 60_000)
  return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 60_000
}

export function normativeTimeoutMs(): number {
  const n = Number(process.env.NORMATIVE_API_TIMEOUT_MS ?? 45_000)
  return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 45_000
}
