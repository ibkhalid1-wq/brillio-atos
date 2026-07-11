import React, { Fragment, useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import FlowArtifactStudio, { type ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts,
  gateReadiness, gateChecklist, listenCoverage, movementFacts, demoAcceptance,
  type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { meetingKit, type MeetingKit } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, listDemoInvites, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";

interface FlowCanvasProps {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
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
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc?: (input: ArtifactEditInput) => Promise<void>;
  /** Jump to the Inbox (regeneration-pending band in the studio). */
  onOpenInbox?: () => void;
  /** Record a movement's gate — demonstrated. Locks the movement's inputs. */
  onRecordGate?: (movementId: string) => Promise<void>;
}

/**
 * "Paper & Flow" — the Flow programme home. The pipeline is drawn as one
 * continuous line down the page; movements are chapters on that spine, not
 * pages behind pills. Each open chapter is the triptych: what people said
 * (blue pull-quotes) → what ATOS made (paper documents) → the gate (verdict-
 * coloured). Nothing locks; editing unfolds in place via the shared inputs
 * panel, so the canvas is the workspace, not a dashboard about one.
 */
export default function FlowCanvas({ program, runningAgentIds, onRunAgent, onSaveInputs, onMintPacks, onMintDemoInvites, onCompileShipLanes, onToggleShipItem, onScheduleFollowUp, onMintFollowUp, onSaveArtifactDoc, onOpenInbox, onRecordGate }: FlowCanvasProps) {
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
        const checks = gateChecklist(program, movement, artifacts);
        const readiness = gateReadiness(program, movement, artifacts, checks);
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
              {!isOpen && (evidence.length > 0 || artifacts.some((a) => a.present)) ? (
                <span className="v3fs-meta">
                  {evidence.length} evidence · {artifacts.filter((a) => a.present && !a.stale && a.gaps === 0).length}/{artifacts.length} documents current
                </span>
              ) : null}
            </button>

            {isOpen ? (
              <div className="v3fs-ch-b">
                <div>
                  <div className="v3fs-colh ev">Stakeholder evidence{coverage && coverage.total ? ` — ${coverage.done}/${coverage.total}` : ""}</div>
                  {/* The column leads with the evidence itself — voices, then
                      facts, then coverage. The kit is the action and follows,
                      collapsed to one line once a conversation is on record. */}
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
                  {(() => {
                    const kit = meetingKit(program, movement.id);
                    const channelCards = movement.id === "listen" && onMintPacks
                      ? <AsyncInterviews program={program} onMintPacks={onMintPacks} />
                      : movement.id === "show" && onMintDemoInvites
                        ? <DemoInvites program={program} onMint={onMintDemoInvites} />
                        : undefined;
                    return (
                      <>
                        <MeetingKitCard
                          kit={kit}
                          movementId={movement.id}
                          hasEvidence={evidence.length > 0}
                          program={program}
                          onSaveInputs={onSaveInputs}
                          onScheduleFollowUp={onScheduleFollowUp}
                          onMintFollowUp={onMintFollowUp}
                          channels={channelCards}
                        />
                        {!kit ? channelCards : null}
                      </>
                    );
                  })()}
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
                  <div className={`v3fs-colh gt${isDone ? " done" : ""}`}>{isLoop ? "Steady-state health" : "Gate"}</div>
                  <div className="v3fs-gate">
                    {/* Verdict first: one composed state over the whole loop —
                        evidence criteria, record current, Inbox clear. */}
                    <div className={`v3fs-gstate ${readiness.tone}`}>
                      <div className="v3fs-gstate-h">
                        <span className="v3fs-gstate-g" aria-hidden="true">
                          {readiness.kind === "trails" ? "⟳" : readiness.tone === "green" ? "✓" : readiness.tone === "amber" ? "⚠" : "○"}
                        </span>
                        {readiness.headline}
                      </div>
                      {readiness.detail ? <div className="v3fs-gstate-d">{readiness.detail}</div> : null}
                      {readiness.kind === "ready" && !isDone && onRecordGate ? (
                        <RecordGateButton movementId={movement.id} onRecordGate={onRecordGate} />
                      ) : null}
                    </div>
                    <div className="v3fs-checks">
                      {checks.map((item, itemIndex) => {
                        const group = item.group ?? "evidence";
                        const prevGroup = itemIndex ? (checks[itemIndex - 1].group ?? "evidence") : null;
                        const grouped = checks.some((c) => (c.group ?? "evidence") !== "evidence");
                        const artifact = item.artifactId ? artifacts.find((a) => a.id === item.artifactId) : undefined;
                        const onClick = item.anchor
                          ? () => openEditor(movement.id, item.anchor)
                          : artifact?.present
                            ? () => setDocFor(artifact)
                            : item.inbox && !item.done && onOpenInbox
                              ? () => onOpenInbox()
                              : undefined;
                        const title = item.anchor
                          ? item.done ? "Met — open to review or correct" : "Open the editor on this item"
                          : item.artifactId
                            ? artifact?.present ? "Open the document" : "Generate from the card"
                            : item.inbox
                              ? item.done ? "Nothing waiting" : "Open the Inbox"
                              : "Met by generating / working the movement";
                        // Amber emphasis for any present-but-open record row;
                        // the box glyph says why: ⟳ evidence moved, ! gaps declared.
                        const attention = group === "record" && !item.done && !!artifact?.present;
                        const boxGlyph = item.done ? "✓" : attention ? (artifact?.stale ? "⟳" : "!") : "";
                        return (
                          <Fragment key={item.id}>
                            {grouped && group !== prevGroup ? (() => {
                              const members = checks.filter((c) => (c.group ?? "evidence") === group);
                              const met = members.filter((c) => c.done).length;
                              const name = group === "evidence" ? "Evidence" : group === "record" ? "Record" : "Inbox";
                              const count = group === "judgment"
                                ? (met === members.length ? "clear" : "waiting")
                                : `${met} of ${members.length}`;
                              return (
                                <div className={`v3fs-check-grp${met === members.length ? " met" : ""}`}>
                                  {name}<span>{count}</span>
                                </div>
                              );
                            })() : null}
                            <button
                              type="button"
                              className={`v3fs-check${item.done ? " done" : ""}${attention ? " stale" : ""}`}
                              disabled={!onClick}
                              onClick={onClick}
                              title={title}
                            >
                              <span className="v3fs-check-box" aria-hidden="true">{boxGlyph}</span>
                              <span className="v3fs-check-l">
                                {item.label}
                                {item.done && item.why ? <span className="v3fs-check-why">{item.why}</span> : null}
                              </span>
                            </button>
                          </Fragment>
                        );
                      })}
                    </div>
                    <p className="v3fs-gate-say foot">{movement.movement?.readyWhen ?? ""}</p>
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
        <FlowArtifactStudio
          program={program}
          artifact={docFor}
          onClose={() => setDocFor(null)}
          onRegenerate={() => onRunAgent(docFor.id, docFor.movementId)}
          onSaveDoc={onSaveArtifactDoc}
          onOpenInbox={onOpenInbox}
        />
      ) : null}
    </div>
  );
}

/**
 * The one action the gate column owns: recording the gate itself. Two-step —
 * the first press arms, the second records — because approval hard-locks the
 * movement's inputs. Renders only in the READY state.
 */
function RecordGateButton({ movementId, onRecordGate }: {
  movementId: string;
  onRecordGate: (movementId: string) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const press = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try { await onRecordGate(movementId); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <button type="button" className={`v3fs-gate-rec${armed ? " armed" : ""}`} disabled={busy} onClick={() => void press()}>
      {busy ? "Recording…" : armed ? "Confirm — records the gate and locks inputs" : "Record the gate — demonstrated"}
    </button>
  );
}

/**
 * The meeting kit — if the input is a conversation, hand the user the
 * conversation: who to sit with, the script to run (derived from missing
 * facts and generated agendas), and capture right where the script is.
 * Open by default when the conversation hasn't happened; a quiet one-line
 * summary once it has.
 */
function MeetingKitCard({ kit, movementId, hasEvidence, program, onSaveInputs, onScheduleFollowUp, onMintFollowUp, channels }: {
  kit: MeetingKit | null;
  movementId: string;
  hasEvidence: boolean;
  /** Extra channel cards (async links, demo links) rendered under Channels. */
  channels?: React.ReactNode;
  program: ProgramSummary;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
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
  const [docName, setDocName] = useState("");
  const [docText, setDocText] = useState("");
  const [docTick, setDocTick] = useState(false);
  const [docOpen, setDocOpen] = useState(false);

  // "Attach" on a referenced document: land in the ingest form with the
  // name prefilled — the capture area is where evidence arrives.
  const attachDocument = (name: string) => {
    setDocName(name);
    setDocOpen(true);
  };

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
      await onSaveInputs(movementId, { [kit.captureField]: next }, {
        attest: { action: `Evidence captured — ${kit.who}`, detail: text.replace(/\s+/g, " ").slice(0, 140) },
      });
      setCapture("");
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  // Documents referenced in the conversation are evidence too — ingested
  // beside the transcript under their own attributed header, so every
  // generator reads them with the same grounding.
  const saveDoc = async () => {
    const name = docName.trim();
    const text = docText.trim();
    if (!name || !text) return;
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
        ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] ?? {}
        : {};
      const existing = typeof bucket[kit.captureField] === "string" ? bucket[kit.captureField] as string : "";
      const block = `— Document: ${name}, provided by ${kit.who}, ${new Date().toISOString().slice(0, 10)} —\n${text}`;
      await onSaveInputs(movementId, { [kit.captureField]: [existing.trimEnd(), block].filter(Boolean).join("\n\n") }, {
        attest: { action: `Document ingested — ${name}`, detail: `provided by ${kit.who}` },
      });
      setDocName("");
      setDocText("");
      setDocTick(true);
      window.setTimeout(() => setDocTick(false), 2200);
    } finally { setBusy(false); }
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
    <details className={`v3fs-kit${kit.followUp ? " v3fs-kit-fu" : ""}`} open={!kit.done && !hasEvidence}>
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
        <div className="v3fs-kit-cap">Interview script — {kit.who}</div>
        <ol className="v3fs-kit-qs">
          {kit.questions.map((question, index) => <li key={index}>{question}</li>)}
        </ol>
        <div className="v3fs-kit-actions">
          <button type="button" className="v3fs-btn pri" onClick={() => void copyScript()}>
            {copied ? "Copied ✓" : "Copy the script"}
          </button>
        </div>
        {kit.documents.length ? (
          <div className="v3fs-script-docs">
            <div className="v3fs-script-docs-cap">Referenced documents</div>
            {kit.documents.map((name) => (
              <div key={name} className="v3fs-script-doc">
                <span className="v3fs-script-doc-n">{name}</span>
                <button type="button" className="v3fs-btn" onClick={() => attachDocument(name)}>
                  Attach
                </button>
              </div>
            ))}
            <p className="v3fs-script-docs-note">Attaching lands it as evidence beside the transcript, attributed.</p>
          </div>
        ) : null}
        {(kit.followUp && (onScheduleFollowUp || onMintFollowUp)) || channels ? (
          <>
            <div className="v3fs-kit-cap">Channels</div>
            <div className="v3fs-kit-ch">
              {kit.followUp && onScheduleFollowUp ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Meeting<span>Book it — run the script in the room, capture below</span></div>
                  <div className="v3fs-kit-chan-a">
                    <input type="date" value={followDate} onChange={(event) => setFollowDate(event.target.value)} aria-label="Follow-up date" />
                    <button type="button" className="v3fs-btn" disabled={busy || !followDate} onClick={() => void schedule()}>
                      {scheduledTick ? "Scheduled ✓" : "Schedule"}
                    </button>
                  </div>
                </div>
              ) : null}
              {kit.followUp && onMintFollowUp ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Link<span>ATOS asks for you — answers land in the Inbox, attributed</span></div>
                  <div className="v3fs-kit-chan-a">
                    <button type="button" className="v3fs-btn" disabled={busy} onClick={() => void sendLink()}>
                      {linkTick ? "Link copied ✓" : "✳ Mint the link"}
                    </button>
                  </div>
                </div>
              ) : null}
              {channels}
            </div>
          </>
        ) : null}
        <div className="v3fs-kit-cap">What came back</div>
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
          <details className="v3fs-kit-doc" open={docOpen} onToggle={(event) => setDocOpen(event.currentTarget.open)}>
            <summary>＋ Ingest a referenced document</summary>
            <div className="v3fs-kit-docrow">
              <input value={docName} onChange={(event) => setDocName(event.target.value)}
                placeholder="Document name (e.g. Q2 pricing export)" aria-label="Document name" />
              <textarea rows={2} value={docText} onChange={(event) => setDocText(event.target.value)}
                placeholder="Paste its content — it becomes evidence beside the conversation." aria-label="Document content" />
              <button type="button" className="v3fs-btn" disabled={busy || !docName.trim() || !docText.trim()}
                onClick={() => void saveDoc()}>
                {docTick ? "Ingested ✓" : "Ingest the document"}
              </button>
            </div>
          </details>
        </div>
      </div>
    </details>
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
    <div className="v3fs-kit-chan v3fs-async">
      <div className="v3fs-kit-chan-t">Async interviews<span>one link per voice — answers land in the Inbox, attributed</span></div>
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
    <div className="v3fs-kit-chan v3fs-async">
      <div className="v3fs-kit-chan-t">Demo links<span>one per stakeholder — verdicts arrive in the Inbox</span></div>
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
          Compiles from the Blueprint, the hardening plan and the roster.
          The gate goes green when validation is done and cutover has executed.
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
