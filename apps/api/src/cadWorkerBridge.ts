import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import type { CadWorkerRenderResult } from './llmRenderContext'
import { logStructured } from './logger'
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
  paredes?: { inicio: number[]; fin: number[]; capa?: string }[]
  etiquetas_texto?: { texto: string; posicion: number[] }[]
  /** Segments/blocks on door/window layers (puertas, ventanas). */
  aberturas?: Record<string, unknown>[]
  /** Block references on furniture layers (mobiliario). */
  muebles?: { bloque?: string; posicion?: number[]; capa?: string }[]
  /** Layer names classified by heuristic: paredes | aberturas | muebles. */
  capas_clasificadas?: Record<string, string[]>
  /** Declared DXF $INSUNITS (4=mm, 6=m); null when the header is absent. */
  insunits?: number | null
  error?: string
  code?: string
}

export type CadWorkerApplyLayerResult = {
  ok: boolean
  input?: string
  output?: string
  layer?: string
  block_name?: string
  outlets_added?: number
  placements_skipped_out_of_bbox?: number
  bounding_box?: { min_x: number; max_x: number; min_y: number; max_y: number }
  source_layers_preserved?: boolean
  output_checksum_sha256?: string
  error?: string
  code?: string
}

export type ApplyElectricalLayerOptions = {
  outputLayer?: {
    name: string
    block_name?: string
    color_aci?: number
  }
  /** US-013: room_id for incremental merge; tags new blockrefs and removes prior ones for this room. */
  roomId?: string
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

export type { CadWorkerRenderResult } from './llmRenderContext'

export type CadWorkerTransport = 'http' | 'spawn' | 'disabled'

const CAD_WORKER_RESULT_HEADER = 'x-cad-worker-result'
const CAD_WORKER_RESULT_ENCODING_HEADER = 'x-cad-worker-result-encoding'

function decodeCadWorkerResultHeader(
  rawHeader: string,
  encodingHeader: string | null,
): string {
  if (encodingHeader?.toLowerCase() === 'base64-utf-8') {
    return Buffer.from(rawHeader, 'base64').toString('utf-8')
  }
  return rawHeader
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

/** Throws when CAD worker is explicitly disabled (production paths must not silently stub). */
export function assertCadWorkerEnabled(): void {
  if (cadWorkerDisabled()) {
    throw new CadWorkerError('CAD_WORKER_DISABLED', 'CAD worker is disabled')
  }
}

export function cadWorkerTimeoutMs(): number {
  const n = Number(process.env.CAD_WORKER_TIMEOUT_MS ?? 30_000)
  return Number.isFinite(n) && n > 0 ? n : 30_000
}

/** Base URL of the remote cad-worker HTTP service (no trailing slash). */
/** Ensures fetch()-safe base URL (Railway private hostnames often omit http://). */
export function normalizeCadWorkerBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export function cadWorkerBaseUrl(): string | undefined {
  const raw = process.env.CAD_WORKER_URL?.trim()
  if (!raw) return undefined
  return normalizeCadWorkerBaseUrl(raw)
}

export function cadWorkerTransport(): CadWorkerTransport {
  if (cadWorkerDisabled()) return 'disabled'
  if (cadWorkerBaseUrl()) return 'http'
  return 'spawn'
}

export function cadWorkerConfigSummary(): Record<string, unknown> {
  const transport = cadWorkerTransport()
  return {
    cad_worker_transport: transport,
    cad_worker_url: transport === 'http' ? cadWorkerBaseUrl() : undefined,
    cad_worker_timeout_ms: cadWorkerTimeoutMs(),
    cad_worker_python: transport === 'spawn' ? pythonExecutable() : undefined,
  }
}

function logCadWorker(
  level: 'info' | 'warn' | 'error',
  fields: Record<string, unknown>,
): void {
  logStructured(level, { component: 'cad_worker_bridge', ...fields })
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

function parseWorkerPayload(body: string, httpStatus: number): Record<string, unknown> {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new CadWorkerError('CAD_WORKER_INVALID_JSON', body.slice(0, 500), httpStatus)
  }
  if (parsed.ok === false) {
    throw mapExitCodeToError(
      typeof parsed.code === 'string' ? parsed.code : undefined,
      typeof parsed.error === 'string' ? parsed.error : `HTTP ${httpStatus}`,
      httpStatus,
    )
  }
  return parsed
}

function httpDetailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object') {
    const d = detail as { error?: unknown; message?: unknown }
    if (typeof d.error === 'string') return d.error
    if (typeof d.message === 'string') return d.message
    return JSON.stringify(detail).slice(0, 500)
  }
  return 'cad-worker HTTP error'
}

function httpDetailCode(detail: unknown): string | undefined {
  if (detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string') {
    return (detail as { code: string }).code
  }
  return undefined
}

async function fetchCadWorker(
  endpoint: string,
  init: RequestInit & { operation: string; inputPath?: string },
): Promise<Response> {
  const base = cadWorkerBaseUrl()
  if (!base) {
    throw new CadWorkerError('CAD_WORKER_URL_MISSING', 'CAD_WORKER_URL is not set')
  }

  const url = `${base}${endpoint}`
  const timeoutMs = cadWorkerTimeoutMs()
  const t0 = Date.now()

  logCadWorker('info', {
    event: 'cad_worker_http_request',
    operation: init.operation,
    endpoint,
    url,
    method: init.method ?? 'POST',
    input_path: init.inputPath,
    transport: 'http',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - t0
    logCadWorker(response.ok ? 'info' : 'warn', {
      event: 'cad_worker_http_response',
      operation: init.operation,
      endpoint,
      status: response.status,
      duration_ms: durationMs,
      transport: 'http',
    })
    return response
  } catch (e) {
    const durationMs = Date.now() - t0
    const message = e instanceof Error ? e.message : String(e)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    logCadWorker('error', {
      event: 'cad_worker_http_failed',
      operation: init.operation,
      endpoint,
      duration_ms: durationMs,
      error: message,
      timed_out: isAbort,
      transport: 'http',
    })
    if (isAbort) {
      throw new CadWorkerError('CAD_WORKER_TIMEOUT', `cad-worker HTTP timeout after ${timeoutMs}ms`)
    }
    throw new CadWorkerError('CAD_WORKER_HTTP_FAILED', message)
  } finally {
    clearTimeout(timer)
  }
}

async function postDxfForJson(
  endpoint: string,
  operation: string,
  inputPath: string,
): Promise<Record<string, unknown>> {
  const fileName = basename(inputPath)
  const bytes = readFileSync(inputPath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), fileName)

  const response = await fetchCadWorker(endpoint, {
    method: 'POST',
    body: form,
    operation,
    inputPath,
  })

  const body = await response.text()
  if (!response.ok) {
    let detail: unknown
    try {
      detail = JSON.parse(body) as { detail?: unknown }
      if (detail && typeof detail === 'object' && 'detail' in detail) {
        detail = (detail as { detail: unknown }).detail
      }
    } catch {
      detail = body
    }
    throw mapExitCodeToError(
      httpDetailCode(detail),
      httpDetailMessage(detail),
      response.status,
    )
  }

  return parseWorkerPayload(body, response.status)
}

async function httpApplyElectricalLayer(
  inputPath: string,
  outputPath: string,
  placements: unknown[],
  options?: ApplyElectricalLayerOptions,
): Promise<CadWorkerApplyLayerResult> {
  const fileName = basename(inputPath)
  const bytes = readFileSync(inputPath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), fileName)
  form.append('placements_json', JSON.stringify(placements))
  if (options?.outputLayer) {
    form.append('output_layer_json', JSON.stringify(options.outputLayer))
  }
  if (options?.roomId) {
    form.append('room_id', options.roomId)
  }

  const response = await fetchCadWorker('/apply-electrical-layer', {
    method: 'POST',
    body: form,
    operation: 'apply-electrical-layer',
    inputPath,
  })

  if (!response.ok) {
    const body = await response.text()
    let detail: unknown = body
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (parsed.detail !== undefined) detail = parsed.detail
    } catch {
      /* keep raw body */
    }
    throw mapExitCodeToError(
      httpDetailCode(detail),
      httpDetailMessage(detail),
      response.status,
    )
  }

  const metaHeaderRaw = response.headers.get(CAD_WORKER_RESULT_HEADER)
  const metaEncoding = response.headers.get(CAD_WORKER_RESULT_ENCODING_HEADER)
  let meta: CadWorkerApplyLayerResult = { ok: true }
  if (metaHeaderRaw) {
    try {
      const metaHeader = decodeCadWorkerResultHeader(metaHeaderRaw, metaEncoding)
      meta = parseWorkerPayload(metaHeader, response.status) as CadWorkerApplyLayerResult
    } catch (e) {
      logCadWorker('warn', {
        event: 'cad_worker_apply_meta_parse_failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const outputBytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(outputPath, outputBytes)
  logCadWorker('info', {
    event: 'cad_worker_apply_saved',
    output_path: outputPath,
    bytes: outputBytes.length,
    outlets_added: meta.outlets_added,
  })
  return { ...meta, ok: true, output: outputPath }
}

async function httpRenderPng(
  endpoint: string,
  operation: string,
  inputPath: string,
  outputPath: string,
  formFields: Record<string, string>,
): Promise<CadWorkerRenderResult> {
  const fileName = basename(inputPath)
  const bytes = readFileSync(inputPath)
  const form = new FormData()
  form.append('file', new Blob([bytes]), fileName)
  for (const [key, value] of Object.entries(formFields)) {
    form.append(key, value)
  }

  const response = await fetchCadWorker(endpoint, {
    method: 'POST',
    body: form,
    operation,
    inputPath,
  })

  if (!response.ok) {
    const body = await response.text()
    let detail: unknown = body
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (parsed.detail !== undefined) detail = parsed.detail
    } catch {
      /* keep raw body */
    }
    throw mapExitCodeToError(
      httpDetailCode(detail),
      httpDetailMessage(detail),
      response.status,
    )
  }

  const metaHeaderRaw = response.headers.get(CAD_WORKER_RESULT_HEADER)
  const metaEncoding = response.headers.get(CAD_WORKER_RESULT_ENCODING_HEADER)
  let meta: CadWorkerRenderResult = { ok: true }
  if (metaHeaderRaw) {
    try {
      const metaHeader = decodeCadWorkerResultHeader(metaHeaderRaw, metaEncoding)
      meta = parseWorkerPayload(metaHeader, response.status) as CadWorkerRenderResult
    } catch (e) {
      logCadWorker('warn', {
        event: 'cad_worker_render_meta_parse_failed',
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const outputBytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(outputPath, outputBytes)
  return { ...meta, ok: true, output: outputPath }
}

function spawnCadWorkerJson(args: string[], inputPath?: string): Promise<Record<string, unknown>> {
  if (cadWorkerDisabled()) {
    return Promise.reject(new CadWorkerError('CAD_WORKER_DISABLED', 'CAD worker disabled'))
  }

  const timeoutMs = cadWorkerTimeoutMs()
  const py = pythonExecutable()
  const cwd = cadWorkerCwd()
  const operation = args[0] ?? 'unknown'

  logCadWorker('info', {
    event: 'cad_worker_spawn_start',
    operation,
    python: py,
    cwd,
    args: args.slice(0, 4),
    input_path: inputPath,
    transport: 'spawn',
  })

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

    const t0 = Date.now()

    child.on('error', (err) => {
      clearTimeout(timer)
      logCadWorker('error', {
        event: 'cad_worker_spawn_failed',
        operation,
        error: err.message,
        duration_ms: Date.now() - t0,
        transport: 'spawn',
      })
      reject(new CadWorkerError('CAD_WORKER_SPAWN_FAILED', err.message))
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const code = exitCode ?? 1
      const durationMs = Date.now() - t0
      const trimmed = stdout.trim()

      if (!trimmed) {
        logCadWorker('error', {
          event: 'cad_worker_spawn_empty_output',
          operation,
          exit_code: code,
          stderr_preview: stderr.trim().slice(0, 300),
          duration_ms: durationMs,
          transport: 'spawn',
        })
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
        logCadWorker('error', {
          event: 'cad_worker_spawn_invalid_json',
          operation,
          exit_code: code,
          stdout_preview: trimmed.slice(0, 300),
          duration_ms: durationMs,
          transport: 'spawn',
        })
        reject(new CadWorkerError('CAD_WORKER_INVALID_JSON', trimmed.slice(0, 500), code))
        return
      }

      if (code !== 0 || parsed.ok === false) {
        logCadWorker('warn', {
          event: 'cad_worker_spawn_error',
          operation,
          exit_code: code,
          code_field: parsed.code,
          duration_ms: durationMs,
          transport: 'spawn',
        })
        reject(
          mapExitCodeToError(
            typeof parsed.code === 'string' ? parsed.code : undefined,
            typeof parsed.error === 'string' ? parsed.error : stderr.trim() || `exit ${code}`,
            code,
          ),
        )
        return
      }

      logCadWorker('info', {
        event: 'cad_worker_spawn_success',
        operation,
        exit_code: code,
        duration_ms: durationMs,
        transport: 'spawn',
      })
      resolve(parsed)
    })
  })
}

async function invokeCadWorkerJson(
  operation: string,
  spawnArgs: string[],
  inputPath: string,
  httpEndpoint: string,
): Promise<Record<string, unknown>> {
  if (cadWorkerTransport() === 'http') {
    return postDxfForJson(httpEndpoint, operation, inputPath)
  }
  return spawnCadWorkerJson(spawnArgs, inputPath)
}

/**
 * On API startup, probes cad-worker when HTTP transport is configured.
 */
export async function probeCadWorkerOnStartup(): Promise<void> {
  const transport = cadWorkerTransport()
  logCadWorker('info', {
    event: 'cad_worker_config',
    ...cadWorkerConfigSummary(),
  })

  if (transport !== 'http') return

  const base = cadWorkerBaseUrl()!
  const t0 = Date.now()
  try {
    const response = await fetch(`${base}/healthz`, {
      signal: AbortSignal.timeout(Math.min(cadWorkerTimeoutMs(), 10_000)),
    })
    const body = await response.text()
    logCadWorker(response.ok ? 'info' : 'warn', {
      event: 'cad_worker_startup_probe',
      status: response.status,
      duration_ms: Date.now() - t0,
      body_preview: body.slice(0, 200),
    })
  } catch (e) {
    logCadWorker('error', {
      event: 'cad_worker_startup_probe_failed',
      error: e instanceof Error ? e.message : String(e),
      duration_ms: Date.now() - t0,
      url: `${base}/healthz`,
    })
  }
}

/**
 * Runs `python -m cad_worker inspect --input <path> --json` or POST /inspect when CAD_WORKER_URL is set.
 */
export function inspectDxfFile(inputPath: string): Promise<CadWorkerInspectResult> {
  assertCadWorkerEnabled()
  return invokeCadWorkerJson(
    'inspect',
    ['inspect', '--input', inputPath, '--json'],
    inputPath,
    '/inspect',
  ) as Promise<CadWorkerInspectResult>
}

export function extractGeometryFromDxf(inputPath: string): Promise<CadWorkerGeometryExtract> {
  assertCadWorkerEnabled()
  return invokeCadWorkerJson(
    'extract-geometry',
    ['extract-geometry', '--input', inputPath, '--json'],
    inputPath,
    '/extract-geometry',
  ) as Promise<CadWorkerGeometryExtract>
}

export type CadWorkerPlaceElementsResult = {
  ok: boolean
  room_id?: string
  rule_id?: string
  required_outlets?: number
  outlet_placements?: Record<string, unknown>[]
  warnings?: string[]
  drawing_units_per_meter?: number
  placement_engine?: string
  error?: string
  code?: string
}

/**
 * Deterministic outlet placement (placement_mode=deterministic): the
 * cad-worker computes exact coordinates from walls/openings/furniture.
 * Payload: { room: {id, room_type, polygon}, geometry, rules, insunits? }.
 */
export async function placeElementsForRoom(
  payload: Record<string, unknown>,
): Promise<CadWorkerPlaceElementsResult> {
  assertCadWorkerEnabled()

  if (cadWorkerTransport() === 'http') {
    const response = await fetchCadWorker('/place-elements', {
      operation: 'place-elements',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json().catch(() => ({}))) as CadWorkerPlaceElementsResult & {
      detail?: { code?: string; error?: string }
    }
    if (!response.ok || body.ok === false) {
      const code = body.detail?.code ?? body.code ?? `CAD_WORKER_HTTP_${response.status}`
      const message =
        body.detail?.error ?? body.error ?? `cad-worker /place-elements HTTP ${response.status}`
      throw new CadWorkerError(code, message)
    }
    return body
  }

  const parsed = await spawnCadWorkerJson([
    'place-elements',
    '--payload-json',
    JSON.stringify(payload),
  ])
  return parsed as CadWorkerPlaceElementsResult
}

/** @deprecated Use inspectDxfFile — platform is DXF-only. */
export const inspectDwgFile = inspectDxfFile

/** US-009 — copy input DXF and add Cambre_Electrical blocks from outlet_placements JSON. */
export async function applyElectricalLayer(
  inputPath: string,
  outputPath: string,
  placements: unknown[],
  options?: ApplyElectricalLayerOptions,
): Promise<CadWorkerApplyLayerResult> {
  assertCadWorkerEnabled()

  if (cadWorkerTransport() === 'http') {
    return httpApplyElectricalLayer(inputPath, outputPath, placements, options)
  }

  const placementsJson = JSON.stringify(placements)
  const spawnArgs = [
    'apply-electrical-layer',
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--placements-json',
    placementsJson,
  ]
  if (options?.outputLayer) {
    spawnArgs.push('--output-layer-json', JSON.stringify(options.outputLayer))
  }
  if (options?.roomId) {
    spawnArgs.push('--room-id', options.roomId)
  }
  const parsed = await spawnCadWorkerJson(spawnArgs, inputPath)
  return parsed as CadWorkerApplyLayerResult
}

export type RenderPlanOptions = {
  widthPx?: number
}

/** Rasterize full DXF plan to PNG (US-007 multimodal context). */
export async function renderPlanFromDxf(
  inputPath: string,
  outputPath: string,
  options?: RenderPlanOptions,
): Promise<CadWorkerRenderResult> {
  assertCadWorkerEnabled()

  const widthPx = options?.widthPx ?? 2048

  if (cadWorkerTransport() === 'http') {
    return httpRenderPng('/render-plan', 'render-plan', inputPath, outputPath, {
      width_px: String(widthPx),
    })
  }

  const spawnArgs = [
    'render-plan',
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--width-px',
    String(widthPx),
  ]
  const parsed = await spawnCadWorkerJson(spawnArgs, inputPath)
  return parsed as CadWorkerRenderResult
}
