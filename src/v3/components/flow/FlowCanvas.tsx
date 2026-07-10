import React, { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts,
  gateSignal, listenCoverage, type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";

/** The gate column's one primary action per movement — opens its editor. */
const GATE_CTA: Record<string, string> = {
  frame: "Add the sponsor conversation",
  listen: "Update the coverage ledger",
  envision: "Record the direction",
  show: "Record demo verdicts",
  ship: "Record the go/no-go",
  evolve: "Log this month's ops review",
};

interface FlowCanvasProps {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
}

/**
 * "Paper & Flow" — the Flow programme home. The pipeline is drawn as one
 * continuous line down the page; movements are chapters on that spine, not
 * pages behind pills. Each open chapter is the triptych: what people said
 * (blue pull-quotes) → what ATOS made (paper documents) → the gate (verdict-
 * coloured). Nothing locks; editing unfolds in place via the shared inputs
 * panel, so the canvas is the workspace, not a dashboard about one.
 */
export default function FlowCanvas({ program, runningAgentIds, onRunAgent, onSaveInputs }: FlowCanvasProps) {
  const movements = useMemo(() => flowMovements(), []);
  const frontier = frontierMovementId(program);
  const [open, setOpen] = useState<Set<string>>(() => new Set([frontier]));
  const [editing, setEditing] = useState<Set<string>>(() => new Set());

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const openEditor = (id: string) => {
    setOpen((current) => new Set(current).add(id));
    setEditing((current) => new Set(current).add(id));
  };

  // The hero's "Set first-demo date" chip (and anything else outside the
  // canvas) can ask for a movement's editor via this event.
  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ movement?: string }>).detail?.movement;
      if (id) openEditor(id);
    };
    window.addEventListener("v3fs-open-editor", onOpen);
    return () => window.removeEventListener("v3fs-open-editor", onOpen);
  }, []);

  return (
    <div className="v3fs-flow">
      {movements.map((movement, index) => {
        const isOpen = open.has(movement.id);
        const isDone = program.gateReviews?.[movement.id]?.status === "approved";
        const artifacts = movementArtifacts(program, movement);
        const evidence = movementEvidence(program, movement);
        const generating = artifacts.some((a) => runningAgentIds.has(a.id));
        const isLive = movement.id === frontier && !isDone;
        const signal = gateSignal(program, movement, artifacts);
        const isLoop = !!movement.movement?.isLoop;
        const coverage = movement.id === "listen" ? listenCoverage(program) : null;

        return (
          <article
            key={movement.id}
            className={["v3fs-ch", isOpen ? "open" : "", isDone ? "done" : "", isLive ? "live" : ""].filter(Boolean).join(" ")}
          >
            <div className="v3fs-node" aria-hidden="true">{isDone ? "✓" : isLoop ? "∞" : index + 1}</div>
            <button type="button" className="v3fs-ch-h" onClick={() => toggle(setOpen, movement.id)} aria-expanded={isOpen}>
              <h2>{movement.displayName}</h2>
              <span className={`v3fs-state ${generating ? "gen" : isDone ? "done" : isLive ? "live" : isLoop ? "loop" : "wait"}`}>
                {generating ? "Generating" : isDone ? "Demonstrated" : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming"}
              </span>
              <span className="v3fs-ready">{movement.movement?.readyWhen ?? movement.description}</span>
            </button>

            {isOpen ? (
              <div className="v3fs-ch-b">
                <div>
                  <div className="v3fs-colh ev">Stakeholder evidence{coverage && coverage.total ? ` — ${coverage.done}/${coverage.total}` : ""}</div>
                  {evidence.length === 0 ? (
                    <div className="v3fs-voice-ghost">
                      No evidence captured for this movement yet. Open the editor below to add it.
                    </div>
                  ) : evidence.map((entry, i) => (
                    <div key={`${entry.fieldLabel}-${i}`} className="v3fs-voice">
                      {entry.excerpt ? <div className="v3fs-voice-q">“{entry.excerpt}”</div> : null}
                      <div className="v3fs-voice-who">
                        {entry.who}
                        <span>{entry.kind === "reference" ? `referenced · ${entry.meta}` : entry.meta}</span>
                      </div>
                    </div>
                  ))}
                  {coverage && coverage.total > 0 ? (
                    <div className="v3fs-coverage">
                      <div className="v3fs-coverage-cap"><span>Coverage</span><span>{coverage.done} of {coverage.total}</span></div>
                      <div className="v3fs-coverage-bar"><div className="v3fs-coverage-fill" style={{ width: `${Math.round((coverage.done / coverage.total) * 100)}%` }} /></div>
                    </div>
                  ) : null}
                  <button type="button" className="v3fs-edit-toggle" onClick={() => toggle(setEditing, movement.id)}>
                    {editing.has(movement.id) ? "Close editor" : "✎ Edit inputs & evidence"}
                  </button>
                </div>

                <div>
                  <div className="v3fs-colh gn">{generating ? "Generating…" : "Generated by ATOS"}</div>
                  {artifacts.map((artifact) => (
                    <ArtifactDoc
                      key={artifact.id}
                      artifact={artifact}
                      running={runningAgentIds.has(artifact.id)}
                      evidenceNames={evidence.map((entry) => entry.who)}
                      onGenerate={() => onRunAgent(artifact.id, movement.id)}
                    />
                  ))}
                </div>

                <div>
                  <div className={`v3fs-colh gt${isDone ? " done" : ""}`}>{isLoop ? "Steady-state health" : "Gate criteria"}</div>
                  <div className="v3fs-gate">
                    <p className="v3fs-gate-say">{movement.movement?.readyWhen ?? ""}</p>
                    <div className={`v3fs-sig ${signal.tone}`}>
                      {signal.tone === "green" ? "✓ " : signal.tone === "amber" ? "⚠ " : ""}{signal.text}
                    </div>
                    {!isDone ? (
                      <button type="button" className="v3fs-cta" onClick={() => openEditor(movement.id)}>
                        {GATE_CTA[movement.id] ?? "Update inputs & evidence"}
                      </button>
                    ) : null}
                    {movement.movement?.humanMoments?.length ? (
                      <div className="v3fs-moments">
                        <div className="v3fs-moments-l">Your actions</div>
                        {movement.movement.humanMoments.map((moment) => (
                          <div key={moment} className="v3fs-moment">▸ {moment}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {editing.has(movement.id) ? (
                  <div className="v3fs-editor">
                    <PhaseInputsPanel program={program} phaseId={movement.id} onSave={onSaveInputs} locked={isDone} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function ArtifactDoc({ artifact, running, evidenceNames, onGenerate }: {
  artifact: ArtifactCardModel;
  running: boolean;
  evidenceNames: string[];
  onGenerate: () => void;
}) {
  if (running) {
    // Generation theater: show what ATOS is reading while it drafts, so the
    // evidence → artifact transformation is visible, not a spinner.
    return (
      <div className="v3fs-doc gen">
        <div className="v3fs-gen-line"><span className="v3fs-gdot" /> {artifact.title} — in progress</div>
        {evidenceNames.length ? (
          <>
            <div className="v3fs-reading">Reading evidence</div>
            <div className="v3fs-srcs">
              {evidenceNames.slice(0, 6).map((name) => <span key={name}>{name.split(",")[0]} ✓</span>)}
            </div>
          </>
        ) : null}
        <div className="v3fs-doc-x">Reviewing the evidence and drafting the document…</div>
      </div>
    );
  }
  return (
    <div className={`v3fs-doc${artifact.present ? "" : " ghost"}`}>
      <div className="v3fs-doc-t">
        <span className={`v3fs-st ${artifact.present ? "ok" : "none"}`} />
        <b>{artifact.title}</b>
        {artifact.confidence != null ? <span className="v3fs-conf">{artifact.confidence}%</span> : null}
      </div>
      <div className="v3fs-doc-x">{artifact.excerpt ?? artifact.description}</div>
      <div className="v3fs-doc-foot">
        <button type="button" className="v3fs-a" onClick={onGenerate}>
          {artifact.present ? "Regenerate" : "✦ Generate"}
        </button>
      </div>
    </div>
  );
}
