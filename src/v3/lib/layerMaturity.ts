/**
 * Layer-maturity model — the ATOS architecture stack expressed as a set of
 * *workspaces that build up as a programme advances through the methodology*.
 *
 * The stack has 16 layers, but they are not all things a *user* builds. Three
 * groups behave very differently:
 *   • shell     (Presentation, Experience)            — the app itself.
 *   • cognition (Agent, Planning, Workflow, Search)   — runtime internals.
 *   • substrate (Integration, Storage, Infrastructure)— the platform.
 * Only the **knowledge plane** — Context, Memory, Semantic, Knowledge Graph,
 * Business Rules, Analytics — accretes content as phases clear their gates. This
 * module models each layer, computes maturity for the buildable knowledge layers
 * from the programme's live selectors, and records which methodology phases feed
 * each one so a "layers" surface can light up and deep-link into the existing
 * workspace for a layer as the programme progresses.
 *
 * Pure and derived: composes existing selectors, reads/writes no storage. The
 * phase→layer contribution map lives here as declarative registry config (not in
 * a component), consistent with the methodology-owns-structure discipline.
 */
import type { ProgramSummary } from "@/new/types";
import { buildProgramGraph } from "@/v3/lib/programGraph";
import { detectCoverageGaps } from "@/v3/lib/graphInference";
import { buildArtifactModel } from "@/v3/lib/artifactModel";
import { mineRiskPatterns } from "@/v3/lib/patternMining";
import { assessObjectives } from "@/v3/ontology/objectiveConfidence";
import { graphGaps } from "@/v3/ontology/objectiveGraph";

export type LayerGroup = "shell" | "knowledge" | "cognition" | "substrate";

/** Buildable layers move through this lifecycle; static layers get a fixed tag. */
export type LayerStatus =
  | "locked" // no contributing phase has started yet
  | "seeding" // a contributing phase is active but the layer holds nothing yet
  | "populated" // has content, but with open gaps / low quality
  | "healthy" // populated and clean
  | "shell" // the app itself (Presentation/Experience)
  | "runtime" // runtime internals (Agent/Planning/Workflow/Search)
  | "platform"; // substrate (Integration/Storage/Infrastructure)

export type KnowledgeLayerId =
  | "context"
  | "memory"
  | "semantic"
  | "knowledge-graph"
  | "business-rules"
  | "analytics";

export type LayerId =
  | "presentation"
  | "experience"
  | "agent"
  | "planning"
  | "workflow"
  | "search-rag"
  | "integration"
  | "storage"
  | "infrastructure"
  | KnowledgeLayerId;

export interface LayerMaturity {
  id: LayerId;
  label: string;
  group: LayerGroup;
  /** True for the knowledge-plane layers a programme builds up over its phases. */
  buildable: boolean;
  status: LayerStatus;
  description: string;
  /** Methodology phase ids that feed this layer (knowledge layers only). */
  contributingPhases: string[];
  /** How many contributing items the layer currently holds. */
  populated: number;
  /** Open gaps eroding the layer (unmet coverage, orphaned facts, missing artifacts). */
  gaps: number;
  /** 0–100 quality/confidence for the layer, or null when not a scored layer. */
  quality: number | null;
  /** Route/panel key the layer's workspace lives at, or null for non-workspaces. */
  deepLink: string | null;
}

export interface LayerMaturityModel {
  /** All 16 layers, top→bottom (Presentation … Infrastructure). */
  layers: LayerMaturity[];
  /** The 6 buildable knowledge-plane layers, in build order. */
  knowledge: LayerMaturity[];
  /** Roll-up over the buildable layers. */
  summary: { buildableTotal: number; healthy: number; populated: number; seeding: number; locked: number };
}

interface LayerDef {
  id: LayerId;
  label: string;
  group: LayerGroup;
  description: string;
  deepLink: string | null;
}

/** The stack top→bottom. Static layers carry a fixed status; knowledge layers are computed. */
const LAYER_REGISTRY: LayerDef[] = [
  { id: "presentation", label: "Presentation", group: "shell", description: "The rendering surfaces the user sees.", deepLink: null },
  { id: "experience", label: "Experience", group: "shell", description: "Flow, navigation and state — how the user moves through the work.", deepLink: null },
  { id: "agent", label: "Agent", group: "cognition", description: "Autonomous agents that generate and validate.", deepLink: "agent-trace" },
  { id: "planning", label: "Planning", group: "cognition", description: "Goal decomposition, phase sequencing, exit criteria.", deepLink: null },
  { id: "workflow", label: "Workflow & Orchestration", group: "cognition", description: "Runs the plan — sequencing, gating, cascades.", deepLink: null },
  { id: "context", label: "Context", group: "knowledge", description: "The bounded, ranked slice of knowledge assembled for each task.", deepLink: "graph" },
  { id: "memory", label: "Memory", group: "knowledge", description: "Prior state — confidence history and mined cross-programme patterns.", deepLink: "insights" },
  { id: "semantic", label: "Semantic", group: "knowledge", description: "The ontology applied — objectives tied to KPIs, artifacts and risks.", deepLink: "ontology" },
  { id: "knowledge-graph", label: "Knowledge Graph", group: "knowledge", description: "The structured truth — typed entities and their relationships.", deepLink: "graph" },
  { id: "search-rag", label: "Search / RAG", group: "cognition", description: "Retrieval over the graph and documents.", deepLink: null },
  { id: "business-rules", label: "Business Rules", group: "knowledge", description: "Methodology, required artifacts, governance and gates.", deepLink: "artifacts" },
  { id: "analytics", label: "Analytics", group: "knowledge", description: "Derived signals — confidence, coverage, contradictions, gate risk.", deepLink: "ontology" },
  { id: "integration", label: "Integration", group: "substrate", description: "External connectors — Supabase, edge functions, document ingest.", deepLink: null },
  { id: "storage", label: "Storage", group: "substrate", description: "Durable data — Postgres and device-local stores.", deepLink: null },
  { id: "infrastructure", label: "Infrastructure", group: "substrate", description: "Compute, edge runtime and deploy.", deepLink: null },
];

/**
 * Which methodology phases feed each knowledge layer. Declarative registry config
 * keyed by ATOS phase id — a programme lights a layer up as its contributing
 * phases start and clear.
 */
const LAYER_PHASE_CONTRIBUTIONS: Record<KnowledgeLayerId, string[]> = {
  "knowledge-graph": ["strategy", "discover", "design", "build"],
  semantic: ["strategy", "design"],
  "business-rules": ["mobilise", "design", "govern"],
  analytics: ["strategy", "operate", "optimize", "valuerealize"],
  memory: ["operate", "optimize", "valuerealize"],
  context: ["discover", "design", "build"],
};

const STATIC_STATUS: Record<Exclude<LayerGroup, "knowledge">, LayerStatus> = {
  shell: "shell",
  cognition: "runtime",
  substrate: "platform",
};

interface LayerSignal {
  populated: number;
  gaps: number;
  quality: number | null;
}

/** Derive status for a buildable layer from its signal and whether it has started. */
function statusFor(signal: LayerSignal, anyPhaseStarted: boolean): LayerStatus {
  if (signal.populated <= 0) return anyPhaseStarted ? "seeding" : "locked";
  const qualityOk = signal.quality === null || signal.quality >= 70;
  if (signal.gaps === 0 && qualityOk) return "healthy";
  return "populated";
}

/**
 * Build the layer-maturity model for a programme. Composes the graph, coverage,
 * artifact-coverage, objective-confidence and pattern-mining selectors once, then
 * projects each buildable knowledge layer's state; static layers carry a fixed tag.
 */
export function buildLayerMaturityModel(program: ProgramSummary | null | undefined): LayerMaturityModel {
  const graph = buildProgramGraph(program ?? null);
  const coverageGaps = detectCoverageGaps(graph);
  const artifacts = buildArtifactModel(program ?? null);
  const assessment = assessObjectives(program);
  const patterns = program ? mineRiskPatterns(program) : [];

  // A contributing phase has "started" when the programme has it and it is not
  // inactive (ready/active/at-risk/blocked/complete all count as underway).
  const phaseStarted = new Map<string, boolean>();
  for (const phase of program?.phases ?? []) {
    phaseStarted.set(phase.id, phase.status !== "inactive" || phase.pct > 0);
  }
  const anyStarted = (phaseIds: string[]) => phaseIds.some((id) => phaseStarted.get(id));

  const signalFor = (id: KnowledgeLayerId): LayerSignal => {
    switch (id) {
      case "knowledge-graph": {
        // Count content nodes only — the phase spine exists before any work does.
        const phaseNodes = graph.stats.byKind.phase ?? 0;
        return { populated: graph.stats.nodeCount - phaseNodes, gaps: graph.stats.orphanFacts, quality: null };
      }
      case "context":
        // Context grounding is only as rich as the facts available to select from.
        return { populated: graph.stats.byKind.fact ?? 0, gaps: coverageGaps.length, quality: null };
      case "semantic":
        return {
          populated: assessment.graph.relations.length,
          gaps: graphGaps(assessment.graph).length,
          quality: assessment.graph.objectiveIds.length ? assessment.overall : null,
        };
      case "analytics":
        return {
          populated: assessment.objectives.length,
          gaps: assessment.recommendations.length,
          quality: assessment.objectives.length ? assessment.overall : null,
        };
      case "business-rules":
        return {
          populated: artifacts.totals.present,
          gaps: artifacts.totals.missing,
          quality: artifacts.totals.required ? Math.round(artifacts.totals.coverage * 100) : null,
        };
      case "memory":
        return { populated: patterns.length, gaps: 0, quality: null };
    }
  };

  const layers: LayerMaturity[] = LAYER_REGISTRY.map((def) => {
    if (def.group !== "knowledge") {
      return {
        ...def,
        buildable: false,
        status: STATIC_STATUS[def.group],
        contributingPhases: [],
        populated: 0,
        gaps: 0,
        quality: null,
      };
    }
    const id = def.id as KnowledgeLayerId;
    const contributingPhases = LAYER_PHASE_CONTRIBUTIONS[id];
    const signal = signalFor(id);
    return {
      ...def,
      buildable: true,
      status: statusFor(signal, anyStarted(contributingPhases)),
      contributingPhases,
      populated: signal.populated,
      gaps: signal.gaps,
      quality: signal.quality,
    };
  });

  const knowledge = layers.filter((l) => l.buildable);
  const summary = {
    buildableTotal: knowledge.length,
    healthy: knowledge.filter((l) => l.status === "healthy").length,
    populated: knowledge.filter((l) => l.status === "populated").length,
    seeding: knowledge.filter((l) => l.status === "seeding").length,
    locked: knowledge.filter((l) => l.status === "locked").length,
  };

  return { layers, knowledge, summary };
}
