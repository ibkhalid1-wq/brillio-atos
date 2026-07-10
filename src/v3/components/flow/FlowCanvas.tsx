import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts,
  gateSignal, gateChecklist, listenCoverage, movementFacts, demoAcceptance, artifactDocument,
  type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { meetingKit, type MeetingKit } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, listDemoInvites, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";

/** The gate column's one primary action per movement — opens its editor. */
const GATE_CTA: Record<string, string> = {
  frame: "Add the sponsor conversation",
  listen: "Update the coverage ledger",
  envision: "Record the direction",
  show: "Record demo verdicts",
  ship: "Record the go/no-go",
  evolve: "Log this month's ops review",
};

/** The field each gate CTA should land the editor on, when it exists. */
const GATE_CTA_FIELD: Record<string, string> = {
  frame: "input:sponsorConversation",
  listen: "input:interviewRoster",
  envision: "input:directionDecision",
  show: "input:demoTour",
  ship: "input:goDecisionRef",
  evolve: "input:opsConversations",
};

interface FlowCanvasProps {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
  /** Mint async-interview response links from the Discovery Kit (Listen). */
  onMintPacks?: () => Promise<void>;
  /** Mint demo links from the Demo Scripts (Show). */
  onMintDemoInvites?: () => Promise<void>;
  /** Compile the ship plan from the blueprint (Ship). */
  onCompileShipLanes?: () => Promise<void>;
  /** Toggle one ship-lane item. */
  onToggleShipItem?: (laneId: string, itemId: string) => Promise<void>;
  /** Put a gap-closing follow-up on the calendar. */
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a follow-up link (async form of the meeting); resolves to the URL. */
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
}

/**
 * "Paper & Flow" — the Flow programme home. The pipeline is drawn as one
 * continuous line down the page; movements are chapters on that spine, not
 * pages behind pills. Each open chapter is the triptych: what people said
 * (blue pull-quotes) → what ATOS made (paper documents) → the gate (verdict-
 * coloured). Nothing locks; editing unfolds in place via the shared inputs
 * panel, so the canvas is the workspace, not a dashboard about one.
 */
export default function FlowCanvas({ program, runningAgentIds, onRunAgent, onSaveInputs, onMintPacks, onMintDemoInvites, onCompileShipLanes, onToggleShipItem, onScheduleFollowUp, onMintFollowUp }: FlowCanvasProps) {
  const movements = useMemo(() => flowMovements(), []);
  const frontier = frontierMovementId(program);
  const [open, setOpen] = useState<Set<string>>(() => new Set([frontier]));
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Open a movement's editor and land on a specific field (the gate CTAs point
  // at their key field). The editor mounts below the fold, so after it commits
  // we scroll it — or that field — into view and focus its control; opening it
  // silently would look like nothing happened.
  const openEditor = (id: string, fieldAnchor?: string) => {
    setOpen((current) => new Set(current).add(id));
    setEditing((current) => new Set(current).add(id));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const editor = document.querySelector(`.v3fs-editor[data-movement="${id}"]`);
      if (!editor) return;
      const target = fieldAnchor ? editor.querySelector(`[data-io-anchor="${fieldAnchor}"]`) : null;
      (target ?? editor).scrollIntoView({ behavior: "smooth", block: fieldAnchor ? "center" : "start" });
      const focusable = target?.querySelector("textarea, input, select, button");
      if (focusable instanceof HTMLElement) focusable.focus({ preventScroll: true });
    }));
  };

  // The readers parse grids and transcripts — compute once per programme
  // snapshot, not once per render per chapter.
  const rows = useMemo(
    () => movements.map((movement) => ({
      movement,
      artifacts: movementArtifacts(program, movement),
      evidence: movementEvidence(program, movement),
    })),
    [program, movements],
  );

  return (
    <div className="v3fs-flow">
      {rows.map(({ movement, artifacts, evidence }, index) => {
        const isOpen = open.has(movement.id);
        const isDone = program.gateReviews?.[movement.id]?.status === "approved";
        const generating = artifacts.some((a) => runningAgentIds.has(a.id));
        const isLive = movement.id === frontier && !isDone;
        const signal = gateSignal(program, movement, artifacts);
        const checks = gateChecklist(program, movement, artifacts);
        const openChecks = checks.filter((item) => !item.done).length;
        const isLoop = !!movement.movement?.isLoop;
        const coverage = movement.id === "listen" ? listenCoverage(program) : null;

        return (
          <article
            key={movement.id}
            className={["v3fs-ch", isOpen ? "open" : "", isDone ? "done" : "", isLive ? "live" : ""].filter(Boolean).join(" ")}
          >
            <div className="v3fs-node" aria-hidden="true">{isDone ? "✓" : isLoop ? "∞" : index + 1}</div>
            {isLive ? (
              // The rail's pointer: pulsing at the movement that needs the
              // user when its chapter is closed; a calm marker once inside.
              <button
                type="button"
                className={`v3fs-here${isOpen ? " calm" : ""}`}
                onClick={() => { if (!isOpen) toggle(setOpen, movement.id); }}
                aria-label={isOpen ? "You are here" : `Open ${movement.displayName} — it needs your attention`}
              >
                {isOpen ? "You are here" : `Needs you${openChecks ? ` · ${openChecks}` : ""}`}
                <span className="v3fs-here-a" aria-hidden="true">▶</span>
              </button>
            ) : null}
            <button type="button" className="v3fs-ch-h" onClick={() => toggle(setOpen, movement.id)} aria-expanded={isOpen}>
              <h2>{movement.displayName}</h2>
              <span className={`v3fs-state ${generating ? "gen" : isDone ? "done" : isLive ? "live" : isLoop ? "loop" : "wait"}`}>
                {generating ? "Generating" : isDone ? "Demonstrated" : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming"}
              </span>
              {!isOpen ? (
                <span className="v3fs-meta">
                  {evidence.length} evidence · {artifacts.filter((a) => a.present).length}/{artifacts.length} artifacts
                </span>
              ) : null}
              <span className="v3fs-ready">{movement.movement?.readyWhen ?? movement.description}</span>
            </button>

            {isOpen ? (
              <div className="v3fs-ch-b">
                <div>
                  <div className="v3fs-colh ev">Stakeholder evidence{coverage && coverage.total ? ` — ${coverage.done}/${coverage.total}` : ""}</div>
                  <MeetingKitCard
                    kit={meetingKit(program, movement.id)}
                    movementId={movement.id}
                    hasEvidence={evidence.length > 0}
                    program={program}
                    onSaveInputs={onSaveInputs}
                    onScheduleFollowUp={onScheduleFollowUp}
                    onMintFollowUp={onMintFollowUp}
                  />
                  {evidence.length === 0 ? null : evidence.map((entry, i) => (
                    <div key={`${entry.fieldLabel}-${i}`} className="v3fs-voice">
                      {entry.excerpt ? <div className="v3fs-voice-q">“{entry.excerpt}”</div> : null}
                      <div className="v3fs-voice-who">
                        {entry.who}
                        <span>{entry.kind === "reference" ? `referenced · ${entry.meta}` : entry.meta}</span>
                      </div>
                    </div>
                  ))}
                  {(() => {
                    const facts = movementFacts(program, movement);
                    return facts.length ? (
                      <div className="v3fs-facts">
                        {facts.map((fact) => (
                          <div key={fact.label} className="v3fs-fact"><b>{fact.label}</b><span>{fact.value}</span></div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  {coverage && coverage.total > 0 ? (
                    <div className="v3fs-coverage">
                      <div className="v3fs-coverage-cap"><span>Coverage</span><span>{coverage.done} of {coverage.total}</span></div>
                      <div className="v3fs-coverage-bar"><div className="v3fs-coverage-fill" style={{ width: `${Math.round((coverage.done / coverage.total) * 100)}%` }} /></div>
                    </div>
                  ) : null}
                  {movement.id === "listen" && onMintPacks ? (
                    <AsyncInterviews program={program} onMintPacks={onMintPacks} />
                  ) : null}
                  {movement.id === "show" && onMintDemoInvites ? (
                    <DemoInvites program={program} onMint={onMintDemoInvites} />
                  ) : null}
                  {/* Quiet escape hatch only — the checklist and gate CTA are
                      the purposeful doors into the editor now. */}
                  <button type="button" className="v3fs-edit-toggle quiet" onClick={() => toggle(setEditing, movement.id)}>
                    {editing.has(movement.id) ? "Close the editor" : "Adjust details"}
                  </button>
                </div>

                <div>
                  <div className="v3fs-colh gn">{generating ? "Generating…" : "Generated by ATOS"}</div>
                  {movement.id === "ship" && onCompileShipLanes && onToggleShipItem ? (
                    <ShipLanesBoard program={program} onCompile={onCompileShipLanes} onToggle={onToggleShipItem} />
                  ) : null}
                  {movement.id === "show" ? (() => {
                    const tour = demoAcceptance(program);
                    return tour.rows.length ? (
                      <div className="v3fs-doc v3fs-tour">
                        {tour.rows.slice(0, 4).map((row, i) => (
                          <div key={i} className="v3fs-verd">
                            <span className="v3fs-verd-w">{row.stakeholder || "—"}</span>
                            <span className={`v3fs-vc ${/accepted/i.test(row.verdict ?? "") ? "acc" : "pen"}`}>{row.verdict || "Pending"}</span>
                          </div>
                        ))}
                        {tour.rows.length > 4 ? <div className="v3fs-verd-more">+ {tour.rows.length - 4} more in Pulse</div> : null}
                      </div>
                    ) : null;
                  })() : null}
                  {artifacts.map((artifact) => (
                    <ArtifactDoc
                      key={artifact.id}
                      artifact={artifact}
                      running={runningAgentIds.has(artifact.id)}
                      evidenceNames={evidence.map((entry) => entry.who)}
                      onGenerate={() => onRunAgent(artifact.id, movement.id)}
                      onOpen={artifact.present ? () => setDocFor(artifact) : undefined}
                    />
                  ))}
                </div>

                <div>
                  <div className={`v3fs-colh gt${isDone ? " done" : ""}`}>{isLoop ? "Steady-state health" : "Gate criteria"}</div>
                  <div className="v3fs-gate">
                    <p className="v3fs-gate-say">{movement.movement?.readyWhen ?? ""}</p>
                    {(() => {
                      const done = checks.filter((item) => item.done).length;
                      const firstOpen = checks.find((item) => !item.done);
                      return (
                        <>
                          <div className={`v3fs-sig ${signal.tone}`}>
                            {signal.tone === "green" ? "✓ " : signal.tone === "amber" ? "⚠ " : ""}
                            {checks.length ? `${done} of ${checks.length} criteria met` : signal.text}
                          </div>
                          <div className="v3fs-checks">
                            {checks.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`v3fs-check${item.done ? " done" : ""}`}
                                disabled={!item.anchor}
                                onClick={item.anchor ? () => openEditor(movement.id, item.anchor) : undefined}
                                title={item.anchor
                                  ? item.done ? "Met — open to review or correct" : "Open the editor on this item"
                                  : "Met by generating / working the movement"}
                              >
                                <span className="v3fs-check-box" aria-hidden="true">{item.done ? "✓" : ""}</span>
                                <span className="v3fs-check-l">{item.label}</span>
                              </button>
                            ))}
                          </div>
                          {!isDone ? (
                            <button type="button" className="v3fs-cta"
                              onClick={() => openEditor(movement.id, firstOpen?.anchor ?? GATE_CTA_FIELD[movement.id])}>
                              {firstOpen && firstOpen.anchor ? firstOpen.label : GATE_CTA[movement.id] ?? "Update inputs & evidence"}
                            </button>
                          ) : null}
                        </>
                      );
                    })()}
                    {movement.movement?.humanMoments?.length ? (
                      <details className="v3fs-disc v3fs-disc-sm">
                        <summary>
                          <span className="v3fs-disc-l">Your actions<em>{movement.movement.humanMoments.length}</em></span>
                          <span className="v3fs-disc-c" aria-hidden="true" />
                        </summary>
                        <div className="v3fs-disc-b">
                          {movement.movement.humanMoments.map((moment) => (
                            <div key={moment} className="v3fs-moment">▸ {moment}</div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>

                {editing.has(movement.id) ? (
                  <div className="v3fs-editor" data-movement={movement.id}>
                    <PhaseInputsPanel program={program} phaseId={movement.id} onSave={onSaveInputs} locked={isDone} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
      {docFor ? (
        <FlowDocViewer
          program={program}
          artifact={docFor}
          onClose={() => setDocFor(null)}
          onRegenerate={() => onRunAgent(docFor.id, docFor.movementId)}
        />
      ) : null}
    </div>
  );
}

/**
 * The meeting kit — if the input is a conversation, hand the user the
 * conversation: who to sit with, the script to run (derived from missing
 * facts and generated agendas), and capture right where the script is.
 * Open by default when the conversation hasn't happened; a quiet one-line
 * summary once it has.
 */
function MeetingKitCard({ kit, movementId, hasEvidence, program, onSaveInputs, onScheduleFollowUp, onMintFollowUp }: {
  kit: MeetingKit | null;
  movementId: string;
  hasEvidence: boolean;
  program: ProgramSummary;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
}) {
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [copied, setCopied] = useState(false);
  const [followDate, setFollowDate] = useState("");
  const [scheduledTick, setScheduledTick] = useState(false);
  const [linkTick, setLinkTick] = useState(false);

  if (!kit) {
    return hasEvidence ? null : (
      <div className="v3fs-kit v3fs-kit-ghost">
        The script for this movement's conversations arrives with the upstream artifact — generate it and the kit appears here.
      </div>
    );
  }

  const save = async () => {
    const text = capture.trim();
    if (!text) return;
    setBusy(true);
    try {
      const existing = (program.rawData && typeof program.rawData === "object"
        ? (() => {
            const raw = program.rawData as Record<string, unknown>;
            const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
            const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
              ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] ?? {}
              : {};
            const value = bucket[kit.captureField];
            return typeof value === "string" ? value : "";
          })()
        : "");
      const block = kit.header ? `${kit.header}\n${text}` : text;
      const next = kit.header
        ? [existing.trimEnd(), block].filter(Boolean).join("\n\n")
        : text; // single-line refs (go/no-go) replace rather than append
      await onSaveInputs(movementId, { [kit.captureField]: next });
      setCapture("");
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  const copyScript = async () => {
    const script = [`${kit.title} — ${kit.who}`, kit.purpose, "", ...kit.questions.map((q, i) => `${i + 1}. ${q}`)].join("\n");
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { window.prompt("Copy the script:", script); }
  };

  const schedule = async () => {
    if (!onScheduleFollowUp || !followDate) return;
    setBusy(true);
    try {
      await onScheduleFollowUp(movementId, kit.who, followDate);
      setFollowDate("");
      setScheduledTick(true);
      window.setTimeout(() => setScheduledTick(false), 2200);
    } finally { setBusy(false); }
  };

  const sendLink = async () => {
    if (!onMintFollowUp) return;
    setBusy(true);
    try {
      const link = await onMintFollowUp({ movementId, who: kit.who, questions: kit.questions, captureField: kit.captureField });
      if (link) {
        try { await navigator.clipboard.writeText(link); } catch { window.prompt("Copy the follow-up link:", link); }
        setLinkTick(true);
        window.setTimeout(() => setLinkTick(false), 2200);
      }
    } finally { setBusy(false); }
  };

  return (
    <details className={`v3fs-kit${kit.followUp ? " v3fs-kit-fu" : ""}`} open={(!kit.done && !hasEvidence) || kit.followUp}>
      <summary>
        <span className={`v3fs-st ${kit.followUp ? "stale" : kit.done ? "ok" : "none"}`} />
        <span className="v3fs-kit-t">
          {kit.title}
          <span className="v3fs-kit-who">{kit.who}{kit.followUp ? ` · ${kit.gaps.length} gap${kit.gaps.length === 1 ? "" : "s"} to close` : kit.done ? " · on record" : ""}</span>
        </span>
        <span className="v3fs-disc-c" aria-hidden="true" />
      </summary>
      <div className="v3fs-kit-b">
        <p className="v3fs-kit-p">{kit.purpose}</p>
        <ol className="v3fs-kit-qs">
          {kit.questions.map((question, index) => <li key={index}>{question}</li>)}
        </ol>
        <div className="v3fs-kit-actions">
          <button type="button" className="v3fs-a" onClick={() => void copyScript()}>{copied ? "Copied ✓" : "Copy the script"}</button>
        </div>
        {kit.followUp && (onScheduleFollowUp || onMintFollowUp) ? (
          <div className="v3fs-kit-fu-row">
            {onScheduleFollowUp ? (
              <>
                <input type="date" value={followDate} onChange={(event) => setFollowDate(event.target.value)} aria-label="Follow-up date" />
                <button type="button" className="v3fs-btn" disabled={busy || !followDate} onClick={() => void schedule()}>
                  {scheduledTick ? "Scheduled ✓" : "Schedule the follow-up"}
                </button>
              </>
            ) : null}
            {onMintFollowUp ? (
              <button type="button" className="v3fs-btn" disabled={busy} onClick={() => void sendLink()}>
                {linkTick ? "Link copied ✓" : "✳ Send as a link"}
              </button>
            ) : null}
            <span className="v3fs-kit-fu-note">No meeting needed — ATOS asks these itself and the answers arrive in Today.</span>
          </div>
        ) : null}
        <div className="v3fs-kit-capture">
          <textarea
            rows={3}
            placeholder={kit.header ? `${kit.captureLabel} — attribution added for you (${kit.header})` : kit.captureLabel}
            value={capture}
            onChange={(event) => setCapture(event.target.value)}
            aria-label={kit.captureLabel}
          />
          <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : savedTick ? "Captured ✓" : "Capture"}
          </button>
        </div>
      </div>
    </details>
  );
}

/**
 * The drill-down for every generated artifact: a reading pane over the full
 * document, opened from any card or Library row. One overlay, everywhere —
 * cards stay excerpts, details are always one tap away.
 */
export function FlowDocViewer({ program, artifact, onClose, onRegenerate }: {
  program: ProgramSummary;
  artifact: ArtifactCardModel;
  onClose: () => void;
  onRegenerate?: () => void;
}) {
  const body = artifactDocument(program, artifact.id);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Light markdown: heading lines become headings, bullet lines keep their
  // hang, everything else reads as prose. No parser — the docs are trusted
  // generator output rendered as text.
  const blocks = useMemo(() => (body ?? "")
    .replace(/\*\*/g, "")
    .split(/\n{2,}/)
    .map((block) => block.trimEnd())
    .filter(Boolean)
    .map((block) => block.split("\n").map((line) => {
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      if (heading) return { kind: "h" as const, text: heading[1] };
      const bullet = line.match(/^\s*[-•]\s+(.*)$/);
      if (bullet) return { kind: "li" as const, text: bullet[1] };
      return { kind: "p" as const, text: line };
    })), [body]);

  return (
    <>
      <div className="v3fs-doc-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="v3fs-docview" role="dialog" aria-modal="true" aria-label={artifact.title}>
        <header className="v3fs-docview-h">
          <div>
            <h2>{artifact.title}</h2>
            <span className="v3fs-docview-m">
              {[artifact.confidence != null ? `confidence ${artifact.confidence}%` : null,
                artifact.stale ? "evidence changed since generation" : null]
                .filter(Boolean).join(" · ") || "generated by ATOS"}
            </span>
          </div>
          <div className="v3fs-docview-cta">
            {onRegenerate ? (
              <button type="button" className="v3fs-btn" onClick={() => { onRegenerate(); onClose(); }}>
                {artifact.stale ? "Regenerate — evidence changed" : "Regenerate"}
              </button>
            ) : null}
            <button type="button" className="v3fs-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </header>
        <div className="v3fs-docview-b">
          {blocks.length === 0 ? <p className="v3fs-empty">No document body yet — generate it first.</p> : null}
          {blocks.map((lines, blockIndex) => (
            <div key={blockIndex} className="v3fs-docview-blk">
              {lines.map((line, lineIndex) =>
                line.kind === "h" ? <h3 key={lineIndex}>{line.text}</h3>
                  : line.kind === "li" ? <div key={lineIndex} className="v3fs-docview-li">{line.text}</div>
                    : <p key={lineIndex}>{line.text}</p>,
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Async interviews — the Listen column's "no meeting required" lane. Links
 * mint from the Discovery Kit's per-stakeholder packs; what comes back waits
 * in Today's evidence inbox until ingested.
 */
function AsyncInterviews({ program, onMintPacks }: { program: ProgramSummary; onMintPacks: () => Promise<void> }) {
  const packs = listInterviewPacks(program);
  const hasKit = (() => {
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const kit = inner.discoveryKit;
    return !!kit && typeof kit === "object" && Array.isArray((kit as Record<string, unknown>).interviews);
  })();
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!hasKit && packs.length === 0) return null;

  const mint = async () => {
    setBusy(true);
    try { await onMintPacks(); } finally { setBusy(false); }
  };
  const copy = async (packId: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(packId);
      window.setTimeout(() => setCopiedId((current) => (current === packId ? null : current)), 1600);
    } catch { window.prompt("Copy the response link:", link); }
  };

  return (
    <div className="v3fs-async">
      <div className="v3fs-async-cap">Async interviews <span>no meeting required — send a link, answers arrive in Today</span></div>
      {packs.map((pack) => (
        <div key={pack.id} className="v3fs-async-row">
          <span className={`v3fs-st ${pack.respondedAt ? "ok" : "none"}`} />
          <div className="v3fs-async-who">
            {pack.stakeholder}
            <span>{pack.respondedAt ? "responded" : `${pack.questions.length} questions · waiting`}</span>
          </div>
          <button type="button" className="v3fs-a" onClick={() => void copy(pack.id, portalLinkFor(program.id, pack))}>
            {copiedId === pack.id ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      ))}
      {hasKit ? (
        <button type="button" className="v3fs-a" disabled={busy} onClick={() => void mint()}>
          {busy ? "Creating…" : packs.length ? "↺ Create links for new stakeholders" : "✳ Create response links from the Discovery Kit"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Demo tour links — the Show column's automation ladder. Invites mint from
 * the Demo Scripts (each stakeholder gets THEIR walkthrough); verdicts come
 * back through the quarantine and land in the tour ledger + track passes.
 */
function DemoInvites({ program, onMint }: { program: ProgramSummary; onMint: () => Promise<void> }) {
  const invites = listDemoInvites(program);
  const hasScripts = (() => {
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const doc = inner.demoScripts;
    return !!doc && typeof doc === "object" && Array.isArray((doc as Record<string, unknown>).scripts);
  })();
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!hasScripts && invites.length === 0) return null;

  const mint = async () => {
    setBusy(true);
    try { await onMint(); } finally { setBusy(false); }
  };
  const copy = async (inviteId: string, link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(inviteId);
      window.setTimeout(() => setCopiedId((current) => (current === inviteId ? null : current)), 1600);
    } catch { window.prompt("Copy the demo link:", link); }
  };

  return (
    <div className="v3fs-async">
      <div className="v3fs-async-cap">Demo tour links <span>each stakeholder watches their own workflow — verdicts arrive in Today</span></div>
      {invites.map((invite) => (
        <div key={invite.id} className="v3fs-async-row">
          <span className={`v3fs-st ${invite.respondedAt ? "ok" : "none"}`} />
          <div className="v3fs-async-who">
            {invite.stakeholder}
            <span>{invite.respondedAt ? "verdict received" : "waiting for their verdict"}</span>
          </div>
          <button type="button" className="v3fs-a" onClick={() => void copy(invite.id, portalLinkFor(program.id, invite))}>
            {copiedId === invite.id ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      ))}
      {hasScripts ? (
        <button type="button" className="v3fs-a" disabled={busy} onClick={() => void mint()}>
          {busy ? "Creating…" : invites.length ? "↺ Create links for new stakeholders" : "✳ Create demo links from the Demo Scripts"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Ship lanes — the plan compiles from the Blueprint (build sequence, data
 * contracts, eval plan), the hardening plan, and the roster. The gate reads
 * from this board: validation lane done + cutover executed → green.
 */
function ShipLanesBoard({ program, onCompile, onToggle }: {
  program: ProgramSummary;
  onCompile: () => Promise<void>;
  onToggle: (laneId: string, itemId: string) => Promise<void>;
}) {
  const lanes = listShipLanes(program);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  if (!lanes.length) {
    return (
      <div className="v3fs-doc ghost">
        <div className="v3fs-doc-t"><span className="v3fs-st none" /><b>Ship plan</b></div>
        <div className="v3fs-doc-x">
          Six lanes — build, data, validation &amp; evals, hardening, enablement, cutover — compiled from the
          Blueprint, the hardening plan and the roster. The gate goes green when validation is done and cutover has executed.
        </div>
        <div className="v3fs-doc-foot">
          <button type="button" className="v3fs-a" disabled={busy} onClick={() => void act(onCompile)}>
            {busy ? "Compiling…" : "✳ Compile the ship plan"}
          </button>
        </div>
      </div>
    );
  }

  const progress = shipLaneProgress(lanes);
  return (
    <div className="v3fs-doc v3fs-shipboard">
      <div className="v3fs-doc-t">
        <span className={`v3fs-st ${progress.validationDone && progress.cutoverDone ? "ok" : "stale"}`} />
        <b>Ship plan</b>
        <span className="v3fs-conf">{progress.done}/{progress.total}</span>
      </div>
      {lanes.map((lane) => (
        <div key={lane.id} className="v3fs-shiplane">
          <div className="v3fs-shiplane-t">
            {lane.name}
            <span>{lane.items.filter((entry) => entry.done).length}/{lane.items.length}</span>
          </div>
          {lane.items.map((entry) => (
            <label key={entry.id} className={`v3fs-shipitem${entry.done ? " done" : ""}`}>
              <input type="checkbox" checked={entry.done} disabled={busy}
                onChange={() => void act(() => onToggle(lane.id, entry.id))} />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function ArtifactDoc({ artifact, running, evidenceNames, onGenerate, onOpen }: {
  artifact: ArtifactCardModel;
  running: boolean;
  evidenceNames: string[];
  onGenerate: () => void;
  onOpen?: () => void;
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
              {evidenceNames.slice(0, 6).map((name, index) => <span key={`${index}-${name}`}>{name.split(",")[0]} ✓</span>)}
            </div>
          </>
        ) : null}
        <div className="v3fs-doc-x">Reviewing the evidence and drafting the document…</div>
      </div>
    );
  }
  return (
    <div className={`v3fs-doc${artifact.present ? "" : " ghost"}${onOpen ? " openable" : ""}`}>
      <div className="v3fs-doc-t">
        <span className={`v3fs-st ${artifact.present ? (artifact.stale ? "stale" : "ok") : "none"}`} />
        {onOpen ? (
          <button type="button" className="v3fs-doc-open" onClick={onOpen}>{artifact.title}</button>
        ) : (
          <b>{artifact.title}</b>
        )}
        {artifact.stale ? <span className="v3fs-stale-tag">evidence changed</span> : null}
        {artifact.confidence != null ? <span className="v3fs-conf">{artifact.confidence}%</span> : null}
      </div>
      <div className="v3fs-doc-x">{artifact.excerpt ?? artifact.description}</div>
      <div className="v3fs-doc-foot">
        {onOpen ? <button type="button" className="v3fs-a" onClick={onOpen}>Read</button> : null}
        <button type="button" className="v3fs-a" onClick={onGenerate}>
          {artifact.present ? (artifact.stale ? "Regenerate — evidence changed" : "Regenerate") : "✦ Generate"}
        </button>
      </div>
    </div>
  );
}
