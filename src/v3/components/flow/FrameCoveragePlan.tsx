/**
 * The Listen plan — Frame's own tab, where the operator shapes discovery before
 * it opens: who Listen will hear (roles) and the areas it will cover.
 *
 * Roles and areas are SEEDED from the sponsor mandate, the draft ontology and
 * the discovery kit (read-only, tagged "from discovery"). On top of that the
 * operator has full CRUD over their OWN entries — add, rename, remove — by
 * keyboard or voice. Two invariants keep the plan honest:
 *  - a new role becomes a real Person (written to the People roster), so it
 *    flows into Listen's collection like any other voice;
 *  - any change persists to a fingerprinted frame field (`listenPlan`), so the
 *    Discovery Kit goes stale and regenerates against the new scope, and the
 *    confirmation re-opens.
 */
import { useMemo, useState, useRef, useEffect } from "react";
import type { ProgramSummary } from "@/new/types";
import { readDirectoryPeople, validateProgramRole, readListenPlan, type ListenPlanOverlay } from "@/v3/components/flow/flowStakeholders";
import { listenCoverageRoles, listenCoverageAreas, listenAreaCoverage, makeListenPlanWriter } from "@/v3/components/flow/listenCoverage";
import { roleAliasKey, displayRole } from "@/v3/components/flow/flowAreas";
import { areaAccent } from "@/v3/components/flow/CollectBoard";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { TranscribeButton } from "@/v3/components/flow/flowCapture";

// The operator's plan overlay (roles · areas · explicit who↔area coverage)
// lives on Frame as the fingerprinted `listenPlan` field — the read/write
// helpers are shared with the Inbox resolutions in flowStakeholders.ts.
type EditTarget = { kind: "role" | "area"; key: string } | null;

function monogram(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export default function FrameCoveragePlan({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;
}) {
  const [roleInput, setRoleInput] = useState("");
  const [areaInput, setAreaInput] = useState("");
  const [edit, setEdit] = useState<EditTarget>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const editRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (edit && editRef.current) { editRef.current.focus(); editRef.current.select(); } }, [edit]);

  // People, areas and coverage all come from the ONE shared model shared with
  // the reimagined Discovery Kit matrix (listenCoverage.ts) — a coverage-rule
  // change lands in one place, and the two editors can never disagree.
  const plan = useMemo(() => readListenPlan(program), [program]);
  const roles = useMemo(() => listenCoverageRoles(program), [program]);
  const areas = useMemo(() => listenCoverageAreas(program, plan), [program, plan]);
  const areaCoverage = useMemo(() => listenAreaCoverage(program, plan, roles, areas), [program, plan, roles, areas]);
  // The current covering roles of an area (explicit or inferred) — the base for
  // an edit, so unassigning from an inferred area materialises it correctly.
  const areaRolesNow = (area: string): string[] => areaCoverage.find((a) => a.area === area)?.roles ?? [];
  // Role-first projection: each person and the AREAS they cover. This is the
  // view — rows are roles, columns are their areas — inverted from the
  // area-keyed store so the same coverage powers both.
  const roleCoverage = useMemo(
    () => roles.map((r) => ({ role: r, areas: areaCoverage.filter((ac) => ac.roles.includes(r.label)).map((ac) => ac.area) })),
    [roles, areaCoverage],
  );

  const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
  const confirmed = confirmedAt.length > 0;
  const addedRoles = roles.filter((r) => r.added).length;

  // The plan-overlay writer is shared with the Discovery Kit matrix
  // (listenCoverage.ts): it persists a PARTIAL overlay merged onto the current
  // plan and stamps `planRev` into Listen/Envision/Show so the Discovery Kit and
  // Prototype stale for regeneration — ONE atomic write per edit.
  const writer = useMemo(() => makeListenPlanWriter(program, onSaveInputs), [program, onSaveInputs]);
  // Rewrite every coverage list (used when a role is renamed so the explicit
  // assignments follow it).
  const remapCoverageRoles = (fn: (roles: string[]) => string[]): Record<string, string[]> =>
    Object.fromEntries(Object.entries(plan.coverage).map(([area, list]) => [area, fn(list)]));
  // Assign / unassign a role to an area — the direct edit of the relationship.
  // The first edit of a derived row materialises its inferred set, then curates.
  const setAreaRoles = (area: string, nextRoles: string[]) => void writer.setAreaRoles(area, nextRoles);

  const addRole = async (raw: string) => {
    const role = raw.trim();
    if (!role || busy || !onSaveInputs) return;
    if (roles.some((r) => r.label.trim().toLowerCase() === role.toLowerCase())) { setRoleInput(""); return; }
    setBusy(true);
    try { await writer.addRole(role); setRoleInput(""); } finally { setBusy(false); }
  };

  // Rename a role. A rename is COSMETIC — it must not fire the plan's stale
  // cascade (planRev) or race the same movement bucket. So it does at most two
  // writes to DIFFERENT buckets: the Listen bucket carries the durable display
  // alias plus, if the role is an added directory person, its renamed entry;
  // the Frame bucket keeps plan.roles/coverage labelled the same. No cascade.
  const renameRole = async (from: string, to: string) => {
    const next = to.trim();
    const key = from.trim().toLowerCase();
    const currentDisplay = displayRole(program, from).trim().toLowerCase();
    if (busy || !onSaveInputs || !next || next.toLowerCase() === currentDisplay) { setEdit(null); return; }
    setBusy(true);
    try {
      // Listen bucket — set the display alias AND rename any matching directory
      // person, in ONE write so they never clobber each other.
      const rawAliases = readMovementInputs(program, "listen")._roleAliases;
      let store: Record<string, unknown> = {};
      if (typeof rawAliases === "string") { try { store = JSON.parse(rawAliases) as Record<string, unknown>; } catch { store = {}; } }
      const existing = (store[roleAliasKey(from)] && typeof store[roleAliasKey(from)] === "object") ? store[roleAliasKey(from)] as Record<string, unknown> : {};
      store[roleAliasKey(from)] = { ...existing, from, rename: next };
      const dir = readDirectoryPeople(program).map((p) =>
        p.movementId === "listen" && p.name.trim().toLowerCase() === key
          ? { ...p, name: next, role: next, roleResolved: validateProgramRole(program, next).known }
          : p);
      // Frame bucket — keep the plan's own role/coverage labels consistent. Folded
      // into the SAME write as the Listen alias/directory update (via extraInputs)
      // so the two never race each other's optimistic-version check. As an extra
      // bucket it skips the stale machinery — a cosmetic rename must not cascade.
      const extra: Record<string, Record<string, string>> = {};
      if (plan.roles.some((r) => r.trim().toLowerCase() === key) || Object.values(plan.coverage).some((list) => list.some((r) => r.trim().toLowerCase() === key))) {
        const merged: ListenPlanOverlay = {
          roles: plan.roles.map((r) => (r.trim().toLowerCase() === key ? next : r)),
          areas: plan.areas,
          coverage: remapCoverageRoles((list) => list.map((r) => (r.trim().toLowerCase() === key ? next : r))),
          dismissedAreas: plan.dismissedAreas,
        };
        extra.frame = { listenPlan: JSON.stringify(merged), _listenCoverageConfirmed: "" };
      }
      await onSaveInputs("listen", { _roleAliases: JSON.stringify(store), _directoryPeople: JSON.stringify(dir) }, { silent: true, ...(Object.keys(extra).length ? { extraInputs: extra } : {}) });
    } finally { setBusy(false); setEdit(null); }
  };

  const removeRole = async (label: string, name?: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    // Shared writer drops the operator-added directory person AND dismisses the
    // role (label + person name), so a SEEDED role leaves the cast too and
    // regeneration won't resurrect it, alongside the planRev stale cascade.
    try { await writer.removeRole({ label, name }); } finally { setBusy(false); }
  };

  const addArea = async (raw: string) => {
    const area = raw.trim();
    if (!area || busy || !onSaveInputs) return;
    if (areas.some((a) => a.label.trim().toLowerCase() === area.toLowerCase())) { setAreaInput(""); return; }
    setBusy(true);
    try { await writer.addArea(area); setAreaInput(""); } finally { setBusy(false); }
  };

  const renameArea = async (from: string, to: string) => {
    const next = to.trim();
    if (busy || !onSaveInputs || !next || next.toLowerCase() === from.toLowerCase()) { setEdit(null); return; }
    setBusy(true);
    try {
      const key = from.trim().toLowerCase();
      // The coverage map is keyed by the area's LABEL — follow the rename.
      const cov = { ...plan.coverage };
      if (Object.prototype.hasOwnProperty.call(cov, from)) { cov[next] = cov[from]; delete cov[from]; }
      await writer.writePlan({ areas: plan.areas.map((a) => (a.trim().toLowerCase() === key ? next : a)), coverage: cov });
    } finally { setBusy(false); setEdit(null); }
  };

  const removeArea = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    // Shared writer drops the area from the operator-added list, records it as
    // dismissed (so an ontology-DERIVED area can be deleted too), and clears its
    // coverage entry.
    try { await writer.removeArea(label); } finally { setBusy(false); }
  };

  const setConfirmed = (value: string) =>
    void onSaveInputs?.("frame", { _listenCoverageConfirmed: value }, { silent: true });

  const startEdit = (kind: "role" | "area", label: string) => { setEdit({ kind, key: label }); setEditValue(label); };
  const commitEdit = () => {
    if (!edit) return;
    if (edit.kind === "role") void renameRole(edit.key, editValue);
    else void renameArea(edit.key, editValue);
  };

  return (
    <section className={`v3fs-plan${confirmed ? " is-confirmed" : ""}`} aria-label="Listen plan">
      <header className="v3fs-plan-head">
        <div className="v3fs-plan-htext">
          <span className="v3fs-plan-eyebrow">Before Listen opens</span>
          <h3 className="v3fs-plan-t">The Listen plan</h3>
          <p className="v3fs-plan-sub">
            Who discovery will hear and the areas it will cover — seeded from the mandate and the draft ontology.
            Add, rename or drop your own entries; a new role joins People, and any change refreshes the Discovery Kit.
          </p>
        </div>
        <div className={`v3fs-plan-status ${confirmed ? "ok" : "pending"}`}>
          <span className="v3fs-plan-status-g" aria-hidden="true">{confirmed ? "✓" : "◇"}</span>
          {confirmed ? "Confirmed" : "Awaiting confirmation"}
        </div>
      </header>

      {/* ONE consolidated view, role-first: each PERSON we'll hear as a row and
          the AREAS they cover as chips. Full CRUD — rename/remove a person on
          their row, add below; areas are managed in the strip and assigned
          inline from the ONTOLOGY's areas, so every assignment stays bound to
          the model. */}
      <div className="v3fs-plan-panel v3fs-plan-cov v3fs-plan-cov2">
        <div className="v3fs-plan-panel-h">
          <span className="v3fs-plan-panel-t">Coverage — who we&rsquo;ll hear, and the areas they cover</span>
          <span className="v3fs-plan-count">{roleCoverage.filter((r) => !r.areas.length).length}<i>unassigned</i></span>
        </div>
        {/* Areas strip — area CRUD, FIRST so the scope of areas reads before the
            who-covers-what table below. Ontology-derived areas are bound to the
            model (marked); operator-added areas can be renamed or removed. */}
        <div className="v3fs-plan-roster">
          <div className="v3fs-plan-roster-h">
            <span className="v3fs-plan-roster-t">Areas we&rsquo;ll cover</span>
            <span className="v3fs-plan-count">{areas.length}</span>
          </div>
          {areas.length ? (
            <div className="v3fs-plan-roster-chips">
              {areas.map((a, i) => {
                const editingArea = edit?.kind === "area" && edit.key === a.label;
                return (
                  <span key={i} className={`v3fs-plan-rchip areachip${a.added ? " added" : ""}`}>
                    {editingArea ? (
                      <input ref={editRef} className="v3fs-plan-editin chip" value={editValue}
                        onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <>
                        <i className="v3fs-covmap-dot" style={{ background: areaAccent(a.label) }} aria-hidden="true" />
                        <span className="v3fs-plan-rchip-l">{a.label}</span>
                        {!a.added ? <span className="v3fs-plan-src" title="From the ontology">ontology</span> : null}
                        {onSaveInputs ? (
                          <span className="v3fs-plan-rchip-acts">
                            {/* Rename only operator-added areas; DELETE works for any. */}
                            {a.added ? <button type="button" className="v3fs-plan-act" aria-label={`Rename ${a.label}`} disabled={busy} onClick={() => startEdit("area", a.label)}>✎</button> : null}
                            <button type="button" className="v3fs-plan-act del" aria-label={`Remove ${a.label}`} disabled={busy} onClick={() => void removeArea(a.label)}>×</button>
                          </span>
                        ) : null}
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="v3fs-plan-empty">Areas appear once the ontology names them.</p>
          )}
          {onSaveInputs ? (
            <div className="v3fs-plan-add">
              <input className="v3fs-plan-addin" placeholder="Add an area — e.g. Fraud" value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)} disabled={busy}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addArea(areaInput); } }} />
              <TranscribeButton onText={(t) => setAreaInput(t.replace(/\s+/g, " ").trim())} />
              <button type="button" className="v3fs-plan-addbtn" disabled={busy || !areaInput.trim()} onClick={() => void addArea(areaInput)}>Add</button>
            </div>
          ) : null}
        </div>
        <p className="v3fs-plan-covsub">Each person we&rsquo;ll hear and the areas they cover. Assign areas inline — the picker offers the ontology&rsquo;s areas, so the plan stays bound to the model. Rename or remove a person on their row; manage areas in the strip above.</p>
        <div className="v3fs-covmap v3fs-covmap-role" role="table" aria-label="Coverage — roles and the areas they cover">
          <div className="v3fs-covmap-h" role="row"><span>Role</span><span>Areas we&rsquo;ll cover</span></div>
          {roleCoverage.map(({ role: r, areas: covered }, i) => {
            const editingRole = edit?.kind === "role" && edit.key === r.label;
            const availableAreas = areas.map((a) => a.label).filter((l) => !covered.includes(l));
            return (
              <div key={i} className={`v3fs-covmap-row${covered.length ? "" : " thin"}`} role="row">
                <span className="v3fs-covmap-area v3fs-covmap-rolecell">
                  {editingRole ? (
                    <input ref={editRef} className="v3fs-plan-editin" value={editValue}
                      onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setEdit(null); }} />
                  ) : (
                    <>
                      <span className="v3fs-plan-mono" aria-hidden="true">{monogram(displayRole(program, r.label))}</span>
                      <span className="v3fs-covmap-roletext">
                        <span className="v3fs-covmap-arean">{displayRole(program, r.label)}</span>
                        {r.name ? <em className="v3fs-covmap-rolesub">{r.name}</em> : null}
                      </span>
                      {covered.length ? null : <em className="v3fs-covmap-flag">unassigned</em>}
                      {onSaveInputs ? (
                        <span className="v3fs-covmap-areaacts">
                          {/* Rename ANY role; a seeded role renames via a durable
                              alias, an added person renames the directory entry. */}
                          <button type="button" className="v3fs-plan-act" aria-label={`Rename ${displayRole(program, r.label)}`} disabled={busy} onClick={() => { setEdit({ kind: "role", key: r.label }); setEditValue(displayRole(program, r.label)); }}>✎</button>
                          <button type="button" className="v3fs-plan-act del" aria-label={`Remove ${displayRole(program, r.label)}`} disabled={busy} onClick={() => void removeRole(r.label, r.name)}>×</button>
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                <span className="v3fs-covmap-people">
                  {covered.map((a, j) => (
                    <span key={j} className={`v3fs-covmap-chip areachip${onSaveInputs ? " editable" : ""}`}>
                      <i className="v3fs-covmap-dot" style={{ background: areaAccent(a) }} aria-hidden="true" />
                      {a}
                      {onSaveInputs ? (
                        <button type="button" className="v3fs-covmap-x" disabled={busy}
                          aria-label={`Remove ${a} from ${r.label}`}
                          onClick={() => setAreaRoles(a, areaRolesNow(a).filter((x) => x !== r.label))}>×</button>
                      ) : null}
                    </span>
                  ))}
                  {!covered.length ? <span className="v3fs-covmap-none">no areas yet</span> : null}
                  {onSaveInputs && availableAreas.length ? (
                    <select className="v3fs-covmap-add" value="" disabled={busy}
                      aria-label={`Assign an area to ${r.label}`}
                      onChange={(e) => { if (e.target.value) setAreaRoles(e.target.value, [...areaRolesNow(e.target.value), r.label]); }}>
                      <option value="">+ area</option>
                      {availableAreas.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  ) : null}
                </span>
              </div>
            );
          })}
          {/* Add a person — a new row we'll hear. */}
          {onSaveInputs ? (
            <div className="v3fs-covmap-row addrow" role="row">
              <span className="v3fs-covmap-area">
                <input className="v3fs-plan-addin" placeholder="＋ Add a person — e.g. Head of Billing" value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)} disabled={busy}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addRole(roleInput); } }} />
              </span>
              <span className="v3fs-covmap-people">
                <TranscribeButton onText={(t) => setRoleInput(t.replace(/\s+/g, " ").trim())} />
                <button type="button" className="v3fs-plan-addbtn" disabled={busy || !roleInput.trim()} onClick={() => void addRole(roleInput)}>Add person</button>
              </span>
            </div>
          ) : null}
        </div>

      </div>

      <footer className="v3fs-plan-foot">
        <span className="v3fs-plan-foot-note">
          {addedRoles ? `${addedRoles} role${addedRoles === 1 ? "" : "s"} added by you · ` : ""}
          Confirming clears the Listen gate; any later edit re-opens it and refreshes the kit.
        </span>
        {confirmed ? (
          <div className="v3fs-plan-foot-r">
            <span className="v3fs-plan-confnote">Confirmed {new Date(confirmedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <button type="button" className="v3fs-plan-btn quiet" onClick={() => setConfirmed("")}>Re-open</button>
          </div>
        ) : (
          <button type="button" className="v3fs-plan-btn pri" onClick={() => setConfirmed(new Date().toISOString())} disabled={!onSaveInputs || busy}>
            Confirm the Listen plan
          </button>
        )}
      </footer>
    </section>
  );
}
