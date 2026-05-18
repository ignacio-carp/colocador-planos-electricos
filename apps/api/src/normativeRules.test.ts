import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  clearNormativeRulesCache,
  loadNormativeRulesBundle,
  resolveActiveNormativeRulesVersion,
} from './normativeRules'

describe('normativeRules S-03', () => {
  beforeEach(() => {
    clearNormativeRulesCache()
    delete process.env.NORMATIVE_RULES_VERSION
  })

  it('resolves active version from manifest', () => {
    assert.equal(resolveActiveNormativeRulesVersion(), 'cambre-normative-2026.05.1')
  })

  it('loads rules bundle for active version', () => {
    const bundle = loadNormativeRulesBundle('cambre-normative-2026.05.1')
    assert.ok(bundle.rules.length >= 1)
    assert.equal(bundle.version, 'cambre-normative-2026.05.1')
  })

  it('respects NORMATIVE_RULES_VERSION override', () => {
    process.env.NORMATIVE_RULES_VERSION = 'cambre-normative-2026.05.1'
    assert.equal(resolveActiveNormativeRulesVersion(), 'cambre-normative-2026.05.1')
  })
})
