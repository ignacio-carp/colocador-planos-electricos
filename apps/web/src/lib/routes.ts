/** Path helpers for client-side routing (no router library). */

export function jobDetailPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`
}

export function workspacePath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}/workspace`
}

export function parseJobIdFromPath(pathname: string): string | null {
  const prefix = '/jobs/'
  if (!pathname.startsWith(prefix) || pathname === '/jobs/new') return null
  const rest = pathname.slice(prefix.length)
  if (!rest) return null
  const segment = rest.split('/')[0]
  if (!segment) return null
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function isJobDetailPath(pathname: string): boolean {
  return parseJobIdFromPath(pathname) !== null
}

export function isWorkspacePath(pathname: string): boolean {
  const prefix = '/jobs/'
  if (!pathname.startsWith(prefix)) return false
  const rest = pathname.slice(prefix.length)
  const parts = rest.split('/')
  return parts.length === 2 && parts[1] === 'workspace' && Boolean(parts[0])
}

export function parseWorkspaceJobId(pathname: string): string | null {
  if (!isWorkspacePath(pathname)) return null
  const prefix = '/jobs/'
  const rest = pathname.slice(prefix.length)
  try {
    return decodeURIComponent(rest.split('/')[0] ?? '')
  } catch {
    return null
  }
}
