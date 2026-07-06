import type { AiBackend } from './pipelineMode'
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

type LlmApiConfig = {
  backend: AiBackend
  apiKey: string
  chatCompletionsUrl: string
  extraHeaders: Record<string, string>
}

function resolveLlmApiConfig(): LlmApiConfig {
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim()
  if (openrouterKey) {
    const base =
      process.env.OPENROUTER_BASE_URL?.trim().replace(/\/+$/, '') ||
      'https://openrouter.ai/api/v1'
    const extraHeaders: Record<string, string> = {}
    const referer = process.env.OPENROUTER_HTTP_REFERER?.trim()
    const appName = process.env.OPENROUTER_APP_NAME?.trim()
    if (referer) extraHeaders['HTTP-Referer'] = referer
    if (appName) extraHeaders['X-Title'] = appName
    return {
      backend: 'openrouter',
      apiKey: openrouterKey,
      chatCompletionsUrl: `${base}/chat/completions`,
      extraHeaders,
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim()
  if (openaiKey) {
    const base =
      process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, '') || 'https://api.openai.com/v1'
    return {
      backend: 'openai',
      apiKey: openaiKey,
      chatCompletionsUrl: `${base}/chat/completions`,
      extraHeaders: {},
    }
  }

  throw new OpenAiClientError(
    'LLM_NOT_CONFIGURED',
    'Set OPENROUTER_API_KEY (recommended) or OPENAI_API_KEY for CAD_PIPELINE_MODE=live',
  )
}

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type LlmToolDefinition = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type LlmToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type LlmToolExecutor = (call: LlmToolCall) => Promise<Record<string, unknown>>

type ChatMessageParam =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | UserContentPart[] }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

async function chatCompletionsRequest(params: {
  llm: LlmApiConfig
  model: string
  messages: ChatMessageParam[]
  tools?: LlmToolDefinition[]
  timeoutMs: number
  jobId: string
  correlationId: string
  step: string
}): Promise<{
  content: string | null
  toolCalls: { id: string; name: string; argumentsJson: string }[]
  totalTokens?: number
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  let res: Response
  try {
    res = await fetch(params.llm.chatCompletionsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.llm.apiKey}`,
        'Content-Type': 'application/json',
        ...params.llm.extraHeaders,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.15,
        messages: params.messages,
        ...(params.tools && params.tools.length > 0
          ? {
              tools: params.tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
            }
          : {}),
      }),
      signal: controller.signal,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('abort')) {
      throw new OpenAiClientError('OPENAI_TIMEOUT', `LLM request timed out (${params.step})`)
    }
    throw new OpenAiClientError('OPENAI_NETWORK', message)
  } finally {
    clearTimeout(timer)
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }
    choices?: {
      message?: {
        content?: string | null
        tool_calls?: {
          id?: string
          function?: { name?: string; arguments?: string }
        }[]
      }
    }[]
    usage?: { total_tokens?: number }
  }

  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`
    logStructured('warn', {
      event: 'llm_http_error',
      job_id: params.jobId,
      correlation_id: params.correlationId,
      step: params.step,
      backend: params.llm.backend,
      status: res.status,
      error: msg,
    })
    if (res.status === 429) {
      throw new OpenAiClientError('OPENAI_RATE_LIMIT', msg)
    }
    throw new OpenAiClientError('OPENAI_HTTP_ERROR', msg)
  }

  const message = body.choices?.[0]?.message
  const toolCalls = (message?.tool_calls ?? [])
    .filter((tc) => tc.id && tc.function?.name)
    .map((tc) => ({
      id: tc.id!,
      name: tc.function!.name!,
      argumentsJson: tc.function!.arguments ?? '{}',
    }))

  return {
    content: message?.content ?? null,
    toolCalls,
    totalTokens: body.usage?.total_tokens,
  }
}

/**
 * Agentic tool-calling loop (US-014 chat). The model may chain tool calls;
 * each call is executed via `executeTool` and its JSON result is fed back
 * until the model produces a final text reply or `maxIterations` is hit.
 */
export async function openaiChatWithTools(params: {
  model: string
  system: string
  user: string
  tools: LlmToolDefinition[]
  executeTool: LlmToolExecutor
  timeoutMs: number
  jobId: string
  correlationId: string
  step: string
  imageDataUrl?: string
  maxIterations?: number
}): Promise<{ reply: string; toolCallCount: number }> {
  const llm = resolveLlmApiConfig()
  const maxIterations = params.maxIterations ?? 6

  const messages: ChatMessageParam[] = [
    { role: 'system', content: params.system },
    {
      role: 'user',
      content: params.imageDataUrl
        ? ([
            { type: 'text', text: params.user },
            { type: 'image_url', image_url: { url: params.imageDataUrl } },
          ] satisfies UserContentPart[])
        : params.user,
    },
  ]

  let toolCallCount = 0

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    logStructured('info', {
      event: 'llm_request',
      job_id: params.jobId,
      correlation_id: params.correlationId,
      step: params.step,
      backend: llm.backend,
      model: params.model,
      iteration,
    })

    const result = await chatCompletionsRequest({
      llm,
      model: params.model,
      messages,
      tools: params.tools,
      timeoutMs: params.timeoutMs,
      jobId: params.jobId,
      correlationId: params.correlationId,
      step: params.step,
    })

    if (result.toolCalls.length === 0) {
      const reply = result.content?.trim()
      if (!reply) {
        throw new OpenAiClientError('OPENAI_EMPTY_CONTENT', 'No message content in LLM response')
      }
      logStructured('info', {
        event: 'llm_success',
        job_id: params.jobId,
        correlation_id: params.correlationId,
        step: params.step,
        backend: llm.backend,
        model: params.model,
        tokens: result.totalTokens,
        tool_calls: toolCallCount,
      })
      return { reply, toolCallCount }
    }

    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      })),
    })

    for (const tc of result.toolCalls) {
      toolCallCount += 1
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.argumentsJson) as Record<string, unknown>
      } catch {
        // executor receives {} and reports the problem back to the model
      }
      let toolResult: Record<string, unknown>
      try {
        toolResult = await params.executeTool({ id: tc.id, name: tc.name, arguments: args })
      } catch (e) {
        toolResult = { error: e instanceof Error ? e.message : String(e) }
      }
      logStructured('info', {
        event: 'llm_tool_call',
        job_id: params.jobId,
        correlation_id: params.correlationId,
        step: params.step,
        tool: tc.name,
        iteration,
        has_error: Boolean(toolResult.error),
      })
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      })
    }
  }

  throw new OpenAiClientError(
    'OPENAI_TOOL_LOOP_LIMIT',
    `Tool loop exceeded ${maxIterations} iterations without a final reply`,
  )
}

/**
 * Chat Completions with JSON object response (OpenAI API or OpenRouter).
 * `imageDataUrl` (optional) attaches a rendered-viewport screenshot as a
 * multimodal reference (US-014 interactive chat).
 */
export async function openaiChatJsonObject(params: {
  model: string
  system: string
  user: string
  timeoutMs: number
  jobId: string
  correlationId: string
  step: string
  imageDataUrl?: string
}): Promise<Record<string, unknown>> {
  const llm = resolveLlmApiConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  let res: Response
  try {
    logStructured('info', {
      event: 'llm_request',
      job_id: params.jobId,
      correlation_id: params.correlationId,
      step: params.step,
      backend: llm.backend,
      model: params.model,
    })
    res = await fetch(llm.chatCompletionsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
        ...llm.extraHeaders,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: params.system },
          {
            role: 'user',
            content: params.imageDataUrl
              ? ([
                  { type: 'text', text: params.user },
                  { type: 'image_url', image_url: { url: params.imageDataUrl } },
                ] satisfies UserContentPart[])
              : params.user,
          },
        ],
      }),
      signal: controller.signal,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes('abort')) {
      throw new OpenAiClientError('OPENAI_TIMEOUT', `LLM request timed out (${params.step})`)
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
      event: 'llm_http_error',
      job_id: params.jobId,
      correlation_id: params.correlationId,
      step: params.step,
      backend: llm.backend,
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
    throw new OpenAiClientError('OPENAI_EMPTY_CONTENT', 'No message content in LLM response')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content) as Record<string, unknown>
  } catch {
    throw new OpenAiClientError('OPENAI_INVALID_JSON', 'Model returned non-JSON content')
  }

  logStructured('info', {
    event: 'llm_success',
    job_id: params.jobId,
    correlation_id: params.correlationId,
    step: params.step,
    backend: llm.backend,
    model: params.model,
    tokens: body.usage?.total_tokens,
  })

  return parsed
}
