import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertAllowedDxfContentType,
  buildDxfObjectPath,
  objectPathMatchesJobAndOwner,
  parseDxfObjectPath,
} from './dxfStorage'

describe('dxfStorage', () => {
  const owner = '11111111-1111-4111-8111-111111111111'
  const job = '22222222-2222-4222-8222-222222222222'

  it('buildDxfObjectPath uses owner/job and .dxf suffix', () => {
    const p = buildDxfObjectPath(owner, job, '33333333-3333-4333-8333-333333333333')
    assert.equal(p, `${owner}/${job}/33333333-3333-4333-8333-333333333333.dxf`)
  })

  it('parseDxfObjectPath accepts valid triple', () => {
    const parsed = parseDxfObjectPath(`${owner}/${job}/33333333-3333-4333-8333-333333333333.dxf`)
    assert.ok(parsed)
    assert.equal(parsed?.ownerUserId, owner)
    assert.equal(parsed?.jobId, job)
  })

  it('objectPathMatchesJobAndOwner rejects wrong owner', () => {
    const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const p = buildDxfObjectPath(other, job, '33333333-3333-4333-8333-333333333333')
    assert.equal(objectPathMatchesJobAndOwner(p, owner, job), null)
  })

  it('assertAllowedDxfContentType accepts octet-stream', () => {
    assert.doesNotThrow(() => assertAllowedDxfContentType('application/octet-stream'))
  })

  it('assertAllowedDxfContentType rejects unknown', () => {
    assert.throws(() => assertAllowedDxfContentType('text/plain'))
  })
})
