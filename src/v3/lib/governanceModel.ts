// Governance model selection. The governance-model agent proposes several
// AI-generated, programme-tailored options; the user picks one. Selection is
// "replace-but-re-selectable": the chosen option becomes the effective model
// while every option stays available to switch to later. This pure resolver
// turns the persisted `governanceModel` payload into the option set plus the
// effective selection, so the UI and any downstream consumer agree on which
// model is in force.

export interface GovernanceOption {
  id: string;
  name?: string;
  summary?: string;
  bestFor?: string;
  decisionBodies?: unknown[];
  decisionRights?: unknown[];
  escalationPath?: unknown[];
  reportingCadence?: unknown[];
  gaps?: unknown[];
}

export interface GovernanceSelection {
  options: GovernanceOption[];
  recommendedId: string | null;
  /** The effective selection: the user's pick, else the recommendation, else the first option. */
  selectedId: string;
  selected: GovernanceOption;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Resolve the option set and effective selection from a persisted governanceModel
 * payload. Returns null when the payload carries no usable options (e.g. a legacy
 * single-model result, or nothing generated yet) — callers fall back accordingly.
 */
export function resolveGovernanceSelection(model: unknown): GovernanceSelection | null {
  if (!model || typeof model !== "object" || Array.isArray(model)) return null;
  const m = model as Record<string, unknown>;

  const options: GovernanceOption[] = asArray(m.options)
    .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === "object" && !Array.isArray(o))
    .map((o, i) => {
      const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `option-${i + 1}`;
      return {
        id,
        name: typeof o.name === "string" ? o.name : undefined,
        summary: typeof o.summary === "string" ? o.summary : undefined,
        bestFor: typeof o.bestFor === "string" ? o.bestFor : undefined,
        decisionBodies: asArray(o.decisionBodies),
        decisionRights: asArray(o.decisionRights),
        escalationPath: asArray(o.escalationPath),
        reportingCadence: asArray(o.reportingCadence),
        gaps: asArray(o.gaps),
      };
    });
  if (options.length === 0) return null;

  const has = (id: string | null): id is string => Boolean(id) && options.some((o) => o.id === id);
  const recommendedRaw = typeof m.recommendedOptionId === "string" ? m.recommendedOptionId : null;
  const recommendedId = has(recommendedRaw) ? recommendedRaw : null;
  const selectedRaw = typeof m.selectedOptionId === "string" ? m.selectedOptionId : null;
  const selectedId = has(selectedRaw) ? selectedRaw : (recommendedId ?? options[0].id);
  const selected = options.find((o) => o.id === selectedId) ?? options[0];

  return { options, recommendedId, selectedId, selected };
}
