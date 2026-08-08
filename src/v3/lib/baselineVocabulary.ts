/**
 * Baseline ontology vocabulary — concepts any enterprise domain ontology should
 * hold regardless of vertical, so the generic-noun slice of the unresolved-reference
 * residue never becomes per-engagement curation work.
 *
 * Scope, measured (docs/aura/ontology-gap-census.md): this is a FLOOR, not the lever
 * the recurrence framing implied. Across 57 ontologies the residue barely recurs
 * (1 of 49 distinct names spans >1 engagement), and this baseline binds ~6 of 49
 * distinct residue names cleanly (~12%). It is deliberately PRECISE — it matches a
 * reference to a concept only on the whole name or an explicit alias, never on token
 * overlap, so it does NOT over-bind domain composites ("Account Competitor View",
 * "Police Report", "Deal Team") that merely share a word. Per-vertical terms (FNOL,
 * Physician, Candidate) are NOT here — they are real domain gaps for Listen.
 *
 * Client-side and testable. The generator change that would CONSUME this (seed the
 * ontology output with these concepts, or bind against them at generation) is edge
 * and gated — specified in docs/aura/artifact-schema-findings.md, not made here.
 */

export interface BaselineConcept {
  name: string;
  definition: string;
  /** Extra surface forms that resolve to this concept (lowercased, whole-string). */
  aliases: string[];
}

export const BASELINE_VOCABULARY: BaselineConcept[] = [
  { name: "Document", definition: "A stored file or record attached to a process or entity (contract, form, report, image).", aliases: ["documents", "file", "files", "attachment", "attachments"] },
  { name: "User", definition: "A person with an account who operates the system (distinct from a modelled domain Person/Contact).", aliases: ["users", "account holder", "system user"] },
  { name: "Task", definition: "A unit of work assigned to a user, with a status and optional due date.", aliases: ["tasks", "to-do", "todo", "action item", "action items", "activity item"] },
  { name: "Note", definition: "A free-text annotation left on an entity by a user.", aliases: ["notes", "comment", "comments", "remark"] },
  { name: "Report", definition: "A generated view or export summarising other data for reading or distribution.", aliases: ["reports", "reporting", "dashboard", "export"] },
  { name: "Organization", definition: "A company or institution the engagement transacts with or within (buyer, partner, vendor).", aliases: ["organisation", "organizations", "company", "companies", "institution"] },
  { name: "Person", definition: "A named individual (a contact or stakeholder), distinct from a system User.", aliases: ["persons", "people", "contact", "contacts", "individual"] },
  { name: "Notification", definition: "A message pushed to a user about a state change or required action.", aliases: ["notifications", "alert", "alerts", "reminder"] },
  { name: "AuditEvent", definition: "An immutable record that something happened — who did what, when — for traceability.", aliases: ["audit", "audit log", "auditlog", "activity log", "event log", "audit trail"] },
  { name: "Role", definition: "A named set of permissions or responsibilities a user or persona holds.", aliases: ["roles", "persona", "personas", "permission set"] },
  { name: "Team", definition: "A named group of people who collaborate on work.", aliases: ["teams", "group", "groups", "workgroup"] },
  { name: "Address", definition: "A postal or physical location associated with an entity.", aliases: ["addresses", "location", "locations"] },
  { name: "Tag", definition: "A user-applied label used to classify or filter entities.", aliases: ["tags", "label", "labels", "category"] },
];

const INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of BASELINE_VOCABULARY) {
    m.set(c.name.toLowerCase(), c.name);
    for (const a of c.aliases) m.set(a.toLowerCase(), c.name);
  }
  return m;
})();

/**
 * Resolve a reference to a baseline concept, or null. Exact whole-string match
 * only (after trimming/lowercasing and a trailing-plural fold) — never token
 * overlap, so "Account Competitor View" does NOT resolve to Organization.
 */
export function resolveToBaseline(reference: string): string | null {
  const n = String(reference || "").trim().toLowerCase();
  if (!n) return null;
  if (INDEX.has(n)) return INDEX.get(n)!;
  const singular = n.replace(/s$/, "");
  if (INDEX.has(singular)) return INDEX.get(singular)!;
  return null;
}

/** True when a reference is a generic baseline concept (i.e. NOT a per-engagement domain gap). */
export function isBaselineConcept(reference: string): boolean {
  return resolveToBaseline(reference) !== null;
}
