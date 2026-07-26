/**
 * DiscoveryKitAlign — the Discovery Kit alignment surface (reimagined chrome).
 * The many-to-many map of PEOPLE × AREAS, now EDITABLE: click a cell to toggle
 * who covers what, add/remove an area, add/remove a role. It edits the same
 * `listenPlan` overlay the (now-retired) Listen coverage plan used, so a change
 * here stales the Discovery Kit and Prototype for regeneration, exactly as
 * before. Two views — a coverage Matrix and a By-person list.
 *
 * Coverage is EXPLICIT-or-inferred: an area with a hand-curated list uses it
 * (even empty — a deliberate "no one"); otherwise it falls back to the
 * title-inferred match, materialised on first edit.
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { areaAccent, areaMonogram, stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { resolveMovementStakeholders, readListenPlan, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { listenCoverageRoles, listenCoverageAreas, listenAreaCoverage, makeListenPlanWriter, type CoverageRole } from "@/v3/components/flow/listenCoverage";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import { movementEvidence, flowMovements, readMovementInputs } from "@/v3/components/flow/flowShellData";

const initials = (name: string): string => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
};

type SaveInputs = (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;

export default function DiscoveryKitAlign({ program, onSaveInputs, onRenamePerson, onRenameRole, locked, onOpenGate }: {
  program: ProgramSummary;
  onSaveInputs?: SaveInputs;
  /** Rename a NAMED person programme-wide (roster, bindings, links). */
  onRenamePerson?: (oldName: string, newName: string) => Promise<void>;
  /** Rename a role-only row's label programme-wide. */
  onRenameRole?: (oldRole: string, newRole: string) => Promise<void>;
  /** The movement's gate is approved. The matrix stays EDITABLE — the save
   * chokepoint auto-reopens the gate on the first substantive change — but
   * the operator must know that before clicking, so a notice says so and
   * routes to the gate for the details. */
  locked?: boolean;
  onOpenGate?: () => void;
}) {
  const [view, setView] = useState<"matrix" | "person">("matrix");
  const [areaInput, setAreaInput] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState<null | { kind: "area" | "person"; label: string; x: number; y: number }>(null);
  const [editing, setEditing] = useState<null | { kind: "area" | "person"; label: string }>(null);
  const [drag, setDrag] = useState<null | { kind: "area" | "person"; label: string }>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const editable = !!onSaveInputs;

  const plan = readListenPlan(program);
  const writer = makeListenPlanWriter(program, onSaveInputs);

  // People, areas and coverage all come from the ONE shared model.
  const people = listenCoverageRoles(program);
  const shown = listenCoverageAreas(program, plan);
  const areaCoverage = listenAreaCoverage(program, plan, people, shown);
  const areaRolesNow = (area: string): string[] => areaCoverage.find((a) => a.area === area)?.roles ?? [];
  const covers = (roleLabel: string, area: string): boolean => areaRolesNow(area).includes(roleLabel);

  // Heard footer — of the people covering an area, how many are heard. Resolve
  // the stakeholder record by role/name key so stakeholderCollection (the same
  // source the collect board and People page use) can score it.
  const listen = flowMovements().find((m) => m.id === "listen");
  const ev = listen ? movementEvidence(program, listen) : [];
  const packs = listInterviewPacks(program);
  const sByLabel = new Map<string, MovementStakeholder>();
  for (const s of resolveMovementStakeholders(program, "listen")) {
    const key = (s.role || s.name).trim().toLowerCase();
    if (key && !sByLabel.has(key)) sByLabel.set(key, s);
  }
  const heardByLabel = new Map(people.map((p) => {
    const s = sByLabel.get(p.label.trim().toLowerCase());
    return [p.label, s ? stakeholderCollection("listen", s, packs, ev).heard : false] as const;
  }));
  const footer = shown.map((a) => {
    const covering = areaRolesNow(a.label);
    const heard = covering.filter((l) => heardByLabel.get(l)).length;
    return { area: a.label, total: covering.length, heard };
  });

  // ── writes — thin wrappers over the shared writer, adding busy + input UX ──
  const guard = async (fn: () => Promise<void> | void) => {
    if (busy || !editable) return; setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const toggleCell = (roleLabel: string, area: string) => guard(() => {
    const now = areaRolesNow(area);
    return writer.setAreaRoles(area, now.includes(roleLabel) ? now.filter((r) => r !== roleLabel) : [...now, roleLabel]);
  });
  const addArea = () => {
    const a = areaInput.trim();
    if (!a) return Promise.resolve();
    if (shown.some((x) => x.label.toLowerCase() === a.toLowerCase())) { setAreaInput(""); return Promise.resolve(); }
    return guard(async () => { await writer.addArea(a); setAreaInput(""); });
  };
  const removeArea = (area: string) => guard(() => writer.removeArea(area));
  const addRole = () => {
    const role = roleInput.trim();
    if (!role) return Promise.resolve();
    if (people.some((r) => r.label.toLowerCase() === role.toLowerCase())) { setRoleInput(""); return Promise.resolve(); }
    return guard(async () => { await writer.addRole(role); setRoleInput(""); });
  };
  const removeRole = (r: { label: string; name?: string }) => guard(() => writer.removeRole(r));
  const moveArea = (area: string, delta: number) => guard(() => writer.moveArea(area, delta));
  const moveRole = (label: string, delta: number) => guard(() => writer.moveRole(label, delta));

  // ── inline rename — double-click a label; Enter/blur commits, Esc cancels ──
  const canRenameRow = (p: CoverageRole) => !!(p.name ? onRenamePerson : onRenameRole);
  const commitRename = (next: string) => {
    const target = editing;
    setEditing(null);
    if (!target) return;
    const to = next.trim();
    if (!to || to.toLowerCase() === target.label.toLowerCase()) return;
    if (target.kind === "area") { void guard(() => writer.renameArea(target.label, to)); return; }
    const row = people.find((r) => (r.name || r.label) === target.label);
    if (!row) return;
    if (row.name && onRenamePerson) { void guard(() => onRenamePerson(row.name as string, to)); return; }
    if (onRenameRole) void guard(() => onRenameRole(row.label, to));
  };
  const renameInput = (label: string, ariaLabel: string) => (
    <input className="v3fs-dka-ren" defaultValue={label} aria-label={ariaLabel} autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitRename(e.currentTarget.value);
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={(e) => commitRename(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()} />
  );

  // ── drag-drop reorder — writes the same order overlay as the arrows ──
  const dropReorder = (kind: "area" | "person", targetLabel: string) => {
    if (!drag || drag.kind !== kind || drag.label === targetLabel) return;
    const labels = kind === "area" ? shown.map((a) => a.label) : people.map((p) => p.label);
    const from = labels.indexOf(drag.label);
    const to = labels.indexOf(targetLabel);
    if (from < 0 || to < 0) return;
    const next = [...labels];
    next.splice(from, 1);
    next.splice(to, 0, drag.label);
    void guard(() => (kind === "area" ? writer.setAreaOrder(next) : writer.setRoleOrder(next)));
  };
  const dragProps = (kind: "area" | "person", label: string) => (editable ? {
    draggable: !(editing && editing.kind === kind && editing.label === label),
    onDragStart: () => { setPeek(null); setDrag({ kind, label }); },
    onDragOver: (e: React.DragEvent) => { if (drag?.kind === kind) { e.preventDefault(); setDragOver(label); } },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); dropReorder(kind, label); setDrag(null); setDragOver(null); },
    onDragEnd: () => { setDrag(null); setDragOver(null); },
  } : {});
  const dragoverCls = (kind: "area" | "person", label: string) =>
    drag?.kind === kind && dragOver === label && drag.label !== label ? " dragover" : "";

  // ── hover peek — fixed-position so the matrix's scroll box can't clip it ──
  const showPeek = (kind: "area" | "person", label: string) => (e: React.MouseEvent) => {
    if (drag || editing) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPeek(kind === "person"
      ? { kind, label, x: Math.min(r.right + 10, window.innerWidth - 300), y: Math.max(8, r.top) }
      : { kind, label, x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 8 });
  };
  const hidePeek = () => setPeek(null);

  const gridCols = `230px repeat(${shown.length}, minmax(96px, 1fr))${editable ? " 44px" : ""}`;

  return (
    <div className={`v3fs-dka${busy ? " busy" : ""}`}>
      <div className="v3fs-dka-h">
        <div>
          <div className="v3fs-dka-eyebrow">Frame · Discovery Kit</div>
          <h2 className="v3fs-dka-title">Areas &amp; people — who covers what</h2>
          <p className="v3fs-dka-sub">Click a cell to change who covers an area. Add or remove an area or a role below. A person who spans areas is interviewed once and their evidence flows to every area they cover.</p>
          {locked ? (
            <div className="v3fs-dka-lock">
              <span aria-hidden="true">🔓</span> Gate approved — making a change reopens the Frame gate.
              {onOpenGate ? <button type="button" className="v3fs-nb-open ghost sm" onClick={onOpenGate}>View the gate →</button> : null}
            </div>
          ) : null}
        </div>
        <div className="v3fs-dka-hr">
          <div className="v3fs-dka-views" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === "matrix"} className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>Matrix</button>
            <button type="button" role="tab" aria-selected={view === "person"} className={view === "person" ? "on" : ""} onClick={() => setView("person")}>By person</button>
          </div>
          {/* Confirm ceremony, under the view toggle. The button appears ONLY
              when there are unconfirmed plan edits (the overlay exists and the
              confirmation is open — every matrix write re-opens it via the
              shared plan writer). Confirming clears the Listen gate and, with
              Auto-build on, triggers ONE rebuild over the final plan. */}
          {editable ? (() => {
            const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
            const hasPlanEdits = !!String(readMovementInputs(program, "frame").listenPlan ?? "").trim();
            const setConfirmed = (value: string) => void onSaveInputs?.("frame", { _listenCoverageConfirmed: value }, { silent: true });
            if (confirmedAt) return (
              <span className="v3fs-dka-confirmed">
                <span className="v3fs-dka-confnote">✓ Confirmed {new Date(confirmedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <button type="button" className="v3fs-nb-open ghost sm" disabled={busy} onClick={() => setConfirmed("")}>Re-open</button>
              </span>
            );
            if (hasPlanEdits) return (
              <button type="button" className="v3fs-nb-open sm" disabled={busy} title="Clears the Listen gate; with Auto-build on, triggers one rebuild over the final plan" onClick={() => setConfirmed(new Date().toISOString())}>Confirm the Listen plan</button>
            );
            return null;
          })() : null}
        </div>
      </div>

      {!people.length ? (
        <div className="v3fs-dka-empty">No people yet — add a role below to start mapping coverage.</div>
      ) : view === "matrix" ? (
        <div className="v3fs-dka-matrixwrap">
          <div className="v3fs-dka-matrix" style={{ gridTemplateColumns: gridCols }}>
            <div className="v3fs-dka-corner">People × Areas</div>
            {shown.map((a, i) => (
              <div key={a.label} className={`v3fs-dka-ahdr${dragoverCls("area", a.label)}`} style={{ "--acc": areaAccent(a.label) } as React.CSSProperties}
                onMouseEnter={showPeek("area", a.label)} onMouseLeave={hidePeek} {...dragProps("area", a.label)}>
                <span className="mono" aria-hidden="true">{areaMonogram(a.label)}</span>
                {editing?.kind === "area" && editing.label === a.label
                  ? renameInput(a.label, `Rename ${a.label}`)
                  : <span className="an" title={editable ? "Double-click to rename" : undefined}
                      onDoubleClick={editable ? () => { hidePeek(); setEditing({ kind: "area", label: a.label }); } : undefined}>
                      {a.label}{a.added ? <em className="added"> new</em> : null}
                    </span>}
                {editable ? (
                  <span className="v3fs-dka-mv">
                    <button type="button" className="v3fs-dka-mvb" title={`Move ${a.label} left`} aria-label={`Move ${a.label} left`}
                      disabled={busy || i === 0} onClick={() => void moveArea(a.label, -1)}>◂</button>
                    <button type="button" className="v3fs-dka-mvb" title={`Move ${a.label} right`} aria-label={`Move ${a.label} right`}
                      disabled={busy || i === shown.length - 1} onClick={() => void moveArea(a.label, 1)}>▸</button>
                  </span>
                ) : null}
                {editable ? <button type="button" className="v3fs-dka-x" title={`Remove ${a.label}`} aria-label={`Remove ${a.label}`} onClick={() => void removeArea(a.label)}>×</button> : null}
              </div>
            ))}
            {editable ? <div className="v3fs-dka-ahdr addcol" aria-hidden="true" /> : null}
            {people.map((p, i) => (
              <div key={p.label} className="v3fs-dka-row" style={{ display: "contents" }}>
                <div className={`v3fs-dka-person${shown.filter((a) => covers(p.label, a.label)).length > 1 ? " spans" : ""}${dragoverCls("person", p.label)}`}
                  onMouseEnter={showPeek("person", p.label)} onMouseLeave={hidePeek} {...dragProps("person", p.label)}>
                  <span className="av">{initials(p.name || p.label)}</span>
                  <span className="who">
                    {editing?.kind === "person" && editing.label === (p.name || p.label)
                      ? renameInput(p.name || p.label, `Rename ${p.name || p.label}`)
                      : <span className="nm" title={editable && canRenameRow(p) ? "Double-click to rename" : undefined}
                          onDoubleClick={editable && canRenameRow(p) ? () => { hidePeek(); setEditing({ kind: "person", label: p.name || p.label }); } : undefined}>
                          {p.name || p.label}
                        </span>}
                    {p.name ? <span className="rl">{p.label}</span> : null}
                  </span>
                  {editable ? (
                    <span className="v3fs-dka-mv rows">
                      <button type="button" className="v3fs-dka-mvb" title={`Move ${p.name || p.label} up`} aria-label={`Move ${p.name || p.label} up`}
                        disabled={busy || i === 0} onClick={() => void moveRole(p.label, -1)}>▴</button>
                      <button type="button" className="v3fs-dka-mvb" title={`Move ${p.name || p.label} down`} aria-label={`Move ${p.name || p.label} down`}
                        disabled={busy || i === people.length - 1} onClick={() => void moveRole(p.label, 1)}>▾</button>
                    </span>
                  ) : null}
                  {editable ? <button type="button" className="v3fs-dka-x" title={`Remove ${p.name || p.label}`} aria-label={`Remove ${p.name || p.label}`} onClick={() => void removeRole(p)}>×</button> : null}
                </div>
                {shown.map((a) => (
                  <div key={a.label} className="v3fs-dka-cell">
                    <button type="button" className={`v3fs-dka-dot${covers(p.label, a.label) ? " on" : ""}${editable ? " editable" : ""}`}
                      disabled={!editable || busy} aria-pressed={covers(p.label, a.label)}
                      aria-label={`${p.name || p.label} ${covers(p.label, a.label) ? "covers" : "does not cover"} ${a.label}`}
                      onClick={() => void toggleCell(p.label, a.label)} />
                  </div>
                ))}
                {editable ? <div className="v3fs-dka-cell" /> : null}
              </div>
            ))}
            <div className="v3fs-dka-foot lbl">Coverage · heard</div>
            {footer.map((f) => (
              <div key={f.area} className={`v3fs-dka-foot cov${f.total > 0 && f.heard === f.total ? " full" : ""}`}>
                {/* Coverage first, heard second — the label's order. A bare
                    "0 / 9" read as a fraction and pointed the wrong way. */}
                <span className="n">{f.total ? <>{f.total} covering · {f.heard} heard</> : "no one covering"}</span>
                <span className="bar"><i style={{ width: `${f.total ? Math.round((100 * f.heard) / f.total) : 0}%` }} /></span>
              </div>
            ))}
            {editable ? <div className="v3fs-dka-foot" /> : null}
          </div>
        </div>
      ) : (
        <div className="v3fs-dka-byperson">
          {people.map((p, i) => {
            const cov = shown.filter((a) => covers(p.label, a.label)).map((a) => a.label);
            return (
              <div key={p.label} className="v3fs-dka-pcard">
                <span className="av">{initials(p.name || p.label)}</span>
                <span className="who">
                  {editing?.kind === "person" && editing.label === (p.name || p.label)
                    ? renameInput(p.name || p.label, `Rename ${p.name || p.label}`)
                    : <span className="nm" title={editable && canRenameRow(p) ? "Double-click to rename" : undefined}
                        onDoubleClick={editable && canRenameRow(p) ? () => setEditing({ kind: "person", label: p.name || p.label }) : undefined}>
                        {p.name || p.label}
                      </span>}
                  {p.name ? <span className="rl">{p.label}</span> : null}
                </span>
                <span className="areas">
                  {cov.length ? cov.map((a) => <span key={a} className="achip" style={{ "--acc": areaAccent(a) } as React.CSSProperties}>{a}</span>) : <span className="achip none">no area yet</span>}
                </span>
                {editable ? (
                  <span className="v3fs-dka-mv rows">
                    <button type="button" className="v3fs-dka-mvb" title={`Move ${p.name || p.label} up`} aria-label={`Move ${p.name || p.label} up`}
                      disabled={busy || i === 0} onClick={() => void moveRole(p.label, -1)}>▴</button>
                    <button type="button" className="v3fs-dka-mvb" title={`Move ${p.name || p.label} down`} aria-label={`Move ${p.name || p.label} down`}
                      disabled={busy || i === people.length - 1} onClick={() => void moveRole(p.label, 1)}>▾</button>
                  </span>
                ) : null}
                {editable ? <button type="button" className="v3fs-dka-x" title={`Remove ${p.name || p.label}`} onClick={() => void removeRole(p)}>×</button> : null}
              </div>
            );
          })}
        </div>
      )}

      {editable ? (
        <div className="v3fs-dka-add">
          <div className="v3fs-dka-addrow">
            <input value={roleInput} onChange={(e) => setRoleInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addRole(); }} placeholder="Add a role or person…" aria-label="Add a role or person" />
            <button type="button" className="v3fs-nb-open sm" disabled={busy || !roleInput.trim()} onClick={() => void addRole()}>+ Person</button>
          </div>
          <div className="v3fs-dka-addrow">
            <input value={areaInput} onChange={(e) => setAreaInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addArea(); }} placeholder="Add an area…" aria-label="Add an area" />
            <button type="button" className="v3fs-nb-open sm" disabled={busy || !areaInput.trim()} onClick={() => void addArea()}>+ Area</button>
          </div>
        </div>
      ) : null}

      {/* Hover peek — who/what this row or column is, without opening anything.
          Fixed-position and pointer-transparent so the matrix scroll box can't
          clip it and it never steals the hover. */}
      {peek ? (() => {
        if (peek.kind === "person") {
          const p = people.find((r) => r.label === peek.label);
          if (!p) return null;
          const email = stakeholderEmail(program, p.name || p.label);
          const heard = heardByLabel.get(p.label) === true;
          const cov = shown.filter((a) => covers(p.label, a.label)).map((a) => a.label);
          return (
            <div className="v3fs-dka-peek" style={{ left: peek.x, top: peek.y }} role="presentation">
              <div className="pk-t">{p.name || p.label}</div>
              <div className="pk-r">{p.name ? p.label : "role — no named person yet"}</div>
              <div className="pk-meta">
                <span className={`pk-pill${heard ? " ok" : ""}`}>{heard ? "✓ heard" : "not heard yet"}</span>
                {p.added ? <span className="pk-pill">operator-added</span> : null}
              </div>
              {email ? <div className="pk-e">{email}</div> : null}
              <div className="pk-l">Covers</div>
              <div className="pk-chips">
                {cov.length
                  ? cov.map((a) => <span key={a} className="achip" style={{ "--acc": areaAccent(a) } as React.CSSProperties}>{a}</span>)
                  : <span className="achip none">no area yet</span>}
              </div>
            </div>
          );
        }
        const a = shown.find((x) => x.label === peek.label);
        if (!a) return null;
        const roles = areaRolesNow(a.label);
        const heard = roles.filter((l) => heardByLabel.get(l)).length;
        return (
          <div className="v3fs-dka-peek" style={{ left: peek.x, top: peek.y }} role="presentation">
            <div className="pk-t">{a.label}</div>
            <div className="pk-meta">
              <span className={`pk-pill${roles.length > 0 && heard === roles.length ? " ok" : ""}`}>{heard} / {roles.length || "—"} heard</span>
              {a.added ? <span className="pk-pill">operator-added</span> : null}
            </div>
            <div className="pk-l">Who covers it</div>
            {roles.length
              ? <ul className="pk-list">{roles.map((r) => <li key={r}><i className={heardByLabel.get(r) ? "ok" : ""}>{heardByLabel.get(r) ? "✓" : "○"}</i>{r}</li>)}</ul>
              : <div className="pk-none">no one assigned yet</div>}
          </div>
        );
      })() : null}

    </div>
  );
}
