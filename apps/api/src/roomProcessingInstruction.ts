import { resolveActiveNormativeRulesVersion } from './normativeRules'

export type RoomInstructionContext = {
  id: string
  label?: string
  room_type?: string
  area_m2?: number
}

/**
 * Default architect-facing instruction for US-008 (editable before send).
 */
export function buildDefaultRoomProcessingInstruction(
  room: RoomInstructionContext,
  rulesVersion = resolveActiveNormativeRulesVersion(),
): string {
  const label = room.label?.trim() || room.id
  const roomType = room.room_type?.trim() || 'sin clasificar'
  const area =
    room.area_m2 != null && Number.isFinite(room.area_m2)
      ? `${room.area_m2} m²`
      : 'área no calculada'

  return `Procesá los tomacorrientes (capa Cambre_Electrical) para la habitación "${label}" (id: ${room.id}, tipo: ${roomType}, ${area}).

Usá la captura del visor como contexto visual y la geometría vectorial del plano como fuente de coordenadas exactas.

Aplicá las reglas normativas del bundle ${rulesVersion} para este tipo de habitación. Colocá cada toma en posición accesible sobre muros del perímetro, respetando clearance y mínimos de la normativa.

Si hay ambigüedad en el tipo de habitación o zonas húmedas no verificadas, incluí warnings en la respuesta.`
}

export function findRoomInVisionLayout(
  visionLayout: Record<string, unknown> | undefined,
  roomId: string,
): RoomInstructionContext | null {
  if (!visionLayout || typeof visionLayout !== 'object') return null
  const layout = visionLayout.layout_interpretation as { rooms?: unknown[] } | undefined
  const rooms = layout?.rooms ?? []
  for (const raw of rooms) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : undefined
    if (id !== roomId) continue
    return {
      id,
      label: typeof r.label === 'string' ? r.label : undefined,
      room_type: typeof r.room_type === 'string' ? r.room_type : undefined,
      area_m2: typeof r.area_m2 === 'number' ? r.area_m2 : undefined,
    }
  }
  return null
}
