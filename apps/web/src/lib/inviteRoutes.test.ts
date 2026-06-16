import { describe, expect, it } from 'vitest'
import { getLegacyInviteToken, isInviteOnboardingPath } from './inviteRoutes'

describe('inviteRoutes', () => {
  it('recognizes invite onboarding routes', () => {
    expect(isInviteOnboardingPath('/invite')).toBe(true)
    expect(isInviteOnboardingPath('/invite/set-password')).toBe(true)
    expect(isInviteOnboardingPath('/invite/profile')).toBe(true)
    expect(isInviteOnboardingPath('/login')).toBe(false)
  })

  it('reads legacy token query param', () => {
    expect(getLegacyInviteToken('?token=abc123')).toBe('abc123')
    expect(getLegacyInviteToken('')).toBeNull()
  })
})
