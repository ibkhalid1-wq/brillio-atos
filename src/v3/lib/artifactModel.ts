/**
 * Artifact-centric operating model.
 *
 * ATOS's system of record is its artifacts, not its methodology steps. This module
 * derives, for a programme, the full artifact ledger: which artifacts each phase
 * REQUIRES, which are PRESENT, their state, quality, evidence (provenance) and
 * lineage (what each artifact depends on / feeds). It reads only normalized
 * programme data (`program.artifacts`) plus the methodology's required-artifact
 * catalogue — no backend changes — so it is a pure, testable selector that also
 * feeds the Program Knowledge Graph (Cycle 5).
 */
import type { ProgramSummary, ArtifactSummary } from "@/new/types";
import { ATOS_STANDARD, type MethodologyDefinition } from "@/v3/lib/methodology";
import { getAgentMeta } from "@/v3/lib/agentMeta";
import { getDynamicSchemaStore, dynamicArtifactDefs } from "@/v3/lib/dynamicSchema";
import {
  FORMAL_ARTIFACT_FIELD_KEYS,
  getFormalArtifactContent,
  getFormalArtifactConfidence,
} from "@/v3/lib/formalArtifacts";

export type ArtifactState = "missing" | "draft" | "ready" | "approved" | "stale" | "archived";
export type ArtifactOrigin = "generated" | "uploaded" | "required";

export interface ArtifactNode {
  /** Stable key: the producing agent id for required artifacts, else the artifact id. */
  key: string;
  phaseId: string;
  label: string;
  state: ArtifactState;
  origin: ArtifactOrigin;
  required: boolean;
  present: boolean;
  /** 0-100 confidence/quality, or null when unknown. */
  quality: number | null;
  /** One-line provenance string for the evidence chip. */
  evidence: string | null;
  updatedAt: string | null;
  /** Producing-agent ids this artifact depends on (lineage in). */
  upstream: string[];
  /** Producing-agent ids that depend on this artifact (lineage out). */
  downstream: string[];
  /** Underlying artifact id when present (for navigation). */
  artifactId: string | null;
}

export interface PhaseArtifactSummary {
  phaseId: string;
  phaseLabel: string;
  required: number;
  present: number;
  missing: number;
  approved: number;
  avgQuality: number | null;
  artifacts: ArtifactNode[];
}

export interface ProgramArtifactModel {
  phases: PhaseArtifactSummary[];
  totals: {
    required: number;
    present: number;
    missing: number;
    approved: number;
    avgQuality: number | null;
    /** present required / required, 0-1. */
    coverage: number;
  };
}

/**
 * Lineage between producing agents (by id). Deliberately small and explicit —
 * this is the seed of the knowledge graph, refined in Cycle 5.
 */
const ARTIFACT_DOWNSTREAM: Record<string, string[]> = {
  narrative: ["plan", "stakeholder"],
  plan: ["milestone"],
  risk: [],
  milestone: ["critical-path"],
  stakeholder: ["change-impact"],
  budget: [],
};

function invertDownstream(): Record<string, string[]> {
  const upstream: Record<string, string[]> = {};
  for (const [from, tos] of Object.entries(ARTIFACT_DOWNSTREAM)) {
    for (const to of tos) {
      (upstream[to] ||= []).push(from);
    }
  }
  return upstream;
}

const ARTIFACT_UPSTREAM = invertDownstream();

function artifactLabel(agentId: string): string {
  const meta = getAgentMeta(agentId);
  return meta.outputArtifact || meta.label || agentId;
}

function normalize(text: string): string {
  // Split camelCase ("raciMatrix" → "raci Matrix") so produced artifact keys
  // line up with kebab-case agent ids and spaced human labels after lowercasing.
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A present artifact satisfies a required one when EITHER its stable key matches
 * the producing agent id (the reliable join — e.g. "raciMatrix" ↔ "raci-matrix"),
 * OR its title matches the expected human label. Key matching is exact-only to
 * avoid short ids like "plan" falsely absorbing unrelated artifacts; label
 * matching keeps the looser substring behaviour for human-authored titles.
 */
function matchesRequirement(artifact: ArtifactSummary, agentId: string, expectedLabel: string): boolean {
  const key = normalize(artifact.id);
  const aid = normalize(agentId);
  if (key && aid && key === aid) return true;
  const a = normalize(artifact.title);
  const b = normalize(expectedLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function stateFromArtifact(artifact: ArtifactSummary | undefined): ArtifactState {
  if (!artifact) return "missing";
  if (artifact.status === "approved") return "approved";
  if (artifact.status === "stale") return "stale";
  if (artifact.status === "archived") return "archived";
  // A draft with strong confidence reads as "ready" for review.
  if ((artifact.agentConfidence ?? 0) >= 80) return "ready";
  return "draft";
}

function originFromArtifact(artifact: ArtifactSummary | undefined): ArtifactOrigin {
  if (!artifact) return "required";
  return artifact.agentGenerated ? "generated" : "uploaded";
}

function evidenceFromArtifact(artifact: ArtifactSummary | undefined): string | null {
  if (!artifact) return null;
  const source = artifact.agentGenerated
    ? "Generated by ATOS"
    : `Provided by ${artifact.lastEditedBy === "human" ? "the team" : "ATOS"}`;
  const version = artifact.versionNumber ? ` · v${artifact.versionNumber}` : "";
  return `${source}${version}`;
}

/**
 * The data root that holds the top-level formal-artifact mirrors (and
 * phaseArtifacts/phaseInputs). program.rawData is a wrapper; the live shape nests
 * the real payload under `.data`. Mirror the resolution in phaseReadiness.ts.
 */
function resolveFormalSource(rawData: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!rawData || typeof rawData !== "object") return null;
  const data = (rawData as Record<string, unknown>).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : rawData;
}

/**
 * Read-path resilience: a formal document is stored both as a top-level mirror
 * (the real body, under its field key) and as a phaseArtifacts ledger stub (the
 * status record the coverage UI normally reads). An older edge build wrote only
 * the mirror, leaving the ledger empty — so a present document showed as
 * "missing". When no ledger artifact matches a required formal agent but its
 * mirror has content, synthesise a present ArtifactSummary from the mirror.
 */
function formalMirrorArtifact(
  source: Record<string, unknown> | null,
  agentId: string,
  label: string,
  phaseId: string,
): ArtifactSummary | undefined {
  if (!source || !FORMAL_ARTIFACT_FIELD_KEYS[agentId]) return undefined;
  const content = getFormalArtifactContent(source, agentId);
  if (!content) return undefined;
  const mirror = source[FORMAL_ARTIFACT_FIELD_KEYS[agentId]];
  const generatedAt =
    mirror && typeof mirror === "object" && !Array.isArray(mirror)
      ? (mirror as Record<string, unknown>).generatedAt
      : null;
  const confidence = getFormalArtifactConfidence(source, agentId);
  return {
    id: agentId,
    phaseId,
    title: label,
    status: "draft",
    agentConfidence: confidence ?? undefined,
    agentGenerated: true,
    lastEditedBy: "agent",
    lastEditedAt: typeof generatedAt === "string" ? generatedAt : new Date().toISOString(),
    contentSummary: content,
    versionNumber: 1,
  };
}

export function buildArtifactModel(
  program: ProgramSummary | null,
  methodology: MethodologyDefinition = ATOS_STANDARD,
): ProgramArtifactModel {
  const emptyTotals = { required: 0, present: 0, missing: 0, approved: 0, avgQuality: null, coverage: 0 };
  if (!program) return { phases: [], totals: emptyTotals };

  const artifactsByPhase = new Map<string, ArtifactSummary[]>();
  for (const artifact of program.artifacts || []) {
    const list = artifactsByPhase.get(artifact.phaseId) || [];
    list.push(artifact);
    artifactsByPhase.set(artifact.phaseId, list);
  }

  // Only consider phases the programme actually has, in methodology order.
  const programPhaseIds = new Set((program.phases || []).map((phase) => phase.id));

  // The required spine = the methodology's static requiredArtifacts merged with
  // any ai-derived dynamic artifacts the programme has accrued for the phase.
  // Without this, a dynamic-only phase (e.g. Mobilise) has an empty static spine,
  // so present generated artifacts fall through to the "additional" bucket as
  // required:false — which StageView's required-only filter then hides as
  // "Missing". Mirrors the resolved required set in phaseReadiness.ts.
  const dynamicStore = getDynamicSchemaStore(program.rawData);
  const formalSource = resolveFormalSource(program.rawData);

  const phases: PhaseArtifactSummary[] = [];

  for (const phaseDef of methodology.phases) {
    if (programPhaseIds.size > 0 && !programPhaseIds.has(phaseDef.id)) continue;

    const present = artifactsByPhase.get(phaseDef.id) || [];
    const consumed = new Set<string>();
    const nodes: ArtifactNode[] = [];

    // Merge static (agent id → meta label) and dynamic (def id → def label)
    // required specs, deduped by normalized key so a dynamic def that already
    // exists statically isn't doubled.
    const requiredSpecs: { key: string; label: string }[] = [
      ...phaseDef.requiredArtifacts.map((agentId) => ({ key: agentId, label: artifactLabel(agentId) })),
      ...dynamicArtifactDefs(phaseDef.id, dynamicStore).map((def) => ({ key: def.id, label: def.label })),
    ];
    const seenSpecKeys = new Set<string>();

    // 1. Required artifacts (the spine of the phase).
    for (const { key: agentId, label } of requiredSpecs) {
      const normKey = normalize(agentId);
      if (normKey && seenSpecKeys.has(normKey)) continue;
      if (normKey) seenSpecKeys.add(normKey);
      let match = present.find((a) => !consumed.has(a.id) && matchesRequirement(a, agentId, label));
      if (match) consumed.add(match.id);
      else match = formalMirrorArtifact(formalSource, agentId, label, phaseDef.id);
      nodes.push({
        key: agentId,
        phaseId: phaseDef.id,
        label,
        state: stateFromArtifact(match),
        origin: originFromArtifact(match),
        required: true,
        present: !!match,
        quality: match?.agentConfidence ?? null,
        evidence: evidenceFromArtifact(match),
        updatedAt: match?.lastEditedAt ?? null,
        upstream: ARTIFACT_UPSTREAM[agentId] ?? [],
        downstream: ARTIFACT_DOWNSTREAM[agentId] ?? [],
        artifactId: match?.id ?? null,
      });
    }

    // 2. Additional artifacts present but not part of the required spine.
    for (const artifact of present) {
      if (consumed.has(artifact.id)) continue;
      nodes.push({
        key: artifact.id,
        phaseId: phaseDef.id,
        label: artifact.title,
        state: stateFromArtifact(artifact),
        origin: originFromArtifact(artifact),
        required: false,
        present: true,
        quality: artifact.agentConfidence ?? null,
        evidence: evidenceFromArtifact(artifact),
        updatedAt: artifact.lastEditedAt ?? null,
        upstream: [],
        downstream: [],
        artifactId: artifact.id,
      });
    }

    const requiredNodes = nodes.filter((n) => n.required);
    const presentNodes = nodes.filter((n) => n.present);
    const approvedNodes = nodes.filter((n) => n.state === "approved");
    const qualityValues = presentNodes.map((n) => n.quality).filter((q): q is number => typeof q === "number");
    const avgQuality = qualityValues.length
      ? Math.round(qualityValues.reduce((sum, q) => sum + q, 0) / qualityValues.length)
      : null;

    phases.push({
      phaseId: phaseDef.id,
      phaseLabel: phaseDef.displayName,
      required: requiredNodes.length,
      present: requiredNodes.filter((n) => n.present).length,
      missing: requiredNodes.filter((n) => !n.present).length,
      approved: approvedNodes.length,
      avgQuality,
      artifacts: nodes,
    });
  }

  const totals = phases.reduce(
    (acc, phase) => {
      acc.required += phase.required;
      acc.present += phase.present;
      acc.missing += phase.missing;
      acc.approved += phase.approved;
      return acc;
    },
    { required: 0, present: 0, missing: 0, approved: 0, avgQuality: null as number | null, coverage: 0 },
  );

  const allQuality = phases
    .map((p) => p.avgQuality)
    .filter((q): q is number => typeof q === "number");
  totals.avgQuality = allQuality.length
    ? Math.round(allQuality.reduce((sum, q) => sum + q, 0) / allQuality.length)
    : null;
  totals.coverage = totals.required > 0 ? totals.present / totals.required : 0;

  return { phases, totals };
}

/** Convenience: artifact ledger for a single phase. */
export function buildPhaseArtifacts(
  program: ProgramSummary | null,
  phaseId: string,
  methodology: MethodologyDefinition = ATOS_STANDARD,
): PhaseArtifactSummary | null {
  const model = buildArtifactModel(program, methodology);
  return model.phases.find((phase) => phase.phaseId === phaseId) ?? null;
}
