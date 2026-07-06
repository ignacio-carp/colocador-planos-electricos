import React, { useMemo } from 'react'
import { JsonEditor } from 'json-edit-react'

const SECTION_LABELS: Record<string, string> = {
  version: 'Versión',
  title: 'Título',
  description: 'Descripción',
  normative_basis: 'Base normativa',
  room_type_taxonomy: 'Tipología de ambientes',
  pipeline: 'Etapas del motor',
  normative: 'Reglas normativas (PMU, grados)',
  placement: 'Ubicación espacial',
  symbology: 'Simbología',
  defaults: 'Valores por defecto',
  validation: 'Validaciones',
  rules: 'Reglas (formato legacy)',
  design_decisions: 'Decisiones de diseño',
  assumptions: 'Supuestos',
  input_contract: 'Contrato de entrada',
  output_contract: 'Contrato de salida',
}

/**
 * Structural keys the editor must not let users rename, retype, or delete:
 * the US-008 prompt and merge logic reference them (rule_ids, PMU stages, etc.).
 */
const PROTECTED_KEYS = new Set(['version', 'id', 'stage'])

function isProtectedKey(key: string | number | undefined): boolean {
  return typeof key === 'string' && PROTECTED_KEYS.has(key)
}

type NormativeRulesEditorProps = {
  bundle: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  searchText: string
  focusSection: string | null
  onSectionFocus?: (section: string | null) => void
}

export function NormativeRulesEditor({
  bundle,
  onChange,
  searchText,
  focusSection,
  onSectionFocus,
}: NormativeRulesEditorProps) {
  const effectiveSearch = focusSection ?? searchText

  const sectionKeys = useMemo(
    () => Object.keys(bundle).filter((key) => key !== 'version'),
    [bundle],
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2 lg:sticky lg:top-28 lg:self-start">
        <p className="text-technical-label text-on-surface-variant tracking-wider uppercase">
          Secciones
        </p>
        <ul className="space-y-1 text-body-sm">
          {sectionKeys.map((key) => {
            const active = focusSection === key
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSectionFocus?.(active ? null : key)}
                  className={`block w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    active
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:bg-surface-container-low'
                  }`}
                >
                  <span className="font-mono text-xs">{key}</span>
                  <span className="mt-0.5 block text-body-sm">
                    {SECTION_LABELS[key] ?? 'Campo del bundle'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="text-body-sm text-on-surface-variant px-1">
          Doble clic en un valor para editarlo. Las secciones y los identificadores (
          <span className="font-mono text-xs">version</span>,{' '}
          <span className="font-mono text-xs">id</span>,{' '}
          <span className="font-mono text-xs">stage</span>) están protegidos y no se pueden
          borrar ni renombrar.
        </p>
      </aside>

      <div className="min-w-0 overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-[var(--shadow-ambient)]">
        <JsonEditor
          data={bundle}
          setData={(next) => {
            if (next && typeof next === 'object' && !Array.isArray(next)) {
              onChange(next as Record<string, unknown>)
            }
          }}
          rootName="rules"
          collapse={2}
          searchText={effectiveSearch || undefined}
          searchFilter={focusSection ? 'key' : 'all'}
          restrictEdit={({ path, key }) =>
            (path.length === 1 && path[0] === 'version') || isProtectedKey(key)
          }
          restrictDelete={({ path, key }) => path.length <= 1 || isProtectedKey(key)}
          restrictAdd={({ path }) => path.length === 0}
          restrictTypeSelection
          restrictDrag
          enableClipboard
          showErrorMessages
          className="normative-rules-json-editor text-sm"
        />
      </div>
    </div>
  )
}

export function listNormativeSectionKeys(bundle: Record<string, unknown>): string[] {
  return Object.keys(bundle).filter((key) => key !== 'version')
}

export function sectionLabel(key: string): string {
  return SECTION_LABELS[key] ?? key
}
