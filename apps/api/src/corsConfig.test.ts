import assert from 'node:assert/strict'
import test from 'node:test'
import { getCorsOptions } from './corsConfig'

test('getCorsOptions allows listed origins', async () => {
  process.env.NODE_ENV = 'development'
  process.env.CORS_ORIGIN = 'http://localhost:5173,http://localhost:5174'
  const opts = getCorsOptions()
  const fn = opts.origin
  assert.equal(typeof fn, 'function')
  await new Promise<void>((resolve, reject) => {
    ;(fn as (o: string | undefined, cb: (e: Error | null, a?: boolean) => void) => void)(
      'http://localhost:5174',
      (err, allowed) => {
        try {
          assert.equal(err, null)
          assert.equal(allowed, true)
          resolve()
        } catch (e) {
          reject(e)
        }
      },
    )
  })
})

test('getCorsOptions allows any localhost port in development', async () => {
  process.env.NODE_ENV = 'development'
  process.env.CORS_ORIGIN = 'http://localhost:5173'
  await new Promise<void>((resolve, reject) => {
    const fn = getCorsOptions().origin
    if (typeof fn !== 'function') {
      reject(new Error('expected function'))
      return
    }
    fn('http://localhost:5179', (err, allowed) => {
      try {
        assert.equal(err, null)
        assert.equal(allowed, true)
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  })
})

test('getCorsOptions exposes the viewer DXF kind header', () => {
  assert.deepEqual(getCorsOptions().exposedHeaders, ['X-Dxf-Kind'])
})
