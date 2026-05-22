import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getPipelineMode, openaiConfigured } from './pipelineMode'

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

  it('openaiConfigured reflects OPENAI_API_KEY', () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    assert.equal(openaiConfigured(), false)
    process.env.OPENAI_API_KEY = 'sk-test'
    assert.equal(openaiConfigured(), true)
    process.env.OPENAI_API_KEY = prev
  })
})
