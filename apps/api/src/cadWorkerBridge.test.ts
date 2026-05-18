import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cadWorkerDisabled, inspectDwgFile } from './cadWorkerBridge'

describe('cadWorkerBridge S-02', () => {
  it('reports disabled when CAD_WORKER_DISABLED=true', async () => {
    const prev = process.env.CAD_WORKER_DISABLED
    process.env.CAD_WORKER_DISABLED = 'true'
    try {
      const result = await inspectDwgFile('/nonexistent.dwg')
      assert.equal(result.ok, false)
      assert.equal(result.code, 'CAD_WORKER_DISABLED')
    } finally {
      if (prev === undefined) delete process.env.CAD_WORKER_DISABLED
      else process.env.CAD_WORKER_DISABLED = prev
    }
  })

  it('cadWorkerDisabled helper', () => {
    const prev = process.env.CAD_WORKER_DISABLED
    process.env.CAD_WORKER_DISABLED = 'yes'
    try {
      assert.equal(cadWorkerDisabled(), true)
    } finally {
      if (prev === undefined) delete process.env.CAD_WORKER_DISABLED
      else process.env.CAD_WORKER_DISABLED = prev
    }
  })
})
