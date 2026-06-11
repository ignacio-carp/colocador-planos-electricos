import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isArchitecturalLayerCandidate,
  isElectricalLayer,
  suggestLayersFromInspect,
} from './layerSuggestions'

describe('layerSuggestions', () => {
  it('detects electrical layers', () => {
    assert.equal(isElectricalLayer('Cambre_Electrical'), true)
    assert.equal(isElectricalLayer('INSTALACION_ELECTRICA'), true)
    assert.equal(isElectricalLayer('A-WALL'), false)
  })

  it('flags architectural layer name patterns', () => {
    assert.equal(isArchitecturalLayerCandidate('A-WALL-FULL'), true)
    assert.equal(isArchitecturalLayerCandidate('PUERTAS'), true)
    assert.equal(isArchitecturalLayerCandidate('DEFPOINTS'), false)
  })

  it('suggests visible layers from cad inspect', () => {
    const result = suggestLayersFromInspect({
      layers: ['A-WALL', 'A-DOOR', 'DIM', 'DEFPOINTS', 'Cambre_Electrical', 'RANDOM-X'],
    })
    assert.ok(result.suggested_visible.includes('A-WALL'))
    assert.ok(result.suggested_visible.includes('A-DOOR'))
    assert.ok(result.suggested_visible.includes('Cambre_Electrical'))
    assert.equal(result.suggested_visible.includes('DEFPOINTS'), false)
    assert.equal(result.strategy, 'heuristic_v1')
  })
})
