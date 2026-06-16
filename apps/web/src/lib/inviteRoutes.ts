export const INVITE_LANDING_PATH = '/invite'
export const INVITE_SET_PASSWORD_PATH = '/invite/set-password'
export const INVITE_PROFILE_PATH = '/invite/profile'

const INVITE_ONBOARDING_PATHS = new Set([
  INVITE_LANDING_PATH,
  INVITE_SET_PASSWORD_PATH,
  INVITE_PROFILE_PATH,
])

export function isInviteOnboardingPath(pathname: string): boolean {
  return INVITE_ONBOARDING_PATHS.has(pathname)
}

export function getLegacyInviteToken(search: string = window.location.search): string | null {
  const token = new URLSearchParams(search).get('token')?.trim()
  return token || null
}
