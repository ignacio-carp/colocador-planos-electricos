/**
 * Electrical catalog — products the AI chat (US-014) and rules flow can place
 * on the Cambre_Electrical layer.
 *
 * Source of truth in production: public.electrical_catalog (Supabase).
 * Fallback (tests / storage not configured): DEFAULT_ELECTRICAL_CATALOG,
 * kept in sync with the seed in
 * supabase/migrations/20260612120000_interactive_electrical_chat.sql.
 */

import { getSupabaseServiceRole, isStorageConfigured } from './supabaseService'

export type ElectricalCatalogCategory =
  | 'outlet'
  | 'switch'
  | 'lighting'
  | 'domotics'
  | 'other'

export type ElectricalOutletType =
  | 'standard'
  | 'double'
  | 'switch'
  | 'dedicated_appliance'
  | 'emergency'

export type ElectricalCatalogItem = {
  id: string
  sku: string
  name: string
  category: ElectricalCatalogCategory
  description: string | null
  outlet_type: ElectricalOutletType
  default_height_mm: number
  active: boolean
}

export const DEFAULT_ELECTRICAL_CATALOG: ElectricalCatalogItem[] = [
  {
    id: 'cat-toma-std',
    sku: 'CAM-TOMA-STD',
    name: 'Toma simple Cambre Siglo XXII',
    category: 'outlet',
    description: 'Toma de corriente simple 10 A, línea Siglo XXII.',
    outlet_type: 'standard',
    default_height_mm: 300,
    active: true,
  },
  {
    id: 'cat-toma-dbl',
    sku: 'CAM-TOMA-DBL',
    name: 'Toma doble Cambre Siglo XXII',
    category: 'outlet',
    description: 'Toma de corriente doble 10 A, línea Siglo XXII.',
    outlet_type: 'double',
    default_height_mm: 300,
    active: true,
  },
  {
    id: 'cat-toma-20a',
    sku: 'CAM-TOMA-20A',
    name: 'Toma dedicada 20 A',
    category: 'outlet',
    description: 'Toma para electrodomésticos de alto consumo (horno, aire acondicionado).',
    outlet_type: 'dedicated_appliance',
    default_height_mm: 1200,
    active: true,
  },
  {
    id: 'cat-int-simple',
    sku: 'CAM-INT-SIMPLE',
    name: 'Interruptor de un punto',
    category: 'switch',
    description: 'Interruptor simple de un punto, línea Siglo XXII.',
    outlet_type: 'switch',
    default_height_mm: 1200,
    active: true,
  },
  {
    id: 'cat-int-comb',
    sku: 'CAM-INT-COMB',
    name: 'Interruptor de combinación',
    category: 'switch',
    description: 'Interruptor de combinación (escalera) para comando desde dos puntos.',
    outlet_type: 'switch',
    default_height_mm: 1200,
    active: true,
  },
  {
    id: 'cat-luz-emerg',
    sku: 'CAM-LUZ-EMERG',
    name: 'Luz de emergencia autónoma',
    category: 'lighting',
    description: 'Módulo de luz de emergencia autónoma recargable.',
    outlet_type: 'emergency',
    default_height_mm: 2200,
    active: true,
  },
  {
    id: 'cat-domo-dimmer',
    sku: 'CAM-DOMO-DIMMER',
    name: 'Dimmer domótico Wi-Fi',
    category: 'domotics',
    description: 'Módulo dimmer inteligente Wi-Fi compatible con domótica de hogar.',
    outlet_type: 'switch',
    default_height_mm: 1200,
    active: true,
  },
  {
    id: 'cat-domo-toma',
    sku: 'CAM-DOMO-TOMA',
    name: 'Toma inteligente Wi-Fi',
    category: 'domotics',
    description: 'Toma de corriente inteligente con medición de consumo y control remoto.',
    outlet_type: 'standard',
    default_height_mm: 300,
    active: true,
  },
]

const VALID_CATEGORIES = new Set<ElectricalCatalogCategory>([
  'outlet',
  'switch',
  'lighting',
  'domotics',
  'other',
])
const VALID_OUTLET_TYPES = new Set<ElectricalOutletType>([
  'standard',
  'double',
  'switch',
  'dedicated_appliance',
  'emergency',
])

function rowToItem(row: Record<string, unknown>): ElectricalCatalogItem | null {
  const sku = typeof row.sku === 'string' ? row.sku : null
  const name = typeof row.name === 'string' ? row.name : null
  if (!sku || !name) return null
  const category = VALID_CATEGORIES.has(row.category as ElectricalCatalogCategory)
    ? (row.category as ElectricalCatalogCategory)
    : 'other'
  const outletType = VALID_OUTLET_TYPES.has(row.outlet_type as ElectricalOutletType)
    ? (row.outlet_type as ElectricalOutletType)
    : 'standard'
  return {
    id: String(row.id ?? sku),
    sku,
    name,
    category,
    description: typeof row.description === 'string' ? row.description : null,
    outlet_type: outletType,
    default_height_mm:
      typeof row.default_height_mm === 'number' && Number.isFinite(row.default_height_mm)
        ? row.default_height_mm
        : 300,
    active: row.active !== false,
  }
}

/** Lists active catalog items (Supabase, or built-in defaults without storage). */
export async function listElectricalCatalog(): Promise<ElectricalCatalogItem[]> {
  if (!isStorageConfigured()) return [...DEFAULT_ELECTRICAL_CATALOG]
  try {
    const sb = getSupabaseServiceRole()
    const { data, error } = await sb
      .from('electrical_catalog')
      .select('*')
      .eq('active', true)
      .order('sku')
    if (error) throw new Error(error.message)
    const items = (data ?? [])
      .map((row) => rowToItem(row as Record<string, unknown>))
      .filter((item): item is ElectricalCatalogItem => item !== null)
    return items.length > 0 ? items : [...DEFAULT_ELECTRICAL_CATALOG]
  } catch {
    return [...DEFAULT_ELECTRICAL_CATALOG]
  }
}

/** Finds a catalog item by sku or id (case-insensitive sku match). */
export function findCatalogItem(
  catalog: ElectricalCatalogItem[],
  skuOrId: string,
): ElectricalCatalogItem | undefined {
  const needle = skuOrId.trim().toLowerCase()
  return catalog.find(
    (item) => item.sku.toLowerCase() === needle || item.id.toLowerCase() === needle,
  )
}

/**
 * Matches free-form Spanish text (chat message) against catalog items.
 * Returns the best match by keyword overlap, or undefined.
 */
export function matchCatalogItemFromText(
  catalog: ElectricalCatalogItem[],
  text: string,
): ElectricalCatalogItem | undefined {
  const lowered = text.toLowerCase()

  const explicitSku = catalog.find((item) => lowered.includes(item.sku.toLowerCase()))
  if (explicitSku) return explicitSku

  const scored = catalog
    .map((item) => {
      let score = 0
      const nameTokens = item.name
        .toLowerCase()
        .split(/[^a-záéíóúüñ0-9]+/)
        .filter((t) => t.length > 3)
      for (const token of nameTokens) {
        if (lowered.includes(token)) score += 2
      }
      if (item.category === 'domotics' && /dom[oó]tic|inteligente|smart|wi-?fi/.test(lowered)) {
        score += 3
      }
      if (item.category === 'lighting' && /\bluz\b|luces|ilumina|emergencia/.test(lowered)) {
        score += 2
      }
      if (item.category === 'switch' && /interruptor|llave de luz|tecla/.test(lowered)) {
        score += 2
      }
      if (item.category === 'outlet' && /toma|enchufe|tomacorriente/.test(lowered)) {
        score += 2
      }
      if (item.outlet_type === 'double' && /doble/.test(lowered)) score += 2
      if (item.outlet_type === 'dedicated_appliance' && /20\s*a|dedicad|horno|aire/.test(lowered)) {
        score += 2
      }
      return { item, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored[0]?.item
}

/** Slim catalog view injected into the chat LLM prompt. */
export function catalogForPrompt(catalog: ElectricalCatalogItem[]): Array<Record<string, unknown>> {
  return catalog.map((item) => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    outlet_type: item.outlet_type,
    default_height_mm: item.default_height_mm,
    description: item.description ?? undefined,
  }))
}
