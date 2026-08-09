/**
 * Tier-4 projections — read models over the ledger (docs/aura/ledger-spec.md).
 * Pure; a projection is the ONLY read path (A7) — precedence resolves inside it,
 * once, and no component reads raw claims. Tested on the migrated Laila ledger.
 *
 * Includes: the unknown queue (2.3), the ontology / atlas / kit views (2.4), and
 * the deviation register (2.5).
 */
import type { LedgerStore } from "./store";
import { type Claim, type Owner, ownerLabel, slotOf, elementIdOf, isLive } from "./types";

// ── depth filter — which unknowns GATE the Architect vs are disposition-eligible ──
const ARCHITECT_SLOTS = new Set(["automationDisposition", "decision", "optionality", "semantics", "valueSet", "phase", "isClientOrPartner", "handoffRule", "exists"]);
const isArchitectGating = (about: string): boolean => ARCHITECT_SLOTS.has(slotOf(about));

// ── 2.3 · the unknown queue ───────────────────────────────────────────────────
export type Routing = "blocking" | "unowned" | "answerable-without-a-meeting" | "blocked";
export interface QueueItem { about: string; owner: Owner; ownerLabel: string; routing: Routing; slot: string; status: "open" | "blocked"; }
export interface UnknownQueue {
  items: QueueItem[];
  byOwner: Array<{ owner: string; items: QueueItem[] }>;
  unowned: QueueItem[];                 // pinned + loud
  counts: Record<Routing, number> & { total: number };
}

export function buildUnknownQueue(store: LedgerStore): UnknownQueue {
  const open = store.claims().filter((c) => isLive(c) && (c.status === "open" || c.status === "blocked"));
  const items: QueueItem[] = open.map((c) => {
    // UNOWNED is decided by OWNERSHIP first, before the blocked routing — a locus
    // nobody owns is unowned whether or not it is also blocked, and the operator's
    // next move on it is the same either way: assign an owner. Counting it under
    // "blocked" instead (the old order) hid one blocked-unowned locus, so the Work
    // header (kit band, ownership-counted) read 6 while this queue read 5. One
    // definition now: unowned = open-unknowns (open OR blocked) that nobody owns.
    const routing: Routing = c.ownerWhileOpen.kind === "unowned" ? "unowned"
      : c.status === "blocked" ? "blocked"
        : isArchitectGating(c.about) ? "blocking"
          : "answerable-without-a-meeting";
    return { about: c.about, owner: c.ownerWhileOpen, ownerLabel: ownerLabel(c.ownerWhileOpen), routing, slot: slotOf(c.about), status: c.status === "blocked" ? "blocked" : "open" };
  });
  const counts = { blocking: 0, unowned: 0, "answerable-without-a-meeting": 0, blocked: 0, total: items.length } as UnknownQueue["counts"];
  for (const i of items) counts[i.routing] += 1;
  const ownerMap = new Map<string, QueueItem[]>();
  for (const i of items) (ownerMap.get(i.ownerLabel) ?? ownerMap.set(i.ownerLabel, []).get(i.ownerLabel)!).push(i);
  // owners ranked by how much they BLOCK (blocking desc, then total desc, then name)
  const byOwner = [...ownerMap.entries()]
    .map(([owner, its]) => ({ owner, items: its, blockers: its.filter((x) => x.routing === "blocking").length }))
    .sort((a, b) => b.blockers - a.blockers || b.items.length - a.items.length || a.owner.localeCompare(b.owner))
    .map(({ owner, items: its }) => ({ owner, items: its }));
  return { items, byOwner, unowned: items.filter((i) => i.routing === "unowned"), counts };
}

// ── shared: resolved slot status for an element (weak/unknown distinct from closed) ──
export type SlotState = "closed" | "weak" | "open" | "blocked" | "n/a" | "conflict";
export interface SlotView { slot: string; about: string; state: SlotState; valueLabel: string; source: string; world: string; }

function slotViews(store: LedgerStore, elementId: string): SlotView[] {
  const claims = store.claims().filter((c) => isLive(c) && elementIdOf(c.about) === elementId);
  const byAbout = new Map<string, Claim[]>();
  for (const c of claims) (byAbout.get(c.about) ?? byAbout.set(c.about, []).get(c.about)!).push(c);
  const out: SlotView[] = [];
  for (const [about, cs] of byAbout) {
    const { conflicts } = store.resolve(about);
    const primary = cs.slice().sort((a, b) => rank(b) - rank(a))[0];
    const state: SlotState = conflicts.length ? "conflict" : (primary.status as SlotState);
    out.push({ slot: slotOf(about), about, state, valueLabel: valueStr(primary), source: primary.source, world: primary.world });
  }
  return out.sort((a, b) => a.slot.localeCompare(b.slot));
}
const rank = (c: Claim): number => ({ closed: 5, weak: 4, blocked: 3, open: 2, "n/a": 1 } as Record<string, number>)[c.status] ?? 0;
const valueStr = (c: Claim): string => {
  const v = c.value;
  return v.kind === "scalar" ? String(v.value) : v.kind === "ref" ? `→${v.to}` : v.kind === "ref-list" ? v.to.map((t) => `→${t}`).join(", ")
    : v.kind === "unresolved-ref" ? `⚠${v.name}` : v.kind === "unknown" ? "?unknown" : "n/a";
};

// ── 2.4a · ontology view ──────────────────────────────────────────────────────
export interface OntologyElementView { id: string; kind: string; name: string; slots: SlotView[]; }
export function buildOntologyView(store: LedgerStore): OntologyElementView[] {
  return store.elements()
    .filter((e) => e.kind === "entity" || e.kind === "attribute" || e.kind === "relation")
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, slots: slotViews(store, e.id) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

// ── 2.4b · atlas view (steps with tri-state slots; coherence = ledger contradictions) ──
export interface StepView { id: string; name: string; slots: SlotView[]; contradictions: number; unresolvedRefs: number; }
export interface WorkflowView { id: string; name: string; slots: SlotView[]; steps: StepView[]; }
export function buildAtlasView(store: LedgerStore): WorkflowView[] {
  const stepsOf = (wid: string) => store.elements().filter((e) => e.kind === "step" && e.of === wid);
  return store.elements().filter((e) => e.kind === "workflow").map((w) => ({
    id: w.id, name: w.name, slots: slotViews(store, w.id),
    steps: stepsOf(w.id).map((st) => {
      const sv = slotViews(store, st.id);
      return {
        id: st.id, name: st.name, slots: sv,
        contradictions: sv.filter((s) => s.state === "conflict").length,
        unresolvedRefs: store.claims().filter((c) => isLive(c) && elementIdOf(c.about) === st.id && c.value.kind === "unresolved-ref").length,
      };
    }),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── heard-count (honest) — an attributed HUMAN closure, not a machine import ──
// migrate() closes nearly every slot `weak` via `{by:"prototype", method:"import"}`;
// counting those as "heard" inflates the register. A slot is HEARD only when a person
// closed it: an attributed source, a non-import method, and a human `by` (not the
// prototype/system token). This is the single definition the kit + register share.
const ATTRIBUTED_SOURCES = new Set(["asserted", "dispositioned", "document", "regulation", "precedent"]);
const SYSTEM_ACTORS = new Set(["prototype", "import", "system", "?"]);
export const isHeardClosure = (c: Claim): boolean =>
  isLive(c) && (c.status === "closed" || c.status === "weak") && ATTRIBUTED_SOURCES.has(c.source)
  && !!c.closedBy && c.closedBy.method !== "import" && !SYSTEM_ACTORS.has((c.closedBy.by || "").toLowerCase());

export interface HeardRegister { byBand: Array<{ band: string; heard: number }>; total: number; totalClosedOrWeak: number; }
/** The corrected claims register: attributed human closures per owner band + total,
 *  alongside the raw closed|weak count the old register conflated it with. */
export function buildHeardRegister(store: LedgerStore): HeardRegister {
  const byBand = new Map<string, number>();
  let total = 0;
  for (const c of store.claims()) {
    if (!isHeardClosure(c)) continue;
    total += 1;
    const key = ownerLabel(c.ownerWhileOpen);
    byBand.set(key, (byBand.get(key) ?? 0) + 1);
  }
  const totalClosedOrWeak = store.claims().filter((c) => isLive(c) && (c.status === "closed" || c.status === "weak")).length;
  return { byBand: [...byBand.entries()].map(([band, heard]) => ({ band, heard })).sort((a, b) => b.heard - a.heard || a.band.localeCompare(b.band)), total, totalClosedOrWeak };
}

// ── 2.4c · kit view (function-grouped; seams as joint bands; unowned its own band) ──
export interface KitBand { key: string; kind: "function" | "seam" | "unowned"; label: string; open: number; blocking: number; heard: number; }
export interface KitView { bands: KitBand[]; burnDown: { total: number; closed: number; open: number; pctClosed: number }; }
export function buildKitView(store: LedgerStore): KitView {
  const q = buildUnknownQueue(store);
  const bandMap = new Map<string, KitBand>();
  const push = (owner: Owner, item: QueueItem) => {
    const kind = owner.kind === "joint" ? "seam" : owner.kind === "unowned" ? "unowned" : "function";
    const key = ownerLabel(owner);
    const b = bandMap.get(key) ?? { key, kind, label: key, open: 0, blocking: 0, heard: 0 };
    b.open += 1; if (item.routing === "blocking") b.blocking += 1;
    bandMap.set(key, b);
  };
  for (const i of q.items) push(i.owner, i);
  // heard-count = attributed HUMAN closures owned by that band (honest; not machine imports).
  // A band with only open unknowns still appears (open>0); heard stays 0 until a person closes.
  for (const c of store.claims()) {
    if (!isHeardClosure(c)) continue;
    const key = ownerLabel(c.ownerWhileOpen);
    const b = bandMap.get(key) ?? { key, kind: c.ownerWhileOpen.kind === "joint" ? "seam" : c.ownerWhileOpen.kind === "unowned" ? "unowned" : "function", label: key, open: 0, blocking: 0, heard: 0 };
    b.heard += 1; bandMap.set(key, b);
  }
  const bands = [...bandMap.values()].sort((a, b) =>
    (a.kind === "unowned" ? -2 : a.kind === "seam" ? -1 : 0) - (b.kind === "unowned" ? -2 : b.kind === "seam" ? -1 : 0)
    || b.blocking - a.blocking || a.label.localeCompare(b.label));
  const all = store.claims().filter(isLive);
  const closed = all.filter((c) => c.status === "closed" || c.status === "weak").length;
  const open = all.filter((c) => c.status === "open" || c.status === "blocked").length;
  return { bands, burnDown: { total: closed + open, closed, open, pctClosed: closed + open ? +(100 * closed / (closed + open)).toFixed(1) : 0 } };
}

// ── 3.3 · confirm-or-deviate session agenda ───────────────────────────────────
// Each open unknown is rendered against its STRONGEST existing claim on the same
// locus (any world), so the question is "keep / trim / restage this?" not open
// recall. An as-is claim (an import) frames as "this is what you're leaving —
// keep or change?"; deviation is the expected answer.
export interface AgendaItem {
  about: string;
  owner: string;
  prompt: string;
  framing: "confirm-or-deviate" | "open-recall";
  against?: { value: string; source: string; world: string };
}
const strengthRank: Record<string, number> = { regulation: 8, asserted: 7, dispositioned: 6, document: 5, "external-standard": 4, "code-derived": 3, precedent: 2, generated: 1 };

export function buildSessionAgenda(store: LedgerStore): AgendaItem[] {
  const open = store.claims().filter((c) => isLive(c) && c.status === "open");
  return open.map((c) => {
    const siblings = store.liveClaimsAbout(c.about)
      .filter((x) => x.id !== c.id && (x.value.kind === "scalar" || x.value.kind === "ref" || x.value.kind === "ref-list"))
      .sort((a, b) => (strengthRank[b.source] ?? 0) - (strengthRank[a.source] ?? 0));
    const against = siblings[0];
    if (!against) return { about: c.about, owner: ownerLabel(c.ownerWhileOpen), framing: "open-recall" as const, prompt: `${slotOf(c.about)}: no prior claim — what is it?` };
    const leaving = against.world === "as-is";
    const val = valueStr(against);
    const prompt = leaving
      ? `${slotOf(c.about)}: today it's "${val}" (${against.source}, as-is) — this is what you're leaving. Keep or change?`
      : `${slotOf(c.about)}: the draft says "${val}" (${against.source}) — confirm, trim, or restage?`;
    return { about: c.about, owner: ownerLabel(c.ownerWhileOpen), framing: "confirm-or-deviate" as const, prompt, against: { value: val, source: against.source, world: against.world } };
  });
}

// ── 2.5 · deviation register (as-is vs to-be on one locus) ─────────────────────
export type DeviationClass = "document-backed" | "unbacked";
export interface Deviation {
  about: string; asIs: string; toBe: string; classification: DeviationClass;
  stillReferenced: boolean;
  // when stillReferenced: HOW it was matched. A clean structural link (removed element →
  // reference) needs the binder; until then this is a NAME candidate, surfaced as unverified,
  // never a silent name join.
  stillReferencedVia?: "name-candidate-unverified";
}
// substantive value kinds a deviation can be about. ref-list is INCLUDED — it is the exact
// shape imports emit (a Salesforce picklist / FHIR value set), so the primary import deviation
// must be able to register (it silently could not before).
const DEV_SUBSTANTIVE = new Set(["scalar", "ref", "ref-list"]);
export function buildDeviationRegister(store: LedgerStore): Deviation[] {
  const live = store.claims().filter(isLive);
  const referencedNames = new Set(live.filter((c) => c.value.kind === "unresolved-ref").map((c) => (c.value as { name: string }).name.toLowerCase()));
  const byAbout = new Map<string, Claim[]>();
  for (const c of live) (byAbout.get(c.about) ?? byAbout.set(c.about, []).get(c.about)!).push(c);
  const out: Deviation[] = [];
  for (const [about, cs] of byAbout) {
    const asIs = cs.filter((c) => c.world === "as-is" && DEV_SUBSTANTIVE.has(c.value.kind));
    const toBe = cs.filter((c) => c.world === "to-be" && DEV_SUBSTANTIVE.has(c.value.kind));
    if (!asIs.length || !toBe.length) continue;
    const asIsVals = new Set(asIs.map((c) => JSON.stringify(c.value)));         // compare against ALL as-is, not [0]
    const asIsStr = [...new Set(asIs.map(valueStr))].join(" | ");
    const el = store.elements().find((e) => e.id === elementIdOf(about));
    const nameMatch = !!el && referencedNames.has(el.name.toLowerCase());
    // one deviation per to-be claim that differs from every as-is value (multiplicity honored,
    // not an arbitrary [0]); classification reflects THAT claim's source, never a coexisting one.
    for (const t of toBe) {
      if (asIsVals.has(JSON.stringify(t.value))) continue;
      const backed = t.source === "document" || t.source === "regulation" || t.source === "external-standard";
      out.push({
        about, asIs: asIsStr, toBe: valueStr(t),
        classification: backed ? "document-backed" : "unbacked",
        stillReferenced: nameMatch,
        ...(nameMatch ? { stillReferencedVia: "name-candidate-unverified" as const } : {}),
      });
    }
  }
  return out.sort((a, b) => a.about.localeCompare(b.about) || a.toBe.localeCompare(b.toBe));
}
