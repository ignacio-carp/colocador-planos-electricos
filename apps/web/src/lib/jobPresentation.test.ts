import { describe, expect, it } from 'vitest'
import {
  canDownloadProcessedDxf,
  canReprocessPreliminaryAnalysis,
  canStartPreliminaryAnalysis,
  formatJobCreatedAt,
  hasRegisteredDxfInput,
  JOB_ANALYSIS_INITIAL_WAIT_MS,
  JOB_ANALYSIS_RETRY_WAIT_MS,
  projectStatusChip,
} from './jobPresentation'

describe('jobPresentation', () => {
  it('formats created_at', () => {
    const s = formatJobCreatedAt('2026-01-15T10:00:00.000Z')
    expect(s).toBeTruthy()
  })

  it('maps procesado to Completado chip', () => {
    expect(projectStatusChip('procesado').label).toBe('Completado')
  })

  it('detects input_dxf kind', () => {
    expect(hasRegisteredDxfInput([{ kind: 'output_dxf' }])).toBe(false)
    expect(hasRegisteredDxfInput([{ kind: 'input_dxf' }])).toBe(true)
    expect(hasRegisteredDxfInput([{ kind: 'output_dxf' }, { kind: 'input_dxf' }])).toBe(true)
  })

  it('allows download when procesado', () => {
    expect(canDownloadProcessedDxf('procesado')).toBe(true)
    expect(canDownloadProcessedDxf('pending')).toBe(false)
  })

  it('allows start analysis when pendiente with input', () => {
    expect(canStartPreliminaryAnalysis('pendiente', true)).toBe(true)
    expect(canStartPreliminaryAnalysis('pendiente', false)).toBe(false)
    expect(canStartPreliminaryAnalysis('error', true)).toBe(true)
    expect(canStartPreliminaryAnalysis('listo_para_editar', true)).toBe(false)
  })

  it('allows reprocess when no rooms detected', () => {
    expect(canReprocessPreliminaryAnalysis('listo_para_editar', 0, ['NO_ROOMS_DETECTED'])).toBe(true)
    expect(canReprocessPreliminaryAnalysis('listo_para_editar', 2, [])).toBe(false)
  })

  it('waits 60s before first analysis check, then 30s between retries', () => {
    expect(JOB_ANALYSIS_INITIAL_WAIT_MS).toBe(60_000)
    expect(JOB_ANALYSIS_RETRY_WAIT_MS).toBe(30_000)
  })
})
