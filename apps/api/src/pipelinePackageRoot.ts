import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Resolved `docs/contracts/pipeline`, walking upward from `startDir` until
 * `vision-layout-output.json` exists (supports `cwd` at repo root or `apps/api`).
 */
export function pipelineContractsDirectory(startDir: string = process.cwd()): string {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, 'docs', 'contracts', 'pipeline')
    if (existsSync(join(candidate, 'vision-layout-output.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate docs/contracts/pipeline.')
    dir = parent
  }
}
