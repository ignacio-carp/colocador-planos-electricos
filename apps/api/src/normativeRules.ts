import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRootDirectory } from './pipelinePackageRoot'

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

let cachedManifest: NormativeRulesManifest | null = null
let cachedBundles = new Map<string, NormativeRulesBundle>()

function rulesRoot(): string {
  return join(repoRootDirectory(), 'rules', 'cambre-normative')
}

export function loadNormativeManifest(): NormativeRulesManifest {
  if (cachedManifest) return cachedManifest
  const raw = readFileSync(join(rulesRoot(), 'manifest.json'), 'utf8')
  cachedManifest = JSON.parse(raw) as NormativeRulesManifest
  return cachedManifest
}

export function loadNormativeRulesBundle(version: string): NormativeRulesBundle {
  const hit = cachedBundles.get(version)
  if (hit) return hit

  const manifest = loadNormativeManifest()
  const entry = manifest.versions.find((v) => v.version === version)
  if (!entry) {
    throw new Error(`Unknown normative rules version: ${version}`)
  }
  const raw = readFileSync(join(rulesRoot(), entry.path), 'utf8')
  const bundle = JSON.parse(raw) as NormativeRulesBundle
  cachedBundles.set(version, bundle)
  return bundle
}

export function isViviendaRulesBundle(bundle: NormativeRulesBundle): bundle is ViviendaNormativeRulesBundle {
  return 'pipeline' in bundle && Array.isArray(bundle.pipeline)
}

export function isLegacyRulesBundle(bundle: NormativeRulesBundle): bundle is LegacyNormativeRulesBundle {
  return 'rules' in bundle && Array.isArray(bundle.rules)
}

/**
 * Active rules version: `NORMATIVE_RULES_VERSION` env or manifest `active_version`.
 */
export function resolveActiveNormativeRulesVersion(): string {
  const fromEnv = process.env.NORMATIVE_RULES_VERSION?.trim()
  if (fromEnv) return fromEnv
  return loadNormativeManifest().active_version
}

/** Test helper */
export function clearNormativeRulesCache(): void {
  cachedManifest = null
  cachedBundles = new Map()
}
