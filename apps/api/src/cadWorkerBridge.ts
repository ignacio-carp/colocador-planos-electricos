import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { repoRootDirectory } from './pipelinePackageRoot'

export type CadWorkerInspectResult = {
  ok: boolean
  path?: string
  layer_count?: number
  layers?: string[]
  entity_count?: number
  entity_types?: Record<string, number>
  has_cambre_electrical_layer?: boolean
  error?: string
  code?: string
}

export class CadWorkerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number | null = null,
  ) {
    super(message)
    this.name = 'CadWorkerError'
  }
}

function cadWorkerCwd(): string {
  return join(repoRootDirectory(), 'services', 'cad-worker')
}

function pythonExecutable(): string {
  const fromEnv = process.env.CAD_WORKER_PYTHON?.trim()
  if (fromEnv) return fromEnv
  const venvPy = join(repoRootDirectory(), 'services', 'cad-worker', '.venv', 'bin', 'python3')
  if (existsSync(venvPy)) return venvPy
  return 'python3'
}

export function cadWorkerDisabled(): boolean {
  const raw = process.env.CAD_WORKER_DISABLED?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function cadWorkerTimeoutMs(): number {
  const n = Number(process.env.CAD_WORKER_TIMEOUT_MS ?? 30_000)
  return Number.isFinite(n) && n > 0 ? n : 30_000
}

function mapExitCodeToError(code: string | undefined, message: string, exitCode: number): CadWorkerError {
  if (code === 'CAD_WORKER_FILE_NOT_FOUND') {
    return new CadWorkerError('CAD_WORKER_FILE_NOT_FOUND', message, exitCode)
  }
  if (code === 'CAD_WORKER_INVALID_DWG') {
    return new CadWorkerError('CAD_WORKER_INVALID_DWG', message, exitCode)
  }
  if (exitCode === 124) {
    return new CadWorkerError('CAD_WORKER_TIMEOUT', message, exitCode)
  }
  return new CadWorkerError(code ?? 'CAD_WORKER_ERROR', message, exitCode)
}

/**
 * Runs `python -m cad_worker inspect --input <path> --json` and parses stdout JSON.
 */
export function inspectDwgFile(inputPath: string): Promise<CadWorkerInspectResult> {
  if (cadWorkerDisabled()) {
    return Promise.resolve({ ok: false, code: 'CAD_WORKER_DISABLED', error: 'CAD worker disabled' })
  }

  const timeoutMs = cadWorkerTimeoutMs()
  const py = pythonExecutable()
  const cwd = cadWorkerCwd()

  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-m', 'cad_worker', 'inspect', '--input', inputPath, '--json'], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new CadWorkerError('CAD_WORKER_SPAWN_FAILED', err.message))
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const code = exitCode ?? 1
      if (code === 124 || (stderr.includes('Killed') && code !== 0)) {
        reject(mapExitCodeToError(undefined, 'CAD worker timed out', 124))
        return
      }

      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(
          new CadWorkerError(
            'CAD_WORKER_EMPTY_OUTPUT',
            stderr.trim() || `cad-worker exited with ${code}`,
            code,
          ),
        )
        return
      }

      let parsed: CadWorkerInspectResult
      try {
        parsed = JSON.parse(trimmed) as CadWorkerInspectResult
      } catch {
        reject(new CadWorkerError('CAD_WORKER_INVALID_JSON', trimmed.slice(0, 500), code))
        return
      }

      if (code !== 0 || parsed.ok === false) {
        reject(
          mapExitCodeToError(
            parsed.code,
            parsed.error ?? stderr.trim() ?? `cad-worker exit ${code}`,
            code,
          ),
        )
        return
      }

      resolve(parsed)
    })
  })
}
