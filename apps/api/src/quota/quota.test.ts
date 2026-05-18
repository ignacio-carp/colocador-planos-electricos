import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertDwgUploadWithinQuota,
  checkJobCreationQuota,
  parseDwgMaxBytesFromEnv,
  QuotaExceededError,
  QUOTA_EXCEEDED_CODE,
} from './index'

describe('quota', () => {
  describe('parseDwgMaxBytesFromEnv', () => {
    it('treats empty and zero as disabled', () => {
      assert.equal(parseDwgMaxBytesFromEnv(''), null)
      assert.equal(parseDwgMaxBytesFromEnv('0'), null)
      assert.equal(parseDwgMaxBytesFromEnv(undefined), null)
    })

    it('parses positive integers', () => {
      assert.equal(parseDwgMaxBytesFromEnv('1024'), 1024)
      assert.equal(parseDwgMaxBytesFromEnv(' 2048 '), 2048)
    })

    it('ignores invalid values', () => {
      assert.equal(parseDwgMaxBytesFromEnv('abc'), null)
      assert.equal(parseDwgMaxBytesFromEnv('-1'), null)
    })
  })

  describe('assertDwgUploadWithinQuota', () => {
    it('allows any size when quota is disabled', () => {
      const prev = process.env.QUOTA_DWG_MAX_BYTES
      delete process.env.QUOTA_DWG_MAX_BYTES
      try {
        assert.doesNotThrow(() => assertDwgUploadWithinQuota({ sizeBytes: 999_999_999 }))
      } finally {
        if (prev === undefined) delete process.env.QUOTA_DWG_MAX_BYTES
        else process.env.QUOTA_DWG_MAX_BYTES = prev
      }
    })

    it('allows size at or under limit when enabled', () => {
      const prev = process.env.QUOTA_DWG_MAX_BYTES
      process.env.QUOTA_DWG_MAX_BYTES = '1000'
      try {
        assert.doesNotThrow(() => assertDwgUploadWithinQuota({ sizeBytes: 1000 }))
        assert.doesNotThrow(() => assertDwgUploadWithinQuota({ sizeBytes: 500 }))
      } finally {
        if (prev === undefined) delete process.env.QUOTA_DWG_MAX_BYTES
        else process.env.QUOTA_DWG_MAX_BYTES = prev
      }
    })

    it('rejects over limit with QUOTA_EXCEEDED', () => {
      const prev = process.env.QUOTA_DWG_MAX_BYTES
      process.env.QUOTA_DWG_MAX_BYTES = '100'
      try {
        assert.throws(
          () => assertDwgUploadWithinQuota({ sizeBytes: 101 }),
          (e: unknown) => {
            assert.ok(e instanceof QuotaExceededError)
            assert.equal(e.code, QUOTA_EXCEEDED_CODE)
            assert.equal(e.maxBytes, 100)
            assert.equal(e.sizeBytes, 101)
            return true
          },
        )
      } finally {
        if (prev === undefined) delete process.env.QUOTA_DWG_MAX_BYTES
        else process.env.QUOTA_DWG_MAX_BYTES = prev
      }
    })
  })

  describe('checkJobCreationQuota', () => {
    it('does not throw (MVP stub)', () => {
      assert.doesNotThrow(() => checkJobCreationQuota('user-1'))
    })
  })
})
