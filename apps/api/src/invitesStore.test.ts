import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearInvitationsForTests,
  createInvitationRecord,
  findInviteByRawToken,
  findPendingInviteByEmail,
  generateInviteToken,
  removeInvitationById,
  tokenHash,
} from './invitesStore'

test('invitations memory store: create, find by email and token', async () => {
  process.env.INVITATIONS_USE_MEMORY = '1'
  clearInvitationsForTests()
  const token = generateInviteToken()
  const row = await createInvitationRecord({
    email: 'Arch@Example.com',
    token,
    invitedByUserId: 'admin-uuid',
    ttlMs: 60_000,
  })
  assert.equal(row.email_normalized, 'arch@example.com')
  const pending = await findPendingInviteByEmail('arch@example.com')
  assert.ok(pending)
  assert.equal(pending?.id, row.id)
  const byToken = await findInviteByRawToken(token)
  assert.equal(byToken?.id, row.id)
  await removeInvitationById(row.id)
  assert.equal(await findPendingInviteByEmail('arch@example.com'), undefined)
})

test('findPendingInviteByEmail ignores expired invitations', async () => {
  process.env.INVITATIONS_USE_MEMORY = '1'
  clearInvitationsForTests()
  const token = generateInviteToken()
  await createInvitationRecord({
    email: 'expired@example.com',
    token,
    invitedByUserId: 'admin-uuid',
    ttlMs: -1,
  })
  assert.equal(await findPendingInviteByEmail('expired@example.com'), undefined)
  assert.equal(await findInviteByRawToken(token), undefined)
})

test('tokenHash is deterministic', () => {
  assert.equal(tokenHash('abc'), tokenHash('abc'))
  assert.notEqual(tokenHash('abc'), tokenHash('abd'))
})
