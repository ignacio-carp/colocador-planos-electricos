import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aiBackend,
  aiConfigured,
  contractProviderName,
  getPipelineMode,
  openaiConfigured,
  visionModel,
} from './pipelineMode'

describe('pipelineMode', () => {
  it('defaults to stub', () => {
    const prev = process.env.CAD_PIPELINE_MODE
    delete process.env.CAD_PIPELINE_MODE
    assert.equal(getPipelineMode(), 'stub')
    process.env.CAD_PIPELINE_MODE = prev
  })

  it('live when CAD_PIPELINE_MODE=live', () => {
    const prev = process.env.CAD_PIPELINE_MODE
    process.env.CAD_PIPELINE_MODE = 'live'
    assert.equal(getPipelineMode(), 'live')
    process.env.CAD_PIPELINE_MODE = prev
  })

  it('aiConfigured reflects OPENROUTER_API_KEY or OPENAI_API_KEY', () => {
    const prevOpenAi = process.env.OPENAI_API_KEY
    const prevOpenRouter = process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    assert.equal(aiConfigured(), false)
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    assert.equal(aiConfigured(), true)
    assert.equal(openaiConfigured(), true)
    assert.equal(aiBackend(), 'openrouter')
    delete process.env.OPENROUTER_API_KEY
    process.env.OPENAI_API_KEY = 'sk-test'
    assert.equal(aiConfigured(), true)
    assert.equal(aiBackend(), 'openai')
    process.env.OPENAI_API_KEY = prevOpenAi
    process.env.OPENROUTER_API_KEY = prevOpenRouter
  })

  it('visionModel uses OpenRouter slug when OPENROUTER_API_KEY is set', () => {
    const prevKey = process.env.OPENROUTER_API_KEY
    const prevModel = process.env.OPENROUTER_MODEL
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet'
    try {
      assert.equal(visionModel(), 'anthropic/claude-3.5-sonnet')
      assert.equal(contractProviderName(visionModel()), 'anthropic')
    } finally {
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = prevKey
      if (prevModel === undefined) delete process.env.OPENROUTER_MODEL
      else process.env.OPENROUTER_MODEL = prevModel
    }
  })

  it('contractProviderName maps openrouter model prefixes', () => {
    assert.equal(contractProviderName('openai/gpt-4o'), 'openai')
    assert.equal(contractProviderName('anthropic/claude-3.5-sonnet'), 'anthropic')
    assert.equal(contractProviderName('gpt-4o'), 'openai')
  })
})
