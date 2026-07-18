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
import { listenCoverageRoles, listenCoverageAreas, listenAreaCoverage, makeListenPlanWriter } from "@/v3/components/flow/listenCoverage";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { movementEvidence, flowMovements, readMovementInputs } from "@/v3/components/flow/flowShellData";

const initials = (name: string): string => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
};

type SaveInputs = (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;

export default function DiscoveryKitAlign({ program, onSaveInputs }: { program: ProgramSummary; onSaveInputs?: SaveInputs }) {
  const [view, setView] = useState<"matrix" | "person">("matrix");
  const [areaInput, setAreaInput] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [busy, setBusy] = useState(false);
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

  const gridCols = `230px repeat(${shown.length}, minmax(96px, 1fr))${editable ? " 44px" : ""}`;
  const spanners = people.filter((p) => shown.filter((a) => covers(p.label, a.label)).length > 1);

  return (
    <div className={`v3fs-dka${busy ? " busy" : ""}`}>
      <div className="v3fs-dka-h">
        <div>
          <div className="v3fs-dka-eyebrow">Frame · Discovery Kit</div>
          <h2 className="v3fs-dka-title">Areas &amp; people — who covers what</h2>
          <p className="v3fs-dka-sub">Click a cell to change who covers an area. Add or remove an area or a role below. A person who spans areas is interviewed once and their evidence flows to every area they cover.</p>
        </div>
        <div className="v3fs-dka-views" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "matrix"} className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>Matrix</button>
          <button type="button" role="tab" aria-selected={view === "person"} className={view === "person" ? "on" : ""} onClick={() => setView("person")}>By person</button>
        </div>
      </div>

      {!people.length ? (
        <div className="v3fs-dka-empty">No people yet — add a role below to start mapping coverage.</div>
      ) : view === "matrix" ? (
        <div className="v3fs-dka-matrixwrap">
          <div className="v3fs-dka-matrix" style={{ gridTemplateColumns: gridCols }}>
            <div className="v3fs-dka-corner">People × Areas</div>
            {shown.map((a) => (
              <div key={a.label} className="v3fs-dka-ahdr" style={{ "--acc": areaAccent(a.label) } as React.CSSProperties}>
                <span className="mono" aria-hidden="true">{areaMonogram(a.label)}</span>
                <span className="an">{a.label}{a.added ? <em className="added"> new</em> : null}</span>
                {editable ? <button type="button" className="v3fs-dka-x" title={`Remove ${a.label}`} aria-label={`Remove ${a.label}`} onClick={() => void removeArea(a.label)}>×</button> : null}
              </div>
            ))}
            {editable ? <div className="v3fs-dka-ahdr addcol" aria-hidden="true" /> : null}
            {people.map((p) => (
              <div key={p.label} className="v3fs-dka-row" style={{ display: "contents" }}>
                <div className={`v3fs-dka-person${shown.filter((a) => covers(p.label, a.label)).length > 1 ? " spans" : ""}`}>
                  <span className="av">{initials(p.name || p.label)}</span>
                  <span className="who"><span className="nm">{p.name || p.label}</span>{p.name ? <span className="rl">{p.label}</span> : null}</span>
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
                <span className="n">{f.heard} / {f.total || "—"}</span>
                <span className="bar"><i style={{ width: `${f.total ? Math.round((100 * f.heard) / f.total) : 0}%` }} /></span>
              </div>
            ))}
            {editable ? <div className="v3fs-dka-foot" /> : null}
          </div>
        </div>
      ) : (
        <div className="v3fs-dka-byperson">
          {people.map((p) => {
            const cov = shown.filter((a) => covers(p.label, a.label)).map((a) => a.label);
            return (
              <div key={p.label} className="v3fs-dka-pcard">
                <span className="av">{initials(p.name || p.label)}</span>
                <span className="who"><span className="nm">{p.name || p.label}</span>{p.name ? <span className="rl">{p.label}</span> : null}</span>
                <span className="areas">
                  {cov.length ? cov.map((a) => <span key={a} className="achip" style={{ "--acc": areaAccent(a) } as React.CSSProperties}>{a}</span>) : <span className="achip none">no area yet</span>}
                </span>
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

      {spanners.length ? (
        <div className="v3fs-dka-note">
          <span className="ic" aria-hidden="true">✉</span>
          <p><b>Asked once.</b> {spanners.slice(0, 3).map((p) => (p.name || p.label).split(" ")[0]).join(", ")}{spanners.length > 3 ? ` and ${spanners.length - 3} more` : ""} each span multiple areas — one interview covers everything they touch, counting toward every area they cover.</p>
        </div>
      ) : null}

      {/* The confirm ceremony (ported from the retired Listen coverage plan):
          confirming clears the Listen gate; ANY matrix edit re-opens it, because
          the shared plan writer resets _listenCoverageConfirmed on every write. */}
      {editable ? (() => {
        const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
        const setConfirmed = (value: string) => void onSaveInputs?.("frame", { _listenCoverageConfirmed: value }, { silent: true });
        return (
          <div className="v3fs-dka-foot">
            <span className="v3fs-dka-foot-note">Confirming clears the Listen gate; any later edit re-opens it and refreshes the kit.</span>
            {confirmedAt ? (
              <span className="v3fs-dka-foot-r">
                <span className="v3fs-dka-confnote">✓ Confirmed {new Date(confirmedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <button type="button" className="v3fs-nb-open ghost sm" disabled={busy} onClick={() => setConfirmed("")}>Re-open</button>
              </span>
            ) : (
              <button type="button" className="v3fs-nb-open sm" disabled={busy} onClick={() => setConfirmed(new Date().toISOString())}>Confirm the Listen plan</button>
            )}
          </div>
        );
      })() : null}
    </div>
  );
}
