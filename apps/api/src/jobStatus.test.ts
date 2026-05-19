import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertJobStatusTransition, InvalidJobStatusTransitionError, normalizeJobStatus } from './jobStatus'

describe('jobStatus transitions', () => {
  it('allows pendiente → procesando → procesado', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('pendiente', 'procesando'))
    assert.doesNotThrow(() => assertJobStatusTransition('procesando', 'procesado'))
  })

  it('rejects illegal transitions', () => {
    assert.throws(
      () => assertJobStatusTransition('procesado', 'pendiente'),
      InvalidJobStatusTransitionError,
    )
  })

  it('normalizes legacy English statuses', () => {
    assert.equal(normalizeJobStatus('completed'), 'procesado')
    assert.equal(normalizeJobStatus('processing'), 'procesando')
  })
})
