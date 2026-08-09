/**
 * The data-dictionary import — a GENERIC source into the same reconcile path the FHIR
 * and Salesforce adapters use (docs/aura/data-dictionary-import.md). Every serious system
 * maintains a data dictionary; not every domain has a standard. So the dictionary is the
 * PRIMARY path that closes the typing wall (F-D dataType / F-F valueSet / optionality),
 * and standards adapters are the fallback.
 *
 * SOURCE CLASS: `code-derived`, provenance `dictionary:<name>` — the client's own truth,
 * a strong DEFAULT, not a stakeholder's confirmed answer (never `asserted`) and not a
 * published standard (never `external-standard`). No precedence-lattice change is needed:
 * `code-derived` already outranks `generated` (so it fills the open unknown) and loses to
 * `asserted` (so a stakeholder deviation still wins) — confirm-or-deviate holds for free.
 *
 * DISCIPLINE (same as the generator): emit a claim ONLY where the dictionary STATES a value;
 * never fabricate a type the document doesn't give (that is the laundering defect). Silence
 * stays `?unknown`. Everything is `code-derived · weak · to-be` so the owner can still deviate.
 */
import { aboutOf, type ClaimValue, type LedgerElement, type Owner } from "./types";
import type { AssertInput } from "./store";

const slug = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
// A dictionary states what's stored; ownerWhileOpen is moot once weak/closed, so a neutral
// "system owner" band keeps the provenance honest (this came from a system, not a person).
const OWNER: Owner = { kind: "role", role: "System Owner" };

/** One normalized dictionary row — an entity's field with whatever the dictionary states. */
export interface DictField {
  entity: string;
  field: string;
  dataType?: string;              // e.g. "date", "string", "code"
  valueSet?: string[];            // enumerated allowed values, if the dictionary lists them
  required?: boolean;             // NOT NULL / mandatory, if the dictionary states it
}
export interface ParsedDictionary { name: string; fields: DictField[] }

// ── Deterministic parser: CSV / TSV (structured formats parse with NO model) ──
// Freeform documents (Word tables, ERD exports, Confluence) are the GATED, model-assisted
// path — specced in the doc, not built here. This handles the common tabular export.
const HEADER_ALIASES: Record<keyof DictField | "sep", string[]> = {
  entity: ["entity", "object", "table", "resource"],
  field: ["field", "attribute", "column", "element", "property", "name"],
  dataType: ["type", "datatype", "data type", "data_type", "format"],
  valueSet: ["values", "valueset", "value set", "allowed values", "picklist", "enum", "codes"],
  required: ["required", "mandatory", "nullable", "not null", "notnull"],
  sep: [],
};
const findCol = (headers: string[], aliases: string[]): number =>
  headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));

/** Parse a CSV/TSV data dictionary deterministically. Returns [] on an unrecognisable header. */
export function parseDictionaryCsv(csv: string, name = "uploaded-dictionary"): ParsedDictionary {
  const text = csv.replace(/\r\n?/g, "\n").trim();
  if (!text) return { name, fields: [] };
  const sep = text.includes("\t") && !text.split("\n")[0].includes(",") ? "\t" : ",";
  const rows = text.split("\n").map((line) => splitRow(line, sep));
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const cEntity = findCol(headers, HEADER_ALIASES.entity);
  const cField = findCol(headers, HEADER_ALIASES.field);
  const cType = findCol(headers, HEADER_ALIASES.dataType);
  const cValues = findCol(headers, HEADER_ALIASES.valueSet);
  const cReq = findCol(headers, HEADER_ALIASES.required);
  if (cField < 0) return { name, fields: [] }; // no field column → not a dictionary we can read
  const fields: DictField[] = [];
  for (const r of rows.slice(1)) {
    const field = (r[cField] ?? "").trim();
    if (!field) continue;
    const entity = (cEntity >= 0 ? r[cEntity] : "").trim();
    const rawType = cType >= 0 ? (r[cType] ?? "").trim() : "";
    const rawValues = cValues >= 0 ? (r[cValues] ?? "").trim() : "";
    const rawReq = cReq >= 0 ? (r[cReq] ?? "").trim().toLowerCase() : "";
    const f: DictField = { entity, field };
    if (rawType) f.dataType = rawType;                                             // stated → claim; silent → ?unknown
    if (rawValues) { const vs = rawValues.split(/[|;,]/).map((v) => v.trim()).filter(Boolean); if (vs.length) f.valueSet = vs; }
    if (rawReq) { if (/^(y|yes|true|required|not ?null|mandatory)$/.test(rawReq)) f.required = true; else if (/^(n|no|false|nullable|optional)$/.test(rawReq)) f.required = false; }
    fields.push(f);
  }
  return { name, fields };
}
function splitRow(line: string, sep: string): string[] {
  if (sep === "\t") return line.split("\t");
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Emit the dictionary as an AssertInput[] batch for reconcile — the SAME batch shape the
 * FHIR/Salesforce adapters produce. Closes dataType / valueSet / optionality unknowns as
 * `code-derived · weak · to-be`. Fields not already in the ontology are LOCAL EXTENSIONS:
 * a new attribute element + its `exists`, so the client's real fields aren't lost.
 *
 * `existingElementIds` lets us tell a covered ontology attribute from a local extension.
 * Returns the batch AND the element ids to register (for reconcile's orphan accounting).
 */
export function dictionaryToClaims(dict: ParsedDictionary, existingElementIds: Set<string>): { batch: AssertInput[]; elements: LedgerElement[] } {
  const batch: AssertInput[] = [];
  const elements: LedgerElement[] = [];
  const by = `dictionary:${dict.name}`;
  const closedBy = { method: "import" as const, by };
  const add = (about: string, value: ClaimValue) =>
    batch.push({ about, value, source: "code-derived", world: "to-be", layer: "configuration", ownerWhileOpen: OWNER, status: "weak", closedBy });
  for (const f of dict.fields) {
    if (!f.entity) continue; // a row with no entity can't be keyed to a locus — skip, don't guess
    const eid = `el:entity:${slug(f.entity)}`;
    const aid = `el:attr:${slug(f.entity)}.${slug(f.field)}`;
    // local extension: the dictionary has a field the ontology never modelled
    if (!existingElementIds.has(aid)) {
      elements.push({ id: aid, kind: "attribute", name: f.field, of: eid });
      add(aboutOf(aid, "exists"), { kind: "scalar", value: true });
    }
    if (f.dataType) add(aboutOf(aid, "dataType"), { kind: "scalar", value: f.dataType });
    if (f.valueSet?.length) add(aboutOf(aid, "valueSet"), { kind: "ref-list", to: f.valueSet });
    if (typeof f.required === "boolean") add(aboutOf(aid, "optionality"), { kind: "scalar", value: f.required });
  }
  return { batch, elements };
}

/** The typing slots a data dictionary answers — the wall it dissolves. */
export const TYPING_SLOTS = new Set(["dataType", "valueSet", "optionality"]);
