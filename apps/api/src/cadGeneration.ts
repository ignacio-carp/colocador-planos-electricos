import { createHash } from 'node:crypto'

/** US-009 contract defaults (cad-generation-input.json). */
export const US009_OUTPUT_LAYER = {
  name: 'Cambre_Electrical',
  block_name: 'CAMBRE_OUTLET',
  color_aci: 3,
} as const

export type Us009OutputLayerConfig = {
  name: string
  block_name: string
  color_aci: number
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function parseUs009OutputLayer(raw: unknown): Us009OutputLayerConfig {
  if (!raw || typeof raw !== 'object') return US009_OUTPUT_LAYER
  const layer = raw as Record<string, unknown>
  return {
    name: typeof layer.name === 'string' && layer.name.trim() ? layer.name.trim() : US009_OUTPUT_LAYER.name,
    block_name:
      typeof layer.block_name === 'string' && layer.block_name.trim()
        ? layer.block_name.trim()
        : US009_OUTPUT_LAYER.block_name,
    color_aci:
      typeof layer.color_aci === 'number' && Number.isFinite(layer.color_aci)
        ? Math.floor(layer.color_aci)
        : US009_OUTPUT_LAYER.color_aci,
  }
}
