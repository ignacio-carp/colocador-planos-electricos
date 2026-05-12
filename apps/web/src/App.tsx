import React, { useEffect, useMemo } from 'react'
import Health from './pages/Health'

export default function App() {
  const path = useMemo(() => window.location.pathname, [])

  useEffect(() => {
    if (path === '/healthz') document.title = 'healthz'
  }, [path])

  if (path === '/healthz') {
    return <Health />
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-slate-900">VanguardIA</h1>
        <p className="mt-4 text-slate-700">
          MVP skeleton levantable. Healthcheck:{' '}
          <code className="rounded bg-slate-200 px-2 py-1">/healthz</code>
        </p>
      </div>
    </main>
  )
}
