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

/** Parse a persisted grid value (JSON string) into typed rows. */
export function parseRows(raw: unknown, columns: GridColumn[]): GridRow[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
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
  function updateCell(index: number, key: string, value: string) {
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
      {rows.length > 0 ? (
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

      {rows.map((row, index) => (
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
                type={col.type === "number" ? "number" : "text"}
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
