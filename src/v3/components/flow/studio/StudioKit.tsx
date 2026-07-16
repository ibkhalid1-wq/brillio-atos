/**
 * The artifact studio's editing primitives. Every structured editor is
 * composed from these so the WYSIWYG grammar stays consistent: click into
 * any text and type; lists and tables add/remove rows in place. All
 * controlled — the studio owns the document, primitives report changes up.
 */
import React from "react";

/**
 * When true, every studio primitive renders its controls disabled and hides its
 * add/remove affordances — the document is DERIVED and read-only, so a field
 * must not accept a click or a keystroke (a no-op onChange still let the caret
 * in, which read as editable). FlowArtifactStudio provides this around the
 * studio whenever edits are locked.
 */
export const StudioLockContext = React.createContext(false);
export const useStudioLocked = (): boolean => React.useContext(StudioLockContext);

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const asText = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
export const asStrings = (value: unknown): string[] => asArray(value).map(asText);

/**
 * The shared premium empty-state — one vocabulary for "this panel has nothing
 * yet" across every phase: a soft accent icon medallion, a title, a one-line
 * hint, and an optional action row. Use it for WHOLE-PANEL emptiness (a studio
 * body with no content); small inline "nothing here" notes stay compact with
 * .v3fs-empty / .v3fs-stu-empty. Mirrors the CSS class .v3fs-emptc.
 */
export function EmptyState({ icon, title, hint, action }: {
  icon: string; title: string; hint?: string; action?: React.ReactNode;
}) {
  return (
    <div className="v3fs-emptc">
      <span className="v3fs-emptc-i" aria-hidden="true">{icon}</span>
      <b className="v3fs-emptc-t">{title}</b>
      {hint ? <p className="v3fs-emptc-h">{hint}</p> : null}
      {action ? <div className="v3fs-emptc-a">{action}</div> : null}
    </div>
  );
}

export function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="v3fs-stu-sec">
      <div className="v3fs-stu-sec-h">
        <h3>{label}</h3>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A collapsible section CARD — a premium `<details>` with a title, optional
 * hint + count badge, and a rotating caret. Studios use these so the operator
 * can fold the sections they aren't working on and navigate a long document by
 * its section headers. Shares the `.v3fs-edcard` styling.
 */
export function CollapsibleCard({ label, hint, badge, defaultOpen = false, children }: {
  label: string; hint?: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details className="v3fs-edcard" {...(defaultOpen ? { open: true } : {})}>
      <summary className="v3fs-edcard-h">
        <span className="v3fs-edcard-t">{label}</span>
        {badge != null && badge !== false ? <span className="v3fs-edcard-badge">{badge}</span> : null}
        {hint ? <span className="v3fs-edcard-hint">{hint}</span> : null}
        <span className="v3fs-edcard-caret" aria-hidden="true">▾</span>
      </summary>
      <div className="v3fs-edcard-b">{children}</div>
    </details>
  );
}

export function TextField({ label, value, onChange, placeholder }: {
  label?: string; value: string; onChange: (next: string) => void; placeholder?: string;
}) {
  const locked = useStudioLocked();
  return (
    <label className="v3fs-stu-field">
      {label ? <span className="v3fs-stu-fl">{label}</span> : null}
      <input value={value} placeholder={placeholder} disabled={locked} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function TextArea({ label, value, onChange, rows = 3, placeholder }: {
  label?: string; value: string; onChange: (next: string) => void; rows?: number; placeholder?: string;
}) {
  const locked = useStudioLocked();
  return (
    <label className="v3fs-stu-field">
      {label ? <span className="v3fs-stu-fl">{label}</span> : null}
      <textarea value={value} rows={rows} placeholder={placeholder} disabled={locked} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: {
  label?: string; value: string; options: string[]; onChange: (next: string) => void;
}) {
  const locked = useStudioLocked();
  const known = options.includes(value) ? options : [value, ...options];
  return (
    <label className="v3fs-stu-field">
      {label ? <span className="v3fs-stu-fl">{label}</span> : null}
      <select value={value} disabled={locked} onChange={(e) => onChange(e.target.value)}>
        {known.map((option) => <option key={option} value={option}>{option || "—"}</option>)}
      </select>
    </label>
  );
}

/** Editor for a plain string[] — one row per entry. */
export function StringListEditor({ label, values, onChange, placeholder, addLabel }: {
  label?: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string; addLabel?: string;
}) {
  const locked = useStudioLocked();
  const set = (index: number, next: string) => onChange(values.map((v, i) => (i === index ? next : v)));
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));
  return (
    <div className="v3fs-stu-list">
      {label ? <span className="v3fs-stu-fl">{label}</span> : null}
      {values.map((value, index) => (
        <div key={index} className="v3fs-stu-list-row">
          <input value={value} placeholder={placeholder} disabled={locked} onChange={(e) => set(index, e.target.value)} />
          {locked ? null : <button type="button" className="v3fs-stu-x" aria-label="Remove" onClick={() => remove(index)}>×</button>}
        </div>
      ))}
      {locked ? null : <button type="button" className="v3fs-a" onClick={() => onChange([...values, ""])}>＋ {addLabel ?? "Add"}</button>}
    </div>
  );
}

export interface TableColumn {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "select";
  options?: string[];
  /** flex-grow weight; defaults to 1 */
  grow?: number;
}

/** Editor for an array of flat objects — a labelled column per key. */
export function TableEditor({ columns, rows, onChange, addLabel, emptyHint }: {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
  addLabel?: string;
  emptyHint?: string;
}) {
  const locked = useStudioLocked();
  const setCell = (index: number, key: string, next: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: next } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, ""]))]);
  return (
    <div className="v3fs-stu-table">
      {rows.length ? (
        <div className="v3fs-stu-tr v3fs-stu-th" aria-hidden="true">
          {columns.map((col) => <span key={col.key} style={{ flexGrow: col.grow ?? 1, flexBasis: 0 }}>{col.label}</span>)}
          <span className="v3fs-stu-xcol" />
        </div>
      ) : emptyHint ? <div className="v3fs-stu-empty">{emptyHint}</div> : null}
      {rows.map((row, index) => (
        <div key={index} className="v3fs-stu-tr">
          {columns.map((col) => {
            const value = asText(row[col.key]);
            const style = { flexGrow: col.grow ?? 1, flexBasis: 0 } as const;
            if (col.kind === "select") {
              const options = col.options ?? [];
              const known = options.includes(value) ? options : [value, ...options];
              return (
                <select key={col.key} style={style} value={value} aria-label={col.label} disabled={locked}
                  onChange={(e) => setCell(index, col.key, e.target.value)}>
                  {known.map((option) => <option key={option} value={option}>{option || "—"}</option>)}
                </select>
              );
            }
            if (col.kind === "textarea") {
              return <textarea key={col.key} style={style} rows={2} value={value} aria-label={col.label} disabled={locked}
                onChange={(e) => setCell(index, col.key, e.target.value)} />;
            }
            return <input key={col.key} style={style} value={value} aria-label={col.label} disabled={locked}
              onChange={(e) => setCell(index, col.key, e.target.value)} />;
          })}
          {locked ? null : <button type="button" className="v3fs-stu-x v3fs-stu-xcol" aria-label="Remove row" onClick={() => remove(index)}>×</button>}
        </div>
      ))}
      {locked ? null : <button type="button" className="v3fs-a" onClick={add}>＋ {addLabel ?? "Add row"}</button>}
    </div>
  );
}

/** Comma-joined chip text input — for short string[] like tools or aliases. */
export function ChipsField({ label, values, onChange, placeholder }: {
  label?: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string;
}) {
  return (
    <TextField
      label={label}
      value={values.join(", ")}
      placeholder={placeholder ?? "comma-separated"}
      onChange={(next) => onChange(next.split(",").map((s) => s.trim()).filter(Boolean))}
    />
  );
}

/** Shared contract every artifact studio implements. */
export interface StudioProps {
  doc: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Open another artifact's document (e.g. an entity chip → the ontology). */
  onOpenArtifact?: (artifactId: string) => void;
  /** The programme — studios that show derived state (role bindings) read it. */
  program?: import("@/new/types").ProgramSummary;
  /** Bind a delivery role to a person (attested `_roleBindings` write). */
  onBindRole?: (movementId: string, role: string, name: string, email: string) => Promise<void>;
  /** Refine & polish the prototype from a plain-language instruction (the
   *  Prototype Build studio's command bar) — stashes it and re-runs the build. */
  onRefinePrototype?: (instruction: string) => Promise<void> | void;
  /** This artifact is regenerating — the studio's command bar shows progress. */
  refining?: boolean;
}
