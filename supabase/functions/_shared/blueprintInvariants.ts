/**
 * THE BLUEPRINT'S "ENFORCED" RULES, ENFORCED.
 *
 * The Agentic Blueprint prompt carries a block headed "ROBUSTNESS RULES
 * (enforced, not optional)" — and nothing enforced any of it. On a reviewed
 * CRM build the model minted ONE journey for nine personas and nine
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
  //
  // REPAIRED, not just reported. The rule says a workflow with no journey is
  // "a gap, never an omission", and the first version of this module honoured
  // the letter of that by naming the miss — which left the operator holding a
  // true sentence and no blueprint. On a real programme ONE journey stood
  // beside nine workflows and nine personas, so eight ninths of the business
  // had no walk-through at all.
  //
  // A journey the Atlas can already describe is SYNTHESISED from it: the
  // workflow's own name, its owner, its steps in order, and the agent that
  // replaces it. That is not invention — every field is copied from a document
  // on the record, which is the same standard the ontology's core synthesis
  // holds itself to. What the model contributes (a customer-facing arc across
  // workflows) is left exactly as authored; what it omitted is filled from
  // evidence and STAMPED `derived`, so nobody mistakes a transcription for the
  // blueprint agent's judgement.
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : {};
  const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : {};
  const workflowRows = asRecords(atlas.workflows).filter((w) => asString(w.name));
  const workflows = workflowRows.map((w) => asString(w.name));
  const personas = asRecords(kit.personas).map((p) => asString(p.name) || asString(p.role)).filter(Boolean);
  const textOf = (list: Array<Record<string, unknown>>): string => list.map((j) =>
    [asString(j.name), ...asRecords(j.stages).flatMap((s) => [asString(s.name), asString(s.user), asString(s.customer), asString(s.agent)])].join(" • ")).join(" • ");
  const agentWorkflows = repairedAgents.map((a) => asString(a.replacesWorkflow)).filter(Boolean);

  // A workflow is covered when a journey walks it. An AGENT that replaces it is
  // not coverage — an agent is what does the work, a journey is how the work
  // reads end to end, and the rule asks for the second.
  const authoredText = textOf(journeys);
  const uncovered = workflowRows.filter((w) => !namesMatch(authoredText, asString(w.name)));
  /** How many steps of one workflow become stages. Past this the journey is a
   *  procedure manual rather than a walk-through, and the document has a budget. */
  const STAGE_CAP = 8;
  const derivedJourneys = uncovered.map((w) => {
    const name = asString(w.name);
    const owner = asString(w.owner);
    const agentFor = repairedAgents.find((a) => namesMatch(asString(a.replacesWorkflow), name));
    const steps = asRecords(w.steps).slice(0, STAGE_CAP);
    const stages = steps.map((step) => {
      const action = asString(step.action).replace(/\s+/g, " ").replace(/\.$/, "");
      const actor = asString(step.actor) || owner;
      return {
        // The label is the step's own first clause — the words the Atlas used.
        name: (action.split(/[,;:]/)[0] || action).slice(0, 60),
        customer: null,
        user: actor ? `${actor}: ${action}` : action,
        agent: agentFor ? asString(agentFor.name) : null,
        systems: asString(step.system) || null,
      };
    });
    return {
      name,
      persona: "user",
      stages: stages.length ? stages : [{ name, customer: null, user: owner || "To confirm", agent: agentFor ? asString(agentFor.name) : null, systems: null }],
      derived: true,
      basis: `Transcribed from the current-state atlas workflow "${name}"${owner ? `, owned by ${owner}` : ""} — the blueprint authored no journey that walks it.`,
    };
  });
  if (derivedJourneys.length) {
    notes.push(`${derivedJourneys.length} journey${derivedJourneys.length === 1 ? " was" : "s were"} added from the current-state atlas (${derivedJourneys.map((j) => j.name).join(", ")}) — the blueprint authored none that walked ${derivedJourneys.length === 1 ? "it" : "them"}. Each is a transcription of that workflow's own steps, marked "derived": confirm the arc reads the way the business tells it.`);
  }
  const allJourneys = [...journeys, ...derivedJourneys];
  // NO PERSONA CHECK LIVES HERE, deliberately. The rule names personas too,
  // but the only test available is whether a persona's NAME appears in a
  // journey's prose — and a journey can walk somebody's work perfectly well
  // without spelling their title. A proxy that fires on a correct blueprint
  // teaches the operator to stop reading gaps, which costs more than the check
  // is worth; the same reasoning retired six false refusals from the verb
  // resolver. A persona nobody works for is visible where it is decidable:
  // in the kit's own coverage, upstream of here.
  // The shape that started this: a single journey and nothing to build more
  // from. With an atlas the repair above has already run, so this only fires
  // where there was no evidence to transcribe.
  if (workflows.length > 2 && allJourneys.length === 1) {
    notes.push(`One journey stands beside ${workflows.length} mapped workflows and ${personas.length} personas, and the atlas carried no steps to derive the rest from — the coverage rule expects every persona and workflow to map to a journey.`);
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
    doc: {
      ...result,
      agents: repairedAgents,
      // Only when something was actually transcribed — a document that needed
      // no journey repair keeps the array it arrived with, identity included.
      ...(derivedJourneys.length ? { journeys: allJourneys } : {}),
      gaps: [...gaps, ...fresh],
    },
    notes,
  };
}
