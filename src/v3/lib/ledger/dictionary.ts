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

/* ── Per-SoR dictionaries: ONE field, one or many uploads ──────────────────────
 *
 * `_dataDictionary` began as ONE global CSV for the whole programme. But the ask is
 * per system of record (`artifactAsks.ts`): a CRM export answers nothing about the
 * finance system, and marking all five of Laila's SoRs "provided" off one upload is
 * exactly the papering-over this codebase exists to prevent.
 *
 * So the field accepts a KEYED MAP — `{"<SoR>": "<csv>", "*": "<csv>"}` — ADDITIVELY:
 * a plain CSV string (or a pre-parsed {name,fields} doc) remains valid and is read as
 * the ONE global dictionary, so no existing programme changes shape or breaks. The
 * keyed form is only written once a per-SoR upload actually happens.
 */

/** The reserved key for a dictionary that is NOT tied to one system of record. */
export const GLOBAL_DICTIONARY_KEY = "*";

/** One dictionary on file. `sor === null` is the global upload. */
export interface DictionarySource { sor: string | null; dict: ParsedDictionary }

const isRecordValue = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const looksParsed = (v: unknown): boolean =>
  isRecordValue(v) && Array.isArray((v as { fields?: unknown }).fields);

/** A stored value → a parsed dictionary. Unrecognisable ⇒ null (never a guess). */
const toDictionary = (value: unknown, name: string): ParsedDictionary | null => {
  if (typeof value === "string") return value.trim() ? parseDictionaryCsv(value, name) : null;
  if (looksParsed(value)) {
    const v = value as ParsedDictionary;
    return { name: String(v.name || name), fields: Array.isArray(v.fields) ? v.fields : [] };
  }
  return null;
};

/** The stored field as a key→value map, the legacy plain string keyed as global. */
function storedMap(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    // Only a JSON object can be the keyed form; anything else is CSV text, and a
    // failed parse means exactly that — it is never treated as a broken map.
    if (text.startsWith("{")) { try { value = JSON.parse(text); } catch { value = raw; } }
  }
  if (typeof value === "string" || looksParsed(value)) return { [GLOBAL_DICTIONARY_KEY]: value };
  if (isRecordValue(value)) return { ...value };
  return {};
}

/**
 * Every dictionary on file, in write order. Backward compatible by construction: the
 * legacy single CSV reads as one source with `sor: null`.
 */
export function readDictionarySources(raw: unknown): DictionarySource[] {
  const out: DictionarySource[] = [];
  for (const [key, value] of Object.entries(storedMap(raw))) {
    const sor = key === GLOBAL_DICTIONARY_KEY ? null : key.trim() || null;
    const dict = toDictionary(value, sor ? `${sor} dictionary` : "uploaded-dictionary");
    if (dict) out.push({ sor, dict });
  }
  return out;
}

/**
 * Attach `csv` to `sor` (null/blank ⇒ the global dictionary), preserving everything
 * already on file. Returns the STRING to store — underscore fields are always
 * strings. A global upload on a programme that has no per-SoR dictionaries keeps the
 * plain-CSV shape, so nothing migrates that does not have to.
 *
 * Keys match case-insensitively: re-uploading for "crm" replaces the "CRM" entry
 * rather than creating a second dictionary for one system.
 */
export function writeDictionaryField(raw: unknown, csv: string, sor?: string | null): string {
  const existing = storedMap(raw);
  const wanted = (sor ?? "").trim();
  if (!wanted) {
    const hasKeyed = Object.keys(existing).some((k) => k !== GLOBAL_DICTIONARY_KEY);
    if (!hasKeyed) return csv;                       // the shape every reader already knows
    return JSON.stringify({ ...existing, [GLOBAL_DICTIONARY_KEY]: csv });
  }
  const key = Object.keys(existing).find((k) => k.toLowerCase() === wanted.toLowerCase()) ?? wanted;
  return JSON.stringify({ ...existing, [key]: csv });
}

// ── spreadsheet uploads ─────────────────────────────────────────────────────────────
/**
 * A workbook is converted to CSV and handed to `parseDictionaryCsv` above, so the
 * deterministic parser stays the ONE definition of what a dictionary row means. No
 * second column-matcher, no second notion of a recognisable header.
 *
 * This exists because the Inbox told the operator "CSV/XLSX dictionaries parse now"
 * while the file input accepted `.csv,.tsv,.txt` — and `xlsx` was a declared dependency
 * with ZERO importers. An operator exporting from Salesforce, where XLSX is the default,
 * was told it worked and then could not select the file.
 */
export const SPREADSHEET_EXTENSIONS = [".xlsx", ".xlsm", ".xlsb", ".xls"];

export const isSpreadsheetName = (name: string): boolean =>
  SPREADSHEET_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

export interface WorkbookPick {
  /** The chosen sheet as CSV, ready for `parseDictionaryCsv`. */
  csv: string;
  /** Which sheet that was, so the operator can see what was read. */
  sheet: string;
  /** Every sheet name in the workbook, in order. */
  sheets: string[];
}

/**
 * Convert a workbook and CHOOSE the sheet that actually looks like a dictionary.
 *
 * A real export is rarely one clean sheet: Salesforce and most BI tools emit a cover
 * or notes sheet first. Taking `SheetNames[0]` unconditionally would read that one,
 * parse zero fields, and tell the operator their file matched nothing — a wrong answer
 * that looks like a data problem. So every sheet is converted and parsed, and the one
 * yielding the most recognised fields wins; ties keep workbook order.
 *
 * When nothing parses anywhere, the FIRST sheet is returned rather than an empty
 * string: the operator then sees "0 fields parsed" against a named sheet they can go
 * and check, instead of an unexplained blank. The miss stays visible either way — the
 * caller reports which sheet was read and how many were skipped.
 *
 * `xlsx` is imported DYNAMICALLY: it is a large library, this module is imported by a
 * dozen test files and by `flowShellData`, and a workbook is the uncommon path. Loading
 * it eagerly would put it in the main bundle for every reader of TYPING_SLOTS.
 */
export async function pickDictionarySheet(bytes: ArrayBuffer): Promise<WorkbookPick> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const sheets = wb.SheetNames.slice();
  if (sheets.length === 0) return { csv: "", sheet: "", sheets };
  let best: WorkbookPick | null = null;
  let bestFields = -1;
  for (const sheet of sheets) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet]);
    const fields = parseDictionaryCsv(csv, sheet).fields.length;
    if (fields > bestFields) { bestFields = fields; best = { csv, sheet, sheets }; }
  }
  return best ?? { csv: "", sheet: sheets[0], sheets };
}
