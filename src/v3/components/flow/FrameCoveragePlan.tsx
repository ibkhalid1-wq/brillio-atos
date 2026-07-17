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
import { resolveMovementStakeholders, readDirectoryPeople, validateProgramRole, dismissedListenRoles, readListenPlan, listenPlanWrite, type ListenPlanOverlay } from "@/v3/components/flow/flowStakeholders";
import { programAreas, GENERAL_AREA, stakeholderPrimaryArea, roleAliasKey, displayRole } from "@/v3/components/flow/flowAreas";
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

  const directoryNames = useMemo(
    () => new Set(readDirectoryPeople(program).filter((p) => p.movementId === "listen").map((p) => p.name.trim().toLowerCase())),
    [program],
  );

  const roles = useMemo(() => {
    const seen = new Map<string, { label: string; name?: string; added: boolean }>();
    for (const person of resolveMovementStakeholders(program, "listen")) {
      const key = (person.role || person.name).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, {
        label: person.role || person.name,
        name: person.isRole ? undefined : person.name,
        added: directoryNames.has(person.name.trim().toLowerCase()),
      });
    }
    return [...seen.values()];
  }, [program, directoryNames]);

  const plan = useMemo(() => readListenPlan(program), [program]);
  const areaNorm = (a: string) => a.trim().toLowerCase();
  const areas = useMemo(() => {
    const dismissed = new Set(plan.dismissedAreas.map(areaNorm));
    const derived = programAreas(program).filter((a) => a && a !== GENERAL_AREA);
    const seen = new Set(derived.map((a) => a.toLowerCase()));
    const extra = plan.areas.filter((a) => !seen.has(a.toLowerCase()));
    // Operator-dismissed areas leave the plan entirely.
    return [...derived.map((a) => ({ label: a, added: false })), ...extra.map((a) => ({ label: a, added: true }))]
      .filter((a) => !dismissed.has(areaNorm(a.label)));
  }, [program, plan.areas, plan.dismissedAreas]);

  // The RELATIONSHIP between the two panels: which roles cover each area. Each
  // role's primary area is resolved once, then token-matched to the plan areas
  // (so "Vertical Sales" covers "Sales" and "Sales & Marketing"). An area no one
  // covers is flagged — the gap the plan exists to close.
  const areaTokens = (a: string) => new Set(
    a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !["and", "the", "of", "amp"].includes(t)));
  const rolePrimary = useMemo(
    () => roles.map((r) => ({ label: r.label, area: stakeholderPrimaryArea(program, r.name || r.label, r.label) })),
    [program, roles],
  );
  const areaCoverage = useMemo(() => areas.map((a) => {
    // An area the operator has hand-curated uses its EXPLICIT list (even if
    // empty — a deliberate "no one"); otherwise fall back to the title-inferred
    // match. `explicit` drives whether the row shows remove-controls.
    const explicit = plan.coverage[a.label];
    if (explicit) return { area: a.label, roles: explicit, explicit: true, added: a.added };
    const at = areaTokens(a.label);
    const covering = rolePrimary.filter((rp) => [...areaTokens(rp.area)].some((t) => at.has(t))).map((rp) => rp.label);
    return { area: a.label, roles: [...new Set(covering)], explicit: false, added: a.added };
  }), [areas, rolePrimary, plan.coverage]);
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

  // Persist a plan change to the fingerprinted `listenPlan` field — this is what
  // stales the Discovery Kit — and re-open confirmation, since the scope moved.
  // Accepts a PARTIAL overlay merged onto the current plan, so a coverage edit
  // never has to restate roles/areas (and vice-versa). It ALSO stamps a
  // `planRev` into the Listen, Envision and Show buckets: a non-underscore key,
  // so it shifts each movement's input fingerprint and marks their artifacts
  // stale — the Listen model and the whole Prototype now require regeneration
  // against the new plan. The edge re-stamps it on regen, clearing the flag.
  // ONE atomic write. The Frame bucket carries the new plan + reset confirmation;
  // the planRev stamp rides into Listen/Envision/Show via `extraInputs` so all
  // four buckets land in a SINGLE optimistic-version check. (Sequential writes
  // raced their own predecessor's version → ConflictError flood.) `listenExtra`
  // lets a caller fold Listen-bucket inputs — directory people, dismissals — into
  // the same write instead of a separate racing call.
  const writePlan = async (next: Partial<ListenPlanOverlay>, listenExtra?: Record<string, string>) => {
    const merged: ListenPlanOverlay = { roles: plan.roles, areas: plan.areas, coverage: plan.coverage, dismissedAreas: plan.dismissedAreas, ...next };
    const { frame, planRev } = listenPlanWrite(merged);
    await onSaveInputs?.(
      "frame",
      frame,
      { silent: true, extraInputs: {
        listen: { planRev, ...(listenExtra ?? {}) },
        envision: { planRev },
        show: { planRev },
      } },
    );
  };
  // Rewrite every coverage list (used when a role is renamed or removed so the
  // explicit assignments follow it).
  const remapCoverageRoles = (fn: (roles: string[]) => string[]): Record<string, string[]> =>
    Object.fromEntries(Object.entries(plan.coverage).map(([area, list]) => [area, fn(list)]));
  // Assign / unassign a role to an area — the direct edit of the relationship.
  // The first edit of a derived row materialises its inferred set, then curates.
  const setAreaRoles = (area: string, nextRoles: string[]) =>
    void writePlan({ coverage: { ...plan.coverage, [area]: [...new Set(nextRoles)] } });

  const dirEntry = (role: string) => ({
    id: `dp-${Date.now().toString(36)}-${role.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
    name: role, role, email: undefined, movementId: "listen", roleResolved: validateProgramRole(program, role).known,
  });

  const addRole = async (raw: string) => {
    const role = raw.trim();
    if (!role || busy || !onSaveInputs) return;
    if (roles.some((r) => r.label.trim().toLowerCase() === role.toLowerCase())) { setRoleInput(""); return; }
    setBusy(true);
    try {
      // Single write: the new directory person rides the same call as the plan
      // update (via listenExtra), so they never race each other's version check.
      await writePlan(
        { roles: [...plan.roles, role], areas: plan.areas },
        { _directoryPeople: JSON.stringify([...readDirectoryPeople(program), dirEntry(role)]) },
      );
      setRoleInput("");
    } finally { setBusy(false); }
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
    try {
      const key = label.trim().toLowerCase();
      // Drop any operator-added directory person by this name…
      const dir = readDirectoryPeople(program).filter((p) => !(p.movementId === "listen" && p.name.trim().toLowerCase() === key));
      // …AND dismiss the role, so a SEEDED role (from the kit or ontology — e.g.
      // "Customer Success Manager") also leaves the cast and regeneration won't
      // resurrect it. Dismiss both its role label and its person name.
      const dismissed = new Set(dismissedListenRoles(program));
      dismissed.add(key);
      if (name && name.trim()) dismissed.add(name.trim().toLowerCase());
      // Single write: the Listen dismissal/directory drop rides writePlan's own
      // call (via listenExtra) alongside the planRev cascade — removing a role
      // moves scope, so the downstream artifacts SHOULD stale.
      await writePlan(
        {
          roles: plan.roles.filter((r) => r.trim().toLowerCase() !== key),
          coverage: remapCoverageRoles((list) => list.filter((r) => r.trim().toLowerCase() !== key)),
        },
        {
          _directoryPeople: JSON.stringify(dir),
          _dismissedListenRoles: JSON.stringify([...dismissed]),
        },
      );
    } finally { setBusy(false); }
  };

  const addArea = async (raw: string) => {
    const area = raw.trim();
    if (!area || busy || !onSaveInputs) return;
    if (areas.some((a) => a.label.trim().toLowerCase() === area.toLowerCase())) { setAreaInput(""); return; }
    setBusy(true);
    try { await writePlan({ roles: plan.roles, areas: [...plan.areas, area] }); setAreaInput(""); }
    finally { setBusy(false); }
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
      await writePlan({ areas: plan.areas.map((a) => (a.trim().toLowerCase() === key ? next : a)), coverage: cov });
    } finally { setBusy(false); setEdit(null); }
  };

  const removeArea = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    const cov = { ...plan.coverage };
    delete cov[label];
    // Drop from the operator-added list AND record it as dismissed, so an
    // ontology-DERIVED area can be deleted too (it won't re-derive into the plan).
    const dismissed = [...new Set([...plan.dismissedAreas, label.trim()])];
    try { await writePlan({ areas: plan.areas.filter((a) => a.trim().toLowerCase() !== label.trim().toLowerCase()), coverage: cov, dismissedAreas: dismissed }); }
    finally { setBusy(false); }
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
