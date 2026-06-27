/**
 * Program Graph — the unified, derived knowledge graph for a single programme.
 *
 * The Fact Graph (factGraph.ts) holds atomic citable facts and their artifact
 * lineage; deriveTwinGraph holds a thin phase/decision/risk entity view. Neither
 * unifies the two, and neither carries the document → fact → artifact lineage in
 * one structure that both the Intelligence view can render and an agent can be
 * fed as cross-phase context.
 *
 * buildProgramGraph composes them into one typed graph: phases, facts, the
 * documents those facts were extracted from, the artifacts they ground, plus the
 * programme entities (KPIs, risks, decisions, stakeholders). It is a pure,
 * testable selector over `ProgramSummary` — no backend, no writes — so it always
 * reflects everything earlier phases have produced. selectGraphForPhase then
 * slices it to a phase's relevant subgraph (current + all prior phases + global
 * nodes) and compresses it for prompt injection, the graph analogue of
 * factGraph.selectFactsForArtifacts.
 *
 * Node/edge shapes match TransformationTwinGraph's reader (`node.type`/`label`,
 * `edge.from`/`to`) so the same structure renders without adaptation.
 */
import type { ProgramSummary } from "@/new/types";
import { buildFactGraph, type Fact } from "@/v3/lib/factGraph";

export type ProgramGraphNodeKind =
  | "phase" | "fact" | "document" | "artifact" | "kpi" | "risk" | "decision" | "stakeholder";

export interface ProgramGraphNode {
  id: string;
  type: ProgramGraphNodeKind;
  label: string;
  /** Owning phase id (bare, e.g. "strategy"). Absent for programme-global nodes. */
  phaseCreated?: string;
  confidence?: number;
  properties?: Record<string, unknown>;
}

export interface ProgramGraphEdge {
  id: string;
  from: string;
  to: string;
  /** sequence | extracted_to | grounds | in_phase */
  type: string;
}

export interface ProgramGraph {
  nodes: ProgramGraphNode[];
  edges: ProgramGraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    byKind: Record<ProgramGraphNodeKind, number>;
    documentCount: number;
    /** Facts that ground no artifact — candidates for pruning or review. */
    orphanFacts: number;
  };
}

const PHASE = (id: string) => `phase:${id}`;
const FACT = (id: string) => `fact:${id}`;
const DOC = (name: string) => `doc:${name}`;
const ARTIFACT = (id: string) => `artifact:${id}`;
const KPI = (id: string) => `kpi:${id}`;
const RISK = (id: string) => `risk:${id}`;
const DECISION = (id: string) => `decision:${id}`;
const STAKEHOLDER = (id: string) => `stakeholder:${id}`;

interface KpiRow { id?: string; name?: string; baseline?: string; target?: string; unit?: string }

function parseKpiRows(raw: unknown): KpiRow[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KpiRow[]) : [];
  } catch {
    return [];
  }
}

function strategyKpiRaw(program: ProgramSummary): unknown {
  const raw = (program.rawData || {}) as Record<string, unknown>;
  const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
  const pi = inner.phaseInputs;
  if (typeof pi !== "object" || pi === null) return undefined;
  const strategy = (pi as Record<string, unknown>).strategy;
  return typeof strategy === "object" && strategy !== null ? (strategy as Record<string, unknown>).kpis : undefined;
}

/**
 * Compose the unified Program Graph from a programme's derived state. Pure: it
 * reads ProgramSummary (phases, artifacts, raidEntries, decisionQueue,
 * stakeholders) and the Fact Graph, and never writes. Re-running after a later
 * phase produces inputs/artifacts yields a graph that has grown to include them.
 */
export function buildProgramGraph(program: ProgramSummary | null | undefined): ProgramGraph {
  const nodes = new Map<string, ProgramGraphNode>();
  const edges = new Map<string, ProgramGraphEdge>();
  const addNode = (node: ProgramGraphNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const addEdge = (edge: ProgramGraphEdge) => { if (!edges.has(edge.id)) edges.set(edge.id, edge); };

  if (!program) {
    return {
      nodes: [], edges: [],
      stats: { nodeCount: 0, edgeCount: 0, documentCount: 0, orphanFacts: 0, byKind: emptyKindCounts() },
    };
  }

  // Phases (+ sequence edges) establish the spine and the phase ordering.
  const phaseIds = new Set((program.phases || []).map((p) => p.id));
  (program.phases || []).forEach((phase, index) => {
    addNode({
      id: PHASE(phase.id), type: "phase", label: phase.displayName || phase.id, phaseCreated: phase.id,
      properties: { pct: phase.pct, status: phase.status },
    });
    if (index > 0) {
      const prev = program.phases[index - 1].id;
      addEdge({ id: `seq:${prev}->${phase.id}`, from: PHASE(prev), to: PHASE(phase.id), type: "sequence" });
    }
  });

  // Artifacts the programme has produced; a planned-artifact placeholder is added
  // later for any artifact a fact grounds that has not yet been generated, so a
  // grounds edge never dangles.
  (program.artifacts || []).forEach((artifact) => {
    addNode({
      id: ARTIFACT(artifact.id), type: "artifact", label: artifact.title || artifact.id, phaseCreated: artifact.phaseId,
      confidence: artifact.agentConfidence,
      properties: { status: artifact.status, version: artifact.versionNumber },
    });
    if (phaseIds.has(artifact.phaseId)) {
      addEdge({ id: `inphase:${artifact.id}`, from: ARTIFACT(artifact.id), to: PHASE(artifact.phaseId), type: "in_phase" });
    }
  });

  // Facts, the documents they were extracted from, and the artifacts they ground.
  const factGraph = buildFactGraph(program);
  factGraph.facts.forEach((fact: Fact) => {
    addNode({
      id: FACT(fact.id), type: "fact", label: fact.factText, phaseCreated: fact.sourceId,
      confidence: fact.confidence,
      properties: { factType: fact.factType, status: fact.status, sourceType: fact.sourceType },
    });
    if (phaseIds.has(fact.sourceId)) {
      addEdge({ id: `inphase:${fact.id}`, from: FACT(fact.id), to: PHASE(fact.sourceId), type: "in_phase" });
    }
    if (fact.sourceType === "imported_document" && fact.sourceName) {
      addNode({ id: DOC(fact.sourceName), type: "document", label: fact.sourceName });
      addEdge({ id: `ext:${fact.sourceName}->${fact.id}`, from: DOC(fact.sourceName), to: FACT(fact.id), type: "extracted_to" });
    }
    fact.impactedArtifacts.forEach((artifactId) => {
      if (!nodes.has(ARTIFACT(artifactId))) {
        addNode({ id: ARTIFACT(artifactId), type: "artifact", label: artifactId, properties: { status: "planned" } });
      }
      addEdge({ id: `grounds:${fact.id}->${artifactId}`, from: FACT(fact.id), to: ARTIFACT(artifactId), type: "grounds" });
    });
  });

  // Strategy KPIs (structured, excluded from the Fact Graph) as their own nodes.
  parseKpiRows(strategyKpiRaw(program)).forEach((row, index) => {
    const name = (row.name || "").trim();
    if (!name) return;
    const id = row.id || String(index);
    const detail = [row.baseline, row.target, row.unit].filter(Boolean).join(" → ");
    addNode({
      id: KPI(id), type: "kpi", label: detail ? `${name}: ${detail}` : name, phaseCreated: "strategy",
      properties: { baseline: row.baseline, target: row.target, unit: row.unit },
    });
    if (phaseIds.has("strategy")) {
      addEdge({ id: `inphase:kpi:${id}`, from: KPI(id), to: PHASE("strategy"), type: "in_phase" });
    }
  });

  // Open risks/blockers and open decisions, scoped to their phase.
  (program.raidEntries || [])
    .filter((entry) => entry.status !== "closed")
    .forEach((entry) => {
      addNode({
        id: RISK(entry.id), type: "risk", label: entry.title, phaseCreated: entry.phase,
        confidence: entry.agentConfidence,
        properties: { raidType: entry.type, severity: entry.severity, status: entry.status },
      });
      if (phaseIds.has(entry.phase)) {
        addEdge({ id: `inphase:risk:${entry.id}`, from: RISK(entry.id), to: PHASE(entry.phase), type: "in_phase" });
      }
    });

  (program.decisionQueue || [])
    .filter((decision) => !decision.status || decision.status === "open")
    .forEach((decision) => {
      addNode({
        id: DECISION(decision.id), type: "decision", label: decision.title || decision.question || "Decision",
        phaseCreated: decision.phaseId,
        properties: { priority: decision.priority, status: decision.status || "open" },
      });
      if (phaseIds.has(decision.phaseId)) {
        addEdge({ id: `inphase:decision:${decision.id}`, from: DECISION(decision.id), to: PHASE(decision.phaseId), type: "in_phase" });
      }
    });

  // Stakeholders are programme-global (no single phase), so they carry no
  // phaseCreated and are surfaced in every phase slice as ambient context.
  (program.stakeholders || []).forEach((stakeholder) => {
    addNode({
      id: STAKEHOLDER(stakeholder.id), type: "stakeholder",
      label: `${stakeholder.name}${stakeholder.role ? ` (${stakeholder.role})` : ""}`,
      properties: { influence: stakeholder.influence, engagement: stakeholder.currentEngagement },
    });
  });

  const nodeList = [...nodes.values()];
  const byKind = emptyKindCounts();
  for (const node of nodeList) byKind[node.type] += 1;

  return {
    nodes: nodeList,
    edges: [...edges.values()],
    stats: {
      nodeCount: nodeList.length,
      edgeCount: edges.size,
      byKind,
      documentCount: byKind.document,
      orphanFacts: factGraph.stats.orphans,
    },
  };
}

function emptyKindCounts(): Record<ProgramGraphNodeKind, number> {
  return { phase: 0, fact: 0, document: 0, artifact: 0, kpi: 0, risk: 0, decision: 0, stakeholder: 0 };
}

export interface ProgramGraphSelection {
  nodes: ProgramGraphNode[];
  edges: ProgramGraphEdge[];
  /** Prompt-ready, compressed citation block for the selected nodes. */
  citations: string;
  reduction: {
    fullChars: number;
    scopedChars: number;
    droppedChars: number;
    /** Percentage of the full graph's compressed characters pruned (0–100). */
    reductionPct: number;
  };
}

const CONFIDENCE_WORD = (c: number | undefined): string =>
  c === undefined ? "n/a" : c >= 0.85 ? "high" : c >= 0.6 ? "medium" : "low";

/** Compact one-line citation for a node — the prompt-injection format. */
export function compressProgramNode(node: ProgramGraphNode): string {
  const phase = node.phaseCreated ? ` [${node.phaseCreated}]` : "";
  const conf = node.type === "fact" || node.type === "artifact" ? ` (confidence: ${CONFIDENCE_WORD(node.confidence)})` : "";
  return `${node.type}${phase}: ${node.label}${conf}`;
}

export function compressProgramGraph(nodes: ProgramGraphNode[]): string {
  return nodes.map(compressProgramNode).join("\n");
}

/**
 * Slice the graph to the context relevant when an agent runs for `phaseId`:
 * the phase itself, every prior phase (so later phases build on earlier
 * outputs), all nodes belonging to those phases, the documents feeding the
 * selected facts, and programme-global nodes (stakeholders). Reports the token
 * saving versus sending the whole graph — composes like selectFactsForArtifacts.
 */
export function selectGraphForPhase(graph: ProgramGraph, phaseId: string): ProgramGraphSelection {
  const phaseOrder = graph.nodes.filter((n) => n.type === "phase").map((n) => n.phaseCreated as string);
  const targetIndex = phaseOrder.indexOf(phaseId);
  // Unknown phase → no phase context, but global nodes still apply.
  const allowedPhases = new Set(targetIndex >= 0 ? phaseOrder.slice(0, targetIndex + 1) : []);

  const selectedIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === "document") continue; // pulled in by edges below
    if (node.phaseCreated === undefined) { selectedIds.add(node.id); continue; } // global
    if (allowedPhases.has(node.phaseCreated)) selectedIds.add(node.id);
  }
  // Documents that fed any selected fact come along as provenance.
  for (const edge of graph.edges) {
    if (edge.type === "extracted_to" && selectedIds.has(edge.to)) selectedIds.add(edge.from);
  }

  const nodes = graph.nodes.filter((n) => selectedIds.has(n.id));
  const selEdges = graph.edges.filter((e) => selectedIds.has(e.from) && selectedIds.has(e.to));
  const citations = compressProgramGraph(nodes);
  const fullChars = compressProgramGraph(graph.nodes).length;
  const scopedChars = citations.length;
  const droppedChars = Math.max(0, fullChars - scopedChars);
  const reductionPct = fullChars === 0 ? 0 : Math.round((droppedChars / fullChars) * 100);

  return { nodes, edges: selEdges, citations, reduction: { fullChars, scopedChars, droppedChars, reductionPct } };
}
