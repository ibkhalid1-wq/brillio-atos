/**
 * The typeset projection of a structured artifact document. Renders the
 * generator's own JSON directly — no text round-trip — with a typographic
 * grammar per value shape: short scalar runs become a facts grid, prose gets
 * a readable measure, flat collections set as hairline tables, deep ones as
 * titled cards, evidence/quote fields as pull-quotes, enums as chips, and
 * the model's open gaps as a closing callout. Provenance never appears here
 * — it lives in the studio's colophon.
 */
import React from "react";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const HIDDEN_KEYS = new Set([
  "title", "summary", "confidence", "generatedat", "editedat", "editedby", "gaps",
]);
const QUOTE_KEY = /quote|evidence|verbatim/i;
const CHIP_KEY = /^(severity|priority|status|kind|effort|value|autonomylevel|sync|mechanism|cardinality|estimate|shape|direction|verdict|relation)$/i;
const CHIP_TONES: Record<string, string> = {
  high: "hot", must: "hot", critical: "hot", now: "hot",
  medium: "warm", should: "warm", next: "warm",
  low: "cool", later: "cool",
};

function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

const text = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

function Chip({ value }: { value: string }) {
  return <span className={`v3fs-dv-chip ${CHIP_TONES[value.toLowerCase()] ?? ""}`}>{value}</span>;
}

function ScalarValue({ k, value }: { k: string; value: unknown }) {
  const s = text(value);
  if (CHIP_KEY.test(k)) return <Chip value={s} />;
  return <>{s}</>;
}

/** Scalar keys of a collection, in first-row order — the table's columns. */
function scalarColumns(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (HIDDEN_KEYS.has(k.toLowerCase()) || k.startsWith("_")) continue;
      if ((typeof v === "string" || typeof v === "number" || typeof v === "boolean") && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

function longestCell(rows: Record<string, unknown>[], keys: string[]): number {
  let max = 0;
  for (const row of rows) for (const k of keys) max = Math.max(max, text(row[k]).length);
  return max;
}

/** A flat collection as a hairline table. */
function Table({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] }) {
  return (
    <div className="v3fs-dv-tablewrap">
      <table className="v3fs-dv-table">
        <thead>
          <tr>{columns.map((k) => <th key={k}>{humanize(k)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((k) => <td key={k}><ScalarValue k={k} value={row[k]} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One deep collection item as a titled card: lead field, facts, nested lists/tables. */
function Card({ item, depth }: { item: Record<string, unknown>; depth: number }) {
  const entries = Object.entries(item).filter(([k, v]) =>
    !HIDDEN_KEYS.has(k.toLowerCase()) && !k.startsWith("_") && v !== null && v !== undefined && v !== "");
  const leadIndex = entries.findIndex(([, v]) => typeof v === "string");
  const lead = leadIndex >= 0 ? entries[leadIndex] : null;
  const rest = entries.filter((_, i) => i !== leadIndex);
  return (
    <div className="v3fs-dv-card">
      {lead ? (
        <div className="v3fs-dv-card-h">
          <b>{text(lead[1])}</b>
          {rest.filter(([k, v]) => CHIP_KEY.test(k) && typeof v === "string").map(([k, v]) => <Chip key={k} value={text(v)} />)}
        </div>
      ) : null}
      {rest.map(([k, v]) => {
        if (CHIP_KEY.test(k) && typeof v === "string") return null; // shown beside the lead
        if (QUOTE_KEY.test(k) && typeof v === "string") return <blockquote key={k} className="v3fs-dv-quote">{v}</blockquote>;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          return (
            <div key={k} className="v3fs-dv-fact">
              <span className="v3fs-dv-fl">{humanize(k)}</span>
              <span className="v3fs-dv-fv">{text(v)}</span>
            </div>
          );
        }
        return <ValueBlock key={k} k={k} value={v} depth={depth + 1} nested />;
      })}
    </div>
  );
}

function ValueBlock({ k, value, depth, nested }: { k: string; value: unknown; depth: number; nested?: boolean }) {
  const label = nested
    ? <span className="v3fs-dv-fl">{humanize(k)}</span>
    : <h3 className="v3fs-dv-h">{humanize(k)}</h3>;

  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined && v !== "");
    if (!items.length) return null;
    if (items.every((v) => typeof v !== "object")) {
      return (
        <section className="v3fs-dv-sec">{label}
          <ul className="v3fs-dv-list">{items.map((v, i) => <li key={i}>{text(v)}</li>)}</ul>
        </section>
      );
    }
    const rows = items.filter(isRecord);
    if (!rows.length) return null;
    const columns = scalarColumns(rows);
    const deep = depth < 2 && (rows.some((row) => Object.values(row).some((v) => Array.isArray(v) && v.length)) || longestCell(rows, columns) > 90 || columns.length > 5);
    return (
      <section className="v3fs-dv-sec">{label}
        {deep
          ? rows.map((row, i) => <Card key={i} item={row} depth={depth} />)
          : <Table rows={rows} columns={columns} />}
      </section>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([kk, v]) =>
      !HIDDEN_KEYS.has(kk.toLowerCase()) && !kk.startsWith("_") && v !== null && v !== undefined && v !== "");
    if (!entries.length) return null;
    return (
      <section className="v3fs-dv-sec">{label}
        <div className="v3fs-dv-facts">
          {entries.map(([kk, v]) =>
            typeof v === "object"
              ? <ValueBlock key={kk} k={kk} value={v} depth={depth + 1} nested />
              : (
                <div key={kk} className="v3fs-dv-fact">
                  <span className="v3fs-dv-fl">{humanize(kk)}</span>
                  <span className="v3fs-dv-fv"><ScalarValue k={kk} value={v} /></span>
                </div>
              ))}
        </div>
      </section>
    );
  }

  const s = text(value);
  if (!s) return null;
  if (QUOTE_KEY.test(k)) {
    return <section className="v3fs-dv-sec">{label}<blockquote className="v3fs-dv-quote">{s}</blockquote></section>;
  }
  return <section className="v3fs-dv-sec">{label}<p className="v3fs-dv-p">{s}</p></section>;
}

export default function DocumentView({ doc, order }: { doc: Record<string, unknown>; order?: string[] }) {
  // Postgres jsonb alphabetises keys on storage, destroying the generator's
  // narrative order — the registry supplies each type's canonical sequence;
  // unknown keys keep their stored relative order, after the known ones.
  const rank = (k: string) => {
    const i = order?.indexOf(k) ?? -1;
    return i === -1 ? (order?.length ?? 0) : i;
  };
  const entries = Object.entries(doc)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k.toLowerCase()) && !k.startsWith("_") && v !== null && v !== undefined && v !== "")
    .map(([k, v], i) => ({ k, v, i }))
    .sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i)
    .map(({ k, v }) => [k, v] as [string, unknown]);
  // Short scalars read as one fact sheet up top, not scattered one-line
  // "sections"; everything else keeps the canonical narrative order.
  const factRun = entries.filter(([k, v]) => typeof v === "string" && v.length <= 90 && !QUOTE_KEY.test(k)) as Array<[string, string]>;
  const factKeys = new Set(factRun.map(([k]) => k));
  const bodyEntries = entries.filter(([k]) => !factKeys.has(k));
  const summary = typeof doc.summary === "string" && doc.summary.trim() ? doc.summary.trim() : null;
  const gaps = Array.isArray(doc.gaps) ? doc.gaps.map(text).filter(Boolean) : [];

  return (
    <div className="v3fs-dv">
      {summary ? <p className="v3fs-dv-lead">{summary}</p> : null}
      {factRun.length ? (
        <div className="v3fs-dv-facts v3fs-dv-factsheet">
          {factRun.map(([k, v]) => (
            <div key={k} className="v3fs-dv-fact">
              <span className="v3fs-dv-fl">{humanize(k)}</span>
              <span className="v3fs-dv-fv">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {bodyEntries.map(([k, v]) => <ValueBlock key={k} k={k} value={v} depth={0} />)}
      {gaps.length ? (
        <aside className="v3fs-dv-gaps">
          <h3 className="v3fs-dv-h">Open gaps</h3>
          <ul className="v3fs-dv-list">{gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </aside>
      ) : null}
    </div>
  );
}
