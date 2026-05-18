import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAcceptInvitationInput } from './inviteAccept'

test('validateAcceptInvitationInput rejects short password and name', () => {
  assert.equal(
    validateAcceptInvitationInput({ token: 't', password: 'short', fullName: 'A' }),
    'fullName must be at least 2 characters',
  )
  assert.equal(
    validateAcceptInvitationInput({ token: 't', password: '1234567', fullName: 'Ana Architect' }),
    'password must be at least 8 characters',
  )
  assert.equal(validateAcceptInvitationInput({ token: '', password: '12345678', fullName: 'Ana' }), 'token is required')
})

test('validateAcceptInvitationInput accepts valid payload', () => {
  assert.equal(
    validateAcceptInvitationInput({
      token: 'abc',
      password: 'secure-pass',
      fullName: 'Ana Architect',
    }),
    null,
  )
})
