/** `stub` (default) | `live` — live requires OPENROUTER_API_KEY or OPENAI_API_KEY for US-007/008. */
export type PipelineMode = 'stub' | 'live'

/** LLM backend for live pipeline steps (OpenRouter preferred in production). */
export type AiBackend = 'openrouter' | 'openai'

export function getPipelineMode(): PipelineMode {
  const raw = process.env.CAD_PIPELINE_MODE?.trim().toLowerCase()
  if (raw === 'live') return 'live'
  return 'stub'
}

export function aiBackend(): AiBackend {
  if (process.env.OPENROUTER_API_KEY?.trim()) return 'openrouter'
  return 'openai'
}

/** True when live pipeline can call an LLM (OpenRouter or direct OpenAI). */
export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim())
}

/** @deprecated Use aiConfigured — kept for existing imports. */
export const openaiConfigured = aiConfigured

export function visionModel(): string {
  const openrouterModel =
    process.env.OPENROUTER_MODEL?.trim() || process.env.OPENROUTER_VISION_MODEL?.trim()
  if (aiBackend() === 'openrouter') {
    return openrouterModel || 'openai/gpt-4o'
  }
  return process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o'
}

/** Maps model slug to contract provider.name (openai | anthropic). */
export function contractProviderName(model: string): 'openai' | 'anthropic' {
  const slug = model.includes('/') ? model.split('/')[0]!.toLowerCase() : 'openai'
  if (slug === 'anthropic') return 'anthropic'
  return 'openai'
}

export function visionTimeoutMs(): number {
  const n = Number(process.env.VISION_API_TIMEOUT_MS ?? 60_000)
  return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 60_000
}

export function normativeTimeoutMs(): number {
  const n = Number(process.env.NORMATIVE_API_TIMEOUT_MS ?? 45_000)
  return Number.isFinite(n) && n > 1000 ? Math.floor(n) : 45_000
}
