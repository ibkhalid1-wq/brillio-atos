/**
 * The Show cockpit — the validation theater as a scannable OVERVIEW, the mirror
 * of the Envision build studio. Show is where CLIENTS validate the prototype the
 * delivery team built: PROTOTYPE (the built app, openable inline) → TOURED (every
 * voice has seen their workflow run) → ACCEPTED (every verdict is in; the demo is
 * the gate). Projected from the record; the per-stakeholder demo links live on
 * the collect board below.
 */
import { useMemo, useState } from "react";
import { demoAcceptance } from "@/v3/components/flow/flowShellData";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { movementValidationCoverage } from "@/v3/components/flow/flowPortal";
import { loopState } from "@/v3/components/flow/flowLoop";
import type { ProgramSummary } from "@/new/types";

function verdictTone(v: string): "ok" | "part" | "obj" | "pending" {
  if (/objection/i.test(v)) return "obj";
  if (/with changes/i.test(v)) return "part";
  if (/accepted/i.test(v)) return "ok";
  return "pending";
}

export default function ShowCockpit({ program, onOpenDesign }: {
  program: ProgramSummary;
  /** Switch to Design mode and open the Prototype workspace. */
  onOpenDesign?: () => void;
}) {
  const tour = useMemo(() => demoAcceptance(program), [program]);
  const coverage = useMemo(() => movementValidationCoverage(program, "show").filter((r) => r.validated || r.waiting), [program]);
  const html = useMemo(() => {
    const pb = readArtifactDoc(program, "prototypeBuild");
    return pb ? String(pb.html ?? "") : "";
  }, [program]);
  const [showProto, setShowProto] = useState(false);
  const ls = useMemo(() => loopState(program), [program]);

  if (!tour.total && !html && !coverage.length) return null;

  const pending = tour.rows.filter((r) => !r.verdict || /pending/i.test(r.verdict)).length;
  const objections = tour.rows.filter((r) => /objection/i.test(r.verdict ?? "")).length;
  const acts = [
    { label: "Prototype", done: !!html, hint: html ? "built & ready" : "not built yet" },
    { label: "Toured", done: tour.total > 0 && pending === 0, hint: tour.total ? `${tour.total - pending}/${tour.total} seen` : "no demos yet" },
    { label: "Approved", done: ls.converged, hint: tour.total ? `${ls.accepted}/${ls.total}${ls.converged ? " · sponsor+majority ✓" : " · need sponsor+majority"}` : "awaiting verdicts" },
  ];

  return (
    <div className="v3fs-envc v3fs-showc">
      <div className="v3fs-envc-ribbon">
        {acts.map((a, i) => (
          <div key={a.label} className={`v3fs-envc-rstep${a.done ? " done" : ""}`}>
            <span className="v3fs-envc-rn">{a.done ? "✓" : i + 1}</span>
            <span className="v3fs-envc-rl">{a.label}<em>{a.hint}</em></span>
          </div>
        ))}
      </div>

      {/* Loop status — which court the ball is in this iteration. */}
      {ls.hasPrototype ? (
        <div className={`v3fs-showc-loop ${ls.court}`} role="status">
          <span className="v3fs-showc-loop-r">Iteration {ls.round}</span>
          <span className="v3fs-showc-loop-t">
            {ls.court === "converged"
              ? "✓ Approved — sponsor + majority accepted. Ready to ship."
              : ls.court === "design"
                ? `${ls.openRequests} change${ls.openRequests === 1 ? "" : "s"} sent back to Design — rebuild, then re-share the prototype.`
                : `Awaiting verdicts — ${ls.accepted}/${ls.total} approved so far.`}
          </span>
        </div>
      ) : null}

      {/* ── THE PROTOTYPE ─────────────────────────────────────────────────── */}
      <section className="v3fs-envc-act">
        <div className="v3fs-envc-ah"><span className="v3fs-envc-an">▶</span>The prototype — what every stakeholder validates
          {html ? <button type="button" className="v3fs-a v3fs-envc-open" onClick={() => setShowProto((v) => !v)}>{showProto ? "hide it ▲" : "open it ▼"}</button> : null}</div>
        {html ? (
          showProto ? <iframe className="v3fs-proto-frame" sandbox="allow-scripts allow-forms" srcDoc={html} title="Prototype" /> : (
            <div className="v3fs-showc-protohint">✓ Built in Envision. Open it here, or each stakeholder walks it on their own seeded data via their demo link below.</div>
          )
        ) : (
          <div className="v3fs-showc-noproto">
            The prototype is built in Envision — Show demonstrates it.
            {onOpenDesign ? <button type="button" className="v3fs-a" onClick={onOpenDesign}> build it in Design →</button> : null}
          </div>
        )}
      </section>

      {/* ── VALIDATION ────────────────────────────────────────────────────── */}
      <section className="v3fs-envc-act">
        <div className="v3fs-envc-ah"><span className="v3fs-envc-an">✓</span>Validation — each area signs off on its own</div>
        {ls.areas.length > 1 ? (
          <div className="v3fs-showc-areas">
            {ls.areas.map((a) => (
              <span key={a.area} className={`v3fs-showc-area${a.converged ? " ok" : a.objections ? " obj" : a.pending < a.total ? " part" : " open"}`}
                title={`${a.accepted} accepted · ${a.changes} changes · ${a.objections} objection · ${a.pending} pending`}>
                <b>{a.area}</b> {a.converged ? "✓ signed off" : `${a.accepted}/${a.total}${a.objections ? ` · ${a.objections}⚠` : a.pending ? ` · ${a.pending}◷` : ""}`}
              </span>
            ))}
          </div>
        ) : null}
        {tour.rows.length ? (
          <ul className="v3fs-showc-verdicts">
            {tour.rows.map((r, i) => (
              <li key={i} className={`v3fs-showc-v ${verdictTone(r.verdict ?? "")}`}>
                <b>{r.stakeholder || "—"}</b>
                <em>{r.verdict || "Pending"}</em>
                {r.reaction ? <span>{r.reaction}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="v3fs-showc-empty">No demo verdicts yet — each stakeholder records one after watching their own workflow run in the prototype.</p>
        )}
        {objections ? <div className="v3fs-showc-obj">⚠ {objections} objection{objections === 1 ? "" : "s"} to resolve before the gate.</div> : null}
      </section>
    </div>
  );
}
