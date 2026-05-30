import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cadWorkerBaseUrl,
  cadWorkerDisabled,
  cadWorkerTransport,
  inspectDxfFile,
} from './cadWorkerBridge'

describe('cadWorkerBridge S-02', () => {
  it('reports disabled when CAD_WORKER_DISABLED=true', async () => {
    const prev = process.env.CAD_WORKER_DISABLED
    process.env.CAD_WORKER_DISABLED = 'true'
    try {
      const result = await inspectDxfFile('/nonexistent.dxf')
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

  it('uses http transport when CAD_WORKER_URL is set', () => {
    const prevUrl = process.env.CAD_WORKER_URL
    const prevDisabled = process.env.CAD_WORKER_DISABLED
    delete process.env.CAD_WORKER_DISABLED
    process.env.CAD_WORKER_URL = 'https://cad-worker.example.railway.app/'
    try {
      assert.equal(cadWorkerBaseUrl(), 'https://cad-worker.example.railway.app')
      assert.equal(cadWorkerTransport(), 'http')
    } finally {
      if (prevUrl === undefined) delete process.env.CAD_WORKER_URL
      else process.env.CAD_WORKER_URL = prevUrl
      if (prevDisabled === undefined) delete process.env.CAD_WORKER_DISABLED
      else process.env.CAD_WORKER_DISABLED = prevDisabled
    }
  })

  it('defaults to spawn transport without CAD_WORKER_URL', () => {
    const prevUrl = process.env.CAD_WORKER_URL
    const prevDisabled = process.env.CAD_WORKER_DISABLED
    delete process.env.CAD_WORKER_URL
    delete process.env.CAD_WORKER_DISABLED
    try {
      assert.equal(cadWorkerTransport(), 'spawn')
    } finally {
      if (prevUrl === undefined) delete process.env.CAD_WORKER_URL
      else process.env.CAD_WORKER_URL = prevUrl
      if (prevDisabled === undefined) delete process.env.CAD_WORKER_DISABLED
      else process.env.CAD_WORKER_DISABLED = prevDisabled
    }
  })
})
