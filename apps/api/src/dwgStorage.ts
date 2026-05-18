import { randomUUID } from 'node:crypto'

/** Private bucket: source .dwg per job (prefix `{owner}/{job}/`). */
export const DWG_INPUT_BUCKET = 'job-dwg-input'

/** Private bucket: processed .dwg per job (same path convention). */
export const DWG_OUTPUT_BUCKET = 'job-dwg-output'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Allowed Content-Type values for .dwg uploads (single validation layer). */
export const ALLOWED_DWG_CONTENT_TYPES = new Set([
  'application/acad',
  'image/vnd.dwg',
  'application/x-dwg',
  'application/dwg',
  'application/octet-stream',
])

export type ParsedDwgObjectPath = {
  ownerUserId: string
  jobId: string
  fileId: string
}

/**
 * Object path inside a job bucket: `{owner_user_id}/{job_id}/{file_id}.dwg`.
 * `file_id` is a new UUID per upload attempt.
 */
export function buildDwgObjectPath(ownerUserId: string, jobId: string, fileId: string = randomUUID()): string {
  return `${ownerUserId}/${jobId}/${fileId}.dwg`
}

export function assertUuid(label: string, value: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${label} must be a UUID`)
  }
}

/**
 * Validates declared MIME for .dwg (extension is enforced on the path).
 */
export function assertAllowedDwgContentType(contentType: string | undefined): void {
  if (!contentType || !contentType.trim()) {
    throw new Error('contentType is required for .dwg upload')
  }
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ALLOWED_DWG_CONTENT_TYPES.has(normalized)) {
    throw new Error(`Unsupported content type for .dwg: ${contentType}`)
  }
}

/** Parses and validates `{owner}/{job}/{uuid}.dwg`. */
export function parseDwgObjectPath(objectPath: string): ParsedDwgObjectPath | null {
  const trimmed = objectPath.trim()
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length !== 3) return null
  const [ownerUserId, jobId, file] = parts
  if (!file.toLowerCase().endsWith('.dwg')) return null
  const fileId = file.slice(0, -'.dwg'.length)
  if (!UUID_RE.test(ownerUserId) || !UUID_RE.test(jobId) || !UUID_RE.test(fileId)) return null
  return { ownerUserId, jobId, fileId }
}

export function objectPathMatchesJobAndOwner(
  objectPath: string,
  ownerUserId: string,
  jobId: string,
): ParsedDwgObjectPath | null {
  const parsed = parseDwgObjectPath(objectPath)
  if (!parsed) return null
  if (parsed.ownerUserId !== ownerUserId || parsed.jobId !== jobId) return null
  return parsed
}
