import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRootDirectory } from './pipelinePackageRoot'
import {
  activateNormativeRuleset,
  findActiveNormativeRuleset,
  isNormativeRulesDatabaseEnabled,
} from './normativeRulesStore'

export type NormativeRulesManifest = {
  active_version: string
  versions: { version: string; path: string; description?: string; replaces?: string }[]
}

/** Legacy MVP ruleset (cambre-normative-2026.05.1). */
export type NormativeRule = {
  id: string
  summary: string
  applies_to_room_types?: string[]
  min_outlets_per_room?: number
  spacing_along_wall_m?: number
  clearance_from_opening_m?: number
  outlet_type?: string
  height_mm?: number
  mounting?: string
  notes?: string
}

export type LegacyNormativeRulesBundle = {
  version: string
  title?: string
  jurisdiction_note?: string
  defaults?: Record<string, unknown>
  rules: NormativeRule[]
}

/** Vivienda ruleset (cambre-vivienda-2026.06.3) — full electrical plan generation. */
export type ViviendaNormativeRulesBundle = {
  version: string
  title?: string
  replaces?: string
  description?: string
  normative_basis?: Record<string, unknown>
  pipeline?: unknown[]
  normative?: Record<string, unknown>
  placement?: Record<string, unknown>
  symbology?: Record<string, unknown>
  output_contract?: Record<string, unknown>
  defaults?: Record<string, unknown>
  room_type_taxonomy?: Record<string, string>
  validation?: unknown[]
}

export type NormativeRulesBundle = LegacyNormativeRulesBundle | ViviendaNormativeRulesBundle

export type NormativeRulesSource = 'database' | 'filesystem'

let cachedManifest: NormativeRulesManifest | null = null
let cachedBundles = new Map<string, NormativeRulesBundle>()
let cachedActiveSource: NormativeRulesSource = 'filesystem'
let cachedActiveDbVersion: string | null = null
let cacheWarmPromise: Promise<void> | null = null

function rulesRoot(): string {
  const override = process.env.CAMBRE_RULES_ROOT?.trim()
  if (override) return override
  return join(repoRootDirectory(), 'rules', 'cambre-normative')
}

export function loadNormativeManifest(): NormativeRulesManifest {
  if (cachedManifest) return cachedManifest
  const raw = readFileSync(join(rulesRoot(), 'manifest.json'), 'utf8')
  cachedManifest = JSON.parse(raw) as NormativeRulesManifest
  return cachedManifest
}

function loadNormativeRulesBundleFromFilesystem(version: string): NormativeRulesBundle {
  const manifest = loadNormativeManifest()
  const entry = manifest.versions.find((v) => v.version === version)
  if (!entry) {
    throw new Error(`Unknown normative rules version: ${version}`)
  }
  const raw = readFileSync(join(rulesRoot(), entry.path), 'utf8')
  return JSON.parse(raw) as NormativeRulesBundle
}

function cacheBundle(version: string, bundle: NormativeRulesBundle, source: NormativeRulesSource): void {
  cachedBundles.set(version, bundle)
  if (source === 'database') {
    cachedActiveSource = 'database'
    cachedActiveDbVersion = version
  }
}

/**
 * Loads bundle from in-memory cache, then filesystem.
 * When Supabase is configured, call `warmNormativeRulesCache()` first so the active
 * version is loaded from Postgres.
 */
export function loadNormativeRulesBundle(version: string): NormativeRulesBundle {
  const hit = cachedBundles.get(version)
  if (hit) return hit

  const bundle = loadNormativeRulesBundleFromFilesystem(version)
  cachedBundles.set(version, bundle)
  return bundle
}

export function getNormativeRulesSource(): NormativeRulesSource {
  return cachedActiveSource
}

export async function warmNormativeRulesCache(): Promise<void> {
  if (!isNormativeRulesDatabaseEnabled()) return
  if (cacheWarmPromise) {
    await cacheWarmPromise
    return
  }
  cacheWarmPromise = warmNormativeRulesCacheInner().finally(() => {
    cacheWarmPromise = null
  })
  await cacheWarmPromise
}

async function warmNormativeRulesCacheInner(): Promise<void> {
  let active = await findActiveNormativeRuleset()
  if (!active) {
    await seedNormativeRulesFromFilesystem()
    active = await findActiveNormativeRuleset()
  }
  if (active) {
    cacheBundle(active.version, active.bundle, 'database')
  }
}

async function seedNormativeRulesFromFilesystem(): Promise<void> {
  const manifest = loadNormativeManifest()
  const version =
    process.env.NORMATIVE_RULES_VERSION?.trim() || manifest.active_version
  const bundle = loadNormativeRulesBundleFromFilesystem(version)
  validateNormativeRulesBundle(bundle)
  await activateNormativeRuleset(bundle)
}

export function isViviendaRulesBundle(bundle: NormativeRulesBundle): bundle is ViviendaNormativeRulesBundle {
  return 'pipeline' in bundle && Array.isArray(bundle.pipeline)
}

export function isLegacyRulesBundle(bundle: NormativeRulesBundle): bundle is LegacyNormativeRulesBundle {
  return 'rules' in bundle && Array.isArray(bundle.rules)
}

/**
 * Active rules version: `NORMATIVE_RULES_VERSION` env, then DB active row, then manifest.
 */
export function resolveActiveNormativeRulesVersion(): string {
  const fromEnv = process.env.NORMATIVE_RULES_VERSION?.trim()
  if (fromEnv) return fromEnv
  if (cachedActiveDbVersion) return cachedActiveDbVersion
  return loadNormativeManifest().active_version
}

export class NormativeRulesValidationError extends Error {
  readonly code = 'NORMATIVE_RULES_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'NormativeRulesValidationError'
  }
}

export type NormativeRulesAdminView = {
  active_version: string
  file_path: string
  source: NormativeRulesSource
  manifest: NormativeRulesManifest
  bundle: NormativeRulesBundle
  updated_at?: string
}

export function validateNormativeRulesBundle(bundle: unknown): NormativeRulesBundle {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new NormativeRulesValidationError('Rules bundle must be a JSON object')
  }
  const record = bundle as Record<string, unknown>
  if (typeof record.version !== 'string' || !record.version.trim()) {
    throw new NormativeRulesValidationError('Rules bundle must include a non-empty "version" string')
  }
  const legacy = Array.isArray(record.rules)
  const vivienda = Array.isArray(record.pipeline)
  if (!legacy && !vivienda) {
    throw new NormativeRulesValidationError(
      'Rules bundle must include a "rules" array (legacy) or "pipeline" array (vivienda)',
    )
  }
  if (legacy && (record.rules as unknown[]).length === 0) {
    throw new NormativeRulesValidationError('Legacy "rules" array must not be empty')
  }
  if (vivienda && (record.pipeline as unknown[]).length === 0) {
    throw new NormativeRulesValidationError('Vivienda "pipeline" array must not be empty')
  }
  return bundle as NormativeRulesBundle
}

export async function getActiveNormativeRulesAdminView(): Promise<NormativeRulesAdminView> {
  if (isNormativeRulesDatabaseEnabled()) {
    await warmNormativeRulesCache()
  }

  const manifest = loadNormativeManifest()
  const activeVersion = resolveActiveNormativeRulesVersion()
  const entry = manifest.versions.find((v) => v.version === activeVersion)
  if (!entry) {
    throw new Error(`Active normative rules version not found in manifest: ${activeVersion}`)
  }

  let updatedAt: string | undefined
  if (isNormativeRulesDatabaseEnabled()) {
    const row = await findActiveNormativeRuleset()
    if (row) updatedAt = row.updated_at
  }

  return {
    active_version: activeVersion,
    file_path: entry.path,
    source: getNormativeRulesSource(),
    manifest,
    bundle: loadNormativeRulesBundle(activeVersion),
    updated_at: updatedAt,
  }
}

/**
 * Persists the active rules bundle.
 * With Supabase configured: Postgres (`normative_rulesets`).
 * Otherwise: repository rules directory (local/tests).
 */
export async function saveActiveNormativeRulesBundle(
  bundle: unknown,
  updatedBy?: string,
): Promise<NormativeRulesBundle> {
  const validated = validateNormativeRulesBundle(bundle)
  const activeVersion = resolveActiveNormativeRulesVersion()
  if (validated.version !== activeVersion) {
    throw new NormativeRulesValidationError(
      `Bundle version "${validated.version}" must match active version "${activeVersion}"`,
    )
  }

  if (isNormativeRulesDatabaseEnabled()) {
    await activateNormativeRuleset(validated, updatedBy)
    clearNormativeRulesCache()
    cacheBundle(validated.version, validated, 'database')
    return validated
  }

  const manifest = loadNormativeManifest()
  const entry = manifest.versions.find((v) => v.version === activeVersion)
  if (!entry) {
    throw new Error(`Active normative rules version not found in manifest: ${activeVersion}`)
  }
  const filePath = join(rulesRoot(), entry.path)
  writeFileSync(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')
  clearNormativeRulesCache()
  cachedBundles.set(validated.version, validated)
  cachedActiveSource = 'filesystem'
  return validated
}

/** Test helper */
export function clearNormativeRulesCache(): void {
  cachedManifest = null
  cachedBundles = new Map()
  cachedActiveSource = 'filesystem'
  cachedActiveDbVersion = null
  cacheWarmPromise = null
}
