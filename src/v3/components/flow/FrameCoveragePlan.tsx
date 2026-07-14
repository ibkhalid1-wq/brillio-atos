/**
 * Frame's coverage plan — the bridge from the sponsor mandate into Listen.
 *
 * Frame no longer asks the operator to hand-type structured facts; the mandate
 * comes from the sponsor conversation and the draft ontology. What Frame DOES
 * still own is the discovery plan: the roles Listen will hear and the business
 * areas it will cover. This panel shows both — seeded from the kit and ontology —
 * and lets the operator ADD or drop roles and areas (by keyboard or voice).
 *
 * Two invariants keep the plan honest:
 *  - a new role becomes a real Person (written to the People roster), so it flows
 *    into Listen's collection like any other voice;
 *  - editing the plan re-opens the confirmation AND touches a fingerprinted frame
 *    field (`listenPlan`), so the Discovery Kit — a Frame artifact — goes stale
 *    and asks to regenerate against the new scope.
 */
import { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { resolveMovementStakeholders, readDirectoryPeople, validateProgramRole } from "@/v3/components/flow/flowStakeholders";
import { programAreas, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";
import { TranscribeButton } from "@/v3/components/flow/flowCapture";

interface PlanOverlay { roles: string[]; areas: string[] }

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

export default function FrameCoveragePlan({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void> | void;
}) {
  const [roleInput, setRoleInput] = useState("");
  const [areaInput, setAreaInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Operator-added roles are the directory people the operator attached to
  // Listen; everything else in the resolved set is derived (kit personas,
  // roster voices, the sponsor).
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
    return [
      ...derived.map((a) => ({ label: a, added: false })),
      ...extra.map((a) => ({ label: a, added: true })),
    ];
  }, [program, plan.areas]);

  const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
  const confirmed = confirmedAt.length > 0;

  if (!roles.length && !areas.length) return null;

  // Persist a plan change to the fingerprinted `listenPlan` field — this is what
  // stales the Discovery Kit — and always re-open confirmation, since the scope
  // the operator confirmed has moved.
  const writePlan = (next: PlanOverlay) =>
    onSaveInputs?.("frame", { listenPlan: JSON.stringify(next), _listenCoverageConfirmed: "" }, { silent: true });

  const addRole = async (raw: string) => {
    const role = raw.trim();
    if (!role || busy || !onSaveInputs) return;
    setBusy(true);
    try {
      const resolved = validateProgramRole(program, role).known;
      const entry = {
        id: `dp-${Date.now().toString(36)}-${role.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
        name: role, role, email: undefined, movementId: "listen", roleResolved: resolved,
      };
      // 1) becomes a real Person on the roster …
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify([...readDirectoryPeople(program), entry]) }, { silent: true });
      // 2) … and lands in the plan, staling the kit + re-opening confirmation.
      await writePlan({ roles: [...plan.roles, role], areas: plan.areas });
      setRoleInput("");
    } finally { setBusy(false); }
  };

  const removeRole = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    try {
      const key = label.trim().toLowerCase();
      const nextDir = readDirectoryPeople(program).filter((p) => !(p.movementId === "listen" && p.name.trim().toLowerCase() === key));
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify(nextDir) }, { silent: true });
      await writePlan({ roles: plan.roles.filter((r) => r.trim().toLowerCase() !== key), areas: plan.areas });
    } finally { setBusy(false); }
  };

  const addArea = async (raw: string) => {
    const area = raw.trim();
    if (!area || busy || !onSaveInputs) return;
    const exists = areas.some((a) => a.label.trim().toLowerCase() === area.toLowerCase());
    if (exists) { setAreaInput(""); return; }
    setBusy(true);
    try { await writePlan({ roles: plan.roles, areas: [...plan.areas, area] }); setAreaInput(""); }
    finally { setBusy(false); }
  };

  const removeArea = async (label: string) => {
    if (busy || !onSaveInputs) return;
    setBusy(true);
    try { await writePlan({ roles: plan.roles, areas: plan.areas.filter((a) => a.trim().toLowerCase() !== label.trim().toLowerCase()) }); }
    finally { setBusy(false); }
  };

  const setConfirmed = (value: string) =>
    void onSaveInputs?.("frame", { _listenCoverageConfirmed: value }, { silent: true });

  return (
    <section className={`v3fs-coverage${confirmed ? " is-confirmed" : ""}`} aria-label="Listen coverage plan">
      <header className="v3fs-coverage-h">
        <div className="v3fs-coverage-htext">
          <span className="v3fs-coverage-eyebrow">Before Listen opens</span>
          <h4 className="v3fs-coverage-t">Who we&apos;ll hear · what we&apos;ll cover</h4>
          <p className="v3fs-coverage-sub">
            Seeded from the sponsor mandate and the draft ontology. Add or drop roles and areas —
            a new role joins People, and any change refreshes the Discovery Kit and asks you to re-confirm.
          </p>
        </div>
        {confirmed ? <span className="v3fs-coverage-badge">✓ Confirmed</span> : null}
      </header>

      <div className="v3fs-coverage-cols">
        <div className="v3fs-coverage-col">
          <div className="v3fs-coverage-label">Listen roles<span>{roles.length}</span></div>
          {roles.length ? (
            <ul className="v3fs-coverage-roles">
              {roles.map((r, i) => (
                <li key={i}>
                  <span className="v3fs-coverage-roletext">
                    <span className="v3fs-coverage-role">{r.label}</span>
                    {r.name ? <span className="v3fs-coverage-name">{r.name}</span> : null}
                  </span>
                  {r.added ? (
                    <button type="button" className="v3fs-coverage-x" aria-label={`Remove ${r.label}`} disabled={busy}
                      onClick={() => void removeRole(r.label)}>×</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="v3fs-coverage-empty">Roles seed from the ontology&apos;s people once the mandate is captured.</p>
          )}
          <div className="v3fs-coverage-add">
            <input className="v3fs-coverage-input" placeholder="Add a role — e.g. Head of Billing" value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addRole(roleInput); } }} />
            <TranscribeButton onText={(t) => setRoleInput(t.replace(/\s+/g, " ").trim())} />
            <button type="button" className="v3fs-btn sm" disabled={busy || !roleInput.trim()} onClick={() => void addRole(roleInput)}>Add</button>
          </div>
        </div>

        <div className="v3fs-coverage-col">
          <div className="v3fs-coverage-label">Coverage areas<span>{areas.length}</span></div>
          {areas.length ? (
            <ul className="v3fs-coverage-chips">
              {areas.map((a, i) => (
                <li key={i} className={`v3fs-coverage-chip${a.added ? " added" : ""}`}>
                  {a.label}
                  {a.added ? (
                    <button type="button" className="v3fs-coverage-x" aria-label={`Remove ${a.label}`} disabled={busy}
                      onClick={() => void removeArea(a.label)}>×</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="v3fs-coverage-empty">Areas appear once the ontology names them.</p>
          )}
          <div className="v3fs-coverage-add">
            <input className="v3fs-coverage-input" placeholder="Add an area — e.g. Fraud" value={areaInput}
              onChange={(e) => setAreaInput(e.target.value)} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addArea(areaInput); } }} />
            <TranscribeButton onText={(t) => setAreaInput(t.replace(/\s+/g, " ").trim())} />
            <button type="button" className="v3fs-btn sm" disabled={busy || !areaInput.trim()} onClick={() => void addArea(areaInput)}>Add</button>
          </div>
        </div>
      </div>

      <div className="v3fs-coverage-foot">
        {confirmed ? (
          <>
            <span className="v3fs-coverage-note">
              Confirmed {new Date(confirmedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} — Listen is cleared to open.
            </span>
            <button type="button" className="v3fs-btn quiet" onClick={() => setConfirmed("")}>Re-open</button>
          </>
        ) : (
          <button type="button" className="v3fs-btn pri" onClick={() => setConfirmed(new Date().toISOString())} disabled={!onSaveInputs || busy}>
            Confirm the Listen plan
          </button>
        )}
      </div>
    </section>
  );
}
