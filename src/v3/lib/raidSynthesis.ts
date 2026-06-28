/**
 * raidSynthesis — the cross-type correlation pass over the RAID primitives.
 *
 * programRaid.ts owns the three primitives (risks, blockers, decisions) and the
 * two views derived from them (escalations = high-priority decisions, actions =
 * decisions). Each selector reads only its own slice, so none of them can see a
 * relationship that spans types — e.g. a decision that exists *because* of an
 * open risk, or a blocker that sits behind an escalated decision. The program
 * graph (programGraph.ts) connects every entity to its phase but carries no
 * inter-type edges (risk → decision, blocker → risk): risk/decision nodes are
 * leaf-attached to phases. So those links have to be inferred.
 *
 * This module infers them deterministically from the linkage substrate the
 * entries already carry — `relatedArtifactId` and `relatedInputIds` — falling
 * back to phase co-location for serious entries. It NEVER creates, mutates, or
 * re-counts RAID entries: the selectors remain the single source of truth for
 * the entries themselves; this only emits an overlay of typed edges + a factual
 * rollup, keyed to existing entry ids so the rail badge can never drift.
 *
 * The pure core (inferRaidLinkages) takes already-selected arrays so it is
 * trivially testable; synthesizeRaid is the thin wrapper that wires the
 * canonical selectors to it.
 */
import type { DecisionSummary, ProgramSummary, RAIDEntry } from "@/new/types";
import {
  selectBlockers,
  selectDecisions,
  selectHighPriorityDecisions,
  selectRisks,
  type RaidScope,
} from "@/v3/lib/programRaid";

export type RaidEntryKind = "risk" | "blocker" | "decision";
/** Directed relation, read as `from RELATION to`. */
export type RaidLinkRelation = "causes" | "blocks" | "escalates";
/** What grounded the link, strongest first. */
export type RaidLinkBasis = "artifact" | "input" | "phase";

export interface RaidLinkRef {
  kind: RaidEntryKind;
  id: string;
  label: string;
}

export interface RaidLinkage {
  /** Stable, derived from the endpoint ids — safe as a React key. */
  id: string;
  from: RaidLinkRef;
  to: RaidLinkRef;
  relation: RaidLinkRelation;
  basis: RaidLinkBasis;
  rationale: string;
  confidence: number;
}

export interface RaidSynthesis {
  linkages: RaidLinkage[];
  /** Factual, deterministic one-liner for the persona — no model prose. */
  rollup: string;
  stats: {
    risks: number;
    blockers: number;
    decisions: number;
    highPriority: number;
    linkages: number;
  };
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** Kind precedence orders the direction of every edge: risk → blocker → decision. */
const KIND_RANK: Record<RaidEntryKind, number> = { risk: 0, blocker: 1, decision: 2 };
const BASIS_CONFIDENCE: Record<RaidLinkBasis, number> = { artifact: 0.9, input: 0.75, phase: 0.4 };

interface Item {
  kind: RaidEntryKind;
  id: string;
  label: string;
  phase: string;
  severity: string;
  /** high or critical — the only entries that earn a phase-co-location link. */
  serious: boolean;
  artifactId: string | null;
  inputIds: string[];
  escalated: boolean;
}

function raidItem(entry: RAIDEntry, kind: "risk" | "blocker"): Item {
  return {
    kind,
    id: entry.id,
    label: entry.title,
    phase: entry.phase,
    severity: entry.severity,
    serious: entry.severity === "critical" || entry.severity === "high",
    artifactId: entry.relatedArtifactId ?? null,
    inputIds: entry.relatedInputIds ?? [],
    escalated: false,
  };
}

function decisionItem(decision: DecisionSummary, escalatedIds: ReadonlySet<string>): Item {
  return {
    kind: "decision",
    id: decision.id,
    label: decision.title || decision.question || "Decision",
    phase: decision.phaseId,
    severity: decision.priority,
    serious: decision.priority === "critical" || decision.priority === "high",
    artifactId: decision.relatedArtifactId ?? null,
    inputIds: decision.relatedInputIds ?? [],
    escalated: escalatedIds.has(decision.id),
  };
}

function relationFor(from: Item, to: Item): RaidLinkRelation {
  if (to.kind === "decision") {
    if (from.kind === "blocker") return "blocks";
    return to.escalated ? "escalates" : "causes"; // risk → decision
  }
  return "causes"; // risk → blocker
}

/** Strongest shared substrate between two entries, or null if unrelated. */
function basisFor(a: Item, b: Item): { basis: RaidLinkBasis; detail: string } | null {
  if (a.artifactId && b.artifactId && a.artifactId === b.artifactId) {
    return { basis: "artifact", detail: `Both reference artifact ${a.artifactId}.` };
  }
  const sharedInputs = a.inputIds.filter((id) => b.inputIds.includes(id));
  if (sharedInputs.length) {
    return { basis: "input", detail: `Share input field(s): ${sharedInputs.join(", ")}.` };
  }
  // Phase co-location is weak and quadratic, so only the serious source entry
  // earns it — enough to flag "a decision sits amid an open critical risk in the
  // same phase" without drowning the overlay in incidental same-phase pairs.
  if (a.phase && a.phase === b.phase && (a.serious || b.serious)) {
    const source = a.serious ? a : b;
    return {
      basis: "phase",
      detail: `Co-located in phase "${a.phase}"; ${source.kind} severity ${source.severity}.`,
    };
  }
  return null;
}

/**
 * Pure cross-type linkage inference over already-selected entries. Pairs are
 * considered only across different kinds (risk↔blocker, risk↔decision,
 * blocker↔decision); same-kind pairs are skipped. Each linked pair yields at
 * most one edge, directed by KIND_RANK and labelled by its strongest basis.
 */
export function inferRaidLinkages(
  risks: RAIDEntry[],
  blockers: RAIDEntry[],
  decisions: DecisionSummary[],
  escalatedIds: ReadonlySet<string> = new Set(),
): RaidLinkage[] {
  const items: Item[] = [
    ...risks.map((r) => raidItem(r, "risk")),
    ...blockers.map((b) => raidItem(b, "blocker")),
    ...decisions.map((d) => decisionItem(d, escalatedIds)),
  ];

  const linkages: RaidLinkage[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (a.kind === b.kind) continue;
      const grounded = basisFor(a, b);
      if (!grounded) continue;
      const [from, to] = KIND_RANK[a.kind] <= KIND_RANK[b.kind] ? [a, b] : [b, a];
      linkages.push({
        id: `${from.kind}:${from.id}->${to.kind}:${to.id}`,
        from: { kind: from.kind, id: from.id, label: from.label },
        to: { kind: to.kind, id: to.id, label: to.label },
        relation: relationFor(from, to),
        basis: grounded.basis,
        rationale: grounded.detail,
        confidence: BASIS_CONFIDENCE[grounded.basis],
      });
    }
  }
  // Strongest, most confident links first so a truncated overlay keeps signal.
  return linkages.sort((x, y) => y.confidence - x.confidence);
}

/**
 * Decisions under "linkage pressure" — those an open risk or blocker points at.
 * Returns a map of decision id → the strongest incoming-edge confidence, used as
 * a deterministic RANKING signal: a decision grounded in an open risk should sit
 * above an equal-priority peer that has nothing pulling on it. This deliberately
 * does NOT touch any decision's priority or escalation flag, so the counts the
 * rail badge and Executive summary read (selectHighPriorityDecisions) never drift —
 * it only reorders within a priority band. Higher confidence wins ties.
 */
export function decisionLinkagePressure(linkages: RaidLinkage[]): Map<string, number> {
  const pressure = new Map<string, number>();
  for (const link of linkages) {
    if (link.to.kind !== "decision") continue;
    if (link.from.kind !== "risk" && link.from.kind !== "blocker") continue;
    pressure.set(link.to.id, Math.max(pressure.get(link.to.id) ?? 0, link.confidence));
  }
  return pressure;
}

function buildRollup(
  stats: RaidSynthesis["stats"],
  linkages: RaidLinkage[],
): string {
  const decisionsFromRisks = new Set(
    linkages
      .filter((link) => link.from.kind === "risk" && link.to.kind === "decision")
      .map((link) => link.to.id),
  ).size;
  const head =
    `${stats.risks} risk(s), ${stats.blockers} blocker(s), ` +
    `${stats.decisions} decision(s) (${stats.highPriority} high priority).`;
  if (!stats.linkages) return `${head} No cross-type linkages found.`;
  const tail = decisionsFromRisks
    ? ` ${decisionsFromRisks} decision(s) trace to open risks.`
    : "";
  return `${head} ${stats.linkages} cross-type link(s).${tail}`;
}

/**
 * Wire the canonical RAID selectors to the pure inference pass. Reads the same
 * (program, scope) the rest of the app counts from, so the synthesis can never
 * disagree with the lists it overlays.
 */
export function synthesizeRaid(
  program: ProgramSummary | null | undefined,
  scope: RaidScope = "programme",
  personaId?: string,
): RaidSynthesis {
  const risks = selectRisks(program, scope);
  const blockers = selectBlockers(program, scope);
  const decisions = selectDecisions(program, scope, personaId);
  const highPriority = selectHighPriorityDecisions(program, scope, personaId);
  const highPriorityIds = new Set(highPriority.map((decision) => decision.id));

  const linkages = inferRaidLinkages(risks, blockers, decisions, highPriorityIds);
  const stats = {
    risks: risks.length,
    blockers: blockers.length,
    decisions: decisions.length,
    highPriority: highPriority.length,
    linkages: linkages.length,
  };
  return { linkages, rollup: buildRollup(stats, linkages), stats };
}
