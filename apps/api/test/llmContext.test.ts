import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { slimCadInspectForLlm, slimGeometryExtractForLlm } from '../src/llmContext'

describe('llmContext', () => {
  it('slimCadInspectForLlm drops server path and ok flag', () => {
    const slim = slimCadInspectForLlm({
      ok: true,
      path: '/tmp/secret/input.dxf',
      dxf_version: 'AC1018',
      layer_count: 14,
      layers: ['A-WALL', 'A-TEXT'],
      entity_count: 100,
      entity_types: { LINE: 80, TEXT: 20 },
    })
    assert.equal(slim.path, undefined)
    assert.equal(slim.ok, undefined)
    assert.equal(slim.dxf_version, 'AC1018')
    assert.deepEqual(slim.layers, ['A-WALL', 'A-TEXT'])
  })

  it('slimGeometryExtractForLlm keeps walls and labels', () => {
    const slim = slimGeometryExtractForLlm({
      paredes: [{ inicio: [0, 0], fin: [1000, 0] }],
      etiquetas_texto: [{ texto: 'Baño', posicion: [500, 500] }],
    })
    assert.ok(slim)
    assert.equal(Array.isArray(slim!.paredes), true)
    assert.equal(Array.isArray(slim!.etiquetas_texto), true)
  })
})
