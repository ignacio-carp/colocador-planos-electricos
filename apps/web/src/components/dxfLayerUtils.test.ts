import { describe, expect, it } from 'vitest'
import { buildInitialLayerVisibility, isElectricalLayerName } from './dxfLayerUtils'

describe('dxfLayerUtils', () => {
  it('detects electrical layer names', () => {
    expect(isElectricalLayerName('Cambre_Electrical')).toBe(true)
    expect(isElectricalLayerName('A-WALL')).toBe(false)
  })

  it('builds initial visibility from suggestions', () => {
    const visibility = buildInitialLayerVisibility(['A-WALL', 'DEFPOINTS', 'Cambre_Electrical'], {
      layers: ['A-WALL', 'DEFPOINTS', 'Cambre_Electrical'],
      suggested_visible: ['A-WALL', 'Cambre_Electrical'],
      hidden_by_default: ['DEFPOINTS'],
      electrical_layers: ['Cambre_Electrical'],
      strategy: 'heuristic_v1',
    })
    expect(visibility['A-WALL']).toBe(true)
    expect(visibility.DEFPOINTS).toBe(false)
    expect(visibility.Cambre_Electrical).toBe(true)
  })
})
