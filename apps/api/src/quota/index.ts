/**
 * T-10: centralized quota hooks (MVP: DXF size limit optional via env).
 */

export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED' as const

/** Documented MVP default when enabling limits (100 MiB). Not applied unless env is set. */
export const DOCUMENTED_DXF_MAX_BYTES_DEFAULT = 104_857_600

export class QuotaExceededError extends Error {
  readonly code = QUOTA_EXCEEDED_CODE

  constructor(
    message: string,
    readonly maxBytes: number,
    readonly sizeBytes: number,
  ) {
    super(message)
    this.name = 'QuotaExceededError'
  }
}

function quotaEnvRaw(): string | undefined {
  return process.env.QUOTA_DXF_MAX_BYTES ?? process.env.QUOTA_DWG_MAX_BYTES
}

/** `QUOTA_DXF_MAX_BYTES` (or legacy `QUOTA_DWG_MAX_BYTES`): empty or `0` = disabled. */
export function parseDxfMaxBytesFromEnv(rawEnv: string | undefined = quotaEnvRaw()): number | null {
  const raw = rawEnv?.trim()
  if (!raw || raw === '0') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.floor(n)
}

export function assertDxfUploadWithinQuota(params: {
  sizeBytes: number
  userId?: string
  jobId?: string
}): void {
  const maxBytes = parseDxfMaxBytesFromEnv()
  if (maxBytes === null) return

  const sizeBytes = Math.floor(params.sizeBytes)
  if (sizeBytes > maxBytes) {
    throw new QuotaExceededError(
      `DXF file exceeds maximum allowed size (${maxBytes} bytes)`,
      maxBytes,
      sizeBytes,
    )
  }
}

/** Stub for future per-user job/month limits; MVP always allows creation. */
export function checkJobCreationQuota(_userId: string): void {
  // no-op
}

export function dxfQuotaResponseHeaders(): Record<string, string> {
  const maxBytes = parseDxfMaxBytesFromEnv()
  if (maxBytes === null) {
    return { 'X-Quota-Dxf-Enabled': 'false' }
  }
  return {
    'X-Quota-Dxf-Enabled': 'true',
    'X-Quota-Dxf-Max-Bytes': String(maxBytes),
  }
}

export function applyDxfQuotaHeaders(setHeader: (name: string, value: string) => void): void {
  for (const [name, value] of Object.entries(dxfQuotaResponseHeaders())) {
    setHeader(name, value)
  }
}

/** @deprecated Use DXF-named exports */
export const DOCUMENTED_DWG_MAX_BYTES_DEFAULT = DOCUMENTED_DXF_MAX_BYTES_DEFAULT
export const parseDwgMaxBytesFromEnv = parseDxfMaxBytesFromEnv
export const assertDwgUploadWithinQuota = assertDxfUploadWithinQuota
export const dwgQuotaResponseHeaders = dxfQuotaResponseHeaders
export const applyDwgQuotaHeaders = applyDxfQuotaHeaders
