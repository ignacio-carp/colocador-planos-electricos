import type { LayerSuggestions } from './DxfLayerPanel'

export const ELECTRICAL_LAYER_NAMES = ['Cambre_Electrical', 'INSTALACION_ELECTRICA'] as const

export function isElectricalLayerName(name: string): boolean {
  const n = name.trim().toLowerCase()
  return ELECTRICAL_LAYER_NAMES.some((layer) => layer.toLowerCase() === n)
}

export function buildInitialLayerVisibility(
  layerNames: string[],
  suggestions: LayerSuggestions | null | undefined,
): Record<string, boolean> {
  const suggested = new Set(suggestions?.suggested_visible ?? [])
  const out: Record<string, boolean> = {}
  for (const name of layerNames) {
    if (suggested.size > 0) {
      out[name] = suggested.has(name)
    } else {
      const lower = name.toLowerCase()
      out[name] =
        !lower.includes('defpoints') &&
        !lower.includes('dim') &&
        !lower.includes('viewport')
    }
  }
  for (const electrical of suggestions?.electrical_layers ?? []) {
    if (layerNames.includes(electrical)) out[electrical] = true
  }
  return out
}
