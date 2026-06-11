import React from 'react'
import { isElectricalLayerName } from './dxfLayerUtils'

export type LayerSuggestions = {
  layers: string[]
  suggested_visible: string[]
  hidden_by_default: string[]
  electrical_layers: string[]
  strategy: string
}

export type DxfLayerState = {
  name: string
  visible: boolean
  suggested: boolean
  electrical: boolean
}

type Props = {
  layers: DxfLayerState[]
  onToggle: (name: string, visible: boolean) => void
  onShowSuggested: () => void
  onShowAll: () => void
  onHideAll: () => void
}

export default function DxfLayerPanel({
  layers,
  onToggle,
  onShowSuggested,
  onShowAll,
  onHideAll,
}: Props) {
  if (layers.length === 0) {
    return (
      <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-technical-label text-on-surface-variant">
        Sin capas cargadas
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="border-b border-outline-variant px-3 py-2">
        <div className="text-technical-label font-bold uppercase text-on-surface-variant">Capas</div>
        <div className="mt-2 flex flex-wrap gap-1">
          <button type="button" className="btn-secondary-outline px-2 py-1 text-xs" onClick={onShowSuggested}>
            Sugeridas
          </button>
          <button type="button" className="btn-secondary-outline px-2 py-1 text-xs" onClick={onShowAll}>
            Todas
          </button>
          <button type="button" className="btn-secondary-outline px-2 py-1 text-xs" onClick={onHideAll}>
            Ninguna
          </button>
        </div>
      </div>
      <ul className="max-h-[360px] flex-1 overflow-y-auto px-2 py-2 text-body-sm">
        {layers.map((layer) => (
          <li key={layer.name} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-container-high">
            <input
              id={`layer-${layer.name}`}
              type="checkbox"
              checked={layer.visible}
              onChange={(e) => onToggle(layer.name, e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <label
              htmlFor={`layer-${layer.name}`}
              className={`flex-1 cursor-pointer truncate ${
                layer.electrical
                  ? 'font-semibold text-primary'
                  : layer.suggested
                    ? 'text-on-surface'
                    : 'text-on-surface-variant'
              }`}
              title={layer.name}
            >
              {layer.name}
              {layer.suggested && !layer.electrical ? (
                <span className="ml-1 text-technical-label text-outline">· sugerida</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
      <div className="border-t border-outline-variant px-3 py-2 text-technical-label text-outline">
        {layers.filter((l) => l.visible).length}/{layers.length} visibles
        {layers.some((l) => isElectricalLayerName(l.name)) ? ' · capa eléctrica resaltada' : ''}
      </div>
    </div>
  )
}
