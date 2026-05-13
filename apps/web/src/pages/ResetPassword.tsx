import React, { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'

/**
 * Tras el enlace de recuperación de Supabase, la sesión queda disponible en el cliente;
 * aquí el usuario define una contraseña nueva.
 */
export default function ResetPassword({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => {
      setReady(!!data.session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setReady(!!session)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const supabase = getSupabaseBrowserClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setPending(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    onNavigate('/login')
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-600">
        <p>Abre esta página desde el enlace del correo de recuperación.</p>
        <button type="button" className="mt-4 text-slate-900 underline" onClick={() => onNavigate('/login')}>
          Ir al login
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Nueva contraseña</h1>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="new-password">
            Contraseña nueva
          </label>
          <input
            id="new-password"
            type="password"
            required
            minLength={6}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  )
}
