import type { PreliminaryRecommendation } from './jobsStore'

type Room = {
  id?: string
  label?: string
  room_type?: string
  area_m2?: number
}

type OutletPlacement = {
  room_id?: string
  outlet_type?: string
  element?: string
  rule_ids?: string[]
}

export function mergeOutletPlacementsForRoom(
  existing: unknown[],
  roomId: string,
  newPlacements: unknown[],
): unknown[] {
  const kept = existing.filter((p) => {
    if (!p || typeof p !== 'object') return false
    return (p as OutletPlacement).room_id !== roomId
  })
  const scoped = newPlacements.filter((p) => {
    if (!p || typeof p !== 'object') return false
    const placement = p as OutletPlacement
    return placement.room_id === roomId || placement.room_id === undefined
  })
  return [...kept, ...scoped.map((p) => ({ ...(p as object), room_id: roomId }))]
}

export function mergePreliminaryRecommendation(
  existing: PreliminaryRecommendation[],
  recommendation: PreliminaryRecommendation,
): PreliminaryRecommendation[] {
  const filtered = existing.filter((r) => r.room_id !== recommendation.room_id)
  return [...filtered, recommendation]
}

export function buildRecommendationForRoom(
  visionOutput: Record<string, unknown>,
  normativeOutput: Record<string, unknown>,
  roomId: string,
): PreliminaryRecommendation | undefined {
  const layout = visionOutput.layout_interpretation as { rooms?: Room[] } | undefined
  const rooms: Room[] = layout?.rooms ?? []
  const room = rooms.find((r) => r.id === roomId)
  if (!room) return undefined

  const roomLabel = room.label ?? roomId
  const placements = ((normativeOutput.outlet_placements as OutletPlacement[] | undefined) ?? []).filter(
    (p) => p.room_id === roomId,
  )
  const outletCount = placements.length
  const allRuleIds = [...new Set(placements.flatMap((p) => p.rule_ids ?? []))]

  const recommendations: string[] = []
  if (outletCount === 0) {
    recommendations.push(
      `No se proponen tomas para "${roomLabel}" según las reglas normativas activas.`,
    )
  } else {
    recommendations.push(
      `Se proponen ${outletCount} toma${outletCount !== 1 ? 's' : ''} de corriente en "${roomLabel}".`,
    )
    const typeGroups: Record<string, number> = {}
    for (const p of placements) {
      const t = p.element ?? p.outlet_type ?? 'estándar'
      typeGroups[t] = (typeGroups[t] ?? 0) + 1
    }
    for (const [type, count] of Object.entries(typeGroups)) {
      recommendations.push(`  • ${count} toma${count !== 1 ? 's' : ''} tipo "${type}".`)
    }
    if (allRuleIds.length > 0) {
      recommendations.push(`Reglas aplicadas: ${allRuleIds.join(', ')}.`)
    }
  }

  return {
    room_id: roomId,
    room_label: roomLabel,
    recommendations,
    outlet_count: outletCount,
    rule_ids: allRuleIds,
  }
}
