import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCompleteInvitationInput } from './inviteComplete'

test('validateCompleteInvitationInput rejects short name', () => {
  assert.equal(
    validateCompleteInvitationInput({
      userId: 'uuid',
      email: 'a@b.com',
      fullName: 'A',
    }),
    'fullName must be at least 2 characters',
  )
})

test('validateCompleteInvitationInput accepts valid payload', () => {
  assert.equal(
    validateCompleteInvitationInput({
      userId: 'uuid',
      email: 'a@b.com',
      fullName: 'Ana Architect',
    }),
    null,
  )
})
