import type { LogLevel } from './logLevels'

/**
 * JSON logs for ingestion by Loki/Datadog/etc. Do not pass raw Authorization
 * or full signed URLs — use helpers below.
 */
export function logStructured(level: LogLevel, fields: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** Never log bearer tokens; use this if logging auth-related diagnostics. */
export function redactAuthorizationHeader(authorization: string | undefined): string {
  if (!authorization) return ''
  if (!authorization.toLowerCase().startsWith('bearer ')) return '[non-bearer]'
  return 'Bearer [REDACTED]'
}

/**
 * Avoid persisting full signed URLs (query often contains secrets).
 * Keeps origin + path without query when query looks like a signature.
 */
export function truncateSignedPath(urlOrPath: string): string {
  const q = urlOrPath.indexOf('?')
  if (q === -1) return urlOrPath
  const query = urlOrPath.slice(q + 1).toLowerCase()
  const looksSigned =
    query.includes('signature') ||
    query.includes('token=') ||
    query.includes('sig=') ||
    query.includes('x-amz-credential')
  if (looksSigned) return `${urlOrPath.slice(0, q)}?[REDACTED_QUERY]`
  return urlOrPath
}
