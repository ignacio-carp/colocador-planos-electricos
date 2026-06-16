import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertJobStatusTransition,
  InvalidJobStatusTransitionError,
  isTerminalJobStatus,
  normalizeJobStatus,
} from './jobStatus'

describe('jobStatus transitions', () => {
  it('allows pendiente → procesando → procesado', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('pendiente', 'procesando'))
    assert.doesNotThrow(() => assertJobStatusTransition('procesando', 'procesado'))
  })

  it('allows error → pendiente for pipeline retry', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('error', 'pendiente'))
  })

  it('allows pendiente → analizando → listo_para_editar (US-012)', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('pendiente', 'analizando'))
    assert.doesNotThrow(() => assertJobStatusTransition('analizando', 'listo_para_editar'))
  })

  it('allows analizando → error', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('analizando', 'error'))
  })

  it('allows listo_para_editar → procesando (US-013)', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('listo_para_editar', 'procesando'))
  })

  it('allows DXF replace transitions back to pendiente', () => {
    assert.doesNotThrow(() => assertJobStatusTransition('listo_para_editar', 'pendiente'))
    assert.doesNotThrow(() => assertJobStatusTransition('parcialmente_procesado', 'pendiente'))
    assert.doesNotThrow(() => assertJobStatusTransition('procesado', 'pendiente'))
  })

  it('rejects illegal transitions', () => {
    assert.throws(
      () => assertJobStatusTransition('analizando', 'pendiente'),
      InvalidJobStatusTransitionError,
    )
    assert.throws(
      () => assertJobStatusTransition('error', 'procesando'),
      InvalidJobStatusTransitionError,
    )
  })

  it('normalizes legacy English statuses', () => {
    assert.equal(normalizeJobStatus('completed'), 'procesado')
    assert.equal(normalizeJobStatus('processing'), 'procesando')
  })

  it('isTerminalJobStatus returns true for terminal states', () => {
    assert.equal(isTerminalJobStatus('procesado'), true)
    assert.equal(isTerminalJobStatus('listo_para_editar'), true)
    assert.equal(isTerminalJobStatus('error'), true)
    assert.equal(isTerminalJobStatus('pendiente'), false)
    assert.equal(isTerminalJobStatus('analizando'), false)
    assert.equal(isTerminalJobStatus('procesando'), false)
  })
})
