import { describe, expect, it } from 'vitest'
import {
  canDownloadProcessedDxf,
  formatJobCreatedAt,
  hasRegisteredDxfInput,
  JOB_ANALYSIS_POLL_MS,
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

  it('uses a 60s poll interval during DXF analysis', () => {
    expect(JOB_ANALYSIS_POLL_MS).toBe(60_000)
  })
})
