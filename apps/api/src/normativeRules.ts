import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRootDirectory } from './pipelinePackageRoot'

export type NormativeRulesManifest = {
  active_version: string
  versions: { version: string; path: string; description?: string }[]
}

export type NormativeRulesBundle = {
  version: string
  title?: string
  rules: { id: string; summary: string }[]
}

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
