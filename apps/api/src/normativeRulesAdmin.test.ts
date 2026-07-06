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

const TOMAS_FIXTURE = {
  version: 'cambre-tomas-2026.07.1',
  title: 'Test rules',
  estrategia_procesamiento: {
    scope: 'tomacorrientes_only',
    steps: [{ id: 'match_room_type' }, { id: 'place_outlets' }],
    defaults: { height_mm: 300 },
  },
  apliques_y_simbologia: {
    cad_layer: { name: 'Cambre_Electrical', block_name: 'CAMBRE_OUTLET', color_aci: 3 },
  },
  reglas_por_habitacion: [
    {
      id: 'RULE-GENERICO',
      summary: 'Mínimo 1 toma',
      room_types: ['generico'],
      min_outlets: 1,
      height_mm: 300,
    },
  ],
}

describe('normativeRules admin', () => {
  let tempRoot: string
  let previousRulesRoot: string | undefined

  beforeEach(() => {
    clearNormativeRulesCache()
    delete process.env.NORMATIVE_RULES_VERSION
    tempRoot = mkdtempSync(join(tmpdir(), 'cambre-rules-admin-'))
    const rulesDir = join(tempRoot, 'rules', 'cambre-normative', '2026.07.1')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(
      join(tempRoot, 'rules', 'cambre-normative', 'manifest.json'),
      JSON.stringify(
        {
          active_version: 'cambre-tomas-2026.07.1',
          versions: [
            {
              version: 'cambre-tomas-2026.07.1',
              path: '2026.07.1/rules.json',
              description: 'test bundle',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    writeFileSync(join(rulesDir, 'rules.json'), JSON.stringify(TOMAS_FIXTURE, null, 2), 'utf8')
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

  it('validateNormativeRulesBundle accepts tomacorrientes bundle shape', () => {
    const bundle = validateNormativeRulesBundle(TOMAS_FIXTURE)
    assert.equal(bundle.version, 'cambre-tomas-2026.07.1')
  })

  it('saveActiveNormativeRulesBundle writes JSON and clears cache', async () => {
    const updated = {
      ...TOMAS_FIXTURE,
      title: 'Updated title',
      reglas_por_habitacion: [
        {
          id: 'RULE-GENERICO',
          summary: 'Dos tomas mínimo',
          room_types: ['generico'],
          min_outlets: 2,
          height_mm: 300,
        },
      ],
    }
    const saved = await saveActiveNormativeRulesBundle(updated)
    assert.equal(saved.title, 'Updated title')
    const onDisk = JSON.parse(
      readFileSync(join(tempRoot, 'rules', 'cambre-normative', '2026.07.1', 'rules.json'), 'utf8'),
    ) as { title?: string; reglas_por_habitacion?: unknown[] }
    assert.equal(onDisk.title, 'Updated title')
    assert.equal(onDisk.reglas_por_habitacion?.length, 1)
  })

  it('saveActiveNormativeRulesBundle rejects version mismatch', async () => {
    await assert.rejects(
      () =>
        saveActiveNormativeRulesBundle({
          ...TOMAS_FIXTURE,
          version: 'other-version',
        }),
      NormativeRulesValidationError,
    )
  })

  it('rejects reglas_por_habitacion entries missing string id', () => {
    assert.throws(
      () =>
        validateNormativeRulesBundle({
          ...TOMAS_FIXTURE,
          reglas_por_habitacion: [{ min_outlets: 1 }],
        }),
      NormativeRulesValidationError,
    )
  })

  it('rejects missing required tomacorrientes section', () => {
    assert.throws(
      () =>
        validateNormativeRulesBundle({
          version: 'cambre-tomas-2026.07.1',
          estrategia_procesamiento: {},
          reglas_por_habitacion: [{ id: 'RULE-X' }],
        }),
      NormativeRulesValidationError,
    )
  })

  it('saveActiveNormativeRulesBundle rejects dropping required sections', async () => {
    await assert.rejects(
      () =>
        saveActiveNormativeRulesBundle({
          version: 'cambre-tomas-2026.07.1',
          estrategia_procesamiento: TOMAS_FIXTURE.estrategia_procesamiento,
          apliques_y_simbologia: TOMAS_FIXTURE.apliques_y_simbologia,
          reglas_por_habitacion: [],
        }),
      /reglas_por_habitacion|Cannot remove required sections/,
    )
  })
})
