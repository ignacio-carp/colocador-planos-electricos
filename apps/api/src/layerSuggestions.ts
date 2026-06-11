/** Layer names we always keep visible when present (product output layers). */
export const ELECTRICAL_LAYER_NAMES = ['Cambre_Electrical', 'INSTALACION_ELECTRICA'] as const

const ARCHITECTURAL_INCLUDE = [
  'wall',
  'pared',
  'muro',
  'arq',
  'arch',
  'a-wall',
  'a-door',
  'a-flor',
  'a-floor',
  'door',
  'puerta',
  'ventana',
  'window',
  'floor',
  'slab',
  'techo',
  'ceiling',
  'room',
  'estancia',
  'partition',
  'hatch',
  'mobili',
  'furnitur',
  'equip',
  'plano',
  'base',
]

const NOISE_EXCLUDE = [
  'defpoints',
  'dim',
  'cota',
  'dimension',
  'annot',
  'text',
  'note',
  'grid',
  'viewport',
  'no plot',
  'noplot',
  'xref',
]

function normalizeLayerName(name: string): string {
  return name.trim().toLowerCase()
}

export function isElectricalLayer(name: string): boolean {
  const n = normalizeLayerName(name)
  return ELECTRICAL_LAYER_NAMES.some((layer) => normalizeLayerName(layer) === n)
}

export function isNoiseLayer(name: string): boolean {
  const n = normalizeLayerName(name)
  return NOISE_EXCLUDE.some((token) => n.includes(token))
}

export function isArchitecturalLayerCandidate(name: string): boolean {
  const n = normalizeLayerName(name)
  if (isElectricalLayer(name) || isNoiseLayer(name)) return false
  return ARCHITECTURAL_INCLUDE.some((token) => n.includes(token))
}

export type LayerSuggestionResult = {
  layers: string[]
  suggested_visible: string[]
  hidden_by_default: string[]
  electrical_layers: string[]
  strategy: 'heuristic_v1'
}

/**
 * Suggests which DXF layers to show for 2D architectural viewing (ShareCAD-style).
 * Uses cad-worker inspect layer list + name heuristics (no LLM round-trip).
 */
export function suggestLayersFromInspect(
  inspect: { layers?: unknown } | undefined,
): LayerSuggestionResult {
  const raw = inspect?.layers
  const layers = Array.isArray(raw)
    ? raw.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : []

  const electrical_layers = layers.filter(isElectricalLayer)
  const suggested_visible = layers.filter(
    (name) => isArchitecturalLayerCandidate(name) || isElectricalLayer(name),
  )

  const hidden_by_default = layers.filter(
    (name) => !suggested_visible.includes(name) && (isNoiseLayer(name) || !isArchitecturalLayerCandidate(name)),
  )

  // If heuristics found nothing, show everything except obvious noise + keep electrical.
  const effectiveSuggested =
    suggested_visible.length > 0
      ? [...new Set([...suggested_visible, ...electrical_layers])]
      : layers.filter((name) => !isNoiseLayer(name))

  return {
    layers,
    suggested_visible: effectiveSuggested,
    hidden_by_default: layers.filter((l) => !effectiveSuggested.includes(l)),
    electrical_layers,
    strategy: 'heuristic_v1',
  }
}
