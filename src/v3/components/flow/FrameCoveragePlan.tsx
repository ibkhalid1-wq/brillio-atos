/**
 * Frame's coverage plan — the bridge from the sponsor mandate into Listen.
 *
 * Frame no longer asks the operator to hand-type structured facts; the mandate
 * comes from the sponsor conversation and the draft ontology. What Frame DOES
 * still need is a human nod that discovery is aimed right: the roles Listen will
 * hear and the business areas it will cover. This panel shows both — derived,
 * not authored — and records a single confirmation before Listen opens.
 */
import { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { programAreas, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { readMovementInputs } from "@/v3/components/flow/flowShellData";

export default function FrameCoveragePlan({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void> | void;
}) {
  // The people Listen will interview, deduped to distinct roles — a bound name
  // rides along when the role is filled, so "Head of Referral Ops · Dana" reads
  // as a person, not a placeholder.
  const roles = useMemo(() => {
    const seen = new Map<string, { role: string; name?: string }>();
    for (const person of resolveMovementStakeholders(program, "listen")) {
      const key = (person.role || person.name).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, { role: person.role || person.name, name: person.isRole ? undefined : person.name });
    }
    return [...seen.values()];
  }, [program]);

  const areas = useMemo(
    () => programAreas(program).filter((area) => area && area !== GENERAL_AREA),
    [program],
  );

  const confirmedAt = String(readMovementInputs(program, "frame")._listenCoverageConfirmed ?? "").trim();
  const confirmed = confirmedAt.length > 0;

  // Nothing derived yet — the sponsor conversation hasn't seeded people or an
  // ontology, so there's no plan to confirm. Stay silent rather than show an
  // empty ceremony.
  if (!roles.length && !areas.length) return null;

  const setConfirmed = (value: string) =>
    void onSaveInputs?.("frame", { _listenCoverageConfirmed: value }, { silent: true });

  return (
    <section className={`v3fs-coverage${confirmed ? " is-confirmed" : ""}`} aria-label="Listen coverage plan">
      <header className="v3fs-coverage-h">
        <div className="v3fs-coverage-htext">
          <span className="v3fs-coverage-eyebrow">Before Listen opens</span>
          <h4 className="v3fs-coverage-t">Who we&apos;ll hear · what we&apos;ll cover</h4>
          <p className="v3fs-coverage-sub">
            Drawn from the sponsor mandate and the draft ontology. Confirm the plan is right — add
            anyone missing on their Listen card, or refine the areas in the ontology.
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
                  <span className="v3fs-coverage-role">{r.role}</span>
                  {r.name ? <span className="v3fs-coverage-name">{r.name}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="v3fs-coverage-empty">Roles seed from the ontology&apos;s people once the mandate is captured.</p>
          )}
        </div>
        <div className="v3fs-coverage-col">
          <div className="v3fs-coverage-label">Coverage areas<span>{areas.length}</span></div>
          {areas.length ? (
            <ul className="v3fs-coverage-chips">
              {areas.map((a, i) => <li key={i} className="v3fs-coverage-chip">{a}</li>)}
            </ul>
          ) : (
            <p className="v3fs-coverage-empty">Areas appear once the ontology names them.</p>
          )}
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
          <button type="button" className="v3fs-btn pri" onClick={() => setConfirmed(new Date().toISOString())} disabled={!onSaveInputs}>
            Confirm the Listen plan
          </button>
        )}
      </div>
    </section>
  );
}
