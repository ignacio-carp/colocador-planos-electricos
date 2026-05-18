import type { AppRole } from './roles'

const AUTH_REQUIRED = new Set(['/dashboard', '/jobs', '/invites', '/jobs/new'])

const ADMIN_ONLY = new Set(['/invites'])

const ARCHITECT_ONLY = new Set(['/jobs/new'])

export function isAuthRequiredPath(pathname: string): boolean {
  return AUTH_REQUIRED.has(pathname)
}

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY.has(pathname)
}

export function resolveAuthRedirect(params: {
  pathname: string
  hasSession: boolean
  role: AppRole | null
}): string | null {
  const { pathname, hasSession, role } = params

  if (!hasSession) {
    if (isAuthRequiredPath(pathname)) return '/login'
    if (pathname === '/reset-password') return null
    return null
  }

  if (pathname === '/login' || pathname === '/forgot-password') return '/dashboard'

  if (isAuthRequiredPath(pathname) && !role) return '/login'

  if (isAdminOnlyPath(pathname) && role !== 'administrator') return '/dashboard'

  if (ARCHITECT_ONLY.has(pathname) && role !== 'architect') return '/dashboard'

  return null
}
