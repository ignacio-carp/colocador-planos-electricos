import { describe, expect, it } from 'vitest'
import { isAuthRequiredPath, resolveAuthRedirect } from './routeGuards'

describe('routeGuards', () => {
  it('requires auth for dashboard and jobs', () => {
    expect(isAuthRequiredPath('/dashboard')).toBe(true)
    expect(isAuthRequiredPath('/jobs')).toBe(true)
    expect(isAuthRequiredPath('/jobs/abc-123')).toBe(true)
    expect(isAuthRequiredPath('/jobs/new')).toBe(true)
    expect(isAuthRequiredPath('/')).toBe(false)
  })

  it('redirects legacy /jobs list to dashboard', () => {
    expect(
      resolveAuthRedirect({ pathname: '/jobs', hasSession: true, role: 'architect' }),
    ).toBe('/dashboard')
  })

  it('redirects unauthenticated users from protected routes', () => {
    expect(resolveAuthRedirect({ pathname: '/jobs', hasSession: false, role: null })).toBe('/login')
  })

  it('redirects authenticated users away from login', () => {
    expect(
      resolveAuthRedirect({ pathname: '/login', hasSession: true, role: 'architect' }),
    ).toBe('/dashboard')
  })

  it('denies architect access to invites (US-001 AC2 UI)', () => {
    expect(
      resolveAuthRedirect({ pathname: '/invites', hasSession: true, role: 'architect' }),
    ).toBe('/dashboard')
  })

  it('allows administrator to invites', () => {
    expect(
      resolveAuthRedirect({ pathname: '/invites', hasSession: true, role: 'administrator' }),
    ).toBeNull()
  })

  it('restricts /jobs/new to architects (US-005)', () => {
    expect(
      resolveAuthRedirect({ pathname: '/jobs/new', hasSession: true, role: 'administrator' }),
    ).toBe('/dashboard')
    expect(resolveAuthRedirect({ pathname: '/jobs/new', hasSession: true, role: 'architect' })).toBeNull()
  })
})
