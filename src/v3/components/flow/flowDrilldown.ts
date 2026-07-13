/**
 * Drill-downs — "New from this programme" reframed as a focused child that
 * dives into one slice of the parent and stays wired to it.
 *
 * A drill-down anchors on a real object already in the parent's graph: a
 * process/entity (Domain Ontology), a workflow (Current-State Atlas), a persona
 * journey (Discovery Kit), a delivery track (Envision plan), or an outcome
 * (Frame KPI) — plus a free-form scope for a segment/geography/boundary that
 * isn't a first-class artifact yet. Anchoring on an existing node is what makes
 * integration clean: the child inherits that slice (shared ontology + the
 * anchor as its stated scope) and its findings roll back up to the same anchor.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState } from "@/new/lib/programState";
import { listFlowTracks } from "@/v3/components/flow/flowTracks";
import { readMetricRegistry } from "@/v3/components/flow/flowMetricRegistry";

export type DrillKind = "process" | "workflow" | "persona" | "track" | "kpi" | "scope";

export interface DrillAnchor {
  kind: DrillKind;
  /** Stable reference into the parent's graph (index-based for artifact rows). */
  refId: string;
  /** Human label — the node's own name. */
  label: string;
}

export interface DrillAnchorOption {
  refId: string;
  label: string;
  sub?: string;
}

export interface DrillKindMeta {
  kind: DrillKind;
  title: string;
  noun: string;
  /** Plural of noun for counts (defaults to noun + "s"). */
  plural?: string;
  blurb: string;
  /** Inline SVG path(s) for the lens icon. */
  icon: string;
  /** True for the free-form scope lens (no picker, a text input instead). */
  freeform?: boolean;
}

/** "3 processes", "1 workflow" — respects irregular plurals. */
export function countNoun(meta: DrillKindMeta, n: number): string {
  return `${n} ${n === 1 ? meta.noun : (meta.plural ?? `${meta.noun}s`)}`;
}

export const DRILL_KINDS: DrillKindMeta[] = [
  { kind: "process", title: "Process or entity", noun: "process", plural: "processes", icon: "M4 7h16M4 12h16M4 17h10",
    blurb: "Zoom into one entity or sub-process from the Domain Ontology." },
  { kind: "workflow", title: "Workflow", noun: "workflow", icon: "M5 6h6v5H5zM13 13h6v5h-6zM8 11v4h5",
    blurb: "Dive into one workflow from the Current-State Atlas." },
  { kind: "persona", title: "Persona journey", noun: "persona", icon: "M12 11a3 3 0 100-6 3 3 0 000 6zM5 20c0-3.3 3.1-5 7-5s7 1.7 7 5",
    blurb: "Follow one persona's journey end to end." },
  { kind: "track", title: "Delivery track", noun: "track", icon: "M4 12h12M12 7l5 5-5 5",
    blurb: "Take one delivery track or agent deeper." },
  { kind: "kpi", title: "Outcome", noun: "KPI", icon: "M4 19V5M4 19h16M8 15l3-4 3 2 4-6",
    blurb: "Make one success measure its own focused programme." },
  { kind: "scope", title: "Something else", noun: "focus", icon: "M12 5v14M5 12h14", freeform: true,
    blurb: "Name a segment, geography, or boundary to focus on." },
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function inner(program: ProgramSummary): Record<string, unknown> {
  return getProgramState((program.rawData ?? {}) as Record<string, unknown>).inner as Record<string, unknown>;
}

/** The concrete anchors of a given kind available to drill into, from the parent's data. */
export function listDrillAnchors(program: ProgramSummary, kind: DrillKind): DrillAnchorOption[] {
  const d = inner(program);
  if (kind === "process") {
    const arr = Array.isArray(d.ontologyAlignment) ? d.ontologyAlignment : [];
    return arr.filter(isRecord)
      .map((e, i) => ({ refId: `ont-${i}`, label: String(e.entity ?? "").trim() }))
      .filter((o) => o.label);
  }
  if (kind === "workflow") {
    const atlas = d.currentStateAtlas;
    const wfs = isRecord(atlas) && Array.isArray(atlas.workflows) ? atlas.workflows : [];
    return wfs.filter(isRecord)
      .map((w, i) => ({ refId: `wf-${i}`, label: String(w.name ?? "").trim(), sub: Array.isArray(w.steps) ? `${w.steps.length} steps` : undefined }))
      .filter((o) => o.label);
  }
  if (kind === "persona") {
    const kit = d.discoveryKit;
    const ps = isRecord(kit) && Array.isArray(kit.personas) ? kit.personas : [];
    return ps.filter(isRecord)
      .map((p, i) => ({ refId: `ps-${i}`, label: String(p.name ?? "").trim(), sub: String(p.kind ?? "").trim() || undefined }))
      .filter((o) => o.label);
  }
  if (kind === "track") {
    return listFlowTracks(program)
      .map((t) => ({ refId: t.id || `tr-${t.name}`, label: t.name, sub: t.goal || undefined }))
      .filter((o) => o.label && o.label !== "Track");
  }
  if (kind === "kpi") {
    return readMetricRegistry(program)
      .map((k, i) => ({ refId: `kpi-${i}`, label: String(k.name ?? "").trim(), sub: [k.baseline, k.target].filter(Boolean).join(" → ") || undefined }))
      .filter((o) => o.label);
  }
  return [];
}

/** How many anchors of each kind the programme offers (drives the lens picker). */
export function drillAnchorCounts(program: ProgramSummary): Record<DrillKind, number> {
  const counts = {} as Record<DrillKind, number>;
  for (const meta of DRILL_KINDS) counts[meta.kind] = meta.freeform ? -1 : listDrillAnchors(program, meta.kind).length;
  return counts;
}

/** The anchor a programme was drilled down on, if it is a drill-down child. */
export function readDrillAnchor(program: ProgramSummary): DrillAnchor | null {
  const lin = inner(program).lineage;
  if (isRecord(lin) && isRecord(lin.anchor)) {
    const a = lin.anchor;
    const kind = String(a.kind ?? "scope") as DrillKind;
    return { kind, refId: String(a.refId ?? ""), label: String(a.label ?? "").trim() };
  }
  return null;
}

/** The parent id a programme hangs from, if any. */
export function readParentId(program: ProgramSummary): string | null {
  const lin = inner(program).lineage;
  return isRecord(lin) && typeof lin.parentId === "string" ? lin.parentId : null;
}

export interface ChildDrilldown { child: ProgramSummary; anchor: DrillAnchor | null; }

/** Every programme that drilled down from this one, with its anchor. */
export function listChildDrilldowns(parent: ProgramSummary, all: ProgramSummary[]): ChildDrilldown[] {
  return all
    .filter((p) => p.id !== parent.id && readParentId(p) === parent.id)
    .map((child) => ({ child, anchor: readDrillAnchor(child) }));
}

export function drillKindMeta(kind: DrillKind): DrillKindMeta {
  return DRILL_KINDS.find((m) => m.kind === kind) ?? DRILL_KINDS[DRILL_KINDS.length - 1];
}

/* ── Finding roll-up: a child's confirmed findings become parent evidence ── */

/** Where a drill-down's findings land on the parent: the movement (and its
 * transcript capture field) that owns the anchor's kind. */
export function drillRollupTarget(kind: DrillKind): { movementId: string; captureField: string } {
  if (kind === "track") return { movementId: "show", captureField: "demoFeedback" };
  if (kind === "kpi") return { movementId: "evolve", captureField: "opsConversations" };
  return { movementId: "listen", captureField: "interviewTranscripts" };
}

const prettifyKey = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Compose the child's findings as an attributed evidence block for the parent:
 * approved gates, every generated document's summary, and any vocabulary the
 * child discovered beyond the parent's ontology. Returns null when the child
 * has nothing substantive to roll up yet.
 */
export function buildDrilldownFindings(child: ProgramSummary, parent: ProgramSummary): string | null {
  const childInner = inner(child);
  const parentInner = inner(parent);
  const lines: string[] = [];

  const gates = child.gateReviews ?? {};
  const approved = Object.keys(gates).filter((k) => gates[k]?.status === "approved");
  if (approved.length) lines.push(`Gates demonstrated: ${approved.join(", ")}.`);

  for (const [key, value] of Object.entries(childInner)) {
    if (isRecord(value) && typeof value.summary === "string" && value.summary.trim()) {
      lines.push(`${prettifyKey(key)}: ${value.summary.trim()}`);
    }
  }

  const parentEntities = new Set(
    (Array.isArray(parentInner.ontologyAlignment) ? parentInner.ontologyAlignment : [])
      .filter(isRecord).map((e) => String(e.entity ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const newEntities = (Array.isArray(childInner.ontologyAlignment) ? childInner.ontologyAlignment : [])
    .filter(isRecord).map((e) => String(e.entity ?? "").trim())
    .filter((name) => name && !parentEntities.has(name.toLowerCase()));
  if (newEntities.length) lines.push(`New vocabulary discovered: ${newEntities.join(", ")} — consider adopting into this programme's ontology.`);

  return lines.length ? lines.join("\n") : null;
}
