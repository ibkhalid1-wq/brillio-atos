// Aura — the claims-emitting generator (edge/Deno). Emits claims-with-unknowns
// conforming to docs/aura/ledger-generation-contract.md: the batch that Option A
// feeds directly into the (frozen, proven) reconcile instead of re-migrating a blob.
//
// THREE FROZEN PRINCIPLES this module honors, never reopens:
//  1. Every slot is a claim; unknowns are EMITTED, not omitted (the whole point).
//  2. Source is always `generated` (the weakest); it never overwrites — reconcile
//     owns precedence, already proven. The generator proposes; closures survive.
//  3. No model call mints an id or an edge. Claims are id-less (ids are the store's
//     contentId, computed downstream); element ids are content-derived slugs;
//     references NAME a target (a claim-to-be-bound), they do not bind it.
//
// Runtime-agnostic TS (no Deno/DOM APIs) so it runs under Deno and is importable by
// a Node reconcile harness for the end-to-end proof.

export type World = "as-is" | "to-be";
export type Layer = "domain" | "configuration";
export type Status = "open" | "weak" | "closed" | "blocked" | "n/a";
export type ClaimValue =
  | { kind: "scalar"; value: string | number | boolean }
  | { kind: "ref"; to: string }
  | { kind: "ref-list"; to: string[] }
  | { kind: "unresolved-ref"; name: string; why: string }
  | { kind: "unknown" }
  | { kind: "na" };
export type Owner = { kind: "role"; role: string } | { kind: "joint"; a: string; b: string } | { kind: "unowned" };

/** A generated claim = AssertInput minus everything the store computes. No id,
 *  supersededBy, contradicts, escalateTo, or closedBy — those are the store's and
 *  the human's, never the generator's. */
export interface GeneratedClaim {
  about: string; value: ClaimValue; world: World; layer: Layer;
  source: "generated"; status: Status; ownerWhileOpen: Owner;
}
export interface GeneratedElement { id: string; kind: string; name: string; of?: string; refs?: Record<string, string>; }
export interface GeneratedBatch { elements: GeneratedElement[]; claims: GeneratedClaim[]; }

// ── deterministic id derivation (mirrors src/v3/lib/ledger/types.ts exactly) ──
export const slug = (s: unknown): string =>
  String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
export function contentId(prefix: string, ...parts: unknown[]): string {
  // CRITICAL: separator MUST be "\x01" (SOH) to match the store's contentId in
  // src/v3/lib/ledger/types.ts byte-for-byte. Written as an escape (not the raw
  // invisible control char) so it can't silently diverge again — that "" vs "\x01"
  // drift once broke every step id. This is a COPY, not an import, because the edge
  // (supabase/functions) is self-contained: NO edge file imports src/ (Supabase
  // deploys the functions dir; the repo's pattern is copy-into-_shared, e.g.
  // flowAreas.ts). The lockstep is ENFORCED by scripts/ledger/contentid-parity.ts,
  // which fails on any drift (function-level + step-id parity vs the store).
  const input = parts.map((p) => (typeof p === "object" ? JSON.stringify(p) : String(p))).join("\x01");
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return `${prefix}:${h.toString(16).padStart(8, "0")}`;
}
export const aboutOf = (elementId: string, slotName: string): string => `${elementId}#${slotName}`;
export const elementIdOf = (about: string): string => (about.includes("#") ? about.slice(0, about.indexOf("#")) : about);
export const slotOf = (about: string): string => (about.includes("#") ? about.slice(about.indexOf("#") + 1) : about);

// ── owner derivation (mirrors migrate.ts: functionOf → role | unowned, joint for seams) ──
const FUNCTIONS: Array<[RegExp, string]> = [
  [/practice|capability|competenc/, "Practices"], [/alliance|partner/, "Alliances"],
  [/finance|invoic|billing|revenue/, "Finance"], [/legal|contract/, "Legal"],
  [/deliver|engagement/, "Delivery"], [/market/, "Marketing"],
  [/sales ops|ops|operation/, "Sales Ops"], [/sales|opportunity|account/, "Sales"],
];
const functionOf = (area: string): string | null => {
  const a = (area || "").toLowerCase();
  for (const [re, fn] of FUNCTIONS) if (re.test(a)) return fn;
  return null;
};
const ROLE_LABEL: Record<string, string> = { Sales: "Sales Leaders" };
const ownerFor = (area: string): Owner => {
  const fn = functionOf(area);
  return fn ? { kind: "role", role: ROLE_LABEL[fn] ?? fn } : { kind: "unowned" };
};
const jointOrOwner = (areaA: string, areaB: string, fallback: string): Owner => {
  const a = functionOf(areaA), b = functionOf(areaB);
  if (a && b && a !== b) { const [x, y] = [a, b].sort(); return { kind: "joint", a: x, b: y }; }
  return ownerFor(a ? areaA : b ? areaB : fallback);
};

// ── the shape-required slot set per element kind (the anti-omission contract) ──
// Every element MUST carry these slots; the generator fills them or emits ?unknown.
export const REQUIRED_SLOTS: Record<string, string[]> = {
  entity: ["exists", "definition", "systemOfRecord"],
  attribute: ["exists", "dataType", "optionality", "valueSet"],
  relation: ["cardinality", "optionality", "semantics"],
  workflow: ["name", "area", "owner", "trigger", "phase"],
  step: ["action", "automationDisposition", "actorRole"],
};
const DECISION_RE = /approv|review|decide|gate|threshold/i;

export interface GenSource { ontology: Record<string, unknown>; atlas: Record<string, unknown>; }

/** Generate the claims-with-unknowns batch from the (model-authored) source artifacts.
 *  Deterministic: the model's content is already in `source`; this emits it as claims,
 *  making every gap an explicit ?unknown rather than a silent omission. */
export function generateClaimsBatch(source: GenSource): GeneratedBatch {
  const entities = (Array.isArray(source.ontology.entities) ? source.ontology.entities : []) as Array<Record<string, unknown>>;
  const relations = (Array.isArray(source.ontology.relations) ? source.ontology.relations : []) as Array<Record<string, unknown>>;
  const workflows = (Array.isArray(source.atlas.workflows) ? source.atlas.workflows : []) as Array<Record<string, unknown>>;

  const elements: GeneratedElement[] = [];
  const claims: GeneratedClaim[] = [];
  const idByName = new Map<string, string>();
  const areaByName = new Map<string, string>();
  const nameByLower = new Map<string, string>(); // for alias collision detection (mirrors migrate.ts)
  for (const e of entities) { const n = String(e.name ?? ""); if (n) { idByName.set(n, `el:entity:${slug(n)}`); areaByName.set(n, String(e.area ?? "")); nameByLower.set(n.toLowerCase(), n); } }

  const sc = (v: string | number | boolean): ClaimValue => ({ kind: "scalar", value: v });
  const UNK: ClaimValue = { kind: "unknown" };
  const emit = (about: string, value: ClaimValue, layer: Layer, owner: Owner) => {
    // status derived from value kind (never `closed`/`blocked` for a plain generated slot)
    const status: Status = value.kind === "unknown" ? "open" : value.kind === "na" ? "n/a" : value.kind === "unresolved-ref" ? "blocked" : "weak";
    claims.push({ about, value, world: "to-be", layer, source: "generated", status, ownerWhileOpen: owner });
  };

  // ── entities + attributes ──
  for (const e of entities) {
    const name = String(e.name ?? ""); if (!name) continue;
    const eid = idByName.get(name)!;
    const owner = ownerFor(String(e.area ?? ""));
    elements.push({ id: eid, kind: "entity", name });
    emit(aboutOf(eid, "exists"), sc(true), "domain", owner);
    emit(aboutOf(eid, "definition"), e.definition ? sc(String(e.definition)) : UNK, "domain", owner);
    emit(aboutOf(eid, "systemOfRecord"), e.systemOfRecord ? sc(String(e.systemOfRecord)) : UNK, "configuration", owner);
    for (const alias of (Array.isArray(e.aliases) ? e.aliases : []) as unknown[]) { // mirrors migrate.ts
      const an = String(alias);
      const collides = nameByLower.has(an.toLowerCase()) && an.toLowerCase() !== name.toLowerCase();
      emit(aboutOf(eid, `alias.${slug(an)}`),
        collides ? { kind: "unresolved-ref", name: an, why: "alias collides with a distinct element name (A2)" } : sc(an),
        "domain", owner);
    }
    for (const a of (Array.isArray(e.attributes) ? e.attributes : []) as unknown[]) {
      const an = typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""); if (!an) continue;
      const aid = `el:attr:${slug(name)}.${slug(an)}`;
      elements.push({ id: aid, kind: "attribute", name: an, of: eid });
      emit(aboutOf(aid, "exists"), sc(true), "configuration", owner);
      emit(aboutOf(aid, "dataType"), UNK, "configuration", owner);      // F-D — never knowable from the artifact alone
      emit(aboutOf(aid, "optionality"), UNK, "configuration", owner);   // F-D
      emit(aboutOf(aid, "valueSet"), UNK, "domain", owner);             // F-F — the highest-value Listen ask
    }
  }

  // ── relations ──
  for (const r of relations) {
    const from = String(r.from ?? ""), to = String(r.to ?? ""); if (!from || !to) continue;
    const rid = `el:rel:${slug(from)}-${slug(to)}`;
    const owner = jointOrOwner(areaByName.get(from) ?? "", areaByName.get(to) ?? "", "sales ops");
    elements.push({ id: rid, kind: "relation", name: `${from}→${to}`, refs: { from: idByName.get(from) ?? "", to: idByName.get(to) ?? "" } });
    emit(aboutOf(rid, "cardinality"), r.cardinality ? sc(String(r.cardinality)) : UNK, "domain", owner);
    emit(aboutOf(rid, "optionality"), UNK, "domain", owner);           // F-D
    emit(aboutOf(rid, "semantics"), r.relation ? sc(String(r.relation)) : UNK, "domain", owner);
  }

  // ── workflows + steps ──
  for (const w of workflows) {
    const wn = String(w.name ?? ""); if (!wn) continue;
    const wid = `el:wf:${slug(wn)}`;
    const area = String(w.area ?? "");
    const owner = ownerFor(area);
    elements.push({ id: wid, kind: "workflow", name: wn });
    emit(aboutOf(wid, "name"), sc(wn), "domain", owner);
    emit(aboutOf(wid, "area"), w.area ? sc(String(w.area)) : UNK, "configuration", owner);
    emit(aboutOf(wid, "owner"), w.owner ? sc(String(w.owner)) : UNK, "configuration", owner);   // ALWAYS emit; ?unknown when absent, never omitted (the anti-omission discipline)
    emit(aboutOf(wid, "trigger"), w.trigger ? sc(String(w.trigger)) : UNK, "domain", owner);     // ALWAYS emit; ?unknown when absent
    emit(aboutOf(wid, "phase"), UNK, "domain", owner);                 // F-G — the grid derives until asserted
    for (const st of (Array.isArray(w.steps) ? w.steps : []) as Array<Record<string, unknown>>) {
      const action = String(st.action ?? "");
      const actor = String(st.actor ?? "");
      const sid = contentId("el:step", wid, actor, action.slice(0, 60)); // content id, not positional (A6)
      const stepOwner = jointOrOwner(area, actor, area || "sales ops");
      elements.push({ id: sid, kind: "step", name: action.slice(0, 60), of: wid });
      emit(aboutOf(sid, "action"), sc(action), "domain", stepOwner);
      emit(aboutOf(sid, "automationDisposition"), UNK, "configuration", stepOwner); // F-A
      emit(aboutOf(sid, "actorRole"), actor ? sc(actor) : UNK, "configuration", stepOwner);
      if (DECISION_RE.test(action)) emit(aboutOf(sid, "decision"), UNK, "domain", stepOwner); // F-B (decision shape only)
      for (const ent of (Array.isArray(st.entities) ? st.entities : []) as unknown[]) {
        const en = String(ent); const target = idByName.get(en);
        emit(aboutOf(sid, `touches.${slug(en)}`),
          target ? { kind: "ref", to: target } : { kind: "unresolved-ref", name: en, why: "step names an entity the ontology does not hold (F-C)" },
          "domain", stepOwner);
      }
    }
  }

  return { elements, claims };
}

// ── the validator: the guard between a non-deterministic model and a proven store ──
export interface ValidationError { code: string; about?: string; detail: string; }
export interface ValidationResult { ok: boolean; errors: ValidationError[]; elementCount: number; claimCount: number; unknownCount: number; }

/** A batch claim = AssertInput shape. GeneratedClaim is the generator's stricter subtype
 *  (source 'generated', no closedBy); an IMPORT adapter emits the same shape with its own
 *  source class and a closedBy (the import/disposition attribution). One shape, one store. */
export interface BatchClaim {
  about: string; value: ClaimValue; world: World; layer: Layer;
  source: string; status: Status; ownerWhileOpen: Owner;
  closedBy?: { method: string; by: string; verbatim?: string };
}
export interface Batch { elements: GeneratedElement[]; claims: BatchClaim[]; }

/** Per-caller policy. The SHAPE checks (about, value, reference, binder discipline on
 *  store-computed fields) are universal; the source ceiling, slot completeness, and
 *  whether a closedBy is allowed are the caller's policy — the generator vs an import. */
export interface ValidateOptions {
  allowedSources?: string[];        // generator: ['generated']; override adapter: ['dispositioned','code-derived']
  requireSlotCompleteness?: boolean; // generator: true (declares whole elements); import: false (targeted claims)
  allowClosedBy?: boolean;           // generator: false (never closes); import: true (carries the disposition attribution)
  checkElementIds?: boolean;         // generator: true (a MODEL must not mint ids); import: false (ids are code-derived by construction, and use el:removed:/el:rel: prefixes)
}

const VALUE_KINDS = new Set(["scalar", "ref", "ref-list", "unresolved-ref", "unknown", "na"]);
// store/human-owned fields no batch may carry (id/supersededBy/… are the store's); closedBy is
// conditionally forbidden — the generator never closes, an import adapter attributes its disposition.
const ALWAYS_FORBIDDEN = ["id", "supersededBy", "superseded_by", "contradicts", "escalateTo", "escalate_to"];

export function validateBatch(batch: Batch, opts: ValidateOptions = {}): ValidationResult {
  const { allowedSources = ["generated"], requireSlotCompleteness = true, allowClosedBy = false, checkElementIds = true } = opts;
  const FORBIDDEN_CLAIM_KEYS = allowClosedBy ? ALWAYS_FORBIDDEN : [...ALWAYS_FORBIDDEN, "closedBy", "closed_by"];
  const errors: ValidationError[] = [];
  const err = (code: string, detail: string, about?: string) => errors.push({ code, about, detail });
  const els = Array.isArray(batch.elements) ? batch.elements : [];
  const cls = Array.isArray(batch.claims) ? batch.claims : [];

  // element ids must be code-derived (recomputable from kind+name), never model-minted (generator-only)
  for (const e of checkElementIds ? els : []) {
    const expected = e.kind === "entity" ? `el:entity:${slug(e.name)}`
      : e.kind === "attribute" ? `el:attr:${slug((els.find((x) => x.id === e.of)?.name) ?? "")}.${slug(e.name)}`
        : e.kind === "workflow" ? `el:wf:${slug(e.name)}` : null; // relation/step ids are content-hashed; checked by prefix only
    if (expected && e.id !== expected) err("element-id-not-derived", `${e.id} != ${expected} (a model must not mint ids)`, e.id);
    if ((e.kind === "relation" && !e.id.startsWith("el:rel:")) || (e.kind === "step" && !e.id.startsWith("el:step:"))) err("element-id-not-derived", `${e.id} has no code prefix`, e.id);
  }

  const claimsByElement = new Map<string, Set<string>>();
  let unknownCount = 0;
  for (const c of cls) {
    const about = c.about;
    // structural
    if (typeof about !== "string" || !about.includes("#")) { err("bad-about", `about must be <elementId>#<slot>: ${JSON.stringify(about)}`); continue; }
    for (const k of FORBIDDEN_CLAIM_KEYS) if (k in (c as unknown as Record<string, unknown>)) err("forbidden-key", `claim carries store/human-owned key '${k}' (binder discipline)`, about);
    // (2) source ceiling — the caller's allowed source classes (never `asserted` unless the caller says so)
    if (!allowedSources.includes(c.source)) err("source-ceiling", `source '${c.source}' not in [${allowedSources.join(", ")}]`, about);
    // value shape
    if (!c.value || !VALUE_KINDS.has(c.value.kind)) { err("bad-value", `unknown value kind`, about); continue; }
    if (c.value.kind === "unknown") unknownCount += 1;
    // (3) reference shape — a touches.* slot MUST be a ref/unresolved-ref, never a bare scalar name
    if (slotOf(about).startsWith("touches.") && c.value.kind !== "ref" && c.value.kind !== "unresolved-ref")
      err("reference-shape", `touches slot must be ref|unresolved-ref, got ${c.value.kind}`, about);
    if (c.value.kind === "ref" && typeof (c.value as { to?: unknown }).to !== "string") err("reference-shape", `ref missing 'to'`, about);
    // (4) status coherence
    const st = c.status;
    if (c.value.kind === "unknown" && st !== "open") err("status-coherence", `unknown ⇒ open, got '${st}'`, about);
    if (c.value.kind === "na" && st !== "n/a") err("status-coherence", `na ⇒ n/a, got '${st}'`, about);
    // substantive: the generator may only propose (weak); an import may close (weak|closed) — never open/blocked
    const substantiveOk = allowClosedBy ? (st === "weak" || st === "closed") : st === "weak";
    if ((c.value.kind === "scalar" || c.value.kind === "ref" || c.value.kind === "ref-list") && !substantiveOk)
      err("status-coherence", `substantive value ⇒ ${allowClosedBy ? "weak|closed" : "weak (generator never closes)"}, got '${st}'`, about);
    // owner present
    if (!c.ownerWhileOpen || !["role", "joint", "unowned"].includes((c.ownerWhileOpen as Owner).kind)) err("bad-owner", `missing/invalid ownerWhileOpen`, about);
    const eid = elementIdOf(about);
    (claimsByElement.get(eid) ?? claimsByElement.set(eid, new Set()).get(eid)!).add(slotOf(about));
  }

  // (1) slot completeness — every element carries the full required slot set for its kind
  // (the anti-omission guard; generator-only — an import adapter emits targeted claims, not whole elements)
  for (const e of requireSlotCompleteness ? els : []) {
    const req = REQUIRED_SLOTS[e.kind]; if (!req) continue;
    const have = claimsByElement.get(e.id) ?? new Set<string>();
    for (const slotName of req) if (!have.has(slotName)) err("slot-incomplete", `element ${e.id} (${e.kind}) missing required slot '${slotName}' — omission is what makes a guess look like fact`, e.id);
  }

  return { ok: errors.length === 0, errors, elementCount: els.length, claimCount: cls.length, unknownCount };
}
