/** Compact contract excerpt for LLM system prompts (US-008). */

const LEGACY_OUTLET_TYPES =
  '"standard"|"double"|"switch"|"dedicated_appliance"|"emergency"'

const VIVIENDA_ELEMENT_TYPES =
  '"centro"|"brazo"|"toma"|"toma_especial"|"llave"'

function legacyNormativeOutletPlacementsPromptSpec(): string {
  return `Return a JSON object with ONLY these top-level keys:
{
  "outlet_placements": [{
    "id": "outlet-<lowercase-slug>",
    "room_id": "<must match a room id from layout_interpretation>",
    "position": { "x": number, "y": number, "unit": "drawing_units" },
    "outlet_type": ${LEGACY_OUTLET_TYPES},
    "mounting": "wall"|"floor"|"ceiling",
    "height_mm": number,
    "rationale": "brief normative justification",
    "rule_ids": ["RULE-..."]
  }],
  "warnings": ["optional strings"]
}
Rules:
- outlet id pattern: ^outlet-[a-z0-9-]+$
- At least one outlet_placements entry per applicable normative rule and room.
- Positions must lie inside the target room polygon (same coordinate system as layout_interpretation).
- Prefer wall positions along room perimeter inferred from walls; avoid overlapping doors/windows when openings are known.
- Reference rule ids from the supplied rules bundle in rule_ids and rationale.
- Do NOT return contract_version, job_id, correlation_id, story_id, normative_rules_version, or completed_at.`
}

function viviendaNormativeOutletPlacementsPromptSpec(): string {
  return `Return a JSON object with ONLY these top-level keys:
{
  "outlet_placements": [{
    "id": "outlet-<lowercase-slug>",
    "room_id": "<must match a room id from layout_interpretation>",
    "position": { "x": number, "y": number, "unit": "drawing_units" },
    "element": ${VIVIENDA_ELEMENT_TYPES},
    "outlet_type": ${LEGACY_OUTLET_TYPES} (optional legacy alias; prefer element),
    "mounting": "wall"|"floor"|"ceiling",
    "height_mm": number,
    "rationale": "brief normative justification",
    "rule_ids": ["PMU-...", "CR-...", "V0..."]
  }],
  "warnings": ["optional strings e.g. WET-ZONE-UNVERIFIED, GENERICO-ROOM"]
}
Rules:
- Follow the supplied rules bundle pipeline: classify rooms → grade → PMU (pmu_by_room) → place bocas.
- element types: centro/brazo = IUG (ceiling/wall light); toma = TUG; toma_especial = TUE; llave = switch.
- outlet id pattern: ^outlet-[a-z0-9-]+$
- Emit every boca required by PMU for each classified room (IUG, TUG, TUE counts per grade).
- Positions must lie inside the target room polygon (same coordinate system as layout_interpretation).
- Wall elements (toma, toma_especial, llave, brazo): prefer perimeter walls; clearance_from_opening_mm ≥ 150.
- centro: distribute on ceiling grid per placement.centro; avoid walls (< 0.4 m clearance).
- Bathroom/toilette tomas: height_mm 1100, wet_zone_check; emit WET-ZONE-UNVERIFIED if fixtures unknown.
- Kitchen counter tomas: height_mm 1100 when sobre_mesada applies.
- Reference PMU ids, counting_rules (CR-*) or validation ids in rule_ids and rationale.
- Do NOT return contract_version, job_id, correlation_id, story_id, normative_rules_version, or completed_at.`
}

/** @deprecated Use normativeOutletPlacementsPromptSpec(rules) */
export function normativeOutletPlacementsPromptSpec(
  rules?: Record<string, unknown>,
): string {
  if (rules && Array.isArray(rules.pipeline)) {
    return viviendaNormativeOutletPlacementsPromptSpec()
  }
  return legacyNormativeOutletPlacementsPromptSpec()
}
