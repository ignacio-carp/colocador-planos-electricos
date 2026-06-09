import type { getAppRole } from './roles'

/** Returns true if user is allowed to read render-data for the given job. */
export function assertJobAccess(
  userId: string,
  role: ReturnType<typeof getAppRole>,
  job: { owner_user_id: string; [key: string]: unknown },
): boolean {
  if (!role) return false
  if (role === 'administrator') return true
  return job.owner_user_id === userId
}
