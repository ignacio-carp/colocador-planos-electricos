import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatPrometheusMetrics, incrementPipelineError, recordStepLatency } from './metrics'

describe('formatPrometheusMetrics', () => {
  it('emits prometheus text with recorded metrics', () => {
    recordStepLatency('vision_layout', 120)
    incrementPipelineError('vision_layout')
    const text = formatPrometheusMetrics()
    assert.match(text, /cambre_pipeline_step_latency_ms/)
    assert.match(text, /cambre_pipeline_errors_total/)
  })
})
