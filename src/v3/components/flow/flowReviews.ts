/**
 * Shareable stakeholder REVIEWS — visual, low-friction input surfaces that ride
 * the interview-pack rails.
 *
 * Two kinds, both projected from the record and served over a no-login link:
 *  - "agentify"       — a persona sees THEIR current workflow (from the
 *                       Current-State Atlas) and marks each step Keep / Assist /
 *                       Agentify, with a comment. Feeds Envision.
 *  - "ontology-atlas" — a stakeholder reads the Domain Ontology's terms and the
 *                       Current-State Atlas's workflows and comments per term
 *                       and per workflow stage. Feeds Listen.
 *
 * The payload is projected CLIENT-SIDE at mint time and stored on the pack, so
 * the public edge is a thin pass-through (no new server projection) and the
 * answers come back through the SAME quarantine → evidence path as an
 * interview. The composed response is an attributed evidence block, so Envision
 * / Listen synthesis reads it like any other stakeholder input.
 */
import type { ProgramSummary } from "@/new/types";
import { workflowArea, entityArea, GENERAL_AREA } from "@/v3/components/flow/flowAreas";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter((s) => s.trim()) : []);

function innerData(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
}

/** Loose actor↔persona match — "Sales Rep" finds an actor written "sales rep"
 * or "Sales Representative" (shared singularised-token overlap). */
function actorMatchesPersona(actor: string, persona: string): boolean {
  const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/)
    .map((token) => token.replace(/s$/, "")).filter((token) => token.length >= 3));
  const a = tokens(actor);
  const p = tokens(persona);
  if (!a.size || !p.size) return false;
  for (const token of p) if (a.has(token)) return true;
  return false;
}

// ── agentify ────────────────────────────────────────────────────────────────

export interface AgentifyStep {
  action: string;
  actor: string;
  system?: string;
  entities?: string[];
  evidence?: string;
  /** True when the reviewing persona performs this step — their steps lead. */
  mine: boolean;
}
export interface AgentifyWorkflow { name: string; trigger?: string; area?: string; steps: AgentifyStep[] }
export interface ArchCandidate { name: string; shape?: string; description?: string; recommended?: boolean }
export interface BlueprintAgentBrief { name: string; purpose?: string; replacesWorkflow?: string; autonomyLevel?: string }
export interface AgentifyReview {
  kind: "agentify";
  persona: string;
  intro: string;
  workflows: AgentifyWorkflow[];
  /** The recipient's own area (alliances, delivery, …) — the link opens scoped
   *  to it so a stakeholder sees only their world's workflow/ontology/questions. */
  recipientArea?: string;
  /** The architecture decision the stakeholder is asked to react to — the
   *  candidates weighed and which was recommended. Shown WITH the question. */
  architecture?: { candidates: ArchCandidate[]; recommendation?: string };
  /** The agentic blueprint slice relevant to this stakeholder — the agents that
   *  would take over the workflows they act in. They respond in words or voice. */
  blueprint?: { agents: BlueprintAgentBrief[] };
}

/**
 * A persona's workflow-agentification review — the Atlas workflows they act in,
 * their own steps flagged. With no persona (or an unmatched one) every workflow
 * rides along so the link is never empty.
 */
export function projectAgentifyReview(program: ProgramSummary, persona: string): AgentifyReview | null {
  const atlas = innerData(program).currentStateAtlas;
  if (!isRecord(atlas)) return null;
  const workflows = (Array.isArray(atlas.workflows) ? atlas.workflows : []).filter(isRecord);
  if (!workflows.length) return null;
  const projected: AgentifyWorkflow[] = workflows.map((workflow) => ({
    name: str(workflow.name) || "Workflow",
    trigger: str(workflow.trigger) || undefined,
    area: workflowArea(workflow),
    steps: (Array.isArray(workflow.steps) ? workflow.steps : []).filter(isRecord).map((step) => ({
      action: str(step.action) || "step",
      actor: str(step.actor),
      system: str(step.system) || undefined,
      entities: strs(step.entities).slice(0, 6),
      evidence: str(step.evidence) || undefined,
      mine: !!persona && actorMatchesPersona(str(step.actor), persona),
    })),
  })).filter((workflow) => workflow.steps.length);
  // Prefer the workflows the persona acts in; if none match, show them all.
  const mine = projected.filter((workflow) => workflow.steps.some((step) => step.mine));
  const chosen = mine.length ? mine : projected;
  if (!chosen.length) return null;

  // The architecture decision + the blueprint the stakeholder reacts to. Both
  // ride on the pack (projected client-side), so no edge change is needed.
  const inner = innerData(program);
  const archDoc = isRecord(inner.architectureStrategy) ? inner.architectureStrategy : null;
  const recommendation = archDoc ? str(archDoc.recommendation) : "";
  const architecture = archDoc && Array.isArray(archDoc.candidates)
    ? {
        recommendation: recommendation || undefined,
        candidates: archDoc.candidates.filter(isRecord).slice(0, 5).map((c) => ({
          name: str(c.name) || "Option",
          shape: str(c.shape) || undefined,
          description: str(c.description) || undefined,
          recommended: !!recommendation && str(c.name).trim().toLowerCase() === recommendation.trim().toLowerCase(),
        })),
      }
    : undefined;

  const bpDoc = isRecord(inner.agenticBlueprint) ? inner.agenticBlueprint : null;
  const chosenNames = new Set(chosen.map((w) => w.name.trim().toLowerCase()));
  const allAgents = bpDoc && Array.isArray(bpDoc.agents)
    ? bpDoc.agents.filter(isRecord).map((a) => ({
        name: str(a.name) || "Agent",
        purpose: str(a.purpose) || undefined,
        replacesWorkflow: str(a.replacesWorkflow) || undefined,
        autonomyLevel: str(a.autonomyLevel) || undefined,
      }))
    : [];
  // Show the agents that take over THIS stakeholder's workflows first; if none
  // match, show the full set so the link is never empty.
  const mineAgents = allAgents.filter((a) => a.replacesWorkflow && chosenNames.has(a.replacesWorkflow.trim().toLowerCase()));
  const blueprintAgents = (mineAgents.length ? mineAgents : allAgents).slice(0, 10);

  return {
    kind: "agentify",
    persona: persona || "You",
    intro: persona
      ? `Here is the current workflow as we heard it. For each step, tell us whether a software agent should take it over, assist you, or stay entirely human — and why.`
      : `Here is the current workflow as we heard it. For each step, tell us whether a software agent should take it over, assist, or stay human — and why.`,
    workflows: chosen.slice(0, 8),
    ...(architecture && architecture.candidates.length ? { architecture } : {}),
    ...(blueprintAgents.length ? { blueprint: { agents: blueprintAgents } } : {}),
  };
}

// ── ontology + atlas ──────────────────────────────────────────────────────────

export interface OntologyTerm { name: string; definition?: string; aliases?: string[]; systemOfRecord?: string; area?: string }
export interface OntologyRelation { from: string; relation: string; to: string }
export interface AtlasStage { name: string; owner?: string; trigger?: string; steps: string[]; area?: string }
export interface OntologyAtlasReview {
  kind: "ontology-atlas";
  intro: string;
  terms: OntologyTerm[];
  relations: OntologyRelation[];
  workflows: AtlasStage[];
  recipientArea?: string;
}

/** The domain relations whose endpoints are BOTH in the given term set — the
 * edges of the ontology map (dangling relations are dropped). */
function projectRelations(program: ProgramSummary, terms: OntologyTerm[]): OntologyRelation[] {
  const inner = innerData(program);
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  const raw = ontology && Array.isArray(ontology.relations) ? ontology.relations.filter(isRecord) : [];
  const known = new Set(terms.map((t) => t.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: OntologyRelation[] = [];
  for (const rel of raw) {
    const from = str(rel.from).trim();
    const to = str(rel.to).trim();
    const relation = str(rel.relation).trim() || "relates to";
    if (!from || !to || !known.has(from.toLowerCase()) || !known.has(to.toLowerCase())) continue;
    const key = `${from.toLowerCase()} ${relation.toLowerCase()} ${to.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, relation, to });
    if (out.length >= 40) break;
  }
  return out;
}

/** The shareable ontology + current-state review — the domain's terms and the
 * mapped workflows, each commentable. */
export function projectOntologyAtlasReview(program: ProgramSummary): OntologyAtlasReview | null {
  const inner = innerData(program);
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : null;
  const terms: OntologyTerm[] = ontology && Array.isArray(ontology.entities)
    ? ontology.entities.filter(isRecord).map((entity) => ({
      name: str(entity.name) || "Term",
      definition: str(entity.definition) || undefined,
      aliases: strs(entity.aliases).slice(0, 4),
      systemOfRecord: str(entity.systemOfRecord) || undefined,
      area: entityArea(entity, program),
    })).filter((term) => term.name).slice(0, 40)
    : [];
  const workflows: AtlasStage[] = atlas && Array.isArray(atlas.workflows)
    ? atlas.workflows.filter(isRecord).map((workflow) => ({
      name: str(workflow.name) || "Workflow",
      owner: str(workflow.owner) || undefined,
      trigger: str(workflow.trigger) || undefined,
      area: workflowArea(workflow),
      steps: (Array.isArray(workflow.steps) ? workflow.steps : []).filter(isRecord)
        .map((step) => str(step.action)).filter(Boolean).slice(0, 10),
    })).filter((workflow) => workflow.name).slice(0, 10)
    : [];
  if (!terms.length && !workflows.length) return null;
  return {
    kind: "ontology-atlas",
    intro: "This is how we've mapped your world so far — the terms and the workflows, in your own language. Tell us where a term is wrong or missing, and where a workflow doesn't match how it really runs.",
    terms,
    relations: projectRelations(program, terms),
    workflows,
  };
}

// ── listen: edit the workflow, narrate changes ────────────────────────────────

export interface ListenWorkflowStep { action: string; actor?: string; system?: string; entities?: string[] }
export interface ListenWorkflow { name: string; trigger?: string; area?: string; steps: ListenWorkflowStep[] }
export interface ListenWorkflowReview {
  kind: "listen-workflow";
  persona: string;
  intro: string;
  workflows: ListenWorkflow[];
  /** The ontology terms the persona's steps touch — commentable. */
  terms: OntologyTerm[];
  /** Relations among those terms — the edges of the little ontology map. */
  relations: OntologyRelation[];
  /** Questions that DON'T reshape the workflow/ontology (compliance, risk, …). */
  questions: string[];
  recipientArea?: string;
}

/** Non-structural prompts — they capture constraints, not workflow shape, so the
 * Listen surface lists them BELOW the editable workflow. */
export const NON_STRUCTURAL_QUESTIONS: string[] = [
  "Any compliance, regulatory, or policy rules that constrain this work?",
  "What are the biggest risks or failure points here today?",
  "Anything that must NOT change — hard constraints, systems that stay?",
];

/** The Listen workflow-edit review — the persona's own workflow (editable) plus
 * the terms it touches, projected from the record. */
export function projectListenWorkflowReview(program: ProgramSummary, persona: string): ListenWorkflowReview | null {
  const agentify = projectAgentifyReview(program, persona);
  if (!agentify) return null;
  const oa = projectOntologyAtlasReview(program);
  const touched = new Set(agentify.workflows.flatMap((w) => w.steps.flatMap((s) => (s.entities ?? []).map((e) => e.toLowerCase()))));
  const relevant = (oa?.terms ?? []).filter((t) => touched.size === 0 || touched.has(t.name.toLowerCase()));
  return {
    kind: "listen-workflow",
    persona: persona || "You",
    intro: "This is how we've captured your workflow so far. Fix any step, add steps we missed, or describe changes in your own words — you'll see your changes build up below as you go.",
    workflows: agentify.workflows.map((w) => ({
      name: w.name, trigger: w.trigger, area: w.area,
      steps: w.steps.map((s) => ({ action: s.action, actor: s.actor, system: s.system, entities: s.entities })),
    })),
    terms: (relevant.length ? relevant : (oa?.terms ?? [])).slice(0, 16),
    relations: projectRelations(program, (relevant.length ? relevant : (oa?.terms ?? [])).slice(0, 16)),
    questions: NON_STRUCTURAL_QUESTIONS,
  };
}

/** The area-scoped visual review a stakeholder's ONE link carries on Listen /
 * Envision, with their gap script folded into a listen-workflow review's
 * questions. Shared by the card's mint AND the respond page's live re-projection
 * — both build the identical review from the current record, so a regenerated
 * artifact never orphans a link (the link rebuilds from the latest state).
 * Null for Frame/Show (a plain questions link). */
export function projectStakeholderReview(
  program: ProgramSummary, movementId: string, name: string,
  primaryArea: string | undefined, linkQuestions: string[],
): ListenWorkflowReview | AgentifyReview | null {
  const kind = movementId === "listen" ? "listen-workflow" : movementId === "envision" ? "agentify" : null;
  if (!kind) return null;
  const base = kind === "listen-workflow" ? projectListenWorkflowReview(program, name) : projectAgentifyReview(program, name);
  if (!base) return null;
  // Area-specific link: the recipient sees only THEIR area's workflow AND
  // ontology terms (alliances, delivery, …). Stamp the area so the surface
  // opens scoped to it and can name it.
  if (primaryArea && primaryArea !== GENERAL_AREA) {
    base.recipientArea = primaryArea;
    const scoped = base.workflows.filter((w) => w.area === primaryArea);
    if (scoped.length) base.workflows = scoped;
    if (base.kind === "listen-workflow") {
      const scopedTerms = base.terms.filter((t) => t.area === primaryArea);
      if (scopedTerms.length) {
        const keep = new Set(scopedTerms.map((t) => t.name.trim().toLowerCase()));
        base.terms = scopedTerms;
        base.relations = base.relations.filter((r) => keep.has(r.from.trim().toLowerCase()) && keep.has(r.to.trim().toLowerCase()));
      }
    }
  }
  // Fold their gap script into a listen-workflow review's question list (the
  // agentify surface has none) so the one link still asks it below the flow.
  if (base.kind === "listen-workflow") {
    const seen = new Set(base.questions.map((q) => q.trim().toLowerCase()));
    const extra = linkQuestions.filter((q) => q.trim() && !seen.has(q.trim().toLowerCase()));
    base.questions = [...extra, ...base.questions].slice(0, 10);
  }
  return base;
}

/** One workflow's edited step list, as the surface holds it. Actor/system ride
 * along so an edit to WHO does a step (or on WHICH system) is captured too. */
export interface EditedStep {
  action: string; original?: string; added?: boolean; removed?: boolean;
  actor?: string; originalActor?: string; system?: string; originalSystem?: string;
}

/** A term the reviewer added that isn't yet on the record. */
export interface AddedTerm { name: string; note?: string }

/** Compose the persona's workflow edits, term notes, narration and answers into
 * one attributed evidence block — changes marked so synthesis reads the diff. */
export function composeListenWorkflowAnswers(
  review: ListenWorkflowReview,
  edits: {
    workflows: Array<{ name: string; steps: EditedStep[]; stepNotes?: Record<string, string>; workflowIndex?: number }>;
    narration: string;
    termNotes: Record<string, string>;
    answers: Record<string, string>;
    addedTerms?: AddedTerm[];
  },
): string {
  const lines: string[] = [`Workflow review — ${review.persona}`, ""];
  // A step whose meta changed reports it inline; an unchanged meta rides along
  // as context so synthesis reads the full step, not just the verb.
  const meta = (step: EditedStep): string => {
    const parts: string[] = [];
    if (step.actor) parts.push(step.originalActor && step.originalActor !== step.actor ? `actor now ${step.actor} (was ${step.originalActor})` : `actor: ${step.actor}`);
    if (step.system) parts.push(step.originalSystem && step.originalSystem !== step.system ? `system now ${step.system} (was ${step.originalSystem})` : `system: ${step.system}`);
    return parts.length ? ` — ${parts.join(" · ")}` : "";
  };
  edits.workflows.forEach((wf) => {
    lines.push(`## ${wf.name}`);
    wf.steps.forEach((step, i) => {
      const n = i + 1;
      if (step.removed) lines.push(`${n}. − [REMOVED] ${step.original ?? step.action}`);
      else if (step.added) lines.push(`${n}. + [ADDED] ${step.action}${meta(step)}`);
      else if (step.original != null && step.original !== step.action) lines.push(`${n}. ~ [WAS: ${step.original}] ${step.action}${meta(step)}`);
      else lines.push(`${n}. ${step.action}${meta(step)}`);
      const note = wf.stepNotes?.[`${wf.workflowIndex ?? 0}.${i}`]?.trim();
      if (note) lines.push(`    ↳ comment: ${note}`);
    });
    lines.push("");
  });
  if (edits.narration.trim()) { lines.push("### Changes in their words", edits.narration.trim(), ""); }
  const termLines = review.terms
    .map((t, i) => ({ t, note: (edits.termNotes[String(i)] ?? "").trim() }))
    .filter((r) => r.note);
  const addedTerms = (edits.addedTerms ?? []).filter((t) => t.name.trim());
  if (termLines.length || addedTerms.length) {
    lines.push("### Terms");
    termLines.forEach((r) => lines.push(`- ${r.t.name}: ${r.note}`));
    addedTerms.forEach((t) => lines.push(`- + [NEW TERM] ${t.name.trim()}${t.note && t.note.trim() ? `: ${t.note.trim()}` : ""}`));
    lines.push("");
  }
  const answered = review.questions
    .map((q, i) => ({ q, a: (edits.answers[String(i)] ?? "").trim() }))
    .filter((r) => r.a);
  if (answered.length) {
    lines.push("### Constraints, compliance & risks");
    answered.forEach((r) => lines.push(`Q: ${r.q}\nA: ${r.a}`));
  }
  return lines.join("\n").trim();
}

export type ReviewPayload = AgentifyReview | OntologyAtlasReview | ListenWorkflowReview;

/** Distinct actors across the Atlas workflows — the personas whose workflow can
 * be shared for an agentification review, most-active first. */
export function atlasPersonas(program: ProgramSummary): string[] {
  const atlas = innerData(program).currentStateAtlas;
  if (!isRecord(atlas)) return [];
  const counts = new Map<string, number>();
  for (const workflow of (Array.isArray(atlas.workflows) ? atlas.workflows : []).filter(isRecord)) {
    for (const step of (Array.isArray(workflow.steps) ? workflow.steps : []).filter(isRecord)) {
      const actor = str(step.actor).trim();
      if (actor) counts.set(actor, (counts.get(actor) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([actor]) => actor);
}

// ── compose responses → attributed evidence text ──────────────────────────────

const DISPOSITION_LABEL: Record<string, string> = {
  agentify: "Agentify", assist: "Agent assists", keep: "Stays human",
};

/** Turn a persona's per-step dispositions into an attributed evidence block. */
export function composeAgentifyAnswers(
  review: AgentifyReview,
  responses: Record<string, { disposition?: string; comment?: string }>,
  extras?: { architectureResponse?: string; blueprintResponse?: string },
): string {
  const lines: string[] = [`Workflow agentification review — ${review.persona}`, ""];
  review.workflows.forEach((workflow, wi) => {
    lines.push(`## ${workflow.name}`);
    workflow.steps.forEach((step, si) => {
      const key = `${wi}.${si}`;
      const answer = responses[key];
      const disposition = answer?.disposition ? DISPOSITION_LABEL[answer.disposition] ?? answer.disposition : "—";
      const comment = answer?.comment?.trim();
      lines.push(`- [${disposition}] ${step.action}${comment ? ` — ${comment}` : ""}`);
    });
    lines.push("");
  });
  const arch = extras?.architectureResponse?.trim();
  if (review.architecture && arch) {
    lines.push(`## On the proposed architecture${review.architecture.recommendation ? ` (recommended: ${review.architecture.recommendation})` : ""}`);
    lines.push(arch, "");
  }
  const bp = extras?.blueprintResponse?.trim();
  if (review.blueprint && bp) {
    lines.push("## On the agentic blueprint");
    lines.push(bp, "");
  }
  return lines.join("\n").trim();
}

/** Turn per-term and per-workflow comments into an attributed evidence block. */
export function composeOntologyAtlasAnswers(
  review: OntologyAtlasReview,
  termComments: Record<string, string>,
  workflowComments: Record<string, string>,
  overall: string,
): string {
  const lines: string[] = ["Ontology & current-state review", ""];
  const termLines = review.terms
    .map((term, i) => ({ term, comment: (termComments[String(i)] ?? "").trim() }))
    .filter((row) => row.comment);
  if (termLines.length) {
    lines.push("### Domain terms");
    termLines.forEach((row) => lines.push(`- ${row.term.name}: ${row.comment}`));
    lines.push("");
  }
  const wfLines = review.workflows
    .map((workflow, i) => ({ workflow, comment: (workflowComments[String(i)] ?? "").trim() }))
    .filter((row) => row.comment);
  if (wfLines.length) {
    lines.push("### Workflows");
    wfLines.forEach((row) => lines.push(`- ${row.workflow.name}: ${row.comment}`));
    lines.push("");
  }
  if (overall.trim()) { lines.push("### Overall"); lines.push(overall.trim()); }
  return lines.join("\n").trim();
}

/** A short human-readable fallback agenda so a review pack is never question-less
 * (drives the plain interview form if the rich review UI can't render). */
export function reviewFallbackQuestions(review: ReviewPayload): string[] {
  if (review.kind === "agentify") {
    return [
      "For each step of your workflow, should an agent take it over, assist you, or stay human — and why?",
      "Which single step would help you most if it were automated?",
    ];
  }
  if (review.kind === "listen-workflow") {
    return [
      "Walk us through your workflow — what's right, what's wrong, and what steps are missing?",
      ...NON_STRUCTURAL_QUESTIONS,
    ];
  }
  return [
    "Where is a domain term wrong, missing, or named differently by your team?",
    "Where does a mapped workflow not match how the work really runs?",
  ];
}
