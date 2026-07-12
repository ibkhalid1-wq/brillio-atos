/**
 * The board pack — the programme as a sponsor reads it, one printable page
 * set. Everything here is the same derived truth the shell shows (readers,
 * never copies): mandate, the one metric, coverage, verdicts, gate states,
 * realised benefits, and the trail's tail. Opened as an overlay; the print
 * stylesheet strips the app and keeps the paper.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import {
  flowMovements, movementArtifacts, gateChecklist, gateReadiness,
  listenCoverage, demoAcceptance, daysToFirstDemo, wordsOfEvidence, frameKpis,
  readMovementInputs, parseGridRows,
} from "@/v3/components/flow/flowShellData";
import { listFlowAttestations, listOpenFlowDecisions } from "@/v3/components/flow/flowDecisions";
import { useFocusTrap } from "@/v3/lib/useFocusTrap";

export default function FlowBoardPack({ program, onMintBrief, onClose }: {
  program: ProgramSummary;
  /** Mint a dated, token-gated snapshot of this pack; resolves to the URL. */
  onMintBrief?: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [shareState, setShareState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const share = async () => {
    if (!onMintBrief) return;
    setShareState("busy");
    const link = await onMintBrief();
    if (!link) { setShareState("failed"); return; }
    try { await navigator.clipboard.writeText(link); } catch { /* the attest trail still holds the mint */ }
    setShareState("copied");
    window.setTimeout(() => setShareState("idle"), 2500);
  };
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const movements = useMemo(() => flowMovements(), []);
  const frame = readMovementInputs(program, "frame");
  const days = daysToFirstDemo(program);
  const coverage = listenCoverage(program);
  const demos = demoAcceptance(program);
  const words = wordsOfEvidence(program);
  const kpis = frameKpis(program);
  const benefits = parseGridRows(readMovementInputs(program, "evolve").realisedBenefits);
  const waiting = listOpenFlowDecisions(program).length;
  const trail = listFlowAttestations(program).slice(0, 6);
  const gates = movements.map((movement) => {
    const artifacts = movementArtifacts(program, movement);
    const readiness = gateReadiness(program, movement, artifacts, gateChecklist(program, movement, artifacts));
    return { movement, readiness };
  });

  return (
    <>
      <div className="v3fs-doc-backdrop v3fs-pack-layer" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} tabIndex={-1} className="v3fs-pack" role="dialog" aria-modal="true" aria-label="Board pack">
        <header className="v3fs-pack-bar">
          <span>Board pack — built from live data, {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</span>
          <span className="v3fs-pack-bar-a">
            {onMintBrief ? (
              <button type="button" className="v3fs-btn" disabled={shareState === "busy"} onClick={() => void share()}>
                {shareState === "busy" ? "Minting\u2026" : shareState === "copied" ? "Link copied \u2713" : shareState === "failed" ? "Could not mint" : "Share a sponsor link"}
              </button>
            ) : null}
            <button type="button" className="v3fs-btn pri" onClick={() => window.print()}>Print / save as PDF</button>
            <button type="button" className="v3fs-btn" onClick={onClose}>Close</button>
          </span>
        </header>

        <div className="v3fs-pack-page">
          <div className="v3fs-pack-eyebrow">ATOS Flow · Board pack</div>
          <h1>{program.name}</h1>
          {program.client ? <div className="v3fs-pack-client">{program.client}</div> : null}

          <section>
            <h2>The mandate</h2>
            <p>{String(frame.businessObjective ?? "") || "Objective not yet on record."}</p>
            <div className="v3fs-pack-facts">
              {typeof frame.sponsor === "string" && frame.sponsor ? <div><b>Sponsor</b><span>{frame.sponsor}</span></div> : null}
              {typeof frame.industry === "string" && frame.industry ? <div><b>Industry</b><span>{frame.industry}</span></div> : null}
              {days != null ? <div><b>First demonstration</b><span>{days} days away</span></div> : null}
            </div>
          </section>

          <section>
            <h2>The numbers</h2>
            <div className="v3fs-pack-stats">
              <div><b>{coverage.done}/{coverage.total || "—"}</b><span>voices heard</span></div>
              <div><b>{demos.accepted}/{demos.total || "—"}</b><span>demos accepted</span></div>
              <div><b>{words.toLocaleString()}</b><span>words of evidence</span></div>
              <div><b>{waiting}</b><span>decisions waiting</span></div>
            </div>
          </section>

          {kpis.length ? (
            <section>
              <h2>Success measures</h2>
              <table className="v3fs-pack-table">
                <thead><tr><th>Measure</th><th>Baseline</th><th>Target</th></tr></thead>
                <tbody>
                  {kpis.map((kpi, index) => (
                    <tr key={index}><td>{kpi.name}</td><td>{kpi.baseline || "—"}</td><td>{kpi.target || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section>
            <h2>Where the engagement stands</h2>
            <div className="v3fs-pack-gates">
              {gates.map(({ movement, readiness }) => (
                <div key={movement.id} className={`v3fs-pack-gate ${readiness.tone}`}>
                  <b>{movement.displayName}</b>
                  <span>{readiness.headline}{readiness.detail ? ` — ${readiness.detail}` : ""}</span>
                </div>
              ))}
            </div>
          </section>

          {demos.rows.length ? (
            <section>
              <h2>Verdicts, person by person</h2>
              <table className="v3fs-pack-table">
                <thead><tr><th>Stakeholder</th><th>Verdict</th><th>Reaction</th></tr></thead>
                <tbody>
                  {demos.rows.map((row, index) => (
                    <tr key={index}><td>{row.stakeholder || "—"}</td><td>{row.verdict || "Pending"}</td><td>{row.reaction || ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {benefits.length ? (
            <section>
              <h2>Realised benefits</h2>
              <table className="v3fs-pack-table">
                <thead><tr><th>Benefit</th><th>Baseline</th><th>Current</th><th>Target</th></tr></thead>
                <tbody>
                  {benefits.map((row, index) => (
                    <tr key={index}><td>{row.benefit || "—"}</td><td>{row.baseline || "—"}</td><td>{row.current || "—"}</td><td>{row.target || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section>
            <h2>Latest on the record</h2>
            {trail.map((entry, index) => (
              <div key={index} className="v3fs-pack-trail">
                <span>{entry.action}</span>
                <em>{new Date(entry.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</em>
              </div>
            ))}
          </section>

          <footer className="v3fs-pack-foot">
            Built live from the programme's data — every number here traces back to evidence, documents and decisions in ATOS Flow.
          </footer>
        </div>
      </div>
    </>
  );
}
