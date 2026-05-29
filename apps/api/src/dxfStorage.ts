import { randomUUID } from 'node:crypto'

/** Private bucket: source .dxf per job (prefix `{owner}/{job}/`). */
export const DXF_INPUT_BUCKET = 'job-dxf-input'

/** Private bucket: processed .dxf per job (same path convention). */
export const DXF_OUTPUT_BUCKET = 'job-dxf-output'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Allowed Content-Type values for .dxf uploads (single validation layer). */
export const ALLOWED_DXF_CONTENT_TYPES = new Set([
  'application/dxf',
  'application/x-dxf',
  'image/vnd.dxf',
  'application/octet-stream',
])

export type ParsedDxfObjectPath = {
  ownerUserId: string
  jobId: string
  fileId: string
}

/**
 * Object path inside a job bucket: `{owner_user_id}/{job_id}/{file_id}.dxf`.
 * `file_id` is a new UUID per upload attempt.
 */
export function buildDxfObjectPath(ownerUserId: string, jobId: string, fileId: string = randomUUID()): string {
  return `${ownerUserId}/${jobId}/${fileId}.dxf`
}

export function assertUuid(label: string, value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`)
  }
}

/**
 * Validates declared MIME for .dxf (extension is enforced on the path).
 */
export function assertAllowedDxfContentType(contentType: string | undefined): void {
  if (!contentType || !contentType.trim()) {
    throw new Error('contentType is required for .dxf upload')
  }
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ALLOWED_DXF_CONTENT_TYPES.has(normalized)) {
    throw new Error(`Unsupported content type for .dxf: ${contentType}`)
  }
}

/** Parses and validates `{owner}/{job}/{uuid}.dxf`. */
export function parseDxfObjectPath(objectPath: string): ParsedDxfObjectPath | null {
  const trimmed = objectPath.trim()
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length !== 3) return null
  const [ownerUserId, jobId, file] = parts
  if (!file.toLowerCase().endsWith('.dxf')) return null
  const fileId = file.slice(0, -'.dxf'.length)
  if (!UUID_RE.test(ownerUserId) || !UUID_RE.test(jobId) || !UUID_RE.test(fileId)) return null
  return { ownerUserId, jobId, fileId }
}

export function objectPathMatchesJobAndOwner(
  objectPath: string,
  ownerUserId: string,
  jobId: string,
): ParsedDxfObjectPath | null {
  const parsed = parseDxfObjectPath(objectPath)
  if (!parsed) return null
  if (parsed.ownerUserId !== ownerUserId || parsed.jobId !== jobId) return null
  return parsed
}
