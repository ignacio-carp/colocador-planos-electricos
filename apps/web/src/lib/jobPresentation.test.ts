import { describe, expect, it } from 'vitest'
import {
  canDownloadProcessedDxf,
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

  it('waits 60s before first analysis check, then 30s between retries', () => {
    expect(JOB_ANALYSIS_INITIAL_WAIT_MS).toBe(60_000)
    expect(JOB_ANALYSIS_RETRY_WAIT_MS).toBe(30_000)
  })
})
