import React, { useEffect, useState } from 'react'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function getTokenFromLocation(): string {
  const params = new URLSearchParams(window.location.search)
  return params.get('token')?.trim() ?? ''
}

export default function InviteAccept({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'bad'>('idle')

  useEffect(() => {
    const token = getTokenFromLocation()
    if (!token) {
      setStatus('bad')
      return
    }
    let cancelled = false
    setStatus('loading')
    void (async () => {
      const res = await fetch(`${apiBase}/api/invites/verify?token=${encodeURIComponent(token)}`)
      if (cancelled) return
      setStatus(res.ok ? 'ok' : 'bad')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Invitación</h1>
      {status === 'loading' ? <p className="text-sm text-slate-600">Verificando enlace…</p> : null}
      {status === 'ok' ? (
        <p className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          El enlace de invitación es válido. El flujo de registro (US-002) se conectará aquí.
        </p>
      ) : null}
      {status === 'bad' ? (
        <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Enlace inválido o caducado. Solicita una nueva invitación al administrador.
        </p>
      ) : null}
      <button type="button" className="text-sm text-slate-900 underline" onClick={() => onNavigate('/')}>
        Ir al inicio
      </button>
    </div>
  )
}
