/**
 * Input → approved-artifact staleness primitives.
 *
 * When a captured input value changes, any approved artifact that the input
 * feeds must be flagged stale and regenerated — approved artifacts are never
 * silently rewritten, but they must not silently drift either. The field →
 * artifact relationships are read from the methodology flow edges
 * (`derivePhaseFlowEdges`, sourced from `artifactInputFlow`), so this logic
 * stays methodology-driven rather than hard-coding which inputs touch which
 * artifacts.
 *
 * The same primitive answers the reimport question in reverse: which incoming
 * fields must be left untouched because they feed an already-approved artifact.
 *
 * Pure, deterministic, unit-testable. No AI, no backend.
 */
import { derivePhaseFlowEdges, artifactReferenceSatisfied } from "@/v3/lib/phaseFlowEdges";
import { getPhaseInputSchema } from "@/v3/lib/phaseInputSchema";
import { getPhaseArtifactDefs } from "@/v3/lib/phaseArtifacts";
import { type DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

/** A phase's artifact bucket: artifactId → entry (we only read `status`). */
export type PhaseArtifactBucket = Record<string, unknown> | undefined;

const RESERVED_INPUT_KEYS = new Set(["savedAt"]);

/**
 * Some inputs are captured through a specialised editor that persists under its
 * own key(s) but is conceptually the SAME methodology field. The Strategy KPI
 * table is the editor for the success-metric concept — it replaces the standalone
 * `successMetric` field in the UI and persists as `kpis` plus the successMetric*
 * anchor keys. For staleness, a change to any companion key must follow the
 * canonical field's flow edges, otherwise deleting/editing a KPI silently leaves
 * the artifacts it feeds (e.g. the outcome framework) marked fresh.
 *
 * This map is consulted ONLY on the staleness path. Generation-gating must not
 * use it: these companion keys are not declared schema fields, so surfacing them
 * in the label-resolved generation flow would render raw ids in the UI.
 */
export const STALENESS_FIELD_ALIASES: Record<string, string[]> = {
  kpis: ["successMetric"],
  successMetricBaseline: ["successMetric"],
  successMetricTarget: ["successMetric"],
  successMetricUnit: ["successMetric"],
};

/** The given field ids plus any canonical fields they alias to (deduped). */
function expandWithAliases(fieldIds: string[]): string[] {
  const expanded = new Set<string>();
  for (const id of fieldIds) {
    expanded.add(id);
    for (const alias of STALENESS_FIELD_ALIASES[id] ?? []) expanded.add(alias);
  }
  return [...expanded];
}

function isApproved(entry: unknown): boolean {
  return Boolean(entry && typeof entry === "object" && (entry as { status?: unknown }).status === "approved");
}

/** Approved artifact ids in a phase bucket. */
function approvedArtifactIds(bucket: PhaseArtifactBucket): Set<string> {
  const approved = new Set<string>();
  if (!bucket || typeof bucket !== "object") return approved;
  for (const [artifactId, entry] of Object.entries(bucket)) {
    if (isApproved(entry)) approved.add(artifactId);
  }
  return approved;
}

/** All artifact ids present in a phase bucket (whatever their status). */
function bucketArtifactIds(bucket: PhaseArtifactBucket): string[] {
  if (!bucket || typeof bucket !== "object") return [];
  return Object.keys(bucket);
}

/**
 * Artifact ids (within the phase) that the given input fields flow into. The
 * bucket's own artifact ids are supplied as valid edge targets so a field that
 * feeds a *produced* artifact a recommended agent made (not a declared
 * `requiredArtifact`, e.g. Design's `solution-architecture`/`future-state-design`)
 * is still recognised — otherwise the edge is dropped for not being in the static
 * catalogue and the artifact never stales / never blocks reimport.
 */
export function artifactsForInputFields(
  phaseId: string,
  fieldIds: string[],
  store?: DynamicSchemaStore,
  extraArtifactIds?: Iterable<string>,
): Set<string> {
  const targets = new Set<string>();
  for (const edge of derivePhaseFlowEdges(phaseId, expandWithAliases(fieldIds), store, extraArtifactIds)) targets.add(edge.to);
  return targets;
}

/**
 * The input field ids whose value differs between the previously-saved bucket
 * and the incoming values. Reserved/meta keys (`savedAt`, anything prefixed
 * with `_`, e.g. provenance) are ignored. Values are compared as strings so a
 * grid serialised to JSON and a plain text field are handled uniformly.
 */
export function changedInputFields(prevBucket: unknown, inputs: Record<string, string>): string[] {
  const prev = (prevBucket && typeof prevBucket === "object" ? prevBucket : {}) as Record<string, unknown>;
  const changed: string[] = [];
  for (const [fieldId, value] of Object.entries(inputs)) {
    if (fieldId.startsWith("_") || RESERVED_INPUT_KEYS.has(fieldId)) continue;
    if (String(prev[fieldId] ?? "") !== String(value ?? "")) changed.push(fieldId);
  }
  return changed;
}

/**
 * Approved artifacts in `bucket` that the changed input fields feed — the
 * artifacts to move to "stale" and require regeneration.
 */
export function approvedArtifactsToStale(
  phaseId: string,
  changedFieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
): string[] {
  if (!changedFieldIds.length) return [];
  const approved = approvedArtifactIds(bucket);
  if (!approved.size) return [];
  const targets = artifactsForInputFields(phaseId, changedFieldIds, store, bucketArtifactIds(bucket));
  return [...targets].filter((artifactId) => approved.has(artifactId));
}

/**
 * Every artifact in `bucket` that the changed input fields feed — regardless of
 * status — so that ANY artifact built from those inputs (draft, ready, OR
 * approved) is moved to "stale" and must be regenerated. `archived` artifacts are
 * left alone (intentionally retired). This is the broader counterpart to
 * `approvedArtifactsToStale`, which only touches approved artifacts.
 */
export function relatedArtifactsToStale(
  phaseId: string,
  changedFieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
): string[] {
  if (!changedFieldIds.length) return [];
  if (!bucket || typeof bucket !== "object") return [];
  const targets = artifactsForInputFields(phaseId, changedFieldIds, store, bucketArtifactIds(bucket));
  return [...targets].filter((artifactId) => {
    const entry = (bucket as Record<string, unknown>)[artifactId];
    if (!entry || typeof entry !== "object") return false;
    const status = (entry as { status?: unknown }).status;
    return status !== "archived" && status !== "stale";
  });
}

/** Titles of the given artifact ids in a phase, resolved from its catalogue. */
function artifactTitles(phaseId: string, artifactIds: string[], store?: DynamicSchemaStore): string[] {
  const defs = getPhaseArtifactDefs(phaseId, store);
  return artifactIds.map((id) => defs.find((d) => d.id === id)?.label ?? id);
}

/** A downstream artifact to stale, named by its owning phase. */
export interface CrossPhaseStaleTarget {
  phaseId: string;
  artifactId: string;
}

/**
 * Cross-phase staleness propagation. `relatedArtifactsToStale` handles the phase
 * whose inputs just changed; this handles the ripple *into later phases*. When an
 * upstream deliverable changes (or is itself staled), any downstream artifact
 * built on top of it is now standing on shifted ground and must be regenerated
 * too — otherwise a Design that referenced the old requirements catalog silently
 * keeps citing a version that no longer exists.
 *
 * The cross-phase dependency signal is a later phase's `artifact-reference` input:
 * its label names an upstream deliverable by title (e.g. "Reference to approved
 * requirements catalog"). We match that label against the changed artifacts'
 * titles (`artifactReferenceSatisfied`, the same token model the flow wiring
 * uses), then follow those reference fields to the downstream artifacts they feed
 * (`artifactsForInputFields`, the same methodology edge model as intra-phase
 * staleness). Downstream artifacts that are present and neither `archived` nor
 * already `stale` are returned as `{ phaseId, artifactId }` pairs.
 *
 * `allBuckets` is the whole `phaseArtifacts` map (phaseId → bucket); the origin
 * phase is skipped, and titles resolve from the artifact catalogue so no
 * bucket-stored title is needed. Pure and deterministic — no I/O, no AI.
 */
/**
 * DECLARED cross-phase dependencies: regenerating the key stales the values.
 *
 * crossPhaseArtifactsToStale discovers dependencies from a later phase's
 * `artifact-reference` input fields. That is a sound mechanism and it has never
 * fired once, because no phase in the methodology declares a field of that
 * type — `artifact-reference` appears in the codebase only as a type union
 * member. So a correct, tested propagation engine sat wired in with a
 * permanently empty input, and regenerating Frame's Discovery Kit left Listen's
 * documents claiming to be fresh.
 *
 * These are the real edges, declared rather than inferred:
 *
 *   The Charter frames the problem and the Kit sets who is asked about what.
 *   Listen's Discovery, Domain Ontology and Current-State Atlas are all
 *   generated downstream of both, so either one moving invalidates all three.
 *
 *   Prototype's architecture, experience and blueprint are generated FROM the
 *   ontology and the atlas — the model of the business is their entire input —
 *   so either one moving invalidates all of them.
 *
 * Stated as artifact ids so a rename of a document TITLE cannot silently break
 * the edge, which is the failure mode the label-matching path carries.
 *
 * SCOPE: this covers the operator editing grounding INPUTS. A regeneration
 * never reaches this code — run-agent persists the artifact server-side and the
 * client only receives a realtime update — so the regeneration cascade lives in
 * the edge function, inverting UPSTREAM_ARTIFACT_DEPS at persist time. Two
 * graphs is a duplication worth watching: if these ever disagree, the edge
 * function's is authoritative, because it is what actually feeds generation.
 */
export const CROSS_PHASE_ARTIFACT_DEPS: Record<string, Array<{ phaseId: string; artifactId: string }>> = {
  "charter": [
    { phaseId: "listen", artifactId: "discovery-kit" },
    { phaseId: "listen", artifactId: "domain-ontology" },
    { phaseId: "listen", artifactId: "current-state-atlas" },
  ],
  "discovery-kit": [
    { phaseId: "listen", artifactId: "domain-ontology" },
    { phaseId: "listen", artifactId: "current-state-atlas" },
  ],
  "domain-ontology": [
    { phaseId: "prototype", artifactId: "architecture-strategy" },
    { phaseId: "prototype", artifactId: "experience-design" },
    { phaseId: "prototype", artifactId: "agentic-blueprint" },
  ],
  "current-state-atlas": [
    { phaseId: "prototype", artifactId: "architecture-strategy" },
    { phaseId: "prototype", artifactId: "experience-design" },
    { phaseId: "prototype", artifactId: "agentic-blueprint" },
  ],
};

/** The declared downstream targets of the given upstream artifacts, filtered to
 * those actually present and not already archived or stale. */
export function declaredCrossPhaseTargets(
  changedArtifactIds: string[],
  allBuckets: Record<string, PhaseArtifactBucket>,
): CrossPhaseStaleTarget[] {
  const out: CrossPhaseStaleTarget[] = [];
  const seen = new Set<string>();
  for (const changed of changedArtifactIds) {
    for (const target of CROSS_PHASE_ARTIFACT_DEPS[changed] ?? []) {
      const key = `${target.phaseId}/${target.artifactId}`;
      if (seen.has(key)) continue;
      const bucket = allBuckets?.[target.phaseId];
      const entry = bucket && typeof bucket === "object" ? (bucket as Record<string, unknown>)[target.artifactId] : undefined;
      if (!entry || typeof entry !== "object") continue;
      const status = (entry as { status?: unknown }).status;
      if (status === "archived" || status === "stale") continue;
      seen.add(key);
      out.push(target);
    }
  }
  return out;
}

export function crossPhaseArtifactsToStale(
  originPhaseId: string,
  changedArtifactIds: string[],
  allBuckets: Record<string, PhaseArtifactBucket>,
  store?: DynamicSchemaStore,
): CrossPhaseStaleTarget[] {
  if (!changedArtifactIds.length || !allBuckets || typeof allBuckets !== "object") return [];
  const changedTitles = artifactTitles(originPhaseId, changedArtifactIds, store);
  const out: CrossPhaseStaleTarget[] = [];
  for (const [phaseId, bucket] of Object.entries(allBuckets)) {
    if (phaseId === originPhaseId || !bucket || typeof bucket !== "object") continue;
    // artifact-reference inputs whose label points at one of the changed upstream
    // deliverables — the fields that make this phase depend on the origin phase.
    const refFieldIds = getPhaseInputSchema(phaseId, store)
      .fields.filter((f) => f.type === "artifact-reference" && artifactReferenceSatisfied(f.label, changedTitles))
      .map((f) => f.id);
    if (!refFieldIds.length) continue;
    const targets = artifactsForInputFields(phaseId, refFieldIds, store, bucketArtifactIds(bucket));
    for (const artifactId of targets) {
      const entry = (bucket as Record<string, unknown>)[artifactId];
      if (!entry || typeof entry !== "object") continue;
      const status = (entry as { status?: unknown }).status;
      if (status === "archived" || status === "stale") continue;
      out.push({ phaseId, artifactId });
    }
  }
  // …plus the DECLARED edges. The reference-label path above depends on input
  // fields no phase actually declares, so on its own it returns nothing.
  const seen = new Set(out.map((t) => `${t.phaseId}/${t.artifactId}`));
  for (const target of declaredCrossPhaseTargets(changedArtifactIds, allBuckets)) {
    if (target.phaseId === originPhaseId) continue;
    const key = `${target.phaseId}/${target.artifactId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/**
 * Whether a persisted input value represents real captured content worth
 * protecting. Text fields are empty when blank; grids persist as JSON and are
 * empty when absent or the empty array (`"[]"`). Used by the reimport guard so a
 * field with no prior content is never "protected" — there is nothing to lose.
 */
function hasInputValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "string") return value !== "";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "[]";
}

/**
 * The subset of `fieldIds` that must NOT be overwritten on reimport because
 * they feed an already-approved artifact. Protecting these keeps an approved
 * artifact's source inputs stable rather than silently staling it on every
 * document re-scan.
 *
 * `priorInputs` (the phase's currently-persisted inputs) makes the guard
 * value-aware: a field is only protected when it ALREADY holds content. An empty
 * field feeding an approved artifact has no PM work to preserve, so blocking its
 * reimport would just discard the accepted mapping and leave the input blank —
 * the bug where an accepted document import never populated an empty field. When
 * `priorInputs` is omitted the guard blocks regardless (back-compatible).
 */
export function fieldsFeedingApprovedArtifacts(
  phaseId: string,
  fieldIds: string[],
  bucket: PhaseArtifactBucket,
  store?: DynamicSchemaStore,
  priorInputs?: Record<string, unknown>,
): Set<string> {
  const blocked = new Set<string>();
  const approved = approvedArtifactIds(bucket);
  if (!approved.size) return blocked;
  for (const fieldId of fieldIds) {
    // Nothing to protect when the target field is currently empty — let the
    // import populate it rather than silently dropping the accepted value.
    if (priorInputs && !hasInputValue(priorInputs[fieldId])) continue;
    // Expand to the canonical field(s) this key aliases to (e.g. kpis →
    // successMetric) so a companion key feeding an approved artifact is protected
    // on reimport just like the canonical field would be. The approved ids are
    // supplied as valid edge targets so a field feeding a produced (recommended-
    // agent) approved artifact — one not in the static catalogue — is still caught.
    for (const edge of derivePhaseFlowEdges(phaseId, expandWithAliases([fieldId]), store, approved)) {
      if (approved.has(edge.to)) {
        blocked.add(fieldId);
        break;
      }
    }
  }
  return blocked;
}
