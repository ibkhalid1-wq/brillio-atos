/**
 * Plain-language phrasing for a locus — turn the ledger's internal reference
 * ("attr:escalation.status#valueSet") into a question a person can answer ("what
 * values can escalation status take?"). Surface layer only; no core touched.
 *
 * A locus is `<elementId>#<slot>`. We resolve the element's display name and map the
 * slot to a question template. Slots with no clean template fall back to
 * "<name> — <slot>?" and are reported (see `UNPHRASED_SLOTS`) rather than showing the
 * raw id as the primary label.
 */
import { elementIdOf, slotOf, type LedgerElement } from "./types";

/** Trim a long name at a WORD boundary + ellipsis — never mid-word. The full string is
 *  what the caller shows on hover. (Step element names are `action.slice(0,60)` at the
 *  migrate layer, so a step's name is already a 60-char cut — this stops it cutting a
 *  second time mid-word on screen; the full action isn't in the element name — a finding.) */
export function wordSafe(s: string, max = 52): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, "") + "…";
}

/** Build a `nameOf` that QUALIFIES an attribute with its parent entity — "Appointment.status",
 *  not a bare "status" (Appointment.status and Condition.status are different questions). Steps
 *  keep their action name. Long names are word-safe-trimmed for display. */
export function makeNameOf(elements: readonly LedgerElement[]): (id: string) => string | undefined {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  return (id) => {
    const el = byId.get(id);
    if (!el) return undefined;
    let name = el.name;
    if ((el.kind === "attribute" || el.kind === "relation") && el.of) {
      const parent = byId.get(el.of);
      if (parent?.name) name = `${parent.name}.${el.name}`;
    }
    return wordSafe(name);
  };
}

/** Small human tag for the slot type (kept beside the question, not as the label). */
const SLOT_TYPE_LABEL: Record<string, string> = {
  valueSet: "Values", phase: "Phase", decision: "Decision", owner: "Owner", trigger: "Trigger",
  optionality: "Optional?", semantics: "Meaning", cardinality: "How many", exists: "Exists?",
  automationDisposition: "Automate?", dataType: "Type", isClientOrPartner: "Client/Partner",
  handoffRule: "Handoff", area: "Area", systemOfRecord: "System of record", "alias": "Aliases",
};
export function slotTypeLabel(about: string): string {
  const slot = slotOf(about);
  return SLOT_TYPE_LABEL[slot] ?? slot.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

/** Question templates by slot. `n` is the element's display name (lower-cased mid-sentence). */
const Q: Record<string, (n: string) => string> = {
  valueSet: (n) => `What values can ${n} take?`,
  phase: (n) => `Which phase does ${n} belong to?`,
  decision: (n) => `What decides the outcome of ${n}?`,
  owner: (n) => `Who performs ${n}?`,
  trigger: (n) => `What triggers ${n}?`,
  optionality: (n) => `Is ${n} required or optional?`,
  semantics: (n) => `What does ${n} mean, exactly?`,
  cardinality: (n) => `How many ${n} can there be?`,
  exists: (n) => `Does ${n} exist in the to-be design?`,
  automationDisposition: (n) => `Should ${n} be automated, assisted, or kept manual?`,
  dataType: (n) => `What type of value is ${n}?`,
  isClientOrPartner: (n) => `Is ${n} a client or a partner?`,
  handoffRule: (n) => `What is the handoff rule for ${n}?`,
  area: (n) => `Which area owns ${n}?`,
  systemOfRecord: (n) => `What is the system of record for ${n}?`,
};

/** Slot kinds we could not phrase cleanly (for the finding). Populated lazily. */
export const UNPHRASED_SLOTS = new Set<string>();

/** A readable display name for the element, from its stored name; falls back to a
 *  de-slugged id tail so a person still sees words, never a raw address. */
export function readableName(rawName: string | undefined, elementId: string): string {
  const name = (rawName ?? "").trim();
  if (name) return name;
  const tail = elementId.replace(/^el:/, "").split(":").pop() ?? elementId;
  return tail.replace(/[.#_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}

export interface Phrased { question: string; typeTag: string; name: string; }

/** Turn a locus into a plain-language question. `nameOf` resolves an element id to
 *  its display name (from the store's elements). */
export function questionForLocus(about: string, nameOf: (id: string) => string | undefined): Phrased {
  const slot = slotOf(about);
  const name = readableName(nameOf(elementIdOf(about)), elementIdOf(about));
  const nLower = /^[A-Z]{2,}/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
  const tmpl = Q[slot];
  if (!tmpl) { UNPHRASED_SLOTS.add(slot); return { question: `${name} — ${slotTypeLabel(about).toLowerCase()}?`, typeTag: slotTypeLabel(about), name }; }
  return { question: tmpl(nLower), typeTag: slotTypeLabel(about), name };
}
