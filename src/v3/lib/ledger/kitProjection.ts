/**
 * Kit questions as a PROJECTION of ledger open unknowns — one source, rendered twice.
 *
 * The operator's Discover queue and the stakeholder's kit/link are the SAME list:
 * the owned open unknowns (`buildUnknownQueue`), phrased two ways. The operator sees
 * loci-with-status; the stakeholder sees the same unknowns as plain-language questions,
 * each carrying the locus it closes. Because there is only ONE list, the kit and the
 * queue cannot drift — and answering a kit question closes a real locus, so the
 * burn-down moves.
 *
 * This module also RECONCILES a separately-generated kit (the discovery-kit artifact,
 * authored early — possibly pre-ledger) against the projection: a kit question that
 * maps to a locus becomes that locus's human phrasing; a kit question that maps to
 * nothing is a FINDING (the kit caught something the ontology missed), never dropped.
 *
 * Surface/read-model only — no core touched. The projection reads `buildUnknownQueue`
 * and phrases via `questionForLocus`; nothing here mutates the store.
 */
import type { LedgerStore } from "./store";
import { elementIdOf, slotOf } from "./types";
import { buildUnknownQueue } from "./projections";
import { questionForLocus, makeNameOf } from "./phrasing";

/** A kit question that IS a projection of a ledger locus. `about` is the locus it
 *  closes; `question` is the human phrasing; `locusName` is the element it's about;
 *  `ownerLabel` scopes it to the person who owns it (their kit). */
export interface KitQuestion {
  about: string;
  question: string;
  typeTag: string;
  locusName: string;
  slot: string;
  ownerLabel: string;
}

/**
 * THE kit projection: every open unknown, phrased for a human, mapped to the locus it
 * closes. Identical source to the operator queue (`buildUnknownQueue`) — one list.
 * Scope to a stakeholder by filtering on `ownerLabel`.
 */
export function projectKitQuestions(store: LedgerStore): KitQuestion[] {
  const q = buildUnknownQueue(store);
  const nameOf = makeNameOf(store.elements());
  return q.items
    .filter((i) => i.status === "open")
    .map((i) => {
      const p = questionForLocus(i.about, nameOf);
      return { about: i.about, question: p.question, typeTag: p.typeTag, locusName: p.name, slot: i.slot, ownerLabel: i.ownerLabel };
    });
}

// ── reconciling a separately-generated kit against the projection ──

/** Why a generated kit question maps to no ledger locus. */
export type UnmatchedReason = "ontology-gap" | "stale";

export interface KitReconciliation {
  /** Kit questions that map to an open locus — folded into the projection. */
  matched: Array<{ kit: string; about: string; question: string }>;
  /** Kit questions that map to NO locus — findings, not noise. Never dropped. */
  unmatched: Array<{ kit: string; reason: UnmatchedReason; implies: string }>;
  /** Loci the queue holds that NO kit question asked (the kit under-covered). */
  projectedOnly: KitQuestion[];
}

const STOP = new Set(["the", "a", "an", "of", "to", "for", "and", "or", "is", "are", "do", "does", "what", "which", "who", "how", "when", "where", "why", "on", "in", "at", "by", "with", "your", "you", "we", "us", "our", "their", "this", "that", "it", "its", "can", "be", "as", "from", "into", "about", "each", "any", "all", "there", "take", "takes"]);
const toks = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));

// Per-slot intent keywords — does the question ASK the thing this slot holds?
const SLOT_INTENT: Record<string, RegExp> = {
  valueSet: /value|status|option|enum|list|allowed|categor|state/i,
  phase: /phase|stage|when|point|part of/i,
  decision: /decid|criteri|determin|basis|threshold|approv|gate/i,
  owner: /who|owns|responsib|performs|accountab|does this/i,
  trigger: /trigger|start|initiat|kick|begin/i,
  optionality: /required|optional|mandatory|must|need/i,
  cardinality: /how many|one or many|multiple|number of|per /i,
  semantics: /mean|definition|refers|what is|stand for/i,
  systemOfRecord: /system|stored|source of record|record|where.*(kept|live|held)/i,
  dataType: /type|format|number|date|text|kind of value/i,
  automationDisposition: /automat|manual|assist/i,
  actorRole: /role|actor|who does/i,
  area: /area|department|team owns/i,
};

/**
 * Reconcile a separately-generated kit's free-text questions against the ledger.
 * A kit question MATCHES a locus when it names an element the ontology holds AND its
 * intent aligns with an OPEN slot on that element. Unmatched questions are findings:
 *  · references no ontology element → `ontology-gap` (the kit knows a thing the model missed).
 *  · references a modelled element but no open slot → `stale` (already modelled/closed,
 *    or asks a detail the ontology never made a slot for — a candidate to retire or to
 *    mint a slot via the curation path).
 * Heuristic by nature (free text ↔ loci); the reason is reported per question, never guessed silently.
 */
export function reconcileKit(kitQuestions: readonly string[], store: LedgerStore): KitReconciliation {
  const q = buildUnknownQueue(store);
  const open = q.items.filter((i) => i.status === "open");
  const nameOf = makeNameOf(store.elements());
  // element id → its display name tokens, and its open loci
  const elements = store.elements();
  const nameById = new Map(elements.map((e) => [e.id, e.name] as const));
  const openByElement = new Map<string, Array<{ about: string; slot: string }>>();
  for (const it of open) {
    const eid = elementIdOf(it.about);
    (openByElement.get(eid) ?? openByElement.set(eid, []).get(eid)!).push({ about: it.about, slot: slotOf(it.about) });
  }
  // longest element names first, so "Anesthesia Record" wins over "Record"
  const elementNames = [...nameById.entries()]
    .map(([id, name]) => ({ id, name, nameToks: toks(name) }))
    .filter((e) => e.nameToks.length)
    .sort((a, b) => b.nameToks.length - a.nameToks.length);

  const matched: KitReconciliation["matched"] = [];
  const unmatched: KitReconciliation["unmatched"] = [];
  const matchedAbouts = new Set<string>();

  for (const kit of kitQuestions) {
    const qToks = new Set(toks(kit));
    // element mentioned = all of its name tokens appear in the question
    const el = elementNames.find((e) => e.nameToks.every((t) => qToks.has(t)));
    if (!el) {
      const salient = [...qToks][0] ?? kit.slice(0, 40);
      unmatched.push({ kit, reason: "ontology-gap", implies: `ontology models no element for "${salient}" — mint an entity/attribute (curation path) or disposition with a reason` });
      continue;
    }
    const loci = openByElement.get(el.id) ?? [];
    const hit = loci.find((l) => SLOT_INTENT[l.slot]?.test(kit));
    if (hit) {
      matched.push({ kit, about: hit.about, question: questionForLocus(hit.about, nameOf).question });
      matchedAbouts.add(hit.about);
    } else {
      unmatched.push({ kit, reason: "stale", implies: `"${el.name}" is modelled but this asks no open locus — already closed/covered, or needs a new slot (curation path)` });
    }
  }

  const projectedOnly = projectKitQuestions(store).filter((k) => !matchedAbouts.has(k.about));
  return { matched, unmatched, projectedOnly };
}
