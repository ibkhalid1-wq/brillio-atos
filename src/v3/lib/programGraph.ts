/**
 * Program Graph — the unified, derived program graph for a single programme.
 * (An in-memory typed graph — nodes + derived edges + traversal — assembled per
 * read, not a persisted graph database.)
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
import { ATOS_STANDARD, getPhaseDefinition } from "@/v3/lib/methodology";
import type { DocumentIntelligence, ExtractedEntities } from "@/new/lib/documentIntelligenceTypes";

export type ProgramGraphNodeKind =
  | "phase" | "fact" | "document" | "artifact" | "kpi" | "risk" | "decision" | "stakeholder" | "insight" | "requirement"
  | "scope" | "increment";

/**
 * A processed document supplied to the graph. The entities the extractor found
 * but that never mapped to a declared phase field (constraints, assumptions,
 * recommendations, gaps) are otherwise lost to every downstream phase; passing
 * the document here turns them into `insight` nodes anchored at its primary
 * phase, so they flow forward like any other phase output.
 */
export interface ProgramDocument {
  id: string;
  fileName: string;
  intelligence: DocumentIntelligence;
}

/** Entity categories that rarely map to a phase field, so they would otherwise
 *  be dropped from cross-phase context. */
const INSIGHT_CATEGORIES: Array<keyof ExtractedEntities> = ["constraints", "assumptions", "recommendations", "gaps"];

function entityText(entity: unknown): string {
  if (typeof entity !== "object" || entity === null) return "";
  const record = entity as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : typeof record.description === "string" ? record.description : "";
  return text.trim();
}

function entityConfidence(entity: unknown): number | undefined {
  if (typeof entity !== "object" || entity === null) return undefined;
  const value = (entity as Record<string, unknown>).confidence;
  return typeof value === "number" ? value : undefined;
}

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
const REQUIREMENT = (id: string) => `requirement:${id}`;
const SCOPE = (id: string) => `scope:${id}`;
const INCREMENT = (id: string) => `increment:${id}`;

interface KpiRow { id?: string; name?: string; baseline?: string; target?: string; unit?: string; objective?: string }
interface RequirementRow { id?: string; requirement?: string; category?: string; priority?: string; target?: string }
interface DesignDecisionRow { id?: string; decision?: string; optionsConsidered?: string; rationale?: string; addresses?: string }
interface ScopeRow { id?: string; item?: string; category?: string }
interface IncrementRow { id?: string; increment?: string; scope?: string; date?: string; delivers?: string }

/** Normalise a requirement reference for label-matching: lowercase, strip
 *  punctuation, collapse whitespace. Lets a design decision's free-text
 *  "addresses" cell resolve to a requirement node without the PM knowing the
 *  requirement's internal id. */
function normalizeRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Split a decision's "addresses" cell (comma/semicolon/newline separated) into
 *  individual requirement references. */
function splitRefs(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseGridRows<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * The artifact ids that consume a given phase-input field, per the static
 * methodology — the union of the field's `usedByArtifacts` and every artifact
 * whose `artifactInputFlow` lists the field. Drives `traces_to` provenance: an
 * artifact generated from a requirement/scope/KPI field traces back to the nodes
 * minted from it, a link the Fact Graph cannot carry (those fields are excluded
 * from facts). Reads the same ATOS_STANDARD registry the Fact Graph uses.
 */
function artifactsConsumingField(phaseId: string, fieldId: string): string[] {
  // Resolve the phase from whichever methodology defines it — flow phases
  // (frame/listen/…) are invisible to the classic registry (rec 3).
  const phase = ATOS_STANDARD.phases.find((p) => p.id === phaseId) ?? getPhaseDefinition(phaseId, "atos-flow");
  if (!phase) return [];
  const out = new Set<string>();
  const field = phase.inputFields?.find((f) => f.id === fieldId);
  for (const artifactId of field?.usedByArtifacts ?? []) out.add(artifactId);
  for (const [artifactId, fields] of Object.entries(phase.artifactInputFlow ?? {})) {
    if (fields.includes(fieldId)) out.add(artifactId);
  }
  return [...out];
}

/** Read one phase-input field's raw value, tolerant of the wrapped/unwrapped
 *  rawData shapes both persist in the wild. */
function phaseInputRaw(program: ProgramSummary, phaseId: string, fieldId: string): unknown {
  const raw = (program.rawData || {}) as Record<string, unknown>;
  const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
  const pi = inner.phaseInputs;
  if (typeof pi !== "object" || pi === null) return undefined;
  const bucket = (pi as Record<string, unknown>)[phaseId];
  return typeof bucket === "object" && bucket !== null ? (bucket as Record<string, unknown>)[fieldId] : undefined;
}

/**
 * Compose the unified Program Graph from a programme's derived state. Pure: it
 * reads ProgramSummary (phases, artifacts, raidEntries, decisionQueue,
 * stakeholders) and the Fact Graph, and never writes. Re-running after a later
 * phase produces inputs/artifacts yields a graph that has grown to include them.
 */
export function buildProgramGraph(
  program: ProgramSummary | null | undefined,
  documents: ProgramDocument[] = [],
): ProgramGraph {
  const nodes = new Map<string, ProgramGraphNode>();
  const edges = new Map<string, ProgramGraphEdge>();
  const addNode = (node: ProgramGraphNode) => { if (!nodes.has(node.id)) nodes.set(node.id, node); };
  const addEdge = (edge: ProgramGraphEdge) => { if (!edges.has(edge.id)) edges.set(edge.id, edge); };
  // Link a minted input node (requirement/scope/KPI) back to the artifacts that
  // consume its source field, but only to artifacts that already exist as nodes,
  // so a `traces_to` edge never dangles to an ungenerated artifact.
  const addTracesTo = (nodeId: string, phaseId: string, fieldId: string) => {
    for (const artifactId of artifactsConsumingField(phaseId, fieldId)) {
      if (nodes.has(ARTIFACT(artifactId))) {
        addEdge({ id: `traces_to:${ARTIFACT(artifactId)}->${nodeId}`, from: ARTIFACT(artifactId), to: nodeId, type: "traces_to" });
      }
    }
  };

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

  // Processed documents: a rich document node (added before fact provenance so
  // its summary/type win the idempotent merge) plus insight nodes for entities
  // that never became phase fields, anchored at the document's primary phase so
  // they flow forward to later phases.
  documents.forEach((doc) => {
    const intel = doc.intelligence;
    addNode({
      id: DOC(doc.fileName), type: "document", label: doc.fileName,
      confidence: intel.overallConfidence,
      properties: { documentType: intel.documentType, summary: intel.summary, primaryPhase: intel.primaryPhase },
    });
    const anchorPhase = phaseIds.has(intel.primaryPhase) ? intel.primaryPhase : undefined;
    const entities = (intel.entities || {}) as Partial<ExtractedEntities>;
    INSIGHT_CATEGORIES.forEach((category) => {
      const list = Array.isArray(entities[category]) ? entities[category] as unknown[] : [];
      list.forEach((entity, index) => {
        const text = entityText(entity);
        if (!text) return;
        const insightId = `insight:${doc.fileName}:${category}:${index}`;
        addNode({
          id: insightId, type: "insight", label: text, phaseCreated: anchorPhase,
          confidence: entityConfidence(entity),
          properties: { category, document: doc.fileName },
        });
        addEdge({ id: `mentions:${insightId}`, from: DOC(doc.fileName), to: insightId, type: "mentions" });
        if (anchorPhase) {
          addEdge({ id: `inphase:${insightId}`, from: insightId, to: PHASE(anchorPhase), type: "in_phase" });
        }
      });
    });
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
  parseGridRows<KpiRow>(phaseInputRaw(program, "strategy", "kpis")).forEach((row, index) => {
    const name = (row.name || "").trim();
    if (!name) return;
    const id = row.id || String(index);
    const detail = [row.baseline, row.target, row.unit].filter(Boolean).join(" → ");
    addNode({
      id: KPI(id), type: "kpi", label: detail ? `${name}: ${detail}` : name, phaseCreated: "strategy",
      // `objective` (optional) names the specific objective this KPI measures, so
      // the objective graph can attribute it per-objective rather than to every
      // objective. Absent for single-objective programmes (the common case).
      properties: { baseline: row.baseline, target: row.target, unit: row.unit, objective: row.objective },
    });
    if (phaseIds.has("strategy")) {
      addEdge({ id: `inphase:kpi:${id}`, from: KPI(id), to: PHASE("strategy"), type: "in_phase" });
    }
    addTracesTo(KPI(id), "strategy", "kpis");
  });

  // Declared requirements (structured grids, excluded from the Fact Graph) as
  // first-class requirement nodes: functional requirements from Discover and
  // non-functional requirements from Design. The objective graph's satisfied-by
  // chain and the cross-artifact validator attach to these *declared*
  // requirements — with stable ids carried on the grid rows — rather than only
  // requirements synthesised from validation findings. The generating agents
  // still read the grids directly via artifactInputFlow, so excluding them from
  // facts does not remove them from generation prompts (mirrors the KPI treatment).
  const requirementSources: Array<{ phaseId: string; fieldId: string; defaultCategory?: string }> = [
    { phaseId: "discover", fieldId: "requirements" },
    { phaseId: "design", fieldId: "nonFunctionalRequirements", defaultCategory: "Non-functional" },
  ];
  // Normalised requirement label → requirement node id, so a design decision's
  // free-text "addresses" cell can be resolved to real requirement nodes below.
  const requirementByLabel = new Map<string, string>();
  for (const src of requirementSources) {
    parseGridRows<RequirementRow>(phaseInputRaw(program, src.phaseId, src.fieldId)).forEach((row, index) => {
      const text = (row.requirement || "").trim();
      if (!text) return;
      // Fallback id is field-scoped so a discover row and a design row at the same
      // index can never collide on `requirement:0`.
      const id = row.id || `${src.fieldId}-${index}`;
      addNode({
        id: REQUIREMENT(id), type: "requirement", label: text, phaseCreated: src.phaseId,
        properties: { category: row.category || src.defaultCategory, priority: row.priority, target: row.target },
      });
      if (phaseIds.has(src.phaseId)) {
        addEdge({ id: `inphase:req:${id}`, from: REQUIREMENT(id), to: PHASE(src.phaseId), type: "in_phase" });
      }
      addTracesTo(REQUIREMENT(id), src.phaseId, src.fieldId);
      const key = normalizeRef(text);
      if (key && !requirementByLabel.has(key)) requirementByLabel.set(key, REQUIREMENT(id));
    });
  }

  // Key design decisions (structured grid on Design) as resolved decision nodes,
  // each linked to the requirement(s) it names in its "addresses" cell via an
  // `addresses` edge. This closes the design → requirement traceability chain:
  // the graph can now show which declared requirements a design decision was made
  // to satisfy, and (by absence) which requirements no decision references. Refs
  // are matched to requirement nodes by normalised label, so the PM/agent writes
  // the requirement text rather than an internal id. Minted before the decision
  // queue so a design-decision id always wins the idempotent node merge.
  parseGridRows<DesignDecisionRow>(phaseInputRaw(program, "design", "keyDesignDecisions")).forEach((row, index) => {
    const text = (row.decision || "").trim();
    if (!text) return;
    const id = row.id || `keyDesignDecisions-${index}`;
    addNode({
      id: DECISION(id), type: "decision", label: text, phaseCreated: "design",
      properties: { status: "resolved", optionsConsidered: row.optionsConsidered, rationale: row.rationale },
    });
    if (phaseIds.has("design")) {
      addEdge({ id: `inphase:decision:${id}`, from: DECISION(id), to: PHASE("design"), type: "in_phase" });
    }
    for (const ref of splitRefs(row.addresses)) {
      const reqNodeId = requirementByLabel.get(normalizeRef(ref));
      if (reqNodeId) {
        addEdge({ id: `addresses:${id}->${reqNodeId}`, from: DECISION(id), to: reqNodeId, type: "addresses" });
      }
    }
  });

  // In-scope items (Discover scopeInclusions grid) as first-class scope nodes,
  // and delivery increments (Build deliveryIncrements grid) as increment nodes
  // linked to the scope items they deliver via `delivers` edges. This closes the
  // delivery → scope traceability chain: the graph can show which increment ships
  // each declared scope item and (by absence) which in-scope items no increment
  // yet delivers. Refs are matched by normalised item label, so the PM/agent
  // writes the scope text rather than an internal id.
  const scopeByLabel = new Map<string, string>();
  parseGridRows<ScopeRow>(phaseInputRaw(program, "discover", "scopeInclusions")).forEach((row, index) => {
    const text = (row.item || "").trim();
    if (!text) return;
    const id = row.id || `scopeInclusions-${index}`;
    addNode({
      id: SCOPE(id), type: "scope", label: text, phaseCreated: "discover",
      properties: { category: row.category },
    });
    if (phaseIds.has("discover")) {
      addEdge({ id: `inphase:scope:${id}`, from: SCOPE(id), to: PHASE("discover"), type: "in_phase" });
    }
    addTracesTo(SCOPE(id), "discover", "scopeInclusions");
    const key = normalizeRef(text);
    if (key && !scopeByLabel.has(key)) scopeByLabel.set(key, SCOPE(id));
  });

  parseGridRows<IncrementRow>(phaseInputRaw(program, "build", "deliveryIncrements")).forEach((row, index) => {
    const text = (row.increment || "").trim();
    if (!text) return;
    const id = row.id || `deliveryIncrements-${index}`;
    addNode({
      id: INCREMENT(id), type: "increment", label: text, phaseCreated: "build",
      properties: { scope: row.scope, date: row.date },
    });
    if (phaseIds.has("build")) {
      addEdge({ id: `inphase:increment:${id}`, from: INCREMENT(id), to: PHASE("build"), type: "in_phase" });
    }
    for (const ref of splitRefs(row.delivers)) {
      const scopeNodeId = scopeByLabel.get(normalizeRef(ref));
      if (scopeNodeId) {
        addEdge({ id: `delivers:${id}->${scopeNodeId}`, from: INCREMENT(id), to: scopeNodeId, type: "delivers" });
      }
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
  return { phase: 0, fact: 0, document: 0, artifact: 0, kpi: 0, risk: 0, decision: 0, stakeholder: 0, insight: 0, requirement: 0, scope: 0, increment: 0 };
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
 * The semantic (ontology-bearing) edge types worth serialising into a prompt —
 * the ones that answer "how does this connect to that". Structural edges
 * (`sequence`, `in_phase`) and pure provenance plumbing (`extracted_to`,
 * `mentions`) are omitted: they add lines without telling the agent anything it
 * can act on.
 */
const RELATIONSHIP_PHRASE: Record<string, string> = {
  grounds: "grounds",
  traces_to: "traces to",
  addresses: "addresses",
  delivers: "delivers",
};

/** Trim a node label to keep a relationship line compact in the prompt budget. */
function shortLabel(label: string, max = 48): string {
  const clean = label.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Render the graph's semantic edges as compact `subject relation object` lines,
 * resolving endpoint ids to their node labels. Skips structural/provenance edges
 * and any edge whose endpoints are not both in `nodes` (so it composes with a
 * phase-scoped selection). This is the relationship complement to
 * {@link compressProgramGraph}, which only ever listed nodes in isolation.
 */
export function compressProgramEdges(edges: ProgramGraphEdge[], nodes: ProgramGraphNode[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];
  for (const edge of edges) {
    const phrase = RELATIONSHIP_PHRASE[edge.type];
    if (!phrase) continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    lines.push(`${from.type} "${shortLabel(from.label)}" ${phrase} ${to.type} "${shortLabel(to.label)}"`);
  }
  return lines.join("\n");
}

/**
 * Signal weight per node kind — how much a node of this kind is worth carrying
 * into a budget-limited prompt. Open risks and decisions steer the next phase
 * most; facts and artifacts are the grounding; requirements/KPIs/scope are the
 * traceability spine; insights and stakeholders are supporting colour; documents
 * and phase markers are the least additive as standalone citation lines.
 */
const NODE_KIND_WEIGHT: Record<ProgramGraphNodeKind, number> = {
  risk: 5, decision: 5, fact: 4, artifact: 4,
  requirement: 3, kpi: 3, scope: 3, increment: 3,
  insight: 2, stakeholder: 2, document: 1, phase: 0,
};

/**
 * Rank a phase slice's nodes by relevance to `targetPhaseId`, most-relevant
 * first, so a budget-limited prompt keeps the highest-signal citations instead of
 * whatever happened to sit at the head of the list. Relevance combines phase
 * recency (a node from the current or an adjacent phase outranks an ancient one),
 * node-kind signal, and — for facts/artifacts — grounding confidence. Programme-
 * global nodes (no phase) are treated as current-phase relevant. Pure and stable:
 * ties preserve the input order.
 */
export function rankNodesForPhase(
  nodes: ProgramGraphNode[],
  phaseOrder: string[],
  targetPhaseId: string,
): ProgramGraphNode[] {
  const targetIndex = phaseOrder.indexOf(targetPhaseId);
  const recency = (node: ProgramGraphNode): number => {
    if (node.phaseCreated === undefined) return targetIndex >= 0 ? targetIndex : 0; // global ≈ current
    const idx = phaseOrder.indexOf(node.phaseCreated);
    return idx >= 0 ? idx : 0;
  };
  const score = (node: ProgramGraphNode): number =>
    recency(node) * 2 + (NODE_KIND_WEIGHT[node.type] ?? 0) + (node.confidence ?? 0) * 2;

  return nodes
    .map((node, index) => ({ node, index, s: score(node) }))
    .sort((a, b) => (b.s !== a.s ? b.s - a.s : a.index - b.index))
    .map((entry) => entry.node);
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

const GRAPH_CONTEXT_HEADER =
  "Program graph (prior phases — facts, artifacts, risks, decisions, KPIs):";
const GRAPH_RELATIONSHIPS_HEADER = "Relationships (how the above connect):";

/**
 * Fit `header` + as many whole `body` lines as `maxChars` allows, preserving the
 * body's order (which is relevance-ranked upstream) but skipping any single line
 * that would overflow so a lower-priority line that still fits is not lost behind
 * one long high-priority line. Whole lines only — a line is never cut mid-item.
 * Returns "" when no line fits under the header.
 */
function fitBlock(header: string, body: string, maxChars: number): string {
  const full = `${header}\n${body}`;
  if (full.length <= maxChars) return full;
  const kept: string[] = [];
  let used = header.length;
  for (const line of body.split("\n")) {
    const next = used + 1 + line.length;
    if (next > maxChars) continue; // skip the overflow, keep trying shorter lines
    kept.push(line);
    used = next;
  }
  return kept.length ? `${header}\n${kept.join("\n")}` : "";
}

/**
 * Prompt-ready cross-phase grounding for an agent running at `targetPhaseId`:
 * the compressed citation block for that phase's slice (current + all prior
 * phases + programme-global nodes). This is the structured complement to the
 * approved-artifact summaries — it also carries the facts, open risks/decisions
 * and KPIs the artifact prose alone never surfaces.
 *
 * Returns "" when there is nothing to add (no program, empty graph, empty
 * slice) so callers can append it unconditionally. The block is capped to
 * `maxChars` by dropping whole citation lines from the tail, so a line is never
 * cut mid-fact, and the result shares a fixed prompt budget with other context.
 */
export function buildProgramGraphContext(
  program: ProgramSummary | null | undefined,
  targetPhaseId: string,
  maxChars = 900,
): string {
  if (!program || !targetPhaseId) return "";
  const graph = buildProgramGraph(program);
  if (!graph.nodes.length) return "";
  const selection = selectGraphForPhase(graph, targetPhaseId);

  // Order citations by relevance so a budget-limited block keeps the highest-
  // signal nodes rather than dropping them off the tail by list position.
  const phaseOrder = graph.nodes.filter((n) => n.type === "phase").map((n) => n.phaseCreated as string);
  const rankedNodes = rankNodesForPhase(selection.nodes, phaseOrder, targetPhaseId);
  const body = compressProgramGraph(rankedNodes).trim();
  if (!body) return "";

  // Node citations first — the grounding facts/artifacts/risks share the budget.
  const nodeBlock = fitBlock(GRAPH_CONTEXT_HEADER, body, maxChars);
  if (!nodeBlock) return "";

  // Then append the semantic relationships with whatever budget remains, so the
  // agent sees not just the entities but how they connect (grounds / traces to /
  // addresses / delivers). Whole lines only; the block is dropped if it can't fit.
  const remaining = maxChars - nodeBlock.length - 1; // -1 for the joining newline
  const edgeBody = compressProgramEdges(selection.edges, selection.nodes).trim();
  if (edgeBody && remaining > GRAPH_RELATIONSHIPS_HEADER.length + 1) {
    const edgeBlock = fitBlock(GRAPH_RELATIONSHIPS_HEADER, edgeBody, remaining);
    if (edgeBlock) return `${nodeBlock}\n${edgeBlock}`;
  }
  return nodeBlock;
}
