// Aura — override-log import adapter (docs/aura/override-adapter-report.md).
// The generator lands `generated`. This adapter lands the claims the generator correctly
// WON'T: the `code-derived` and `dispositioned` claims that come from the engagement's own
// override log. Same batch shape reconcile consumes; same validator (import mode). No model.
//
// SOURCE-CLASS FIDELITY is the whole point (an operator override is NOT a stakeholder
// assertion — never `asserted`, never `generated`):
//   - operator dispositioning/correcting a value   → `dispositioned`
//   - the code-derived basis a removal restates    → `code-derived` (the source HAD it)
//   - a touch with a who but no verbatim           → weak, closed-without-verbatim (dispositioned)
import { slug, aboutOf, type Batch, type BatchClaim, type GeneratedElement, type ClaimValue, type Owner, type World, type Layer } from "./ledgerGenerator.ts";

const OP_OWNER: Owner = { kind: "role", role: "Sales Leaders" }; // matches migrate's ownerFor("sales")

export interface OverrideEntry { note?: string; by?: string; ts?: string; fieldKey?: string; }
export interface OverrideReport {
  batch: Batch; total: number; classified: number; skipped: number;
  byKind: Record<string, number>; bySource: Record<string, number>; skippedNotes: string[];
}

// relation-note verbs, longest first so "is a type of" wins over "is"
const REL_VERBS = ["is a type of", "participates in", "applies to", "produces", "is part of", "relates to", "has"];
function parseRelation(text: string): { from: string; rel: string; to: string } | null {
  const t = text.trim();
  for (const v of REL_VERBS) { const i = t.toLowerCase().indexOf(` ${v} `); if (i > 0) return { from: t.slice(0, i).trim(), rel: v, to: t.slice(i + v.length + 2).trim() }; }
  return null;
}

export function overridesToBatch(overrides: OverrideEntry[]): OverrideReport {
  const elements: GeneratedElement[] = []; const claims: BatchClaim[] = [];
  const elIds = new Set<string>();
  const addEl = (e: GeneratedElement) => { if (!elIds.has(e.id)) { elIds.add(e.id); elements.push(e); } };
  const byKind: Record<string, number> = {}; const bySource: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  const skippedNotes: string[] = [];

  const emit = (about: string, value: ClaimValue, source: "dispositioned" | "code-derived", world: World, layer: Layer, by: string) => {
    // no verbatim ⇒ weak (closed-without-verbatim); a disposition/import method, never a stakeholder assertion
    claims.push({ about, value, world, layer, source, status: "weak", ownerWhileOpen: OP_OWNER,
      closedBy: { method: source === "code-derived" ? "import" : "disposition", by } });
    bump(bySource, source);
  };

  let classified = 0;
  for (const o of overrides) {
    const note = String(o.note ?? ""); const by = String(o.by ?? "operator");
    const mRemoved = note.match(/Entity removed:\s*"?([^"]+)"?/i);
    const mEdited = note.match(/(Entity|Workflow) edited:\s*"?([^"]+)"?/i);
    const mMoved = note.match(/^Workflow\s+"([^"]+)"\s+moved to area\s+"([^"]+)"/i);
    const mRelAdd = note.match(/Relation added:\s*"([^"]+)"/i);
    const mRelRem = note.match(/Relation removed:\s*"([^"]+)"/i);

    if (mRemoved) {
      const name = mRemoved[1].trim(); const rid = `el:removed:${slug(name)}`;
      addEl({ id: rid, kind: "entity", name });
      emit(aboutOf(rid, "exists"), { kind: "scalar", value: true }, "code-derived", "as-is", "domain", "prototype"); // the source HAD it
      emit(aboutOf(rid, "exists"), { kind: "scalar", value: false }, "dispositioned", "to-be", "domain", by);        // operator removed it
      bump(byKind, "entity-removed"); classified += 1;
    } else if (mMoved) {
      const wid = `el:wf:${slug(mMoved[1].trim())}`;
      emit(aboutOf(wid, "area"), { kind: "scalar", value: mMoved[2].trim() }, "dispositioned", "to-be", "configuration", by); // a specific value correction migrate dropped
      bump(byKind, "workflow-moved-area"); classified += 1;
    } else if (mEdited) {
      const kind = mEdited[1].toLowerCase(); const name = mEdited[2].trim();
      const eid = kind === "entity" ? `el:entity:${slug(name)}` : `el:wf:${slug(name)}`;
      emit(aboutOf(eid, "operatorCorrected"), { kind: "scalar", value: note }, "dispositioned", "to-be", "domain", by); // touch with a who, no verbatim
      bump(byKind, `${kind}-edited`); classified += 1;
    } else if (mRelAdd || mRelRem) {
      const text = (mRelAdd ?? mRelRem)![1].trim(); const added = !!mRelAdd;
      const p = parseRelation(text);
      const rid = p ? `el:rel:${slug(p.from)}-${slug(p.to)}` : `el:rel:${slug(text)}`;
      addEl({ id: rid, kind: "relation", name: p ? `${p.from}→${p.to}` : text, refs: p ? { from: `el:entity:${slug(p.from)}`, to: `el:entity:${slug(p.to)}` } : {} });
      emit(aboutOf(rid, "exists"), { kind: "scalar", value: added }, "dispositioned", "to-be", "domain", by);           // operator added/removed the relation
      if (p && added) emit(aboutOf(rid, "semantics"), { kind: "scalar", value: p.rel }, "dispositioned", "to-be", "domain", by);
      bump(byKind, added ? "relation-added" : "relation-removed"); classified += 1;
    } else {
      // area-only companion notes etc. — a real touch we cannot key to a slot; record, don't fabricate
      skippedNotes.push(note); bump(byKind, "skipped");
    }
  }

  return { batch: { elements, claims }, total: overrides.length, classified, skipped: skippedNotes.length, byKind, bySource, skippedNotes };
}
