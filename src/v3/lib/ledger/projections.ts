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
export interface QueueItem { about: string; owner: Owner; ownerLabel: string; routing: Routing; slot: string; }
export interface UnknownQueue {
  items: QueueItem[];
  byOwner: Array<{ owner: string; items: QueueItem[] }>;
  unowned: QueueItem[];                 // pinned + loud
  counts: Record<Routing, number> & { total: number };
}

export function buildUnknownQueue(store: LedgerStore): UnknownQueue {
  const open = store.claims().filter((c) => isLive(c) && (c.status === "open" || c.status === "blocked"));
  const items: QueueItem[] = open.map((c) => {
    const routing: Routing = c.status === "blocked" ? "blocked"
      : c.ownerWhileOpen.kind === "unowned" ? "unowned"
        : isArchitectGating(c.about) ? "blocking"
          : "answerable-without-a-meeting";
    return { about: c.about, owner: c.ownerWhileOpen, ownerLabel: ownerLabel(c.ownerWhileOpen), routing, slot: slotOf(c.about) };
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
  // heard-count = closed claims owned by that band (computed, not stored)
  for (const c of store.claims().filter((c) => isLive(c) && (c.status === "closed" || c.status === "weak"))) {
    const key = ownerLabel(c.ownerWhileOpen); const b = bandMap.get(key);
    if (b) b.heard += 1;
  }
  const bands = [...bandMap.values()].sort((a, b) =>
    (a.kind === "unowned" ? -2 : a.kind === "seam" ? -1 : 0) - (b.kind === "unowned" ? -2 : b.kind === "seam" ? -1 : 0)
    || b.blocking - a.blocking || a.label.localeCompare(b.label));
  const all = store.claims().filter(isLive);
  const closed = all.filter((c) => c.status === "closed" || c.status === "weak").length;
  const open = all.filter((c) => c.status === "open" || c.status === "blocked").length;
  return { bands, burnDown: { total: closed + open, closed, open, pctClosed: closed + open ? +(100 * closed / (closed + open)).toFixed(1) : 0 } };
}

// ── 2.5 · deviation register (as-is vs to-be on one locus) ─────────────────────
export type DeviationClass = "document-backed" | "unbacked";
export interface Deviation { about: string; asIs: string; toBe: string; classification: DeviationClass; stillReferenced: boolean; }
export function buildDeviationRegister(store: LedgerStore): Deviation[] {
  const live = store.claims().filter(isLive);
  const referencedNames = new Set(live.filter((c) => c.value.kind === "unresolved-ref").map((c) => (c.value as { name: string }).name.toLowerCase()));
  const byAbout = new Map<string, Claim[]>();
  for (const c of live) (byAbout.get(c.about) ?? byAbout.set(c.about, []).get(c.about)!).push(c);
  const out: Deviation[] = [];
  for (const [about, cs] of byAbout) {
    const asIs = cs.filter((c) => c.world === "as-is" && (c.value.kind === "scalar" || c.value.kind === "ref"));
    const toBe = cs.filter((c) => c.world === "to-be" && (c.value.kind === "scalar" || c.value.kind === "ref"));
    if (!asIs.length || !toBe.length) continue;
    if (JSON.stringify(asIs[0].value) === JSON.stringify(toBe[0].value)) continue; // no deviation
    const backed = toBe.some((c) => c.source === "document" || c.source === "regulation" || c.source === "external-standard");
    // is the element (by name) still referenced elsewhere as an unresolved-ref?
    const el = store.elements().find((e) => e.id === elementIdOf(about));
    const stillReferenced = !!el && referencedNames.has(el.name.toLowerCase());
    out.push({ about, asIs: valueStr(asIs[0]), toBe: valueStr(toBe[0]), classification: backed ? "document-backed" : "unbacked", stillReferenced });
  }
  return out.sort((a, b) => a.about.localeCompare(b.about));
}
