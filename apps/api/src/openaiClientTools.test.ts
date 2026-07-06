/**
 * Agentic tool loop (US-014): the LLM chains tool calls; each result is fed
 * back until it emits a final reply. Fetch is mocked to simulate the API.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { openaiChatWithTools, type LlmToolCall } from './openaiClient'

const originalFetch = globalThis.fetch

function mockChatResponses(responses: unknown[]): () => number {
  let call = 0
  globalThis.fetch = (async () => {
    const body = responses[Math.min(call, responses.length - 1)]
    call += 1
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  return () => call
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key'
  delete process.env.OPENROUTER_API_KEY
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.OPENAI_API_KEY
})

const TOOLS = [
  {
    name: 'get_room_details',
    description: 'room info',
    parameters: { type: 'object', properties: {}, additionalProperties: true },
  },
]

describe('openaiChatWithTools', () => {
  it('executes tool calls and returns the final reply', async () => {
    const requestCount = mockChatResponses([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  function: {
                    name: 'get_room_details',
                    arguments: JSON.stringify({ room_id: 'room-a' }),
                  },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'Listo: la cocina tiene 2 tomas.' } }] },
    ])

    const executed: LlmToolCall[] = []
    const result = await openaiChatWithTools({
      model: 'test-model',
      system: 'sys',
      user: '{"message":"hola"}',
      tools: TOOLS,
      executeTool: async (call) => {
        executed.push(call)
        return { room: { id: 'room-a' }, elements: [] }
      },
      timeoutMs: 5000,
      jobId: 'job-1',
      correlationId: 'corr-1',
      step: 'workspace_chat',
    })

    assert.equal(result.reply, 'Listo: la cocina tiene 2 tomas.')
    assert.equal(result.toolCallCount, 1)
    assert.equal(executed.length, 1)
    assert.equal(executed[0]!.name, 'get_room_details')
    assert.deepEqual(executed[0]!.arguments, { room_id: 'room-a' })
    assert.equal(requestCount(), 2)
  })

  it('feeds executor errors back to the model instead of throwing', async () => {
    mockChatResponses([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call-1', function: { name: 'get_room_details', arguments: '{}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'No encontré esa habitación.' } }] },
    ])

    const result = await openaiChatWithTools({
      model: 'test-model',
      system: 'sys',
      user: '{}',
      tools: TOOLS,
      executeTool: async () => {
        throw new Error('room not found')
      },
      timeoutMs: 5000,
      jobId: 'job-1',
      correlationId: 'corr-2',
      step: 'workspace_chat',
    })
    assert.equal(result.reply, 'No encontré esa habitación.')
  })

  it('aborts after maxIterations without a final reply', async () => {
    mockChatResponses([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: 'call-x', function: { name: 'get_room_details', arguments: '{}' } },
              ],
            },
          },
        ],
      },
    ])

    await assert.rejects(
      openaiChatWithTools({
        model: 'test-model',
        system: 'sys',
        user: '{}',
        tools: TOOLS,
        executeTool: async () => ({ ok: true }),
        timeoutMs: 5000,
        jobId: 'job-1',
        correlationId: 'corr-3',
        step: 'workspace_chat',
        maxIterations: 2,
      }),
      /OPENAI_TOOL_LOOP_LIMIT|iterations/,
    )
  })
})
