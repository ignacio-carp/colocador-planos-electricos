import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'

/**
 * Carga `.env` del workspace API y del monorepo root (no pisa claves ya definidas).
 * `dotenv/config` solo lee `process.cwd()`, que varía según cómo arranques `npm run dev`.
 */
export function loadEnv(): void {
  const apiDir = path.resolve(__dirname, '..')
  const repoRoot = path.resolve(apiDir, '../..')
  const candidates = [path.join(apiDir, '.env'), path.join(repoRoot, '.env')]
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath })
    }
  }
}
