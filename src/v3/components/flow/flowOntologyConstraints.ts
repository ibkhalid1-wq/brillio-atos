/**
 * Write-time ontology constraints (audit F-004, the hard grounding gate).
 *
 * The T5-Ω report card found the ontology declared domain/range/cardinality on
 * every relation but enforced NONE of it: a relation could point at an entity
 * that doesn't exist, carry a cardinality outside the vocabulary, or contradict
 * a sibling — and every write path accepted it. "Grounding that cannot reject
 * an invalid assertion is not grounding."
 *
 * This is the deterministic checker that gives the schema teeth. It is pure —
 * the studio runs it live to block a Save that would introduce a blocking
 * violation, and applyArtifactEdit runs it as a backstop so no client path
 * (including a programmatic write) can persist a structurally invalid ontology.
 * Relations reference entities by NAME (or alias), matching the editor's own
 * rename-cascade model.
 */

/**
 * The cardinality vocabulary offered by the editor. Validation is broader than
 * this list: any `side:side` pair over {0,1,N,M} is structurally valid (the
 * generator legitimately emits N:1 and optionality-annotated 0:1/0:N), so the
 * gate rejects only genuinely malformed values like "many" or "lots" — never a
 * meaningful cardinality the model or an operator wrote.
 */
export const ONTOLOGY_CARDINALITIES = ["1:1", "1:N", "N:1", "N:M", "0:1", "0:N", "unknown"] as const;
export type OntologyCardinality = (typeof ONTOLOGY_CARDINALITIES)[number];

/**
 * The relation-verb menu the generator's provisional drafts are closed over
 * (run-agent's RELATION VERBS rule). Post-interview docs may carry a
 * stakeholder's own phrase — editors list that value alongside the menu
 * rather than losing it, so this bounds new choices, not existing data.
 */
export const ONTOLOGY_RELATION_VERBS = [
  "conducts", "runs", "manages", "supports", "produces",
  "measures", "leads to", "is part of", "is a type of", "applies to", "participates in", "relates to",
] as const;

/** What each menu verb MEANS — surfaced as option tooltips so the editor
 * teaches the vocabulary. Semantics mirror the reference standards the
 * generator grounds in (FHIR / FIBO / GS1 / W3C ORG). */
export const ONTOLOGY_RELATION_VERB_MEANINGS: Record<string, string> = {
  "conducts": "An organisation carries out a formal undertaking — Brillio conducts the Engagement.",
  "runs": "An actor operates a process or system day to day — Sales Ops runs the pipeline review.",
  "manages": "Ongoing stewardship and responsibility — the Alliance Manager manages the Partner relationship.",
  "supports": "Enables another thing without owning it — the CRM supports Opportunity Qualification.",
  "produces": "Creates instances of the other thing — an Account produces Opportunities.",
  "measures": "Quantifies or scores the other thing — a Lead Score measures a Lead.",
  "leads to": "Process sequence: this stage feeds the next — Qualification leads to Proposal.",
  "is part of": "Composition or membership: part of a whole — a Contact is part of an Account.",
  "is a type of": "Specialisation: a narrower kind of the other — an Escalation is a type of Case.",
  "applies to": "Attaches to or governs the other thing — a Contract applies to a Client.",
  "participates in": "Takes part without owning it — a Partner participates in a Deal.",
  "relates to": "Neutral placeholder — refine it once evidence names the real verb.",
};

/** Structural validity: `X:Y` with X,Y in {0,1,N,M} (case-insensitive), or unknown. */
export function isValidCardinality(value: string): boolean {
  const v = value.trim();
  if (!v || v.toLowerCase() === "unknown") return true;
  return /^[01NM]:[01NM]$/i.test(v);
}

export type OntologyViolationKind =
  | "dangling-relation" // from/to names an entity that isn't declared
  | "empty-endpoint" // from/to is blank
  | "bad-cardinality" // cardinality outside the vocabulary
  | "cardinality-conflict" // the same edge declared with two different cardinalities
  | "self-relation" // from === to
  | "duplicate-entity" // two entities share a name (relations resolve ambiguously)
  | "dangling-alignment"; // a standard mapping points at an undeclared entity

export interface OntologyViolation {
  kind: OntologyViolationKind;
  /** Blocking violations must reject the write; warnings surface but allow it. */
  severity: "blocking" | "warning";
  message: string;
  relationIndex?: number;
  entityIndex?: number;
  /** For dangling refs: the undeclared entity name — enables a one-click "declare it" fix. */
  missing?: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
const norm = (value: unknown): string => asText(value).trim().toLowerCase();

/**
 * Check a domain-ontology document against its declared structure. Returns
 * every violation found (empty array = clean). Deterministic and side-effect
 * free, so it is equally usable in the editor, the write backstop, and tests.
 */
export function validateOntologyConstraints(doc: Record<string, unknown>): OntologyViolation[] {
  const entities = asArray(doc.entities).map(asRecord);
  const relations = asArray(doc.relations).map(asRecord);
  const alignment = asArray(doc.standardAlignment).map(asRecord);
  const violations: OntologyViolation[] = [];

  // Resolvable names: every declared entity name + every alias, normalised.
  const resolvable = new Set<string>();
  const nameCounts = new Map<string, number>();
  entities.forEach((entity, index) => {
    const name = norm(entity.name);
    if (name) {
      resolvable.add(name);
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    for (const alias of asArray(entity.aliases)) {
      const a = norm(alias);
      if (a) resolvable.add(a);
    }
    if (!name) {
      violations.push({ kind: "duplicate-entity", severity: "warning", entityIndex: index, message: `Entity ${index + 1} has no name — relations can't resolve to it.` });
    }
  });
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      violations.push({
        kind: "duplicate-entity",
        severity: "blocking",
        message: `Two entities are both named "${name}" — a relation to it can't be resolved. Rename or merge one.`,
      });
    }
  }

  // Detect the same directed, named edge declared with conflicting cardinality.
  const edgeCardinality = new Map<string, string>();

  relations.forEach((relation, index) => {
    const from = asText(relation.from).trim();
    const to = asText(relation.to).trim();
    const verb = asText(relation.relation).trim() || "relates to";
    const card = asText(relation.cardinality).trim() || "unknown";

    if (!from || !to) {
      violations.push({ kind: "empty-endpoint", severity: "blocking", relationIndex: index, message: `Relation ${index + 1} ("${verb}") is missing ${!from && !to ? "both endpoints" : !from ? "its source" : "its target"}.` });
    }
    if (from && !resolvable.has(norm(from))) {
      violations.push({ kind: "dangling-relation", severity: "blocking", relationIndex: index, missing: from, message: `Relation "${from} → ${to}" points from "${from}", which isn't a declared entity.` });
    }
    if (to && !resolvable.has(norm(to))) {
      violations.push({ kind: "dangling-relation", severity: "blocking", relationIndex: index, missing: to, message: `Relation "${from} → ${to}" points to "${to}", which isn't a declared entity.` });
    }
    if (from && to && norm(from) === norm(to)) {
      violations.push({ kind: "self-relation", severity: "warning", relationIndex: index, message: `Relation ${index + 1} links "${from}" to itself.` });
    }
    if (!isValidCardinality(card)) {
      violations.push({ kind: "bad-cardinality", severity: "blocking", relationIndex: index, message: `Relation "${from} → ${to}" has cardinality "${card}" — use side:side over 0/1/N/M (e.g. ${ONTOLOGY_CARDINALITIES.slice(0, 4).join(", ")}) or unknown.` });
    }
    if (from && to) {
      const edgeKey = `${norm(from)} ${norm(verb)} ${norm(to)}`;
      const prior = edgeCardinality.get(edgeKey);
      if (prior && prior !== "unknown" && card !== "unknown" && prior !== card) {
        violations.push({ kind: "cardinality-conflict", severity: "blocking", relationIndex: index, message: `"${from} ${verb} ${to}" is declared both ${prior} and ${card} — cardinality must be consistent.` });
      }
      if (!prior || prior === "unknown") edgeCardinality.set(edgeKey, card);
    }
  });

  alignment.forEach((row) => {
    const entity = asText(row.entity).trim();
    if (entity && !resolvable.has(norm(entity))) {
      violations.push({ kind: "dangling-alignment", severity: "warning", missing: entity, message: `Standard mapping references "${entity}", which isn't a declared entity.` });
    }
  });

  return violations;
}

/** True when the document carries a violation that must reject the write. */
export function hasBlockingOntologyViolations(doc: Record<string, unknown>): boolean {
  return validateOntologyConstraints(doc).some((v) => v.severity === "blocking");
}

/** Split for display: blocking first, then warnings, each in document order. */
export function partitionOntologyViolations(doc: Record<string, unknown>): { blocking: OntologyViolation[]; warnings: OntologyViolation[] } {
  const all = validateOntologyConstraints(doc);
  return {
    blocking: all.filter((v) => v.severity === "blocking"),
    warnings: all.filter((v) => v.severity === "warning"),
  };
}
