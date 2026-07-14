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
import { resolveMovementStakeholders, readDirectoryPeople, validateProgramRole } from "@/v3/components/flow/flowStakeholders";
import { programAreas, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { TranscribeButton } from "@/v3/components/flow/flowCapture";

interface PlanOverlay { roles: string[]; areas: string[] }
type EditTarget = { kind: "role" | "area"; key: string } | null;

function readPlan(program: ProgramSummary): PlanOverlay {
  const raw = readMovementInputs(program, "frame").listenPlan;
  if (typeof raw !== "string" || !raw.trim()) return { roles: [], areas: [] };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      roles: Array.isArray(p.roles) ? p.roles.map(String).map((s) => s.trim()).filter(Boolean) : [],
      areas: Array.isArray(p.areas) ? p.areas.map(String).map((s) => s.trim()).filter(Boolean) : [],
    };
  } catch { return { roles: [], areas: [] }; }
}

function monogram(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

export default function FrameCoveragePlan({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void> | void;
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

  const plan = useMemo(() => readPlan(program), [program]);
  const areas = useMemo(() => {
    const derived = programAreas(program).filter((a) => a && a !== GENERAL_AREA);
    const seen = new Set(derived.map((a) => a.toLowerCase()));
    const extra = plan.areas.filter((a) => !seen.has(a.toLowerCase()));
    return [...derived.map((a) => ({ label: a, added: false })), ...extra.map((a) => ({ label: a, added: true }))];
  }, [program, plan.areas]);

  const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
  const confirmed = confirmedAt.length > 0;
  const addedRoles = roles.filter((r) => r.added).length;

  // Persist a plan change to the fingerprinted `listenPlan` field — this is what
  // stales the Discovery Kit — and re-open confirmation, since the scope moved.
  const writePlan = (next: PlanOverlay) =>
    onSaveInputs?.("frame", { listenPlan: JSON.stringify(next), _listenCoverageConfirmed: "" }, { silent: true });

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
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify([...readDirectoryPeople(program), dirEntry(role)]) }, { silent: true });
      await writePlan({ roles: [...plan.roles, role], areas: plan.areas });
      setRoleInput("");
    } finally { setBusy(false); }
  };

  const renameRole = async (from: string, to: string) => {
    const next = to.trim();
    if (busy || !onSaveInputs || !next || next.toLowerCase() === from.toLowerCase()) { setEdit(null); return; }
    setBusy(true);
    try {
      const key = from.trim().toLowerCase();
      const dir = readDirectoryPeople(program).map((p) =>
        p.movementId === "listen" && p.name.trim().toLowerCase() === key
          ? { ...p, name: next, role: next, roleResolved: validateProgramRole(program, next).known }
          : p);
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify(dir) }, { silent: true });
      await writePlan({ roles: plan.roles.map((r) => (r.trim().toLowerCase() === key ? next : r)), areas: plan.areas });
    } finally { setBusy(false); setEdit(null); }
  };

  const removeRole = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    try {
      const key = label.trim().toLowerCase();
      const dir = readDirectoryPeople(program).filter((p) => !(p.movementId === "listen" && p.name.trim().toLowerCase() === key));
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify(dir) }, { silent: true });
      await writePlan({ roles: plan.roles.filter((r) => r.trim().toLowerCase() !== key), areas: plan.areas });
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
      await writePlan({ roles: plan.roles, areas: plan.areas.map((a) => (a.trim().toLowerCase() === key ? next : a)) });
    } finally { setBusy(false); setEdit(null); }
  };

  const removeArea = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    try { await writePlan({ roles: plan.roles, areas: plan.areas.filter((a) => a.trim().toLowerCase() !== label.trim().toLowerCase()) }); }
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

      <div className="v3fs-plan-grid">
        {/* Roles ------------------------------------------------------------- */}
        <div className="v3fs-plan-panel">
          <div className="v3fs-plan-panel-h">
            <span className="v3fs-plan-panel-t">Who we&apos;ll hear</span>
            <span className="v3fs-plan-count">{roles.length}<i>roles</i></span>
          </div>
          {roles.length ? (
            <ul className="v3fs-plan-roles">
              {roles.map((r, i) => {
                const editing = edit?.kind === "role" && edit.key === r.label;
                return (
                  <li key={i} className={r.added ? "added" : ""}>
                    <span className="v3fs-plan-mono" aria-hidden="true">{monogram(r.label)}</span>
                    {editing ? (
                      <input ref={editRef} className="v3fs-plan-editin" value={editValue}
                        onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <span className="v3fs-plan-roletext">
                        <span className="v3fs-plan-role">{r.label}</span>
                        {r.name ? <span className="v3fs-plan-name">{r.name}</span> : null}
                      </span>
                    )}
                    {r.added ? (
                      !editing ? (
                        <span className="v3fs-plan-acts">
                          <button type="button" className="v3fs-plan-act" aria-label={`Rename ${r.label}`} disabled={busy}
                            onClick={() => startEdit("role", r.label)}>✎</button>
                          <button type="button" className="v3fs-plan-act del" aria-label={`Remove ${r.label}`} disabled={busy}
                            onClick={() => void removeRole(r.label)}>×</button>
                        </span>
                      ) : null
                    ) : (
                      <span className="v3fs-plan-src">from discovery</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="v3fs-plan-empty">Roles seed from the ontology&apos;s people once the mandate is captured.</p>
          )}
          <div className="v3fs-plan-add">
            <input className="v3fs-plan-addin" placeholder="Add a role — e.g. Head of Billing" value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addRole(roleInput); } }} />
            <TranscribeButton onText={(t) => setRoleInput(t.replace(/\s+/g, " ").trim())} />
            <button type="button" className="v3fs-plan-addbtn" disabled={busy || !roleInput.trim()} onClick={() => void addRole(roleInput)}>Add</button>
          </div>
        </div>

        {/* Areas ------------------------------------------------------------- */}
        <div className="v3fs-plan-panel">
          <div className="v3fs-plan-panel-h">
            <span className="v3fs-plan-panel-t">What we&apos;ll cover</span>
            <span className="v3fs-plan-count">{areas.length}<i>areas</i></span>
          </div>
          {areas.length ? (
            <ul className="v3fs-plan-chips">
              {areas.map((a, i) => {
                const editing = edit?.kind === "area" && edit.key === a.label;
                return (
                  <li key={i} className={`v3fs-plan-chip${a.added ? " added" : ""}`}>
                    {editing ? (
                      <input ref={editRef} className="v3fs-plan-editin chip" value={editValue}
                        onChange={(e) => setEditValue(e.target.value)} onBlur={commitEdit}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } if (e.key === "Escape") setEdit(null); }} />
                    ) : (
                      <>
                        <span>{a.label}</span>
                        {a.added ? (
                          <span className="v3fs-plan-chipacts">
                            <button type="button" className="v3fs-plan-act" aria-label={`Rename ${a.label}`} disabled={busy}
                              onClick={() => startEdit("area", a.label)}>✎</button>
                            <button type="button" className="v3fs-plan-act del" aria-label={`Remove ${a.label}`} disabled={busy}
                              onClick={() => void removeArea(a.label)}>×</button>
                          </span>
                        ) : null}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="v3fs-plan-empty">Areas appear once the ontology names them.</p>
          )}
          <div className="v3fs-plan-add">
            <input className="v3fs-plan-addin" placeholder="Add an area — e.g. Fraud" value={areaInput}
              onChange={(e) => setAreaInput(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addArea(areaInput); } }} />
            <TranscribeButton onText={(t) => setAreaInput(t.replace(/\s+/g, " ").trim())} />
            <button type="button" className="v3fs-plan-addbtn" disabled={busy || !areaInput.trim()} onClick={() => void addArea(areaInput)}>Add</button>
          </div>
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
