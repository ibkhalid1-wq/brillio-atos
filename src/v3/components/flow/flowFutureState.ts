/**
 * The unified FUTURE-STATE projection — Envision's answer to "what will be",
 * assembled (never authored) from the record the way Listen's Atlas + Ontology
 * ARE the current state. One coherent view: the architecture direction, each
 * workflow's today→tomorrow, the agents, the screens, and the KPIs it moves —
 * with the experience↔agents link map so the two design lenses cross-highlight.
 * Pure and testable; EnvisionCockpit renders it.
 */
import type { ProgramSummary } from "@/new/types";
import { canonicalFrameArea, GENERAL_AREA, kitCoverageDomains, workflowArea } from "@/v3/components/flow/flowAreas";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.map(str).filter((s) => s.trim()) : []);

function inner(program: ProgramSummary): Record<string, unknown> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  return isRecord(raw.data) ? (raw.data as Record<string, unknown>) : raw;
}

/** Judgement-bearing verbs — an agent PREPARES these, a human decides. Kept in
 * step with flowReviews' JUDGEMENT so the future-state view and the stakeholder
 * transformation review agree on which steps stay human. */
const JUDGEMENT = /\b(approv|review|negotiat|decid|sign[- ]?off|meet|calls?\b|present|escalat|interview|relationship|judg|assess)/i;

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
}
/** Loose overlap match — "Quote to Cash" finds an agent whose replacesWorkflow
 * reads "quote-to-cash flow", a flow whose journey names the workflow, etc. */
function overlaps(a: string, b: string, min = 2): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits >= Math.min(min, Math.min(ta.size, tb.size));
}

export type FutureMode = "agentify" | "assist" | "keep";
export interface FutureStep { action: string; mode: FutureMode; agent?: string; hitl?: boolean }
export interface FutureWorkflow { name: string; area: string; trigger?: string; steps: FutureStep[] }
export interface FutureAgent { name: string; purpose?: string; autonomyLevel?: string; replacesWorkflow?: string; area?: string; screenIds: string[] }
export interface FutureScreen { id: string; name: string; area?: string; entities: string[]; agentNames: string[] }
export interface ArchCandidateLite { name: string; shape?: string; description?: string; recommended: boolean }
export interface FutureState {
  hasArchitecture: boolean;
  hasDesign: boolean;
  hasBlueprint: boolean;
  direction: { candidates: ArchCandidateLite[]; chosen: string };
  workflows: FutureWorkflow[];
  agents: FutureAgent[];
  screens: FutureScreen[];
  kpis: string[];
  areas: string[];
}

/** The KPIs the future state is judged against — the charter's success measures. */
function chartKpis(program: ProgramSummary): string[] {
  const charter = inner(program).transformationCharter;
  if (!isRecord(charter)) return [];
  const out: string[] = [];
  const push = (v: unknown) => { const s = str(v).trim(); if (s && !out.includes(s)) out.push(s); };
  if (Array.isArray(charter.kpis)) for (const k of charter.kpis) push(isRecord(k) ? `${str(k.name)}${str(k.target) ? ` → ${str(k.target)}` : ""}` : k);
  if (Array.isArray(charter.successMeasures)) for (const k of charter.successMeasures) push(isRecord(k) ? str(k.measure) || str(k.name) : k);
  push(charter.successMetric);
  if (Array.isArray(charter.objectives)) for (const o of charter.objectives.slice(0, 3)) push(o);
  return out.slice(0, 8);
}

export function projectFutureState(program: ProgramSummary): FutureState {
  const data = inner(program);
  const atlas = isRecord(data.currentStateAtlas) ? data.currentStateAtlas : null;
  const arch = isRecord(data.architectureStrategy) ? data.architectureStrategy : null;
  const design = isRecord(data.experienceDesign) ? data.experienceDesign : null;
  const blueprint = isRecord(data.agenticBlueprint) ? data.agenticBlueprint : null;

  // Direction — the candidates and which was chosen (recommendation, or the
  // recorded decision if it names a candidate).
  const recommendation = arch ? str(arch.recommendation).trim() : "";
  const decision = str((isRecord(data.phaseInputs) && isRecord((data.phaseInputs as Record<string, unknown>).envision)
    ? (data.phaseInputs as Record<string, Record<string, unknown>>).envision.directionDecision : "")).trim();
  const candidates: ArchCandidateLite[] = arch && Array.isArray(arch.candidates)
    ? arch.candidates.filter(isRecord).slice(0, 5).map((c) => ({
        name: str(c.name) || "Option", shape: str(c.shape) || undefined, description: str(c.description) || undefined,
        recommended: !!recommendation && str(c.name).trim().toLowerCase() === recommendation.toLowerCase(),
      }))
    : [];
  const chosen = candidates.find((c) => decision && overlaps(decision, c.name, 1))?.name || recommendation;

  // Workflows: today → tomorrow. Steps carry the proposed mode + the agent that
  // takes them, derived from the atlas + the blueprint (never authored here).
  const bpAgents = blueprint && Array.isArray(blueprint.agents) ? blueprint.agents.filter(isRecord) : [];
  // Prototype inherits the Atlas's area labels, and the Atlas writes whatever
  // the generator chose. Align them to the Discovery Kit's domains — the same
  // alignment programAreas does — or the build studio names areas the kit never
  // agreed to and the phases stop matching each other. A label the kit does not
  // recognise still stands; a genuinely new area must not be swallowed.
  const kitDomains = kitCoverageDomains(program);
  const alignArea = (raw: string): string => {
    if (!kitDomains.length || !raw || raw.includes("/")) return raw;
    const canon = canonicalFrameArea(kitDomains, raw);
    return canon === GENERAL_AREA && raw.trim().toLowerCase() !== GENERAL_AREA.toLowerCase() ? raw : canon;
  };
  // AGENTIFY IS THE HOME OF THE MODE. Listen's third artifact carries the
  // Atlas's workflows forward with the call RECORDED on each step. Where it
  // exists it is the source, and a step's recorded mode WINS over the heuristic
  // — a human said what should happen and this projection must not overrule it.
  // A step it leaves undecided, and every programme with no Agentify document at
  // all, falls straight back to the Atlas and the JUDGEMENT guess below, so
  // nothing that ran before the artifact existed reads differently.
  const agentify = isRecord(data.agentify) ? data.agentify : null;
  const agentifyWfs = agentify && Array.isArray(agentify.workflows) ? agentify.workflows.filter(isRecord) : [];
  const sourceWfs = agentifyWfs.length
    ? agentifyWfs
    : (atlas && Array.isArray(atlas.workflows) ? atlas.workflows.filter(isRecord) : []);
  const isMode = (value: string): value is FutureMode =>
    value === "agentify" || value === "assist" || value === "keep";
  const workflows: FutureWorkflow[] = sourceWfs
    .map((wf): FutureWorkflow => {
      const name = str(wf.name) || "Workflow";
      const owner = bpAgents.find((a) => str(a.replacesWorkflow) && overlaps(str(a.replacesWorkflow), name));
      return {
        name, area: alignArea(workflowArea(wf)), trigger: str(wf.trigger) || undefined,
        steps: (Array.isArray(wf.steps) ? wf.steps.filter(isRecord) : []).slice(0, 12).map((s): FutureStep => {
          const action = str(s.action) || "step";
          const judgement = JUDGEMENT.test(action);
          const recorded = str(s.mode).trim().toLowerCase();
          const mode: FutureMode = isMode(recorded) ? recorded : judgement ? "assist" : "agentify";
          // HITL is a property of the mode once one is recorded: a step kept
          // manual or only assisted still needs the human; an agentified step
          // does not, even where the verb reads like judgement.
          const hitl = isMode(recorded) ? recorded !== "agentify" : judgement;
          return { action, mode, agent: owner ? str(owner.name) : undefined, hitl: hitl || undefined };
        }),
      };
    }).filter((wf) => wf.steps.length).slice(0, 12);

  // Screens with the entities they show; flows tie a screen to a workflow.
  const flows = design && Array.isArray(design.flows) ? design.flows.filter(isRecord) : [];
  const screensRaw = design && Array.isArray(design.screens) ? design.screens.filter(isRecord) : [];
  const screenWorkflow = new Map<string, string>(); // screenId → the workflow its flow serves
  for (const flow of flows) {
    const flowName = `${str(flow.name)} ${str(flow.journey)} ${str(flow.persona)}`;
    const wf = workflows.find((w) => overlaps(flowName, w.name))?.name;
    for (const step of Array.isArray(flow.steps) ? flow.steps.filter(isRecord) : []) {
      const sid = str(step.screen).toLowerCase();
      if (sid && wf && !screenWorkflow.has(sid)) screenWorkflow.set(sid, wf);
    }
  }

  // The experience↔agents link map. An agent powers a screen when it takes over
  // the workflow that screen's flow serves.
  const agents: FutureAgent[] = bpAgents.slice(0, 12).map((a) => ({
    name: str(a.name) || "Agent", purpose: str(a.purpose) || undefined, autonomyLevel: str(a.autonomyLevel) || undefined,
    replacesWorkflow: str(a.replacesWorkflow) || undefined,
    area: (() => { const wf = workflows.find((w) => str(a.replacesWorkflow) && overlaps(str(a.replacesWorkflow), w.name)); return wf?.area; })(),
    screenIds: [],
  }));
  const screens: FutureScreen[] = screensRaw.slice(0, 16).map((sc) => {
    const id = str(sc.id) || str(sc.name);
    const wfName = screenWorkflow.get(id.toLowerCase()) ?? "";
    const agentNames = agents.filter((a) => a.replacesWorkflow && wfName && overlaps(a.replacesWorkflow, wfName)).map((a) => a.name);
    return { id, name: str(sc.name) || id, area: workflows.find((w) => w.name === wfName)?.area, entities: strs(sc.entities).slice(0, 6), agentNames };
  });
  // Back-fill each agent's screens from the reverse map.
  for (const agent of agents) agent.screenIds = screens.filter((s) => s.agentNames.includes(agent.name)).map((s) => s.id);

  const areas = [...new Set([...workflows.map((w) => w.area), ...agents.map((a) => a.area).filter((a): a is string => !!a)])]
    .sort((a, b) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)));

  return {
    hasArchitecture: !!arch, hasDesign: !!design, hasBlueprint: !!blueprint,
    direction: { candidates, chosen },
    workflows, agents, screens, kpis: chartKpis(program), areas,
  };
}
