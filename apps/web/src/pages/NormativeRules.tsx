import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import {
  NormativeRulesEditor,
  listNormativeSectionKeys,
  sectionLabel,
} from '../components/NormativeRulesEditor'
import { useAuth } from '../context/AuthContext'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

type NormativeRulesResponse = {
  active_version: string
  file_path: string
  source?: 'database' | 'filesystem'
  updated_at?: string | null
  manifest?: { active_version?: string }
  bundle: Record<string, unknown>
  error?: string
}

function bundlesEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function NormativeRules({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [activeVersion, setActiveVersion] = useState<string | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rulesSource, setRulesSource] = useState<'database' | 'filesystem' | null>(null)
  const [rulesUpdatedAt, setRulesUpdatedAt] = useState<string | null>(null)
  const [savedBundle, setSavedBundle] = useState<Record<string, unknown> | null>(null)
  const [draftBundle, setDraftBundle] = useState<Record<string, unknown> | null>(null)
  const [searchText, setSearchText] = useState('')
  const [focusSection, setFocusSection] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/api/normative-rules`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const body = (await res.json().catch(() => ({}))) as NormativeRulesResponse
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setSavedBundle(null)
        setDraftBundle(null)
        return
      }
      setActiveVersion(body.active_version)
      setFilePath(body.file_path)
      setRulesSource(body.source ?? null)
      setRulesUpdatedAt(body.updated_at ?? null)
      setSavedBundle(body.bundle)
      setDraftBundle(structuredClone(body.bundle))
    } catch {
      setError('No se pudieron cargar las reglas normativas.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => {
    if (!savedBundle || !draftBundle) return false
    return !bundlesEqual(savedBundle, draftBundle)
  }, [savedBundle, draftBundle])

  const sectionKeys = useMemo(
    () => (draftBundle ? listNormativeSectionKeys(draftBundle) : []),
    [draftBundle],
  )

  async function handleSave() {
    if (!session || !draftBundle) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`${apiBase}/api/normative-rules`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bundle: draftBundle }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        bundle?: Record<string, unknown>
        source?: 'database' | 'filesystem'
        error?: string
      }
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const next = body.bundle ?? draftBundle
      setSavedBundle(structuredClone(next))
      setDraftBundle(structuredClone(next))
      if (body.source) setRulesSource(body.source)
      setRulesUpdatedAt(new Date().toISOString())
      setMessage(
        body.source === 'database'
          ? 'Reglas guardadas en la base de datos. Los próximos análisis usarán esta versión.'
          : 'Reglas guardadas. Los próximos análisis usarán esta versión.',
      )
    } catch {
      setError('Error de red al guardar las reglas.')
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    if (!savedBundle) return
    setDraftBundle(structuredClone(savedBundle))
    setMessage(null)
    setError(null)
  }

  return (
    <AppShell activeNav="normative-rules" onNavigate={onNavigate} headerTitle="Reglas normativas">
      <div className="space-y-6">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-[var(--shadow-ambient)]">
          <h1 className="text-headline-md text-primary">Ruleset del sistema</h1>
          <p className="text-body-sm mt-2 max-w-3xl text-on-surface-variant">
            Tres secciones: estrategia de procesamiento, apliques y simbología, y reglas por
            habitación. Alcance actual: solo tomacorrientes por ambiente.
          </p>
          {activeVersion ? (
            <dl className="mt-4 grid gap-3 text-body-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-on-surface-variant">Versión activa</dt>
                <dd className="font-mono text-on-surface">{activeVersion}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant">Fuente</dt>
                <dd className="text-on-surface">
                  {rulesSource === 'database'
                    ? 'Base de datos (Supabase)'
                    : rulesSource === 'filesystem'
                      ? 'Archivo local'
                      : '—'}
                </dd>
              </div>
              {rulesUpdatedAt ? (
                <div>
                  <dt className="text-on-surface-variant">Última actualización</dt>
                  <dd className="text-on-surface">{new Date(rulesUpdatedAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {filePath ? (
                <div>
                  <dt className="text-on-surface-variant">Seed / archivo repo</dt>
                  <dd className="font-mono text-on-surface break-all">{filePath}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        {loading ? (
          <p className="text-on-surface-variant">Cargando reglas…</p>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-error-container px-4 py-3 text-body-sm text-on-error-container" role="alert">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="rounded-lg bg-primary-container px-4 py-3 text-body-sm text-on-primary-container" role="status">
            {message}
          </p>
        ) : null}

        {!loading && draftBundle ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[220px] flex-1 space-y-1">
                <span className="text-button text-on-surface">Buscar en el ruleset</span>
                <input
                  className="input-field pl-4"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setFocusSection(null)
                  }}
                  placeholder="Clave o valor…"
                  disabled={Boolean(focusSection)}
                />
              </label>
              <label className="min-w-[220px] space-y-1">
                <span className="text-button text-on-surface">Ir a sección</span>
                <select
                  className="input-field pl-4"
                  value={focusSection ?? ''}
                  onChange={(e) => {
                    const value = e.target.value
                    setFocusSection(value || null)
                    if (value) setSearchText('')
                  }}
                >
                  <option value="">Todas las secciones</option>
                  {sectionKeys.map((key) => (
                    <option key={key} value={key}>
                      {sectionLabel(key)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!dirty || saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  className="btn-secondary-outline"
                  disabled={!dirty || saving}
                  onClick={handleDiscard}
                >
                  Descartar
                </button>
                <button
                  type="button"
                  className="btn-secondary-outline"
                  disabled={saving}
                  onClick={() => void load()}
                >
                  <Icon name="refresh" className="text-sm" />
                  Recargar
                </button>
              </div>
            </div>

            {dirty ? (
              <p className="text-body-sm text-secondary">Hay cambios sin guardar.</p>
            ) : null}

            <NormativeRulesEditor
              bundle={draftBundle}
              onChange={setDraftBundle}
              searchText={searchText}
              focusSection={focusSection}
              onSectionFocus={(section) => {
                setFocusSection(section)
                if (section) setSearchText('')
              }}
            />
          </>
        ) : null}
      </div>
    </AppShell>
  )
}
