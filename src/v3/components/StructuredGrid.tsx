import React from "react";
import type { GridColumn } from "@/v3/lib/phaseInputSchema";

/**
 * A single grid row. Always carries a stable `id`; every column value is stored
 * as a string keyed by the column key. Persisted as a JSON-string under the
 * field id (same convention the Strategy KPI grid already uses), so the
 * generation agent can parse and humanize it downstream.
 */
export interface GridRow {
  id: string;
  [key: string]: string;
}

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Coerce a plain-text value into one row per line under the grid's first column.
 * Used when a field migrates from free text to a grid (e.g. a textarea promoted
 * to a grid in the methodology, or a planner free-text field upgraded by a static
 * schema): the legacy string is split on lines — bullet markers stripped — so no
 * content is lost. It re-serializes to JSON on the next save, making this a
 * self-healing, one-time migration with no destructive write.
 */
function coercePlainTextRows(text: string, columns: GridColumn[]): GridRow[] {
  const firstKey = columns[0]?.key;
  if (!firstKey) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•·]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const row: GridRow = { id: newId() };
      for (const col of columns) row[col.key] = col.key === firstKey ? line : "";
      return row;
    });
}

/** Parse a persisted grid value (JSON string) into typed rows. */
export function parseRows(raw: unknown, columns: GridColumn[]): GridRow[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Genuine plain text (JSON.parse only throws on non-JSON) — migrate it into
    // rows rather than dropping it. A JSON object/number that isn't an array is
    // not user list text, so that case still yields no rows (below).
    return coercePlainTextRows(raw, columns);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => {
      const row: GridRow = { id: typeof entry.id === "string" ? entry.id : newId() };
      for (const col of columns) {
        const value = entry[col.key];
        row[col.key] = typeof value === "string" ? value : value == null ? "" : String(value);
      }
      return row;
    });
}

/** True when a row has at least one non-empty cell across the grid's columns. */
export function rowHasContent(row: GridRow, columns: GridColumn[]): boolean {
  return columns.some((col) => (row[col.key] ?? "").trim().length > 0);
}

/** Serialize rows to a JSON string, dropping rows that are entirely empty. */
export function serializeRows(rows: GridRow[], columns: GridColumn[]): string {
  return JSON.stringify(rows.filter((row) => rowHasContent(row, columns)));
}

/** Count of non-empty rows — used for completeness/verdict signals. */
export function filledRowCount(rows: GridRow[], columns: GridColumn[]): number {
  return rows.filter((row) => rowHasContent(row, columns)).length;
}

function makeEmptyRow(columns: GridColumn[]): GridRow {
  const row: GridRow = { id: newId() };
  for (const col of columns) row[col.key] = "";
  return row;
}

interface StructuredGridProps {
  columns: GridColumn[];
  rows: GridRow[];
  onChange: (rows: GridRow[]) => void;
  addLabel?: string;
  /** Render inputs as disabled, read-only reference (e.g. referenced roster). */
  readOnly?: boolean;
}

export default function StructuredGrid({ columns, rows, onChange, addLabel = "+ Add row", readOnly = false }: StructuredGridProps) {
  // Always present at least one editable row so the grid reads as a form, not an
  // empty void. The placeholder lives outside parent state (its keystrokes commit
  // it via updateCell) and is omitted in read-only mode, where an empty grid
  // should simply render nothing.
  const placeholderRow = React.useMemo(() => makeEmptyRow(columns), [columns]);
  const displayRows = rows.length > 0 ? rows : readOnly ? [] : [placeholderRow];

  function updateCell(index: number, key: string, value: string) {
    if (rows.length === 0) {
      onChange([{ ...placeholderRow, [key]: value }]);
      return;
    }
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function addRow() {
    onChange([...rows, makeEmptyRow(columns)]);
  }

  return (
    <div className="v3-grid-input">
      {displayRows.length > 0 ? (
        <div className="v3-grid-input-head">
          {columns.map((col) => (
            <span
              key={col.key}
              className="v3-grid-input-col-label"
              style={col.width ? { width: col.width, flex: "none" } : { flex: 1 }}
            >
              {col.label}
            </span>
          ))}
          {!readOnly ? <span className="v3-grid-input-col-spacer" /> : null}
        </div>
      ) : null}

      {displayRows.map((row, index) => (
        <div key={row.id} className="v3-grid-input-row">
          {columns.map((col) =>
            col.type === "select" ? (
              <select
                key={col.key}
                className="v3-input"
                style={col.width ? { width: col.width, flex: "none" } : { flex: 1 }}
                value={row[col.key] ?? ""}
                disabled={readOnly}
                onChange={(event) => updateCell(index, col.key, event.target.value)}
              >
                <option value="">—</option>
                {col.options?.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input
                key={col.key}
                type={col.type === "number" ? "number" : col.type === "date" ? "date" : "text"}
                className="v3-input"
                style={col.width ? { width: col.width, flex: "none" } : { flex: 1 }}
                value={row[col.key] ?? ""}
                placeholder={col.placeholder ?? col.label}
                disabled={readOnly}
                onChange={(event) => updateCell(index, col.key, event.target.value)}
              />
            ),
          )}
          {!readOnly ? (
            <button type="button" className="v3-button ghost" style={{ fontSize: 11, flexShrink: 0 }} onClick={() => removeRow(index)}>
              ✕
            </button>
          ) : null}
        </div>
      ))}

      {!readOnly ? (
        <button type="button" className="v3-button ghost" style={{ fontSize: 11, marginTop: 4 }} onClick={addRow}>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
