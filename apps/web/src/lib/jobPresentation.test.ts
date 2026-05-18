import { describe, expect, it } from 'vitest'
import { formatJobCreatedAt, hasRegisteredDwgInput } from './jobPresentation'

describe('formatJobCreatedAt', () => {
  it('returns null for missing or invalid ISO', () => {
    expect(formatJobCreatedAt(undefined)).toBeNull()
    expect(formatJobCreatedAt('')).toBeNull()
    expect(formatJobCreatedAt('not-a-date')).toBeNull()
  })

  it('formats valid ISO timestamps', () => {
    const s = formatJobCreatedAt('2026-05-18T12:00:00.000Z')
    expect(s).toBeTruthy()
    expect(s).toMatch(/2026/)
  })
})

describe('hasRegisteredDwgInput', () => {
  it('is false for empty list', () => {
    expect(hasRegisteredDwgInput([])).toBe(false)
  })

  it('detects input_dwg kind', () => {
    expect(hasRegisteredDwgInput([{ kind: 'output_dwg' }])).toBe(false)
    expect(hasRegisteredDwgInput([{ kind: 'input_dwg' }])).toBe(true)
    expect(hasRegisteredDwgInput([{ kind: 'output_dwg' }, { kind: 'input_dwg' }])).toBe(true)
  })
})
