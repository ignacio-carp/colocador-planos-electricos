import { createHash, randomBytes, randomUUID } from 'node:crypto'

export type InvitationRow = {
  id: string
  email_normalized: string
  token_hash: string
  invited_by_user_id: string
  created_at_ms: number
  expires_at_ms: number
}

const invitations: InvitationRow[] = []

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function findPendingInviteByEmail(email: string): InvitationRow | undefined {
  const key = normalizeEmail(email)
  const now = Date.now()
  return invitations.find((i) => i.email_normalized === key && i.expires_at_ms > now)
}

export function findInviteByRawToken(token: string): InvitationRow | undefined {
  const h = tokenHash(token)
  const now = Date.now()
  return invitations.find((i) => i.token_hash === h && i.expires_at_ms > now)
}

export function createInvitationRecord(params: {
  email: string
  token: string
  invitedByUserId: string
  ttlMs: number
}): InvitationRow {
  const now = Date.now()
  const row: InvitationRow = {
    id: randomUUID(),
    email_normalized: normalizeEmail(params.email),
    token_hash: tokenHash(params.token),
    invited_by_user_id: params.invitedByUserId,
    created_at_ms: now,
    expires_at_ms: now + params.ttlMs,
  }
  invitations.push(row)
  return row
}

export function removeInvitationById(id: string): void {
  const idx = invitations.findIndex((i) => i.id === id)
  if (idx >= 0) invitations.splice(idx, 1)
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}
