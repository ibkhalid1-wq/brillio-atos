/**
 * The artifact studio's editing primitives. Every structured editor is
 * composed from these so the WYSIWYG grammar stays consistent: click into
 * any text and type; lists and tables add/remove rows in place. All
 * controlled — the studio owns the document, primitives report changes up.
 */
import React, { useState } from "react";

/**
 * When true, every studio primitive renders its controls disabled and hides its
 * add/remove affordances — the document is DERIVED and read-only, so a field
 * must not accept a click or a keystroke (a no-op onChange still let the caret
 * in, which read as editable). FlowArtifactStudio provides this around the
 * studio whenever edits are locked.
 */
export const StudioLockContext = React.createContext(false);
export const useStudioLocked = (): boolean => React.useContext(StudioLockContext);

/**
 * Whether the operator may AUTHOR new top-level items from nothing — add a
 * brand-new entity, workflow, system, pain or event. Distinct from the lock:
 * a CURATABLE artifact (the Domain Ontology, the Current-State Atlas) is
 * unlocked for editing — rename, redefine, relate, regroup, dismiss — but is
 * NOT authorable, because inventing a current-state fact with no evidence
 * breaks the artifact's grounding. Design-team artifacts (architecture,
 * experience, blueprint) are fully authorable. Defaults to true so any studio
 * primitive rendered outside FlowArtifactStudio keeps its add affordance.
 */
export const StudioAuthoringContext = React.createContext(true);
export const useStudioAuthoring = (): boolean => React.useContext(StudioAuthoringContext);

/**
 * Append a dismissal note to a document's `_curationLog` — an underscore-keyed,
 * non-rendered provenance trail that travels with the saved doc (the snapshot
 * ring captures it, and the regeneration hand-edit extractor skips `_` keys, so
 * it never pollutes the body or the regen prompt). Records WHY a grounded node
 * was removed so a curation dismissal is auditable, and recoverable via the
 * snapshot ring.
 */
export function curationNote(doc: Record<string, unknown>, action: string, reason: string): Record<string, unknown> {
  const log = Array.isArray(doc._curationLog) ? doc._curationLog : [];
  return { _curationLog: [...log, { at: new Date().toISOString(), action, reason }] };
}

/**
 * Remove-a-grounded-node control with a mandatory reason. One click reveals a
 * reason field; the removal only lands once a reason is given, so a dismissal
 * is never accidental and always carries its rationale onto the trail. Hidden
 * when the studio is hard-locked.
 */
export function DismissControl({ label, confirmLabel, onDismiss }: {
  label: string; confirmLabel?: string; onDismiss: (reason: string) => void;
}) {
  const locked = useStudioLocked();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (locked) return null;
  if (!open) {
    return <button type="button" className="v3fs-btn danger" onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <div className="v3fs-dismiss" role="group" aria-label={label}>
      <input className="v3fs-dismiss-in" autoFocus value={reason}
        placeholder="Why is this being removed? (recorded on the trail)"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && reason.trim()) { onDismiss(reason.trim()); setOpen(false); setReason(""); } }} />
      <button type="button" className="v3fs-btn danger" disabled={!reason.trim()}
        onClick={() => { onDismiss(reason.trim()); setOpen(false); setReason(""); }}>{confirmLabel ?? "Confirm dismiss"}</button>
      <button type="button" className="v3fs-btn" onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
    </div>
  );
}

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
  const authoring = useStudioAuthoring();
  const set = (index: number, next: string) => onChange(values.map((v, i) => (i === index ? next : v)));
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));
  return (
    <div className="v3fs-stu-list">
      {label ? <span className="v3fs-stu-fl">{label}</span> : null}
      {values.map((value, index) => (
        <div key={index} className="v3fs-stu-list-row">
          <input value={value} placeholder={placeholder} title={value || undefined} disabled={locked} onChange={(e) => set(index, e.target.value)} />
          {locked ? null : <button type="button" className="v3fs-stu-x" aria-label="Remove" onClick={() => remove(index)}>×</button>}
        </div>
      ))}
      {locked || !authoring ? null : <button type="button" className="v3fs-a" onClick={() => onChange([...values, ""])}>＋ {addLabel ?? "Add"}</button>}
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
export function TableEditor({ columns, rows, onChange, addLabel, emptyHint, reorderable }: {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  onChange: (next: Record<string, unknown>[]) => void;
  addLabel?: string;
  emptyHint?: string;
  /** ↑/↓ per row — only for lists whose order carries meaning downstream. */
  reorderable?: boolean;
}) {
  const locked = useStudioLocked();
  const authoring = useStudioAuthoring();
  const setCell = (index: number, key: string, next: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: next } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, Object.fromEntries(columns.map((c) => [c.key, ""]))]);
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };
  return (
    <div className="v3fs-stu-table">
      {rows.length ? (
        <div className="v3fs-stu-tr v3fs-stu-th" aria-hidden="true">
          {columns.map((col) => <span key={col.key} style={{ flexGrow: col.grow ?? 1, flexBasis: 0 }}>{col.label}</span>)}
          {locked || !reorderable ? null : <span className="v3fs-stu-mv-h" />}
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
          {locked || !reorderable ? null : (
            <span className="v3fs-stu-mv">
              <button type="button" className="v3fs-stu-x" aria-label="Move row up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="v3fs-stu-x" aria-label="Move row down" disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button>
            </span>
          )}
          {locked ? null : <button type="button" className="v3fs-stu-x v3fs-stu-xcol" aria-label="Remove row" onClick={() => remove(index)}>×</button>}
        </div>
      ))}
      {locked || !authoring ? null : <button type="button" className="v3fs-a" onClick={add}>＋ {addLabel ?? "Add row"}</button>}
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
  /** Operator gap→stakeholder redirects for this movement (the Gaps table's
   *  second column). Present even when the document is read-only: the gap TEXT
   *  is derived, but WHO it's asked of is an operator judgement kept as an
   *  overlay. Keyed by the gap's bare question (gapRouteKey). */
  gapRoutes?: Record<string, string>;
  /** Redirect one gap to a stakeholder/role (attested `_gapRoutes` write); ""
   *  clears the addressee (movement-wide). Absent ⇒ the Gaps table is read-only. */
  onRouteGap?: (gap: string, who: string) => void | Promise<void>;
}
