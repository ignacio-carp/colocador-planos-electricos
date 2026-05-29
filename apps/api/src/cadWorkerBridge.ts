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
  has_instalacion_electrica_layer?: boolean
  has_cambre_electrical_layer?: boolean
  error?: string
  code?: string
}

export type CadWorkerGeometryExtract = {
  ok: boolean
  paredes?: { inicio: number[]; fin: number[] }[]
  etiquetas_texto?: { texto: string; posicion: number[] }[]
  error?: string
  code?: string
}

export type CadWorkerApplyLayerResult = {
  ok: boolean
  input?: string
  output?: string
  layer?: string
  outlets_added?: number
  placements_skipped_out_of_bbox?: number
  bounding_box?: { min_x: number; max_x: number; min_y: number; max_y: number }
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
  if (code === 'CAD_WORKER_INVALID_DXF') {
    return new CadWorkerError('CAD_WORKER_INVALID_DXF', message, exitCode)
  }
  if (code === 'CAD_WORKER_INVALID_DWG') {
    return new CadWorkerError('CAD_WORKER_INVALID_DXF', message, exitCode)
  }
  if (exitCode === 124) {
    return new CadWorkerError('CAD_WORKER_TIMEOUT', message, exitCode)
  }
  return new CadWorkerError(code ?? 'CAD_WORKER_ERROR', message, exitCode)
}

function spawnCadWorkerJson(args: string[]): Promise<Record<string, unknown>> {
  if (cadWorkerDisabled()) {
    return Promise.reject(new CadWorkerError('CAD_WORKER_DISABLED', 'CAD worker disabled'))
  }

  const timeoutMs = cadWorkerTimeoutMs()
  const py = pythonExecutable()
  const cwd = cadWorkerCwd()

  return new Promise((resolve, reject) => {
    const child = spawn(py, ['-m', 'cad_worker', ...args], {
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
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        reject(new CadWorkerError('CAD_WORKER_INVALID_JSON', trimmed.slice(0, 500), code))
        return
      }
      if (code !== 0 || parsed.ok === false) {
        reject(
          mapExitCodeToError(
            typeof parsed.code === 'string' ? parsed.code : undefined,
            typeof parsed.error === 'string' ? parsed.error : stderr.trim() || `exit ${code}`,
            code,
          ),
        )
        return
      }
      resolve(parsed)
    })
  })
}

/**
 * Runs `python -m cad_worker inspect --input <path> --json` and parses stdout JSON.
 */
export function inspectDxfFile(inputPath: string): Promise<CadWorkerInspectResult> {
  if (cadWorkerDisabled()) {
    return Promise.resolve({ ok: false, code: 'CAD_WORKER_DISABLED', error: 'CAD worker disabled' })
  }
  return spawnCadWorkerJson(['inspect', '--input', inputPath, '--json']) as Promise<CadWorkerInspectResult>
}

export function extractGeometryFromDxf(inputPath: string): Promise<CadWorkerGeometryExtract> {
  if (cadWorkerDisabled()) {
    return Promise.resolve({ ok: false, code: 'CAD_WORKER_DISABLED', error: 'CAD worker disabled' })
  }
  return spawnCadWorkerJson([
    'extract-geometry',
    '--input',
    inputPath,
    '--json',
  ]) as Promise<CadWorkerGeometryExtract>
}

/** @deprecated Use inspectDxfFile — platform is DXF-only. */
export const inspectDwgFile = inspectDxfFile

/** US-009 — copy input DXF and add INSTALACION_ELECTRICA from outlet_placements JSON. */
export async function applyElectricalLayer(
  inputPath: string,
  outputPath: string,
  placements: unknown[],
): Promise<CadWorkerApplyLayerResult> {
  const placementsJson = JSON.stringify(placements)
  const parsed = await spawnCadWorkerJson([
    'apply-electrical-layer',
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--placements-json',
    placementsJson,
  ])
  return parsed as CadWorkerApplyLayerResult
}
