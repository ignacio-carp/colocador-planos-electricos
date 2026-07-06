import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  clearNormativeRulesCache,
  NormativeRulesValidationError,
  saveActiveNormativeRulesBundle,
  validateNormativeRulesBundle,
} from './normativeRules'

describe('normativeRules admin', () => {
  let tempRoot: string
  let previousRulesRoot: string | undefined

  beforeEach(() => {
    clearNormativeRulesCache()
    delete process.env.NORMATIVE_RULES_VERSION
    tempRoot = mkdtempSync(join(tmpdir(), 'cambre-rules-admin-'))
    const rulesDir = join(tempRoot, 'rules', 'cambre-normative', '2026.06.3')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(
      join(tempRoot, 'rules', 'cambre-normative', 'manifest.json'),
      JSON.stringify(
        {
          active_version: 'cambre-vivienda-2026.06.3',
          versions: [
            {
              version: 'cambre-vivienda-2026.06.3',
              path: '2026.06.3/rules.json',
              description: 'test bundle',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    writeFileSync(
      join(rulesDir, 'rules.json'),
      JSON.stringify(
        {
          version: 'cambre-vivienda-2026.06.3',
          title: 'Test rules',
          pipeline: [{ id: 'classify' }],
        },
        null,
        2,
      ),
      'utf8',
    )
    previousRulesRoot = process.env.CAMBRE_RULES_ROOT
    process.env.CAMBRE_RULES_ROOT = join(tempRoot, 'rules', 'cambre-normative')
  })

  afterEach(() => {
    clearNormativeRulesCache()
    if (previousRulesRoot === undefined) delete process.env.CAMBRE_RULES_ROOT
    else process.env.CAMBRE_RULES_ROOT = previousRulesRoot
  })

  it('validateNormativeRulesBundle rejects empty object', () => {
    assert.throws(() => validateNormativeRulesBundle({}), NormativeRulesValidationError)
  })

  it('validateNormativeRulesBundle accepts vivienda bundle shape', () => {
    const bundle = validateNormativeRulesBundle({
      version: 'cambre-vivienda-2026.06.3',
      pipeline: [{ id: 'classify' }],
    })
    assert.equal(bundle.version, 'cambre-vivienda-2026.06.3')
  })

  it('saveActiveNormativeRulesBundle writes JSON and clears cache', async () => {
    const updated = {
      version: 'cambre-vivienda-2026.06.3',
      title: 'Updated title',
      pipeline: [{ id: 'classify' }, { id: 'place' }],
    }
    const saved = await saveActiveNormativeRulesBundle(updated)
    assert.equal(saved.title, 'Updated title')
    const onDisk = JSON.parse(
      readFileSync(join(tempRoot, 'rules', 'cambre-normative', '2026.06.3', 'rules.json'), 'utf8'),
    ) as { title?: string; pipeline?: unknown[] }
    assert.equal(onDisk.title, 'Updated title')
    assert.equal(onDisk.pipeline?.length, 2)
  })

  it('saveActiveNormativeRulesBundle rejects version mismatch', async () => {
    await assert.rejects(
      () =>
        saveActiveNormativeRulesBundle({
          version: 'other-version',
          pipeline: [{ id: 'classify' }],
        }),
      NormativeRulesValidationError,
    )
  })

  it('rejects pipeline entries missing string id', () => {
    assert.throws(
      () =>
        validateNormativeRulesBundle({
          version: 'cambre-vivienda-2026.06.3',
          pipeline: [{ stage: 1 }],
        }),
      NormativeRulesValidationError,
    )
  })

  it('rejects sections that are not JSON objects', () => {
    assert.throws(
      () =>
        validateNormativeRulesBundle({
          version: 'cambre-vivienda-2026.06.3',
          pipeline: [{ id: 'classify' }],
          normative: 'not-an-object',
        }),
      NormativeRulesValidationError,
    )
  })

  it('saveActiveNormativeRulesBundle rejects dropping top-level sections', async () => {
    await assert.rejects(
      () =>
        saveActiveNormativeRulesBundle({
          version: 'cambre-vivienda-2026.06.3',
          // "title" from the seeded bundle is missing here
          pipeline: [{ id: 'classify' }],
        }),
      /Cannot remove top-level sections/,
    )
  })
})
