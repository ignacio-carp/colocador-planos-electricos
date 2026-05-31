/** Compact contract excerpt for LLM system prompts (US-008). */

export function normativeOutletPlacementsPromptSpec(): string {
  return `Return a JSON object with ONLY these top-level keys:
{
  "outlet_placements": [{
    "id": "outlet-<lowercase-slug>",
    "room_id": "<must match a room id from layout_interpretation>",
    "position": { "x": number, "y": number, "unit": "drawing_units" },
    "outlet_type": "standard"|"double"|"switch"|"dedicated_appliance"|"emergency",
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
