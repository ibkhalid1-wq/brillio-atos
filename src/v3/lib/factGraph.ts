/**
 * Program Fact Graph — the normalized atomic-fact repository.
 *
 * The methodology owns *structure* (phases, inputs, artifacts); the Knowledge
 * Graph (knowledgeGraph.ts) owns *entity lineage*. Neither holds the atomic,
 * citable FACTS a programme accumulates — "Sponsor is the CIO", "Go-live before
 * Q4 FY26". This module derives those facts from the confirmed phase inputs (and
 * their import provenance) into a typed, deduplicated graph that LLM calls can
 * reference by short id ("F12") instead of re-sending document excerpts.
 *
 * It is a pure, testable selector over `ProgramSummary` — no backend, no writes.
 * Facts are derived deterministically (phase order, then field order) so the
 * short citation ids are stable for a given input set. This is the substrate the
 * Artifact Generator / Validator / Traceability agents reason over, and the
 * mechanism behind traceability compression (factId → source resolved in the UI).
 */
import type { ProgramSummary } from "@/new/types";
import { ATOS_STANDARD, type GridColumn } from "@/v3/lib/methodology";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { getDynamicSchemaStore, dynamicFieldArtifacts } from "@/v3/lib/dynamicSchema";
import { parseProvenance, provenanceMatches, PROVENANCE_KEY, type FieldProvenance } from "@/new/lib/fieldProvenance";

export type FactSourceType = "user_input" | "imported_document" | "prior_artifact" | "inferred";
export type FactStatus = "proposed" | "confirmed" | "conflicted" | "rejected" | "stale";

export interface Fact {
  /** Short, stable-for-this-input-set citation id, e.g. "F12". */
  id: string;
  /** Namespaced provenance key (phase + field) for dedup / lookup. */
  factId: string;
  /** Semantic kind = the originating field id (e.g. "sponsor", "goLiveDate"). */
  factType: string;
  /** Concise human-readable statement: "<label>: <value>". */
  factText: string;
  /** The raw normalized value. */
  normalizedValue: string;
  sourceType: FactSourceType;
  /** Originating phase id. */
  sourceId: string;
  /** Human-readable source ("User input", "Imported document"). */
  sourceName: string;
  /** Where in the source the value came from (e.g. the extracted quote). */
  sourceLocation: string;
  /** 0–1. User input is 1; imported facts carry their extraction confidence. */
  confidence: number;
  status: FactStatus;
  /** Artifact ids this fact feeds (from artifactInputFlow + field.usedByArtifacts). */
  impactedArtifacts: string[];
  /** Phase ids this fact is relevant to. */
  impactedPhases: string[];
}

export interface FactGraph {
  facts: Fact[];
  byId: Record<string, Fact>;
  stats: {
    factCount: number;
    byStatus: Record<FactStatus, number>;
    bySourceType: Record<FactSourceType, number>;
    /** Facts that feed no artifact — candidates for pruning or review. */
    orphans: number;
  };
}

/** Phase-input keys that are not atomic, citable facts (handled elsewhere). */
const NON_FACT_KEYS = new Set([
  PROVENANCE_KEY, "savedAt", "workstreams", "kpis", "kpiActuals",
  "successMetricBaseline", "successMetricTarget", "successMetricUnit",
  // Requirements are minted as first-class requirement nodes by the Program
  // Graph (buildProgramGraph), not as generic facts — excluded here to avoid
  // double-counting the same rows in both structures.
  "requirements",
]);

function unwrapProgramData(rawData: unknown): Record<string, unknown> {
  if (typeof rawData !== "object" || rawData === null) return {};
  const outer = rawData as Record<string, unknown>;
  return typeof outer.data === "object" && outer.data !== null
    ? (outer.data as Record<string, unknown>)
    : outer;
}

function phaseInputsOf(rawData: unknown): Record<string, Record<string, unknown>> {
  const source = unwrapProgramData(rawData);
  const pi = source.phaseInputs;
  return typeof pi === "object" && pi !== null ? (pi as Record<string, Record<string, unknown>>) : {};
}

interface GridRowFact {
  /** Stable suffix for the fact's factId (row id when present, else index). */
  rowKey: string;
  factText: string;
  normalizedValue: string;
}

/**
 * Derive one fact per non-empty row of a structured grid. The persisted value is
 * a JSON-string array of row objects keyed by column key; each row with at least
 * one filled declared cell becomes a citable fact "<field label>: <cell> · …".
 * A grid with no columns yields nothing (it carries no structured facts).
 */
function gridRowFacts(raw: unknown, columns: GridColumn[], label: string): GridRowFact[] {
  if (typeof raw !== "string" || !raw.trim() || columns.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: GridRowFact[] = [];
  parsed.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const row = entry as Record<string, unknown>;
    const cells = columns
      .map((col) => (typeof row[col.key] === "string" ? (row[col.key] as string).trim() : ""))
      .filter(Boolean);
    if (!cells.length) return;
    const normalizedValue = cells.join(" · ");
    out.push({
      rowKey: typeof row.id === "string" && row.id ? row.id : String(index),
      factText: `${label}: ${normalizedValue}`,
      normalizedValue,
    });
  });
  return out;
}

function sourceFromProvenance(prov: FieldProvenance | undefined): {
  sourceType: FactSourceType; sourceName: string; sourceLocation: string; confidence: number;
} {
  if (prov) {
    return {
      sourceType: "imported_document",
      // Name the originating document when we captured it, so the artifact map
      // and traceability views show "report.pdf" rather than a generic label.
      sourceName: prov.documentName?.trim() || "Imported document",
      sourceLocation: prov.source ?? "",
      // Extraction confidence (0–1); inferred/enriched values carry lower scores.
      confidence: typeof prov.confidence === "number" ? prov.confidence : 0.5,
    };
  }
  return { sourceType: "user_input", sourceName: "User input", sourceLocation: "", confidence: 1 };
}

/**
 * Build the Fact Graph from a programme's confirmed phase inputs. Every declared
 * atomic input field that holds a value becomes one fact; grids and the special
 * KPI/workstream keys are excluded (they are structured, not atomic). Import
 * provenance, when present and still matching the live value, sets the fact's
 * source and confidence; otherwise the fact is treated as confirmed user input.
 */
export function buildFactGraph(program: ProgramSummary | null | undefined): FactGraph {
  const empty: FactGraph = {
    facts: [],
    byId: {},
    stats: {
      factCount: 0,
      byStatus: { proposed: 0, confirmed: 0, conflicted: 0, rejected: 0, stale: 0 },
      bySourceType: { user_input: 0, imported_document: 0, prior_artifact: 0, inferred: 0 },
      orphans: 0,
    },
  };
  if (!program) return empty;

  const dynamicStore = getDynamicSchemaStore(program.rawData);
  const phaseInputs = phaseInputsOf(program.rawData);
  const facts: Fact[] = [];
  let seq = 0;

  for (const phase of ATOS_STANDARD.phases) {
    const bucket = phaseInputs[phase.id];
    if (!bucket) continue;
    const schema = getPhaseInputSchema(phase.id, dynamicStore);
    const provenance = parseProvenance(bucket[PROVENANCE_KEY]);
    const fieldArtifacts = dynamicFieldArtifacts(phase.id, dynamicStore);

    for (const field of schema.fields) {
      if (NON_FACT_KEYS.has(field.id)) continue;
      const raw = bucket[field.id];
      const impactedArtifacts = Array.from(
        new Set([...(field.usedByArtifacts ?? []), ...(fieldArtifacts[field.id] ?? [])]),
      );

      // Structured grids expand to one fact per non-empty row. Rows carry no
      // per-row import provenance, so they are treated as confirmed user input.
      if (field.type === "grid") {
        for (const rowFact of gridRowFacts(raw, field.columns ?? [], field.label)) {
          seq += 1;
          facts.push({
            id: `F${seq}`,
            factId: `${phase.id}:${field.id}#${rowFact.rowKey}`,
            factType: field.id,
            factText: rowFact.factText,
            normalizedValue: rowFact.normalizedValue,
            sourceType: "user_input",
            sourceId: phase.id,
            sourceName: "User input",
            sourceLocation: "",
            confidence: 1,
            status: "confirmed",
            impactedArtifacts,
            impactedPhases: [phase.id],
          });
        }
        continue;
      }

      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) continue;

      // Only honour import provenance while the value still matches the imported
      // snapshot; a later hand-edit makes it confirmed user input again.
      const prov = provenanceMatches(provenance[field.id], value) ? provenance[field.id] : undefined;
      const src = sourceFromProvenance(prov);

      seq += 1;
      facts.push({
        id: `F${seq}`,
        factId: `${phase.id}:${field.id}`,
        factType: field.id,
        factText: `${field.label}: ${value}`,
        normalizedValue: value,
        sourceType: src.sourceType,
        sourceId: phase.id,
        sourceName: src.sourceName,
        sourceLocation: src.sourceLocation,
        confidence: src.confidence,
        status: "confirmed",
        impactedArtifacts,
        impactedPhases: [phase.id],
      });
    }
  }

  const byId: Record<string, Fact> = {};
  const stats = { ...empty.stats, byStatus: { ...empty.stats.byStatus }, bySourceType: { ...empty.stats.bySourceType } };
  for (const fact of facts) {
    byId[fact.id] = fact;
    stats.byStatus[fact.status] += 1;
    stats.bySourceType[fact.sourceType] += 1;
    if (fact.impactedArtifacts.length === 0) stats.orphans += 1;
  }
  stats.factCount = facts.length;

  return { facts, byId, stats };
}

/** Facts relevant to a phase (by origin or impact). */
export function factsForPhase(graph: FactGraph, phaseId: string): Fact[] {
  return graph.facts.filter((f) => f.sourceId === phaseId || f.impactedPhases.includes(phaseId));
}

/** Facts that feed a given artifact id. */
export function factsForArtifact(graph: FactGraph, artifactId: string): Fact[] {
  return graph.facts.filter((f) => f.impactedArtifacts.includes(artifactId));
}

/** Facts in a given status. */
export function factsByStatus(graph: FactGraph, status: FactStatus): Fact[] {
  return graph.facts.filter((f) => f.status === status);
}

function confidenceWord(confidence: number): string {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

/**
 * Compact one-line citation for prompt injection — the traceability-compression
 * format: "F12: <text>. Source: <name>. Confidence: <word>." Keeps prompts
 * small; the UI resolves the id back to full source detail.
 */
export function compressFactCitation(fact: Fact): string {
  const loc = fact.sourceLocation ? ` (${fact.sourceLocation})` : "";
  return `${fact.id}: ${fact.factText}. Source: ${fact.sourceName}${loc}. Confidence: ${confidenceWord(fact.confidence)}.`;
}

/** The compact fact list an LLM call receives instead of raw document text. */
export function compressFactGraph(facts: Fact[]): string {
  return facts.map(compressFactCitation).join("\n");
}

/**
 * A scoped slice of the Fact Graph with a measured token saving — the fact-level
 * analogue of contextContracts.selectContext. Where selectContext prunes graph
 * *nodes* and reports the pruned percentage, this prunes *facts* to only those
 * feeding the in-scope artifacts and reports how much of the full fact corpus was
 * dropped. The compressed citations are what an agent prompt carries instead of
 * the whole programme's facts.
 */
export interface FactSelection {
  /** The facts that feed at least one in-scope artifact. */
  facts: Fact[];
  /** compressFactGraph(facts) — the prompt-ready citation block. */
  citations: string;
  reduction: {
    /** Characters of the full fact corpus, compressed. */
    fullChars: number;
    /** Characters of just the selected facts, compressed. */
    scopedChars: number;
    droppedChars: number;
    /** Percentage of the full fact-corpus characters pruned (0–100). */
    reductionPct: number;
  };
}

/**
 * Select the facts feeding any of `artifactIds` and measure the saving versus
 * sending the full fact corpus. Composes with contextContracts.selectContext:
 * pass the artifact node ids of an `artifact`-capability ScopedContext (e.g.
 * `scoped.graph.nodes.filter(n => n.kind === "artifact").map(n => n.id)`), and
 * the returned `citations` are the "Relevant inputs" slice that contract needs.
 */
export function selectFactsForArtifacts(graph: FactGraph, artifactIds: Iterable<string>): FactSelection {
  const wanted = new Set(artifactIds);
  const facts = graph.facts.filter((f) => f.impactedArtifacts.some((a) => wanted.has(a)));
  const citations = compressFactGraph(facts);
  const fullChars = compressFactGraph(graph.facts).length;
  const scopedChars = citations.length;
  const droppedChars = Math.max(0, fullChars - scopedChars);
  const reductionPct = fullChars === 0 ? 0 : Math.round((droppedChars / fullChars) * 100);
  return { facts, citations, reduction: { fullChars, scopedChars, droppedChars, reductionPct } };
}
