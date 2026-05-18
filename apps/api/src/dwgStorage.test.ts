import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertAllowedDwgContentType,
  buildDwgObjectPath,
  objectPathMatchesJobAndOwner,
  parseDwgObjectPath,
} from './dwgStorage'

describe('dwgStorage', () => {
  const owner = '11111111-1111-4111-8111-111111111111'
  const job = '22222222-2222-4222-8222-222222222222'

  it('buildDwgObjectPath uses owner/job and .dwg suffix', () => {
    const p = buildDwgObjectPath(owner, job, '33333333-3333-4333-8333-333333333333')
    assert.equal(p, `${owner}/${job}/33333333-3333-4333-8333-333333333333.dwg`)
  })

  it('parseDwgObjectPath accepts valid triple', () => {
    const parsed = parseDwgObjectPath(`${owner}/${job}/33333333-3333-4333-8333-333333333333.dwg`)
    assert.ok(parsed)
    assert.equal(parsed?.ownerUserId, owner)
    assert.equal(parsed?.jobId, job)
  })

  it('objectPathMatchesJobAndOwner rejects wrong owner', () => {
    const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const p = buildDwgObjectPath(other, job, '33333333-3333-4333-8333-333333333333')
    assert.equal(objectPathMatchesJobAndOwner(p, owner, job), null)
  })

  it('assertAllowedDwgContentType accepts octet-stream', () => {
    assert.doesNotThrow(() => assertAllowedDwgContentType('application/octet-stream'))
  })

  it('assertAllowedDwgContentType rejects unknown', () => {
    assert.throws(() => assertAllowedDwgContentType('text/plain'))
  })
})
