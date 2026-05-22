import { logStructured } from './logger'

export class OpenAiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'OpenAiClientError'
  }
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) {
    throw new OpenAiClientError('OPENAI_NOT_CONFIGURED', 'OPENAI_API_KEY is not set')
  }
  return key
}

/** Chat Completions with JSON object response (GPT-4o family). */
export async function openaiChatJsonObject(params: {
  model: string
  system: string
  user: string
  timeoutMs: number
  jobId: string
  correlationId: string
  step: string
}): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
      }),
      signal: controller.signal,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('abort')) {
      throw new OpenAiClientError('OPENAI_TIMEOUT', `OpenAI request timed out (${params.step})`)
    }
    throw new OpenAiClientError('OPENAI_NETWORK', message)
  } finally {
    clearTimeout(timer)
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }
    choices?: { message?: { content?: string } }[]
    usage?: { total_tokens?: number }
  }

  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`
    logStructured('warn', {
      event: 'openai_http_error',
      job_id: params.jobId,
      correlation_id: params.correlationId,
      step: params.step,
      status: res.status,
      error: msg,
    })
    if (res.status === 429) {
      throw new OpenAiClientError('OPENAI_RATE_LIMIT', msg)
    }
    throw new OpenAiClientError('OPENAI_HTTP_ERROR', msg)
  }

  const content = body.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new OpenAiClientError('OPENAI_EMPTY_CONTENT', 'No message content in OpenAI response')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content) as Record<string, unknown>
  } catch {
    throw new OpenAiClientError('OPENAI_INVALID_JSON', 'Model returned non-JSON content')
  }

  logStructured('info', {
    event: 'openai_success',
    job_id: params.jobId,
    correlation_id: params.correlationId,
    step: params.step,
    model: params.model,
    tokens: body.usage?.total_tokens,
  })

  return parsed
}
