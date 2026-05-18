/**
 * T-10: centralized quota hooks (MVP: DWG size limit optional via env).
 */

export const QUOTA_EXCEEDED_CODE = 'QUOTA_EXCEEDED' as const

/** Documented MVP default when enabling limits (100 MiB). Not applied unless env is set. */
export const DOCUMENTED_DWG_MAX_BYTES_DEFAULT = 104_857_600

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

/** `QUOTA_DWG_MAX_BYTES`: empty or `0` = disabled; positive integer = max bytes. */
export function parseDwgMaxBytesFromEnv(
  rawEnv: string | undefined = process.env.QUOTA_DWG_MAX_BYTES,
): number | null {
  const raw = rawEnv?.trim()
  if (!raw || raw === '0') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.floor(n)
}

export function assertDwgUploadWithinQuota(params: {
  sizeBytes: number
  userId?: string
  jobId?: string
}): void {
  const maxBytes = parseDwgMaxBytesFromEnv()
  if (maxBytes === null) return

  const sizeBytes = Math.floor(params.sizeBytes)
  if (sizeBytes > maxBytes) {
    throw new QuotaExceededError(
      `DWG file exceeds maximum allowed size (${maxBytes} bytes)`,
      maxBytes,
      sizeBytes,
    )
  }
}

/** Stub for future per-user job/month limits; MVP always allows creation. */
export function checkJobCreationQuota(_userId: string): void {
  // no-op
}

/** Optional response headers for upload flows (documented, not required in MVP). */
export function dwgQuotaResponseHeaders(): Record<string, string> {
  const maxBytes = parseDwgMaxBytesFromEnv()
  if (maxBytes === null) {
    return { 'X-Quota-Dwg-Enabled': 'false' }
  }
  return {
    'X-Quota-Dwg-Enabled': 'true',
    'X-Quota-Dwg-Max-Bytes': String(maxBytes),
  }
}

export function applyDwgQuotaHeaders(setHeader: (name: string, value: string) => void): void {
  for (const [name, value] of Object.entries(dwgQuotaResponseHeaders())) {
    setHeader(name, value)
  }
}
