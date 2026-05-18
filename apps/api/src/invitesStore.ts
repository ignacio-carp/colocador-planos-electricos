import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type InvitationStatus = 'pending' | 'accepted' | 'revoked'

export type InvitationRow = {
  id: string
  email_normalized: string
  token_hash: string
  invited_by_user_id: string
  status: InvitationStatus
  created_at_ms: number
  expires_at_ms: number
  accepted_at_ms?: number
}

const memoryInvitations: InvitationRow[] = []

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function useMemoryStore(): boolean {
  if (process.env.INVITATIONS_USE_MEMORY === '1') return true
  return !isStorageConfigured()
}

function rowFromDb(data: Record<string, unknown>): InvitationRow {
  return {
    id: String(data.id),
    email_normalized: String(data.email_normalized),
    token_hash: String(data.token_hash),
    invited_by_user_id: String(data.invited_by_user_id),
    status: data.status as InvitationStatus,
    created_at_ms: new Date(String(data.created_at)).getTime(),
    expires_at_ms: new Date(String(data.expires_at)).getTime(),
    accepted_at_ms: data.accepted_at ? new Date(String(data.accepted_at)).getTime() : undefined,
  }
}

function isPending(row: InvitationRow, now = Date.now()): boolean {
  return row.status === 'pending' && row.expires_at_ms > now
}

export async function findPendingInviteByEmail(email: string): Promise<InvitationRow | undefined> {
  const key = normalizeEmail(email)
  const now = Date.now()
  if (useMemoryStore()) {
    return memoryInvitations.find((i) => i.email_normalized === key && isPending(i, now))
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('invitations')
    .select('*')
    .eq('email_normalized', key)
    .eq('status', 'pending')
    .gt('expires_at', new Date(now).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowFromDb(data as Record<string, unknown>) : undefined
}

export async function findInviteByRawToken(token: string): Promise<InvitationRow | undefined> {
  const h = tokenHash(token)
  const now = Date.now()
  if (useMemoryStore()) {
    return memoryInvitations.find((i) => {
      if (i.token_hash.length !== h.length) return false
      try {
        return timingSafeEqual(Buffer.from(i.token_hash, 'hex'), Buffer.from(h, 'hex')) && isPending(i, now)
      } catch {
        return false
      }
    })
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('invitations')
    .select('*')
    .eq('token_hash', h)
    .eq('status', 'pending')
    .gt('expires_at', new Date(now).toISOString())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowFromDb(data as Record<string, unknown>) : undefined
}

export async function createInvitationRecord(params: {
  email: string
  token: string
  invitedByUserId: string
  ttlMs: number
}): Promise<InvitationRow> {
  const now = Date.now()
  const expiresAt = now + params.ttlMs
  const row: InvitationRow = {
    id: randomUUID(),
    email_normalized: normalizeEmail(params.email),
    token_hash: tokenHash(params.token),
    invited_by_user_id: params.invitedByUserId,
    status: 'pending',
    created_at_ms: now,
    expires_at_ms: expiresAt,
  }
  if (useMemoryStore()) {
    memoryInvitations.push(row)
    return row
  }
  const sb = getSupabaseServiceRole()
  const { data, error } = await sb
    .from('invitations')
    .insert({
      id: row.id,
      email_normalized: row.email_normalized,
      token_hash: row.token_hash,
      invited_by_user_id: row.invited_by_user_id,
      status: 'pending',
      expires_at: new Date(expiresAt).toISOString(),
    })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? 'insert invitation failed')
  return rowFromDb(data as Record<string, unknown>)
}

export async function removeInvitationById(id: string): Promise<void> {
  if (useMemoryStore()) {
    const idx = memoryInvitations.findIndex((i) => i.id === id)
    if (idx >= 0) memoryInvitations.splice(idx, 1)
    return
  }
  const sb = getSupabaseServiceRole()
  const { error } = await sb.from('invitations').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markInvitationAccepted(id: string): Promise<void> {
  const now = Date.now()
  if (useMemoryStore()) {
    const row = memoryInvitations.find((i) => i.id === id)
    if (row) {
      row.status = 'accepted'
      row.accepted_at_ms = now
    }
    return
  }
  const sb = getSupabaseServiceRole()
  const { error } = await sb
    .from('invitations')
    .update({ status: 'accepted', accepted_at: new Date(now).toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Test helper: reset in-memory invitations. */
export function clearInvitationsForTests(): void {
  memoryInvitations.length = 0
}

export function getInvitationsMemorySnapshot(): readonly InvitationRow[] {
  return memoryInvitations
}

export async function insertInvitationForTests(
  sb: SupabaseClient,
  row: Omit<InvitationRow, 'created_at_ms' | 'accepted_at_ms'> & { created_at_ms?: number },
): Promise<void> {
  const created = row.created_at_ms ?? Date.now()
  await sb.from('invitations').insert({
    id: row.id,
    email_normalized: row.email_normalized,
    token_hash: row.token_hash,
    invited_by_user_id: row.invited_by_user_id,
    status: row.status,
    expires_at: new Date(row.expires_at_ms).toISOString(),
    created_at: new Date(created).toISOString(),
  })
}
