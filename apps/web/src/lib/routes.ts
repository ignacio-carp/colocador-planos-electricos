/** Path helpers for client-side routing (no router library). */

export function jobDetailPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`
}

export function parseJobIdFromPath(pathname: string): string | null {
  const prefix = '/jobs/'
  if (!pathname.startsWith(prefix) || pathname === '/jobs/new') return null
  const rest = pathname.slice(prefix.length)
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}

export function isJobDetailPath(pathname: string): boolean {
  return parseJobIdFromPath(pathname) !== null
}
