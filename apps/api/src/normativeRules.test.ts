import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  clearNormativeRulesCache,
  isLegacyRulesBundle,
  isViviendaRulesBundle,
  loadNormativeRulesBundle,
  resolveActiveNormativeRulesVersion,
} from './normativeRules'

describe('normativeRules S-03', () => {
  beforeEach(() => {
    clearNormativeRulesCache()
    delete process.env.NORMATIVE_RULES_VERSION
  })

  it('resolves active version from manifest (vivienda ruleset)', () => {
    assert.equal(resolveActiveNormativeRulesVersion(), 'cambre-vivienda-2026.06.3')
  })

  it('loads legacy rules bundle', () => {
    const bundle = loadNormativeRulesBundle('cambre-normative-2026.05.1')
    assert.ok(isLegacyRulesBundle(bundle))
    assert.ok(bundle.rules.length >= 1)
    assert.equal(bundle.version, 'cambre-normative-2026.05.1')
  })

  it('loads vivienda rules bundle with pipeline and symbology', () => {
    const bundle = loadNormativeRulesBundle('cambre-vivienda-2026.06.3')
    assert.ok(isViviendaRulesBundle(bundle))
    assert.equal(bundle.version, 'cambre-vivienda-2026.06.3')
    assert.ok(Array.isArray(bundle.pipeline) && bundle.pipeline.length >= 8)
    assert.ok(bundle.symbology && typeof bundle.symbology === 'object')
    assert.ok(bundle.placement && typeof bundle.placement === 'object')
  })

  it('respects NORMATIVE_RULES_VERSION override', () => {
    process.env.NORMATIVE_RULES_VERSION = 'cambre-normative-2026.05.1'
    assert.equal(resolveActiveNormativeRulesVersion(), 'cambre-normative-2026.05.1')
  })
})
