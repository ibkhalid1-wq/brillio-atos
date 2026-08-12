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
/**
 * Header aliases, MOST SPECIFIC FIRST — the order is load-bearing.
 *
 * A real export does not head its column "field". The workbook that exposed this
 * heads it "Field API Name", beside a "Field Label" and a "Maps To New Field";
 * matching had to tell those three apart. So each alias list runs specific →
 * general and the first alias that hits any header wins, which is why
 * "field api name" sits above the bare "field".
 */
const HEADER_ALIASES: Record<keyof DictField | "sep", string[]> = {
  entity: ["entity name", "object name", "table name", "entity", "object", "table", "resource", "sobject"],
  field: ["field api name", "api name", "field name", "column name", "attribute name", "property name",
    "field", "attribute", "column", "element", "property", "name"],
  dataType: ["data type", "datatype", "data_type", "field type", "type", "format"],
  valueSet: ["picklist values", "picklist value", "allowed values", "value set", "valueset",
    "values", "picklist", "enum", "codes"],
  required: ["required", "requirement", "mandatory", "nullable", "not null", "notnull"],
  sep: [],
};

const tokens = (h: string): string[] => h.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const startsWith = (hs: string[], as: string[]) => as.every((t, i) => hs[i] === t);
const contains = (hs: string[], as: string[]) => as.every((t) => hs.includes(t));

/**
 * The column an alias names, or -1.
 *
 * Three passes, each over the WHOLE alias list before the next begins, so a
 * specific alias always beats a general one no matter where its column sits:
 * exact header, then header that BEGINS with the alias, then header that merely
 * contains it. The prefix pass is what keeps "Maps To New Field" — where "field"
 * is the last token — from being read as the field column when a real one exists.
 */
const findCol = (headers: string[], aliases: string[]): number => {
  const toks = headers.map(tokens);
  for (const alias of aliases) {
    const a = tokens(alias);
    const hit = toks.findIndex((h) => h.length === a.length && startsWith(h, a));
    if (hit >= 0) return hit;
  }
  for (const alias of aliases) {
    const a = tokens(alias);
    const hit = toks.findIndex((h) => startsWith(h, a));
    if (hit >= 0) return hit;
  }
  for (const alias of aliases) {
    const a = tokens(alias);
    const hit = toks.findIndex((h) => contains(h, a));
    if (hit >= 0) return hit;
  }
  return -1;
};

/** Parse a CSV/TSV data dictionary deterministically. Returns [] on an unrecognisable header. */
export function parseDictionaryCsv(csv: string, name = "uploaded-dictionary"): ParsedDictionary {
  const text = csv.replace(/\r\n?/g, "\n").trim();
  if (!text) return { name, fields: [] };
  const sep = text.includes("\t") && !text.split("\n")[0].includes(",") ? "\t" : ",";
  const all = text.split("\n").map((line) => splitRow(line, sep));
  // THE HEADER IS NOT ALWAYS ROW 1. A hand-built export leads with a title row
  // ("Recommended Opportunity Schema — 130 Essential Fields") and sometimes a note
  // under it, putting the real header on row 2 or 3. Reading row 1 unconditionally
  // found no field column and returned nothing for the whole workbook.
  // So: the FIRST row within the opening few that names a field column and carries
  // at least two headings. Two, because a lone stray match in a sentence is not a
  // header row, and every real one labels more than one column.
  const HEADER_SCAN_ROWS = 10;
  // A field column ALONE is not a dictionary. Scanning for one was enough to pull in
  // a workbook's validation rules ("Rule Name"), its web links (whose "field" values
  // were URLs like /apex/CloneListPage) and its list views — ~80 fabricated
  // attributes from three tabs that describe the object's UI, not its data. A
  // dictionary row says something ABOUT a field, so the header must also name at
  // least one of: the entity, a type, a value set, or optionality. A bare list of
  // field names states nothing and closes nothing, so losing it costs nothing.
  const isHeader = (cells: string[]): boolean => {
    const lower = cells.map((h) => h.toLowerCase());
    if (findCol(lower, HEADER_ALIASES.field) < 0) return false;
    return [HEADER_ALIASES.entity, HEADER_ALIASES.dataType, HEADER_ALIASES.valueSet, HEADER_ALIASES.required]
      .some((aliases) => findCol(lower, aliases) >= 0);
  };
  let headerAt = -1;
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, all.length); i++) {
    const cells = all[i].map((h) => h.trim());
    if (cells.filter(Boolean).length < 2) continue;
    if (isHeader(cells)) { headerAt = i; break; }
  }
  if (headerAt < 0) return { name, fields: [] };
  const rows = all.slice(headerAt);
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
    // A field NAME with a comma or a URL path in it is not a field name. This is the
    // row-level counterpart to the header check: a "List Views" tab legitimately has
    // a column of field names, but each cell holds the whole comma-joined column set
    // of a view ("Account_ID__c, ACCOUNT.NAME, ..."), and a links tab holds
    // "/apex/CloneListPage?source=...". Admitting either invents attributes that the
    // client's system does not have.
    if (/[,/]/.test(field)) continue;
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
 * THE PROVENANCE TOKEN for a dictionary claim — which named dictionary produced it.
 *
 * `Claim` has no dedicated provenance field; `closedBy.by` is the only place a claim
 * records WHICH system/document it came from. `merge.ts` reads this token to tell
 * "the SAME dictionary was re-uploaded with a correction" (supersede) from "a DIFFERENT
 * system disagrees" (coexist) — N-4. It is therefore a shared definition, not a string
 * literal in two places: the emitter below and the merge rule must agree exactly, or a
 * correction silently degrades into a contradiction.
 *
 * STABILITY REQUIREMENT: for a re-upload to be recognised as a correction, the same
 * system of record must yield the same `dict.name` on every upload. `readDictionarySources`
 * guarantees that — it names each source from its stored key (`"<SoR> dictionary"`, or
 * `"uploaded-dictionary"` for the global one), never from the uploaded FILE name, and
 * `writeDictionaryField` matches keys case-insensitively so re-uploading for "crm" reuses
 * the "CRM" entry. A caller that instead names a dictionary after the file it came from
 * gets a NEW provenance on every upload, and the two readings correctly coexist.
 */
export const dictionaryProvenance = (name: string): string => `dictionary:${name}`;

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
  const by = dictionaryProvenance(dict.name);
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
  // A Uint8Array, NOT the raw ArrayBuffer. `type: "array"` means "array of bytes",
  // and handing SheetJS an ArrayBuffer under that type does not throw — it fails
  // SILENTLY, returning a workbook with one sheet called "Sheet1" whose only
  // content is the file's own ZIP header read as text ("PK\u0003\u0004..."). Every
  // xlsx dictionary therefore parsed zero fields and the operator was told their
  // file matched nothing, which looks exactly like a data problem and is not one.
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
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

// ── the whole workbook, not one sheet ───────────────────────────────────────────────
/**
 * A REAL export is a workbook, not a sheet.
 *
 * The master workbook that exposed this has twelve tabs: a README cover, a
 * `01_Master_Field_List` carrying the fields and their types, and a
 * `06_Picklist_Values` carrying the allowed values, one row per value. Choosing a
 * single sheet cannot read it — pick the field list and every value set is lost;
 * pick by row count and the 442-row picklist tab beats the field list outright and
 * the TYPES are lost instead. Neither is a defensible answer, so this reads EVERY
 * sheet and merges them into one dictionary.
 *
 * The merge is by (entity, field) and it is additive, never overwriting: a field
 * sheet contributes the type and the optionality, a value sheet contributes values,
 * and a workbook stating values in both places accumulates them. Sheets that parse
 * to nothing (covers, notes, release logs) contribute nothing and are named in
 * `skipped`, so what was ignored is visible rather than guessed at.
 */
export interface WorkbookRead {
  /** The merged dictionary as normalized CSV — what gets stored and re-parsed. */
  csv: string;
  /** Sheets that contributed rows, in workbook order. */
  used: string[];
  /** Sheets that parsed to nothing. */
  skipped: string[];
  /** Every sheet, in order. */
  sheets: string[];
  /** Rows in the merged dictionary. */
  fields: number;
  /** Set when NO sheet named an entity and one was read from the workbook instead —
   *  the phrase names where it came from, for the operator to accept or reject. */
  entityFrom: string | null;
  /** The entity that was applied, when `entityFrom` is set. */
  entity: string | null;
}

/**
 * The object a single-object workbook is ABOUT, when no sheet says so in a column.
 *
 * A per-object export (`... - Accounts Object.xlsx`, README titled `... Accounts
 * Object`) names its subject once, in prose, and never repeats it per row. Every
 * row therefore parses with an empty entity and `dictionaryToClaims` correctly
 * skips all of them, because a row with no entity cannot be keyed to a locus. The
 * file is full of answers and closes nothing.
 *
 * Reading the subject from the title is a DERIVATION, not something the file states
 * per row, so it is returned separately for the operator to see before anything is
 * committed — never folded in silently. Narrow by design: an explicit "<Name>
 * Object" phrase, nothing cleverer, and null when the phrase is absent.
 */
export function entityFromTitle(text: string): string | null {
  const m = /\b([A-Za-z][A-Za-z0-9 _-]{1,40}?)\s+Object\b/i.exec(String(text ?? ""));
  if (!m) return null;
  const raw = (m[1].trim().split(/[\s_-]+/).pop() ?? "").trim();
  if (!raw) return null;
  return raw.replace(/s$/i, "") || null;
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The merged dictionary as the canonical CSV `parseDictionaryCsv` reads back — one
 *  shape in, one shape out, so what is stored re-parses to what was previewed. */
export function fieldsToCsv(fields: DictField[]): string {
  const head = ["entity", "field", "type", "values", "required"];
  const rows = fields.map((f) => [
    f.entity, f.field, f.dataType ?? "",
    f.valueSet?.length ? f.valueSet.join("|") : "",
    f.required === undefined ? "" : f.required ? "Yes" : "No",
  ].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n");
}

/** Read and merge every sheet. `title` (the file name) is consulted ONLY when no
 *  sheet names an entity — see `entityFromTitle`. */
export async function readDictionaryWorkbook(bytes: ArrayBuffer, title = ""): Promise<WorkbookRead> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const sheets = wb.SheetNames.slice();
  const used: string[] = [];
  const skipped: string[] = [];
  const merged = new Map<string, DictField>();
  const keyOf = (f: DictField) => `${f.entity.trim().toLowerCase()} ${f.field.trim().toLowerCase()}`;

  for (const sheet of sheets) {
    const parsed = parseDictionaryCsv(XLSX.utils.sheet_to_csv(wb.Sheets[sheet]), sheet);
    if (!parsed.fields.length) { skipped.push(sheet); continue; }
    used.push(sheet);
    for (const f of parsed.fields) {
      const k = keyOf(f);
      const at = merged.get(k);
      if (!at) { merged.set(k, { ...f, valueSet: f.valueSet ? [...f.valueSet] : undefined }); continue; }
      // ADDITIVE. A later sheet fills gaps and accumulates values; it never
      // overwrites a stated type or flips a stated optionality.
      if (!at.dataType && f.dataType) at.dataType = f.dataType;
      if (at.required === undefined && f.required !== undefined) at.required = f.required;
      if (f.valueSet?.length) {
        const seen = new Set(at.valueSet ?? []);
        for (const v of f.valueSet) if (!seen.has(v)) { seen.add(v); (at.valueSet ??= []).push(v); }
      }
    }
  }

  let fields = [...merged.values()];
  let entity: string | null = null;
  let entityFrom: string | null = null;
  if (fields.length && fields.every((f) => !f.entity.trim())) {
    // No sheet named an entity anywhere. Read the workbook's own subject: the file
    // name first (an operator renames a file to say what it holds), then the first
    // sheet's text, which on a cover page is the workbook's title.
    const coverText = sheets.length ? XLSX.utils.sheet_to_csv(wb.Sheets[sheets[0]]).slice(0, 400) : "";
    const fromName = entityFromTitle(title);
    const fromCover = entityFromTitle(coverText);
    entity = fromName ?? fromCover;
    entityFrom = entity ? (fromName ? "the file name" : `the "${sheets[0]}" sheet`) : null;
    if (entity) fields = fields.map((f) => ({ ...f, entity: entity as string }));
  }

  return {
    csv: fields.length ? fieldsToCsv(fields) : "",
    used, skipped, sheets, fields: fields.length, entityFrom, entity,
  };
}
