/**
 * Operator overrides — the durable record of HAND CORRECTIONS to the three
 * evidence-bearing documents (Discovery Kit, Domain Ontology, Current-State
 * Atlas). A studio edit merges into the doc, but the doc is REPLACED on
 * regeneration — so the correction itself is captured here, programme-level
 * and append-only, and fed back into the generator's prompt as authoritative
 * evidence. The operator's judgement outranks the transcripts it corrected.
 *
 * A leaf module: pure functions over doc shapes, no imports from the flow UI.
 */
import type { ProgramSummary } from "@/new/types";
import { getProgramState } from "@/new/lib/programState";

export interface OperatorOverride {
  ts: string;
  by: string;
  fieldKey: string;
  note: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asArr = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const text = (value: unknown): string => String(value ?? "").trim();

/** Named-collection delta: added / removed / renamed / edited, by name. A
 * rename is a removed+added pair whose record (minus the name key) matches —
 * exactly what the studio's rename helpers produce. */
function diffNamed(
  label: string,
  prev: Record<string, unknown>[],
  next: Record<string, unknown>[],
  nameOf: (row: Record<string, unknown>) => string,
  nameKey?: string,
): string[] {
  const key = (row: Record<string, unknown>) => nameOf(row).toLowerCase();
  const prevBy = new Map(prev.map((row) => [key(row), row] as const));
  const nextBy = new Map(next.map((row) => [key(row), row] as const));
  const notes: string[] = [];
  let removed = prev.filter((row) => nameOf(row) && !nextBy.has(key(row)));
  let added = next.filter((row) => nameOf(row) && !prevBy.has(key(row)));
  if (nameKey) {
    const bodyOf = (row: Record<string, unknown>) => {
      const { [nameKey]: _drop, ...rest } = row;
      return JSON.stringify(rest);
    };
    for (const gone of [...removed]) {
      const twin = added.find((row) => bodyOf(row) === bodyOf(gone));
      if (!twin) continue;
      notes.push(`${label} renamed: "${nameOf(gone)}" → "${nameOf(twin)}"`);
      removed = removed.filter((row) => row !== gone);
      added = added.filter((row) => row !== twin);
    }
  }
  for (const row of added) notes.push(`${label} added: "${nameOf(row)}"`);
  for (const row of removed) notes.push(`${label} removed: "${nameOf(row)}"`);
  for (const [k, row] of nextBy) {
    const before = prevBy.get(k);
    if (before && JSON.stringify(before) !== JSON.stringify(row)) {
      notes.push(`${label} edited: "${nameOf(row)}"`);
    }
  }
  return notes;
}

/** Human-readable delta an operator edit produced — empty for docs this
 * module doesn't track or when nothing observable changed. */
export function overrideNotes(
  fieldKey: string,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  if (fieldKey === "discoveryKit") {
    return [
      ...diffNamed("Interview", asArr(previous.interviews), asArr(next.interviews),
        (row) => text(row.stakeholder) || text(row.role), "stakeholder"),
      ...diffNamed("Persona", asArr(previous.personas), asArr(next.personas), (row) => text(row.name), "name"),
      ...diffNamed("Coverage domain", asArr(previous.coverageMap), asArr(next.coverageMap), (row) => text(row.domain), "domain"),
    ];
  }
  if (fieldKey === "domainOntology") {
    return [
      ...diffNamed("Entity", asArr(previous.entities), asArr(next.entities), (row) => text(row.name), "name"),
      ...diffNamed("Relation", asArr(previous.relations), asArr(next.relations),
        (row) => `${text(row.from)} ${text(row.relation)} ${text(row.to)}`),
      ...diffNamed("Business event", asArr(previous.events), asArr(next.events), (row) => text(row.name), "name"),
    ];
  }
  if (fieldKey === "currentStateAtlas") {
    return [
      ...diffNamed("Workflow", asArr(previous.workflows), asArr(next.workflows), (row) => text(row.name), "name"),
      ...diffNamed("Business event", asArr(previous.events), asArr(next.events), (row) => text(row.name), "name"),
      ...diffNamed("Pain point", asArr(previous.painHeatmap), asArr(next.painHeatmap),
        (row) => `${text(row.area)}: ${text(row.pain)}`),
    ];
  }
  return [];
}

/** Append override records to the programme's durable store (capped). Pure —
 * takes and returns the inner-blob slice. */
export function appendOperatorOverrides(
  existing: unknown,
  fieldKey: string,
  notes: string[],
  ts: string,
  by: string,
): OperatorOverride[] {
  const log = Array.isArray(existing) ? (existing.filter(isRecord) as unknown as OperatorOverride[]) : [];
  return [...log, ...notes.map((note) => ({ ts, by, fieldKey, note }))].slice(-200);
}

/** The regeneration guidance block for one document: the operator's stored
 * overrides plus the current doc's dismissal log — regeneration must
 * preserve these, not re-derive around them. Null when there's nothing. */
export function operatorOverrideGuidance(program: ProgramSummary, fieldKey: string): string | null {
  const { inner } = getProgramState((program.rawData ?? {}) as Record<string, unknown>);
  const stored = (Array.isArray(inner.flowOperatorOverrides) ? inner.flowOperatorOverrides.filter(isRecord) : [])
    .filter((row) => text(row.fieldKey) === fieldKey)
    .map((row) => `- ${text(row.ts).slice(0, 10)} ${text(row.note)}`);
  const doc = isRecord(inner[fieldKey]) ? (inner[fieldKey] as Record<string, unknown>) : {};
  const dismissals = (Array.isArray(doc._curationLog) ? doc._curationLog.filter(isRecord) : [])
    .map((row) => `- ${text(row.at).slice(0, 10)} ${text(row.action)}${text(row.reason) ? ` (${text(row.reason)})` : ""}`);
  const lines = [...stored.slice(-40), ...dismissals.slice(-20)];
  if (!lines.length) return null;
  return [
    "## Operator overrides (authoritative hand corrections — PRESERVE every one)",
    "The operator corrected this document by hand after generation. Each correction below outranks the transcripts it was applied to: regenerate AROUND them — never revert a rename, resurrect a removal, or drop an addition listed here.",
    ...lines,
  ].join("\n");
}
