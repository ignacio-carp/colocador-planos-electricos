/** Trim CAD payloads before sending to the LLM (token budget + drop server noise). */

const MAX_LAYERS = 40
const MAX_WALLS = 250
const MAX_TEXT_LABELS = 80
const MAX_OPENINGS = 80
const MAX_FURNITURE = 60

export function slimCadInspectForLlm(raw: Record<string, unknown>): Record<string, unknown> {
  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, MAX_LAYERS) : undefined
  const slim: Record<string, unknown> = {}
  if (typeof raw.dxf_version === 'string') slim.dxf_version = raw.dxf_version
  if (typeof raw.layer_count === 'number') slim.layer_count = raw.layer_count
  if (layers) slim.layers = layers
  if (typeof raw.entity_count === 'number') slim.entity_count = raw.entity_count
  if (raw.entity_types && typeof raw.entity_types === 'object') slim.entity_types = raw.entity_types
  if (typeof raw.has_instalacion_electrica_layer === 'boolean') {
    slim.has_instalacion_electrica_layer = raw.has_instalacion_electrica_layer
  }
  return slim
}

export function slimGeometryExtractForLlm(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const walls = Array.isArray(raw.paredes) ? raw.paredes.slice(0, MAX_WALLS) : []
  const labels = Array.isArray(raw.etiquetas_texto) ? raw.etiquetas_texto.slice(0, MAX_TEXT_LABELS) : []
  const openings = Array.isArray(raw.aberturas) ? raw.aberturas.slice(0, MAX_OPENINGS) : []
  const furniture = Array.isArray(raw.muebles) ? raw.muebles.slice(0, MAX_FURNITURE) : []
  if (walls.length === 0 && labels.length === 0 && openings.length === 0 && furniture.length === 0) {
    return undefined
  }
  const slim: Record<string, unknown> = {}
  if (walls.length > 0) slim.paredes = walls
  if (labels.length > 0) slim.etiquetas_texto = labels
  if (openings.length > 0) slim.aberturas = openings
  if (furniture.length > 0) slim.muebles = furniture
  if (raw.capas_clasificadas && typeof raw.capas_clasificadas === 'object') {
    slim.capas_clasificadas = raw.capas_clasificadas
  }
  const totalWalls = Array.isArray(raw.paredes) ? raw.paredes.length : 0
  const totalLabels = Array.isArray(raw.etiquetas_texto) ? raw.etiquetas_texto.length : 0
  if (totalWalls > walls.length) slim.paredes_truncated = totalWalls - walls.length
  if (totalLabels > labels.length) slim.etiquetas_truncated = totalLabels - labels.length
  return slim
}
