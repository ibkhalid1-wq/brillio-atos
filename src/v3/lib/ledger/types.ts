/**
 * Claims-ledger types (docs/aura/ledger-spec.md — the five tiers + vocabulary,
 * with instantiation amendments A1-A8 folded in). Pure types; no runtime.
 */
import type { World, Source } from "./precedence";
export type { World, Source } from "./precedence";

export type Status = "open" | "weak" | "closed" | "blocked" | "n/a";
export type Layer = "domain" | "configuration"; // Tier 2 durability
/**
 * HOW a claim came to be closed. `transcript` is the newest and the one that
 * needs saying: a person's own words, lifted from a meeting recording and
 * confirmed by an operator. It is not `assertion` — that belongs to a reply
 * which arrived through their own token-gated link, with nobody in between —
 * and it is not `import`, which would mean a machine put it there and would
 * wrongly exclude them from the heard count. They WERE heard; it happened out
 * loud, in a room, and the claim carries the quote to prove it.
 */
export type ClosureMethod = "assertion" | "disposition" | "document" | "analysis" | "experiment" | "transcript" | "import";

/** A1 — a claim value is a tagged union; a reference carries an id, never a name. */
export type ClaimValue =
  | { kind: "scalar"; value: string | number | boolean }
  | { kind: "ref"; to: string }                       // elementId
  | { kind: "ref-list"; to: string[] }                // A5 multi-value
  | { kind: "unresolved-ref"; name: string; why: string } // A1/A2 first-class dangling ref
  | { kind: "unknown" }                               // ?unknown (born, never omitted)
  | { kind: "na" };

/** Ownership — A ⋈ B (joint) is a first-class owner (A8: unowned falls through to a domain authority). */
export type Owner =
  | { kind: "role"; role: string }
  /**
   * SHARED BETWEEN N PARTIES, not two.
   *
   * This was `{ a, b }`, which could not express what the record routinely says: a Laila
   * entity's area reads "Sales / Practices / Delivery / Marketing / Legal / Finance", and
   * **73 of the 78** questions on multi-function elements name three or more functions. A
   * pair forced every one of those into a worse answer — either a fabricated single owner
   * (the old first-regex-wins, which handed Practices 78 questions the record never gave
   * it) or `unowned`, which is honest but makes an operator route work the record already
   * describes as shared.
   *
   * `parties` is kept SORTED and de-duplicated at construction so one seam has one
   * identity: the label `A ⋈ B ⋈ C` is the interchange format nearly every surface
   * actually consumes, and two orderings of the same parties must not read as two seams.
   *
   * LEGACY SHAPE: claims persisted before this carry `{ a, b }`. `normalizeOwner` below
   * accepts both and is applied at the one rehydration boundary (`pgStore`), so stored
   * rows keep working without a data migration.
   */
  | { kind: "joint"; parties: string[] }
  | { kind: "unowned" };

/** Build a joint owner with the one identity rule applied — sorted, de-duplicated. */
export const jointOwner = (parties: readonly string[]): Owner =>
  ({ kind: "joint", parties: [...new Set(parties.filter(Boolean))].sort() });

/**
 * Accept an owner from STORAGE, in either shape.
 *
 * `pgStore` casts a stored JSON blob straight into `Claim["ownerWhileOpen"]`, so a row
 * written before the N-party change carries `{ kind: "joint", a, b }` and would otherwise
 * rehydrate with `parties === undefined` — `ownerLabel` would throw rather than degrade.
 * Normalising at the boundary keeps the type honest inside the core and needs no backfill.
 */
export const normalizeOwner = (raw: unknown): Owner => {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.kind === "joint") {
    if (Array.isArray(o.parties)) return jointOwner(o.parties.map(String));
    return jointOwner([o.a, o.b].filter(Boolean).map(String));   // legacy pair
  }
  if (o.kind === "role") return { kind: "role", role: String(o.role ?? "") };
  return { kind: "unowned" };
};

export interface Closure {
  method: ClosureMethod;
  by: string;             // who closed it (email / role / authority token)
  verbatim?: string;      // the quote/reason; ABSENT ⇒ a touch, not a confirmation (weak)
  at?: string;            // caller-supplied timestamp (no Date.now — determinism)
  note?: string;
}

/** Tier 1 — every slot on every element is a claim. */
export interface Claim {
  id: string;
  about: string;          // "<elementId>.<slot>"
  value: ClaimValue;
  world: World;
  layer: Layer;
  source: Source;
  status: Status;
  ownerWhileOpen: Owner;
  closedBy?: Closure;
  supersededBy?: string;  // id of the claim that won precedence (this one kept as history)
  contradicts?: string[]; // ids of live claims it coexists-in-conflict with
  escalateTo?: "slot-owner" | "legal-compliance"; // set when a conflict on this locus escalates
  blockedReason?: string; // A4/A8 — why blocked (open value set / bound by regulation)
  createdAt?: string;
}

/** Tier 0 — identity kernel (world-agnostic; A3). Relations are elements too. */
export type ElementKind =
  | "entity" | "attribute" | "relation" | "workflow" | "step"
  | "system" | "area" | "person" | "role" | "shape-slot";
export interface LedgerElement {
  id: string;
  kind: ElementKind;
  name: string;
  of?: string;                        // parent element id (attribute of entity, step of workflow)
  refs?: Record<string, string>;      // typed relation targets by id (from/to/sysOfRecord/…)
}

/** Tier 3 — shape modules declared per engagement in Frame; added slots are born unknown. */
export type ShapeKind = "lifecycle" | "decision" | "obligation" | "portfolio";
export interface ShapeDecl {
  kind: ShapeKind;
  appliesTo: ElementKind[];
  slots: string[];         // slot names this shape adds; each born ?unknown on matching elements
}

export interface Ledger {
  elements: LedgerElement[];
  claims: Claim[];
  shapes: ShapeDecl[];
}

// ── helpers ──────────────────────────────────────────────────────────────────
// `about` = `<elementId>#<slot>`. `#` separates because BOTH element ids
// (el:attr:opportunity.stage) and slots (touches.user, stage.valueSet) contain dots.
export const aboutOf = (elementId: string, slot: string): string => `${elementId}#${slot}`;
export const elementIdOf = (about: string): string => (about.includes("#") ? about.slice(0, about.indexOf("#")) : about);
export const slotOf = (about: string): string => (about.includes("#") ? about.slice(about.indexOf("#") + 1) : about);

/** Deterministic id (djb2 hex) — no positional ids anywhere (A6). */
export function contentId(prefix: string, ...parts: unknown[]): string {
  const input = parts.map((p) => (typeof p === "object" ? JSON.stringify(p) : String(p))).join("");
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${prefix}:${h.toString(16).padStart(8, "0")}`;
}

/** THE interchange format for a seam: `A ⋈ B`, `A ⋈ B ⋈ C`, … Surfaces split on `⋈`. */
export const ownerLabel = (o: Owner): string =>
  o.kind === "joint" ? o.parties.join(" ⋈ ") : o.kind === "unowned" ? "unowned" : o.role;

export const valueLabel = (v: ClaimValue): string => {
  switch (v.kind) {
    case "scalar": return String(v.value);
    case "ref": return `→${v.to}`;
    case "ref-list": return v.to.map((t) => `→${t}`).join(", ");
    case "unresolved-ref": return `⚠unresolved(${v.name})`;
    case "unknown": return "?unknown";
    case "na": return "n/a";
  }
};

export const isOpen = (c: Claim): boolean => c.status === "open";
export const isLive = (c: Claim): boolean => !c.supersededBy; // superseded claims are history
