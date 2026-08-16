/**
 * THE BLUEPRINT'S "ENFORCED" RULES, ENFORCED.
 *
 * The Agentic Blueprint prompt carries a block headed "ROBUSTNESS RULES
 * (enforced, not optional)" — and nothing enforced any of it. On the Laila
 * New 2 build the model minted ONE journey for nine personas and nine
 * workflows (the JOURNEY COVERAGE rule calls that "a gap, never an omission" —
 * and the violation was not even in `gaps`), templated one per-area "Tool
 * Agent" with `autonomyLevel: "act"` across the board, and the document
 * shipped as-is. Prompt prose is a request; this module is the post-condition.
 *
 * Two kinds of teeth, matched to what each breach costs:
 *
 *  - THE SAFETY INVARIANT IS REPAIRED, not reported: an agent acting
 *    autonomously on irreversible / high-blast-radius work with no human gate
 *    is demoted to act-with-approval. Demotion is always safe — it can cost a
 *    demo a little autonomy; the other direction costs the client an agent
 *    that acts irreversibly with nobody watching. The demotion is recorded on
 *    the agent's own rationale and in `gaps`.
 *
 *  - COVERAGE AND COMPLETENESS BREACHES BECOME NAMED GAPS — the artifact's
 *    visible-miss channel, same discipline as the prototype's refine
 *    rejections. A workflow no agent replaces, a persona set nine wide beside
 *    a single journey, a data contract with no owner or PII class, an agent
 *    with no guardrails: each is stated, counted and named, so the operator
 *    reads the miss instead of discovering it in a demo.
 *
 * Pure, clockless, and total: a malformed document passes through unchanged
 * except for what could be read. Called by run-agent on the finalized result —
 * both the direct-apply and the propose-then-confirm paths carry it.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asRecords = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter(isRecord) : [];

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Case-insensitive containment either way — "Campaign Management" matches
 * "campaign management workflow" and vice versa. Coverage naming is prose, so
 * exact equality would miss real coverage and cry wolf. */
const namesMatch = (a: string, b: string): boolean => {
  const x = a.toLowerCase(); const y = b.toLowerCase();
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

export interface BlueprintEnforcement {
  doc: Record<string, unknown>;
  /** What was repaired (demotions) and what was recorded (gaps) — one line
   * each, already appended to the doc's gaps. */
  notes: string[];
}

export function enforceBlueprintInvariants(
  inner: Record<string, unknown>,
  result: Record<string, unknown>,
): BlueprintEnforcement {
  const notes: string[] = [];
  const agents = asRecords(result.agents);
  const journeys = asRecords(result.journeys);
  const hitlPoints = asRecords(result.hitlPoints);

  // ── 1 · Safety: act + irreversible/high blast + no gate → act-with-approval ──
  const gated = (agentName: string): boolean =>
    hitlPoints.some((h) => namesMatch(asString(h.where), agentName))
    || agents.some((a) => asString(a.name) === agentName && a.requiresHitl === true);
  const repairedAgents = agents.map((a) => {
    const name = asString(a.name);
    const acts = asString(a.autonomyLevel) === "act";
    const dangerous = asString(a.reversibility) === "irreversible" || asString(a.blastRadius) === "high";
    if (!acts || !dangerous || gated(name)) return a;
    notes.push(`${name} was demoted to act-with-approval: it acted autonomously on ${asString(a.reversibility) === "irreversible" ? "irreversible" : "high-blast-radius"} work with no human gate — the safety invariant the blueprint itself declares.`);
    return {
      ...a,
      autonomyLevel: "act-with-approval",
      requiresHitl: true,
      rationale: `${asString(a.rationale)}${asString(a.rationale) ? " " : ""}[Demoted from "act" at validation: no HITL point covered this agent's irreversible/high-blast work.]`,
    };
  });

  // ── 2 · Journey coverage: every Atlas workflow, every kit persona ──
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : {};
  const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : {};
  const workflows = asRecords(atlas.workflows).map((w) => asString(w.name)).filter(Boolean);
  const personas = asRecords(kit.personas).map((p) => asString(p.name) || asString(p.role)).filter(Boolean);
  const journeyText = journeys.map((j) =>
    [asString(j.name), ...asRecords(j.stages).flatMap((s) => [asString(s.name), asString(s.user), asString(s.customer), asString(s.agent)])].join(" • ")).join(" • ");
  const agentWorkflows = repairedAgents.map((a) => asString(a.replacesWorkflow)).filter(Boolean);

  const uncoveredWorkflows = workflows.filter((w) =>
    !agentWorkflows.some((aw) => namesMatch(aw, w)) && !namesMatch(journeyText, w));
  if (uncoveredWorkflows.length) {
    notes.push(`${uncoveredWorkflows.length} atlas workflow${uncoveredWorkflows.length === 1 ? "" : "s"} no agent replaces and no journey walks (${uncoveredWorkflows.join(", ")}) — the coverage rule calls each a gap, never an omission.`);
  }
  if (workflows.length > 2 && journeys.length === 1) {
    notes.push(`One journey stands beside ${workflows.length} mapped workflows and ${personas.length} personas — the blueprint's own coverage rule expects every persona and workflow to map to a journey; a single journey cannot carry them all.`);
  }

  // ── 3 · Completeness: contracts carry the hard parts; agents degrade gracefully ──
  const contracts = asRecords(result.dataContracts);
  const lax = contracts.filter((c) =>
    !asString(c.owner) || !asString(c.piiClass) || !asString(c.consistency) || !asString(c.conflictResolution));
  if (lax.length) {
    const named = lax.map((c) => asString(c.entity) || "?").slice(0, 6).join(", ");
    notes.push(`${lax.length} data contract${lax.length === 1 ? "" : "s"} missing owner, piiClass, consistency or conflictResolution (${named}${lax.length > 6 ? ", …" : ""}) — the hard parts the robustness rules require.`);
  }
  const unguarded = repairedAgents.filter((a) => asRecords(a.guardrails).length === 0).map((a) => asString(a.name)).filter(Boolean);
  if (unguarded.length) {
    notes.push(`${unguarded.length} agent${unguarded.length === 1 ? "" : "s"} with no guardrails (${unguarded.join(", ")}) — no detection, no fallback, not production-ready by the blueprint's own rule.`);
  }

  if (!notes.length) return { doc: result, notes };
  const gaps = (Array.isArray(result.gaps) ? result.gaps : []).map((g) => String(g));
  const fresh = notes.filter((n) => !gaps.includes(n));
  return {
    doc: { ...result, agents: repairedAgents, gaps: [...gaps, ...fresh] },
    notes,
  };
}
