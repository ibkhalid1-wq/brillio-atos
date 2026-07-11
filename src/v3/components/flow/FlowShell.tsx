import React, { useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import FlowCanvas from "@/v3/components/flow/FlowCanvas";
import FlowArtifactStudio, { type ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import FlowBoardPack from "@/v3/components/flow/FlowBoardPack";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, movementEvidence, movementArtifacts, listenCoverage,
  demoAcceptance, daysToFirstDemo, wordsOfEvidence, frameKpis,
} from "@/v3/components/flow/flowShellData";
import {
  listOpenFlowDecisions, listFlowAttestations, listNextMoments, describeDecisionChanges,
  type FlowDecision,
} from "@/v3/components/flow/flowDecisions";
import {
  listFlowTracks, trackAcceptance, trackPace, trackBlockers,
  type FlowShowPass, type FlowTrack,
} from "@/v3/components/flow/flowTracks";
import { readFlowGovernance, flowAgentTier } from "@/v3/components/flow/flowGovernance";
import { listPortalInbox } from "@/v3/components/flow/flowPortal";
import { listSnapshots, type BlobSnapshot } from "@/v3/lib/blobSnapshots";

interface FlowShellProps {
  program: ProgramSummary;
  programs: ProgramSummary[];
  runningAgentIds: Set<string>;
  onSelectProgram: (id: string) => void;
  onCreateProgram: () => void;
  onOpenSetup: () => void;
  onOpenCopilot: () => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean }) => Promise<void>;
  /** Resolve an open decision (confirm applies its prepared payload). */
  onResolveDecision: (decisionId: string, resolution: "confirmed" | "declined") => Promise<void>;
  /** Record a movement's gate — demonstrated. Locks the movement's inputs. */
  onRecordGate?: (movementId: string) => Promise<void>;
  /** Reopen a demonstrated gate — evidence changed. Unlocks its inputs. */
  onReopenGate?: (movementId: string, reason: string) => Promise<void>;
  /** Restore the programme blob to a local snapshot's state. */
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
  /** Awaitable agent run for the spine runner. */
  onRunAgentAndWait?: (agentId: string, phaseId: string) => Promise<void>;
  /** Presence keys (emails) of others in this programme right now. */
  presence?: string[];
  /** Record a show/refine pass on a track. */
  onRecordShowPass: (trackId: string, pass: { stakeholder?: string; verdict: FlowShowPass["verdict"]; note?: string; stableDiff?: boolean }) => Promise<void>;
  /** Add a track by hand (the blueprint is the usual source). */
  onAddTrack: (input: { name: string; goal?: string }) => Promise<void>;
  /** In-flight runs for the Mission fleet board. */
  fleet: Array<{ agentId: string; phaseId?: string; status: string }>;
  /** Token spend per movement, from the runs ledger. */
  loadMovementSpend: () => Promise<Record<string, number>>;
  onSetHaltAll: (halted: boolean) => Promise<void>;
  onToggleAgentHalt: (agentId: string, halted: boolean) => Promise<void>;
  onSetMovementBudget: (movementId: string, tokens: number) => Promise<void>;
  /** Mint async-interview response links from the Discovery Kit. */
  onMintPacks: () => Promise<void>;
  /** Mint demo links from the Demo Scripts. */
  onMintDemoInvites: () => Promise<void>;
  /** Compile the ship plan from the blueprint. */
  onCompileShipLanes: () => Promise<void>;
  onToggleShipItem: (laneId: string, itemId: string) => Promise<void>;
  /** Hydrate every programme's full blob (Portfolio needs all of them). */
  onHydratePrograms: () => Promise<void>;
  /** Put a gap-closing follow-up on the calendar. */
  onScheduleFollowUp: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a follow-up link (ATOS asks the gaps itself); resolves to the URL. */
  onMintFollowUp: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc: (input: ArtifactEditInput) => Promise<void>;
  /** Confirm a quarantined portal response into evidence. */
  onIngestPortalItem: (itemId: string) => Promise<void>;
  onDismissPortalItem: (itemId: string) => Promise<void>;
}

type FlowView = "today" | "flow" | "tracks" | "library" | "pulse" | "mission" | "portfolio";

/**
 * "Paper & Flow" — the reimagined shell for ATOS Flow programmes. None of the
 * classic chrome renders here: a floating dock (Flow · Library · Pulse ·
 * Copilot), an editorial hero with the one metric that matters (days to first
 * demo), and the pipeline as the page. Brand hues carry one grammar: blue =
 * what people said, indigo = what ATOS made, green = what was demonstrated.
 * Theme-aware — follows the app's data-theme like every other surface.
 */
export default function FlowShell(props: FlowShellProps) {
  const { program } = props;
  // Land where the work is: Today only when something waits on the user's
  // judgment (decisions / quarantined evidence); the canvas otherwise, where
  // the spine pointer takes over. Today stays one badge-tap away.
  const [view, setView] = useState<FlowView>(() =>
    listOpenFlowDecisions(program).length + listPortalInbox(program).length > 0 ? "today" : "flow",
  );
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const days = daysToFirstDemo(program);
  const openDecisions = listOpenFlowDecisions(program);
  const portalInbox = listPortalInbox(program);
  // "Start here" — one prominent pointer at the right entry: Today when
  // anything waits on the user, the canvas otherwise. Dismissed for the
  // session the moment they go there.
  const waitingCount = openDecisions.length + portalInbox.length;
  const startId: FlowView = waitingCount > 0 ? "today" : "flow";
  const [startSeen, setStartSeen] = useState<boolean>(() => {
    try { return window.sessionStorage.getItem("v3fs-start-seen") === "1"; } catch { return true; }
  });
  const dismissStart = () => {
    setStartSeen(true);
    try { window.sessionStorage.setItem("v3fs-start-seen", "1"); } catch { /* ignore */ }
  };

  // The switcher dismisses like a menu should: backdrop click or Escape.
  useEffect(() => {
    if (!switcherOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSwitcherOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switcherOpen]);

  // Instrumentation: the shell's core promise is decision latency. Stamp when
  // it opens; the session's first resolution logs open→decided (see FlowToday).
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("v3fs-open-ts")) sessionStorage.setItem("v3fs-open-ts", String(Date.now()));
    } catch { /* metrics never block the shell */ }
  }, []);

  return (
    <div className="v3fs-app">
      <nav className="v3fs-dock" aria-label="Primary">
        <button type="button" className="v3fs-brand" onClick={() => setSwitcherOpen((v) => !v)} aria-label="Programme menu" aria-expanded={switcherOpen}>
          {(program.name || "F").slice(0, 1).toUpperCase()}
          <span className="v3fs-brand-caret" aria-hidden="true">▾</span>
        </button>
        {([["today", "◈", "Inbox"], ["flow", "⟶", "Flow"], ["tracks", "▤", "Tracks"], ["library", "◫", "Library"], ["pulse", "◉", "Pulse"], ["mission", "⌘", "Mission"], ["portfolio", "⊞", "Portfolio"]] as const).map(([id, icon, label]) => (
          <button key={id} type="button" className={view === id ? "on" : ""}
            onClick={() => { setView(id); window.scrollTo({ top: 0 }); if (id === startId) dismissStart(); }}>
            {id === "today" && waitingCount > 0 ? <span className="v3fs-dock-n">{waitingCount}</span> : null}
            <span className="v3fs-ric" aria-hidden="true">{icon}</span><span className="v3fs-rlb">{label}</span>
            {id === startId && !startSeen && view !== startId ? (
              <span className="v3fs-start" role="status">
                <span className="v3fs-start-a" aria-hidden="true">◀</span>
                Start here{startId === "today" ? ` — ${waitingCount} waiting` : ""}
              </span>
            ) : null}
          </button>
        ))}
        <div className="v3fs-dock-sep" aria-hidden="true" />
        <button type="button" className="v3fs-cp" onClick={props.onOpenCopilot}>
          <span className="v3fs-ric" aria-hidden="true">✦</span><span className="v3fs-rlb">Copilot</span>
        </button>
      </nav>

      {switcherOpen ? (
        <div className="v3fs-switcher-backdrop" onClick={() => setSwitcherOpen(false)} aria-hidden="true" />
      ) : null}
      {switcherOpen ? (
        <div className="v3fs-switcher" role="menu">
          <div className="v3fs-switcher-l">Programmes</div>
          {props.programs.map((entry) => (
            <button key={entry.id} type="button" role="menuitem" className={entry.id === program.id ? "on" : ""}
              onClick={() => { setSwitcherOpen(false); props.onSelectProgram(entry.id); }}>
              {entry.name}
            </button>
          ))}
          <div className="v3fs-switcher-sep" />
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onCreateProgram(); }}>＋ New programme</button>
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onOpenSetup(); }}>Programme setup</button>
        </div>
      ) : null}

      <div className="v3fs-wrap">
        <header className="v3fs-hero">
          <div className="v3fs-hero-eyebrow">
            ATOS Flow{program.client ? <span> · {program.client}</span> : null}
          </div>
          <h1 className="v3fs-hero-title">{program.name}</h1>
          {days != null ? (
            <p className="v3fs-hero-line">
              <b>{days}</b> day{Math.abs(days) === 1 ? "" : "s"} {days >= 0 ? "to first demo" : "past the first-demo target"}
            </p>
          ) : null}
          {props.presence?.length ? (
            <span className="v3fs-presence" title={props.presence.join(", ")}>
              <span className="v3fs-presence-dot" aria-hidden="true" />
              {props.presence.length === 1 ? `${props.presence[0].split("@")[0]} is here too` : `${props.presence.length} others are here`}
            </span>
          ) : null}
        </header>

        {view !== "today" && waitingCount > 0 ? (
          // Judgment stays visible from every view: one line naming the first
          // waiting item, one tap to the Inbox. The queue itself lives there.
          <button type="button" className="v3fs-wait" onClick={() => { setView("today"); window.scrollTo({ top: 0 }); dismissStart(); }}>
            <span className="v3fs-wait-n">{waitingCount}</span>
            <span className="v3fs-wait-t">
              Waiting on you — {openDecisions[0]?.title ?? `${portalInbox[0]?.stakeholder ?? "a stakeholder"}'s response`}
              {waitingCount > 1 ? ` · ${waitingCount - 1} more` : ""}
            </span>
            <span className="v3fs-wait-go">Review →</span>
          </button>
        ) : null}

        <ViewBoundary view={view}>
        {view === "today" ? (
          <FlowToday program={program} onResolveDecision={props.onResolveDecision}
            onIngestPortalItem={props.onIngestPortalItem} onDismissPortalItem={props.onDismissPortalItem}
            onGoFlow={() => { setView("flow"); window.scrollTo({ top: 0 }); }} />
        ) : view === "flow" ? (
          <FlowCanvas program={program} runningAgentIds={props.runningAgentIds} onRunAgent={props.onRunAgent} onSaveInputs={props.onSaveInputs} onMintPacks={props.onMintPacks} onMintDemoInvites={props.onMintDemoInvites} onCompileShipLanes={props.onCompileShipLanes} onToggleShipItem={props.onToggleShipItem} onScheduleFollowUp={props.onScheduleFollowUp} onMintFollowUp={props.onMintFollowUp} onSaveArtifactDoc={props.onSaveArtifactDoc} onRecordGate={props.onRecordGate} onReopenGate={props.onReopenGate} onRunAgentAndWait={props.onRunAgentAndWait} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }} />
        ) : view === "tracks" ? (
          <FlowTracks
            program={program}
            runningAgentIds={props.runningAgentIds}
            onRunAgent={props.onRunAgent}
            onSaveInputs={props.onSaveInputs}
            onRecordShowPass={props.onRecordShowPass}
            onAddTrack={props.onAddTrack}
          />
        ) : view === "library" ? (
          <FlowLibrary program={program} onSaveArtifactDoc={props.onSaveArtifactDoc} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }} />
        ) : view === "mission" ? (
          <FlowMission
            program={program}
            fleet={props.fleet}
            loadMovementSpend={props.loadMovementSpend}
            onSetHaltAll={props.onSetHaltAll}
            onToggleAgentHalt={props.onToggleAgentHalt}
            onSetMovementBudget={props.onSetMovementBudget}
            onRestoreSnapshot={props.onRestoreSnapshot}
          />
        ) : view === "portfolio" ? (
          <FlowPortfolio
            programs={props.programs}
            activeId={program.id}
            onSelectProgram={props.onSelectProgram}
            onHydratePrograms={props.onHydratePrograms}
          />
        ) : (
          <FlowPulse program={program} />
        )}
        </ViewBoundary>
      </div>
    </div>
  );
}

/**
 * One malformed movement or ledger must not blank the shell: each view
 * renders inside a boundary that fails to a quiet card naming the view,
 * while the dock keeps every other surface reachable. Remounts on view
 * change so a crash in one view never poisons the next.
 */
class ViewBoundary extends React.Component<{ view: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { view: string }) {
    if (prev.view !== this.props.view && this.state.failed) this.setState({ failed: false });
  }
  componentDidCatch(error: unknown) { console.error("[flow-view]", this.props.view, error); }
  render() {
    if (this.state.failed) {
      return (
        <div className="v3fs-panel v3fs-view-fail" role="alert">
          <div className="v3fs-ph"><h3>This screen hit an error</h3><span>everything else still works</span></div>
          <div className="v3fs-empty">Your data is intact — this screen just failed to display it. Switching views or reloading usually fixes it; the console has the details.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Today: decisions waiting on you, the log, the moments ahead ─────────── */

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtMomentDate(value: string): string {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(t)) return value;
  return new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function DecisionCard({ program, decision, movementLabel, busy, onResolve }: {
  program: ProgramSummary;
  decision: FlowDecision;
  movementLabel: string;
  busy: boolean;
  onResolve: (id: string, resolution: "confirmed" | "declined") => void;
}) {
  const changes = describeDecisionChanges(program, decision);
  return (
    <article className="v3fs-dec">
      <div className="v3fs-dec-top">
        <span className={`v3fs-tier t${decision.tier}`}>Tier {decision.tier}</span>
        {movementLabel ? <span className="v3fs-dec-mv">{movementLabel}</span> : null}
        {decision.createdAt ? <span className="v3fs-dec-when">{timeAgo(decision.createdAt)}</span> : null}
      </div>
      <h3 className="v3fs-dec-t">{decision.title}</h3>
      {decision.summary ? <p className="v3fs-dec-s">{decision.summary}</p> : null}
      {decision.blocking ? <p className="v3fs-dec-b">Waiting on this: {decision.blocking}</p> : null}
      {decision.recommendation ? (
        <div className="v3fs-dec-rec">
          <div className="v3fs-dec-rec-a">Recommended — {decision.recommendation.action}</div>
          {decision.recommendation.rationale ? <div className="v3fs-dec-rec-r">{decision.recommendation.rationale}</div> : null}
          {decision.recommendation.band ? <div className="v3fs-dec-rec-b">{decision.recommendation.band}</div> : null}
        </div>
      ) : null}
      {changes.length ? (
        <div className="v3fs-dec-diff">
          <div className="v3fs-dec-diff-cap">What changes on confirm</div>
          {changes.map((change) => (
            <div key={change.target} className="v3fs-dec-diff-item">
              <div className="v3fs-dec-diff-t">{change.target}<span>{change.effect}</span></div>
              {change.rows.length ? (
                <ul className="v3fs-dec-diff-rows">
                  {change.rows.map((row) => <li key={row}>{row}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="v3fs-dec-cta">
        <button type="button" className="v3fs-btn pri" disabled={busy} onClick={() => onResolve(decision.id, "confirmed")}>
          {busy ? "Applying…" : decision.recommendation?.action || "Confirm"}
        </button>
        <button type="button" className="v3fs-btn" disabled={busy} onClick={() => onResolve(decision.id, "declined")}>
          Decline
        </button>
      </div>
    </article>
  );
}

function FlowToday({ program, onResolveDecision, onIngestPortalItem, onDismissPortalItem, onGoFlow }: {
  program: ProgramSummary;
  onResolveDecision: FlowShellProps["onResolveDecision"];
  onIngestPortalItem: FlowShellProps["onIngestPortalItem"];
  onDismissPortalItem: FlowShellProps["onDismissPortalItem"];
  onGoFlow: () => void;
}) {
  const movements = useMemo(() => flowMovements(), []);
  const open = listOpenFlowDecisions(program);
  const feed = listFlowAttestations(program);
  const moments = listNextMoments(program);
  const inbox = listPortalInbox(program);
  const [busyId, setBusyId] = useState<string | null>(null);
  const label = (id: string) => movements.find((m) => m.id === id)?.displayName ?? id;

  const actOnItem = async (itemId: string, fn: (id: string) => Promise<void>) => {
    setBusyId(itemId);
    try { await fn(itemId); } finally { setBusyId(null); }
  };

  // "While you were away" — the channels story without a transport: the last
  // seen stamp is read ONCE per mount, then refreshed, so the strip shows
  // what landed in the gap (only when the gap is long enough to matter).
  const [awaySince] = useState<number>(() => {
    try { return Number(window.localStorage.getItem(`v3fs-seen-${program.id}`) || 0); } catch { return 0; }
  });
  useEffect(() => {
    const stamp = () => {
      try { window.localStorage.setItem(`v3fs-seen-${program.id}`, String(Date.now())); } catch { /* ignore */ }
    };
    stamp();
    window.addEventListener("beforeunload", stamp);
    return () => { window.removeEventListener("beforeunload", stamp); stamp(); };
  }, [program.id]);
  const AWAY_GAP_MS = 30 * 60 * 1000;
  const awayItems = awaySince > 0 && Date.now() - awaySince > AWAY_GAP_MS
    ? feed.filter((entry) => Date.parse(entry.ts) > awaySince)
    : [];

  const resolve = async (id: string, resolution: "confirmed" | "declined") => {
    setBusyId(id);
    try {
      await onResolveDecision(id, resolution);
      try {
        // Open→first-decision latency, the design target this surface is judged
        // by. Rolling window of 20 in localStorage; read via console for now.
        const openedAt = Number(sessionStorage.getItem("v3fs-open-ts") || 0);
        if (openedAt) {
          const log = JSON.parse(localStorage.getItem("v3fs-decision-latency") || "[]") as number[];
          log.push(Math.round((Date.now() - openedAt) / 1000));
          localStorage.setItem("v3fs-decision-latency", JSON.stringify(log.slice(-20)));
          sessionStorage.removeItem("v3fs-open-ts");
        }
      } catch { /* metrics never block a resolution */ }
    } finally { setBusyId(null); }
  };

  return (
    <div className="v3fs-today">
      {awayItems.length ? (
        <div className="v3fs-away">
          <b>While you were away</b> — {awayItems.length} action{awayItems.length === 1 ? "" : "s"} landed:
          {" "}{awayItems.slice(0, 3).map((entry) => entry.action).join(" · ")}{awayItems.length > 3 ? " · …" : ""}
        </div>
      ) : null}
      {open.length === 0 && inbox.length === 0 ? (
        <div className="v3fs-quiet">
          <div className="v3fs-quiet-mark" aria-hidden="true">◈</div>
          <h2>Nothing needs you right now.</h2>
          <p>Decisions and quarantined evidence appear here when they need you.</p>
          <button type="button" className="v3fs-btn" onClick={onGoFlow}>Review the flow</button>
        </div>
      ) : (
        <section className="v3fs-inbox" aria-label="Waiting on you">
          <div className="v3fs-ph">
            <h3>Waiting on you</h3>
            <span>{open.length + inbox.length} item{open.length + inbox.length === 1 ? "" : "s"}</span>
          </div>
          {open.map((decision) => (
            <DecisionCard key={decision.id} program={program} decision={decision} movementLabel={label(decision.movementId)}
              busy={busyId === decision.id} onResolve={resolve} />
          ))}
          {inbox.map((item) => (
            <article key={item.id} className="v3fs-dec v3fs-evitem">
              <div className="v3fs-dec-top">
                {item.kind === "demo-verdict" ? (
                  <span className={`v3fs-vc ${item.verdict === "rework" ? "pen" : "acc"}`}>{(item.verdict ?? "verdict").replace(/-/g, " ")}</span>
                ) : (
                  <span className="v3fs-tag ev">async response</span>
                )}
                <span className="v3fs-dec-mv">{item.stakeholder}{item.role ? ` · ${item.role}` : ""}</span>
                {item.receivedAt ? <span className="v3fs-dec-when">{timeAgo(item.receivedAt)}</span> : null}
              </div>
              {item.text ? <p className="v3fs-dec-s">“{item.text.slice(0, 220)}{item.text.length > 220 ? "…" : ""}”</p> : null}
              <div className="v3fs-dec-rec-b">
                {item.kind === "demo-verdict"
                  ? "confirming updates the tour ledger and the track's show record"
                  : `${item.text.split(/\s+/).length.toLocaleString()} words`}
              </div>
              <div className="v3fs-dec-cta">
                <button type="button" className="v3fs-btn pri" disabled={busyId === item.id}
                  onClick={() => void actOnItem(item.id, onIngestPortalItem)}>
                  {busyId === item.id ? "Ingesting…" : item.kind === "demo-verdict" ? "Record the verdict" : "Ingest as evidence"}
                </button>
                <button type="button" className="v3fs-btn" disabled={busyId === item.id}
                  onClick={() => void actOnItem(item.id, onDismissPortalItem)}>
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <details className="v3fs-disc">
        <summary>
          <span className="v3fs-disc-l">Activity{feed.length ? <em>{feed.length}</em> : null}</span>
          <span className="v3fs-disc-hint">{feed[0] ? `${feed[0].action} · ${timeAgo(feed[0].ts)}` : "no runs yet"}</span>
          <span className="v3fs-disc-c" aria-hidden="true" />
        </summary>
        <div className="v3fs-disc-b">
          {feed.length === 0 ? <div className="v3fs-empty">Generate the first artifact in Frame and it will be attested here.</div> : null}
          {feed.slice(0, 12).map((entry, i) => (
            <div key={i} className="v3fs-row">
              <span className={`v3fs-tdot t${entry.tier}`} aria-hidden="true" />
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{entry.action}</div>
                <div className="v3fs-row-m">{[label(entry.phaseId), entry.detail].filter(Boolean).join(" — ")}</div>
              </div>
              <span className="v3fs-feed-ts">{timeAgo(entry.ts)}</span>
            </div>
          ))}
          {feed.length > 12 ? <div className="v3fs-empty">The full searchable trail lives in Mission.</div> : null}
        </div>
      </details>

      <details className="v3fs-disc">
        <summary>
          <span className="v3fs-disc-l">Moments ahead{moments.length ? <em>{moments.length}</em> : null}</span>
          <span className="v3fs-disc-hint">{moments[0] ? `${fmtMomentDate(moments[0].date)} — ${moments[0].label}` : "nothing scheduled yet"}</span>
          <span className="v3fs-disc-c" aria-hidden="true" />
        </summary>
        <div className="v3fs-disc-b">
          {moments.length === 0 ? <div className="v3fs-empty">Booked sessions, pending demonstrations and the first-demo target appear here as they are scheduled.</div> : null}
          {moments.map((moment, i) => (
            <div key={i} className="v3fs-row">
              <span className={`v3fs-tag ${moment.kind === "demo" ? "gn" : "ev"}`}>{fmtMomentDate(moment.date)}</span>
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{moment.label}</div>
                <div className="v3fs-row-m">{moment.kind === "target" ? "set in Frame" : moment.kind === "session" ? "from the interview roster" : "from the demonstration tour"}</div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

/* ── Tracks: the build as demoable workstreams; acceptance is earned ─────── */

function TrackCard({ track, all, busy, onRecord, onOpen }: {
  track: FlowTrack;
  all: FlowTrack[];
  busy: boolean;
  onRecord: (trackId: string, pass: { stakeholder?: string; verdict: FlowShowPass["verdict"]; stableDiff?: boolean }) => Promise<void>;
  onOpen: () => void;
}) {
  const acceptance = trackAcceptance(track);
  const pace = trackPace(track, acceptance.accepted);
  const blockers = trackBlockers(track, all);
  const [recording, setRecording] = useState(false);
  const [stakeholder, setStakeholder] = useState(track.leadStakeholder ?? "");
  const [verdict, setVerdict] = useState<FlowShowPass["verdict"]>("accepted");
  const [stableDiff, setStableDiff] = useState(false);

  const save = async () => {
    await onRecord(track.id, {
      stakeholder: stakeholder.trim() || undefined,
      verdict,
      stableDiff: track.showPasses.length > 0 && stableDiff ? true : undefined,
    });
    setRecording(false);
    setStableDiff(false);
  };

  return (
    <article className={`v3fs-trk${acceptance.accepted ? " acc" : ""}`}>
      <div className="v3fs-trk-top">
        <h3>{track.name}</h3>
        <span className={`v3fs-pace ${pace.tone}`}>{pace.label}</span>
      </div>
      {track.goal ? <p className="v3fs-trk-g">{track.goal}</p> : null}
      <div className="v3fs-trk-meta">
        <span className={`v3fs-accst${acceptance.accepted ? " ok" : ""}`}>
          {acceptance.accepted ? "✓ accepted" : acceptance.label}
        </span>
        {track.leadStakeholder ? <span>demos to {track.leadStakeholder}</span> : null}
        {track.slices.length ? <span>{track.slices.length} slice{track.slices.length === 1 ? "" : "s"}</span> : null}
      </div>
      {track.showPasses.length ? (
        <div className="v3fs-trk-passes" aria-label="Demonstration passes">
          {track.showPasses.map((pass, i) => (
            <span key={i} className={`v3fs-pdot ${pass.verdict === "rework" ? "rw" : "ok"}`}
              title={`${pass.verdict}${pass.stakeholder ? ` — ${pass.stakeholder}` : ""}`} />
          ))}
        </div>
      ) : null}
      {blockers.length ? (
        <div className="v3fs-trk-deps">
          {blockers.map((blocker) => <span key={blocker.id} className="v3fs-dep">waiting on {blocker.name}</span>)}
        </div>
      ) : null}
      {recording ? (
        <div className="v3fs-pass-form">
          <input value={stakeholder} onChange={(e) => setStakeholder(e.target.value)} placeholder="Who watched it run?" aria-label="Stakeholder" />
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as FlowShowPass["verdict"])} aria-label="Verdict">
            <option value="accepted">Accepted</option>
            <option value="accepted-with-changes">Accepted with changes</option>
            <option value="rework">Needs rework</option>
          </select>
          {track.showPasses.length > 0 ? (
            <label className="v3fs-pass-stable">
              <input type="checkbox" checked={stableDiff} onChange={(e) => setStableDiff(e.target.checked)} />
              diff since last pass reviewed &amp; stable
            </label>
          ) : null}
          <div className="v3fs-dec-cta">
            <button type="button" className="v3fs-btn pri" disabled={busy} onClick={() => void save()}>{busy ? "Recording…" : "Record pass"}</button>
            <button type="button" className="v3fs-btn" disabled={busy} onClick={() => setRecording(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="v3fs-dec-cta">
          <button type="button" className="v3fs-btn" onClick={() => setRecording(true)}>Record a pass</button>
          <button type="button" className="v3fs-btn" onClick={onOpen}>Open in canvas</button>
        </div>
      )}
    </article>
  );
}

function FlowTracks({ program, runningAgentIds, onRunAgent, onSaveInputs, onRecordShowPass, onAddTrack }: {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  onRunAgent: FlowShellProps["onRunAgent"];
  onSaveInputs: FlowShellProps["onSaveInputs"];
  onRecordShowPass: FlowShellProps["onRecordShowPass"];
  onAddTrack: FlowShellProps["onAddTrack"];
}) {
  const tracks = listFlowTracks(program);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addGoal, setAddGoal] = useState("");

  const record = async (trackId: string, pass: { stakeholder?: string; verdict: FlowShowPass["verdict"]; stableDiff?: boolean }) => {
    setBusyId(trackId);
    try { await onRecordShowPass(trackId, pass); } finally { setBusyId(null); }
  };

  const drilled = drillId ? tracks.find((t) => t.id === drillId) : undefined;
  if (drilled) {
    return (
      <div className="v3fs-trkwrap">
        <nav className="v3fs-crumb" aria-label="Breadcrumb">
          <button type="button" onClick={() => setDrillId(null)}>Tracks</button>
          <span aria-hidden="true">▸</span>
          <b>{drilled.name}</b>
          <span className="v3fs-crumb-note">{trackAcceptance(drilled).accepted ? "accepted" : trackAcceptance(drilled).label}</span>
        </nav>
        {drilled.goal ? <p className="v3fs-trk-goal">{drilled.goal}</p> : null}
        {drilled.slices.length ? (
          <div className="v3fs-trk-slices">
            {drilled.slices.map((slice) => <span key={slice}>{slice}</span>)}
          </div>
        ) : null}
        <FlowCanvas program={program} runningAgentIds={runningAgentIds} onRunAgent={onRunAgent} onSaveInputs={onSaveInputs} />
      </div>
    );
  }

  return (
    <div className="v3fs-today">
      {tracks.length === 0 ? (
        <div className="v3fs-quiet">
          <div className="v3fs-quiet-mark" aria-hidden="true">▤</div>
          <h2>No tracks yet.</h2>
          <p>Generate the Agentic Blueprint in Envision — adopting its track plan in the Inbox fills this board.</p>
        </div>
      ) : (
        <div className="v3fs-trkgrid">
          {tracks.map((track) => (
            <TrackCard key={track.id} track={track} all={tracks} busy={busyId === track.id}
              onRecord={record} onOpen={() => { setDrillId(track.id); window.scrollTo({ top: 0 }); }} />
          ))}
        </div>
      )}

      <div className="v3fs-addtrk">
        {addOpen ? (
          <div className="v3fs-pass-form">
            <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Track name" aria-label="Track name" />
            <input value={addGoal} onChange={(e) => setAddGoal(e.target.value)} placeholder="What it demonstrates (one sentence)" aria-label="Track goal" />
            <div className="v3fs-dec-cta">
              <button type="button" className="v3fs-btn pri" disabled={!addName.trim()}
                onClick={async () => { await onAddTrack({ name: addName, goal: addGoal }); setAddName(""); setAddGoal(""); setAddOpen(false); }}>
                Add track
              </button>
              <button type="button" className="v3fs-btn" onClick={() => setAddOpen(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="v3fs-a" onClick={() => setAddOpen(true)}>＋ Add a track by hand</button>
        )}
      </div>
    </div>
  );
}

/* ── Mission Control: the fleet, the budgets, the levers, the trail ──────── */

function FlowMission({ program, fleet, loadMovementSpend, onSetHaltAll, onToggleAgentHalt, onSetMovementBudget, onRestoreSnapshot }: {
  program: ProgramSummary;
  fleet: FlowShellProps["fleet"];
  loadMovementSpend: FlowShellProps["loadMovementSpend"];
  onSetHaltAll: FlowShellProps["onSetHaltAll"];
  onToggleAgentHalt: FlowShellProps["onToggleAgentHalt"];
  onSetMovementBudget: FlowShellProps["onSetMovementBudget"];
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
}) {
  const movements = useMemo(() => flowMovements(), []);
  const governance = readFlowGovernance(program);
  const trail = listFlowAttestations(program);
  const [spend, setSpend] = useState<Record<string, number> | null>(null);
  const [query, setQuery] = useState("");
  const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // The spend ledger comes from the runs table, not the blob — load on mount
  // and after every governance change (the levers alter what runs next).
  useEffect(() => {
    let alive = true;
    void loadMovementSpend().then((result) => { if (alive) setSpend(result); }).catch(() => { if (alive) setSpend({}); });
    return () => { alive = false; };
  }, [loadMovementSpend, program]);

  // Every agent the programme can run — the artifact generators plus the
  // planner. Governance levers name agents from this list.
  const agentIds = useMemo(() => {
    const ids = new Set<string>(["phase-input-planner"]);
    for (const movement of movements) {
      for (const artifact of movementArtifacts(program, movement)) ids.add(artifact.id);
    }
    return [...ids];
  }, [program, movements]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const q = query.trim().toLowerCase();
  const visibleTrail = q
    ? trail.filter((entry) => `${entry.agentId} ${entry.action} ${entry.detail ?? ""} ${entry.phaseId}`.toLowerCase().includes(q))
    : trail;

  return (
    <div className="v3fs-today">
      {governance.haltAll ? (
        <div className="v3fs-halt-banner">
          <span>The programme is halted — every agent run blocks until you resume.</span>
          <button type="button" className="v3fs-btn pri" disabled={busy} onClick={() => void act(() => onSetHaltAll(false))}>Resume the programme</button>
        </div>
      ) : null}

      <div className="v3fs-grid2">
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Fleet</h3><span>running now</span></div>
          {fleet.length === 0 ? <div className="v3fs-empty">The fleet is idle. Runs appear here the moment one starts.</div> : null}
          {fleet.map((run, i) => (
            <div key={`${run.agentId}-${i}`} className="v3fs-row">
              <span className="v3fs-gdot" aria-hidden="true" />
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{run.agentId}</div>
                <div className="v3fs-row-m">{[run.status, run.phaseId].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="v3fs-tag gn">tier {flowAgentTier(run.agentId)}</span>
            </div>
          ))}
          {governance.haltedAgents.length ? (
            <>
              <div className="v3fs-ph v3fs-ph-sub"><h3>Held</h3><span>halted agents — resume to allow runs</span></div>
              {governance.haltedAgents.map((agentId) => (
                <div key={agentId} className="v3fs-row">
                  <span className="v3fs-tdot t2" aria-hidden="true" />
                  <div className="v3fs-row-g"><div className="v3fs-row-n">{agentId}</div></div>
                  <button type="button" className="v3fs-btn" disabled={busy} onClick={() => void act(() => onToggleAgentHalt(agentId, false))}>Resume</button>
                </div>
              ))}
            </>
          ) : null}
        </div>

        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Budgets</h3><span>token spend per movement</span></div>
          {movements.map((movement) => {
            const spent = spend?.[movement.id] ?? null;
            const cap = governance.movementBudgets[movement.id];
            const pct = cap && spent != null ? Math.min(100, Math.round((spent / cap) * 100)) : null;
            return (
              <div key={movement.id} className="v3fs-budget">
                <div className="v3fs-budget-t">
                  <b>{movement.displayName}</b>
                  <span>
                    {spend === null ? "…" : `${(spent ?? 0).toLocaleString()} tokens`}
                    {cap ? ` / ${cap.toLocaleString()}` : " · no cap"}
                  </span>
                </div>
                {cap ? (
                  <div className="v3fs-budget-bar"><div className={`v3fs-budget-fill${(pct ?? 0) >= 90 ? " hot" : ""}`} style={{ width: `${pct ?? 0}%` }} /></div>
                ) : null}
              </div>
            );
          })}
          <details className="v3fs-disc v3fs-disc-sm">
            <summary>
              <span className="v3fs-disc-l">Adjust caps</span>
              <span className="v3fs-disc-c" aria-hidden="true" />
            </summary>
            <div className="v3fs-disc-b">
              {movements.map((movement) => (
                <div key={movement.id} className="v3fs-budget-edit">
                  <span className="v3fs-budget-edit-l">{movement.displayName}</span>
                  <input
                    inputMode="numeric"
                    placeholder="tokens · 0 removes"
                    value={capDrafts[movement.id] ?? ""}
                    onChange={(e) => setCapDrafts((d) => ({ ...d, [movement.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                    aria-label={`${movement.displayName} budget cap`}
                  />
                  <button type="button" className="v3fs-btn" disabled={busy || capDrafts[movement.id] == null || capDrafts[movement.id] === ""}
                    onClick={() => void act(async () => {
                      await onSetMovementBudget(movement.id, Number(capDrafts[movement.id] || 0));
                      setCapDrafts((d) => ({ ...d, [movement.id]: "" }));
                    })}>
                    Set
                  </button>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Guardrails</h3><span>every change lands on the trail</span></div>
        <div className="v3fs-guard-row">
          <div className="v3fs-row-g">
            <div className="v3fs-row-n">Halt everything</div>
            <div className="v3fs-row-m">blocks every agent run on this programme until resumed</div>
          </div>
          <button type="button" className={`v3fs-btn${governance.haltAll ? "" : " danger"}`} disabled={busy}
            onClick={() => void act(() => onSetHaltAll(!governance.haltAll))}>
            {governance.haltAll ? "Resume" : "Halt"}
          </button>
        </div>
        <details className="v3fs-disc v3fs-disc-sm">
          <summary>
            <span className="v3fs-disc-l">Per-agent halts{governance.haltedAgents.length ? <em>{governance.haltedAgents.length} held</em> : null}</span>
            <span className="v3fs-disc-hint">{governance.haltedAgents.length ? governance.haltedAgents.join(", ") : "every agent may run"}</span>
            <span className="v3fs-disc-c" aria-hidden="true" />
          </summary>
          <div className="v3fs-disc-b">
            <div className="v3fs-guard-agents">
              {agentIds.map((agentId) => {
                const halted = governance.haltedAgents.includes(agentId);
                return (
                  <button key={agentId} type="button" className={`v3fs-guard-chip${halted ? " off" : ""}`} disabled={busy}
                    title={halted ? "Resume this agent" : "Halt this agent"}
                    onClick={() => void act(() => onToggleAgentHalt(agentId, !halted))}>
                    {halted ? "⏸ " : ""}{agentId}
                  </button>
                );
              })}
            </div>
          </div>
        </details>
        <div className="v3fs-guard-note">Tier 1 acts and attests · Tier 2 waits for your confirm · a hit cap queues the raise as a decision.</div>
      </div>

      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Trail</h3><span>every recorded action, searchable</span></div>
        <input className="v3fs-search" placeholder="Search the trail — an agent, a movement, a phrase…"
          value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search attestations" />
        {visibleTrail.length === 0 ? <div className="v3fs-empty">{q ? "Nothing matches that search." : "No actions recorded yet."}</div> : null}
        {visibleTrail.slice(0, 40).map((entry, i) => (
          <div key={i} className="v3fs-row">
            <span className={`v3fs-tdot t${entry.tier}`} aria-hidden="true" />
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">{entry.action}</div>
              <div className="v3fs-row-m">{[entry.agentId, entry.phaseId, entry.detail].filter(Boolean).join(" — ")}</div>
            </div>
            <span className="v3fs-feed-ts">{timeAgo(entry.ts)}</span>
          </div>
        ))}
        {visibleTrail.length > 40 ? <div className="v3fs-empty">+ {visibleTrail.length - 40} older entries</div> : null}
      </div>

      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Safety</h3><span>how things looked before each recent change — restoring is recorded too</span></div>
        <SnapshotSafety program={program} onRestoreSnapshot={onRestoreSnapshot} />
      </div>
    </div>
  );
}

/**
 * The snapshot ring, made visible: what the record looked like before each
 * recent write, with a two-step restore. Local to this browser by design —
 * reversibility for the operator's own actions.
 */
function SnapshotSafety({ program, onRestoreSnapshot }: {
  program: ProgramSummary;
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [snapshots, setSnapshots] = useState<BlobSnapshot[]>([]);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void listSnapshots(program.id).then((rows) => { if (alive) setSnapshots(rows); });
    return () => { alive = false; };
  }, [program.id, program.updatedAt]);
  useEffect(() => {
    if (armedId == null) return;
    const timer = window.setTimeout(() => setArmedId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armedId]);
  if (!snapshots.length) {
    return <div className="v3fs-empty">No snapshots yet — one is saved before every change, in this browser.</div>;
  }
  const restore = async (snapshot: BlobSnapshot) => {
    if (armedId !== snapshot.id) { setArmedId(snapshot.id); return; }
    if (!onRestoreSnapshot) return;
    setBusyId(snapshot.id);
    try { await onRestoreSnapshot(snapshot.data); } finally { setBusyId(null); setArmedId(null); }
  };
  return (
    <>
      {snapshots.slice(0, 10).map((snapshot) => (
        <div key={snapshot.id} className="v3fs-row">
          <span className="v3fs-tdot t1" aria-hidden="true" />
          <div className="v3fs-row-g">
            <div className="v3fs-row-n">{new Date(snapshot.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
            <div className="v3fs-row-m">{Math.max(1, Math.round(snapshot.bytes / 1024))} KB</div>
          </div>
          {onRestoreSnapshot ? (
            <button type="button" className={`v3fs-btn${armedId === snapshot.id ? " pri" : ""}`}
              disabled={busyId != null} onClick={() => void restore(snapshot)}>
              {busyId === snapshot.id ? "Restoring…" : armedId === snapshot.id ? "Confirm restore" : "Restore"}
            </button>
          ) : null}
        </div>
      ))}
    </>
  );
}

/* ── Portfolio: every Flow programme, the numbers that matter ────────────── */

function FlowPortfolio({ programs, activeId, onSelectProgram, onHydratePrograms }: {
  programs: ProgramSummary[];
  activeId: string;
  onSelectProgram: (id: string) => void;
  onHydratePrograms: () => Promise<void>;
}) {
  // Non-active programmes arrive metadata-only; the numbers need blobs.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let alive = true;
    void onHydratePrograms().then(() => { if (alive) setHydrated(true); }).catch(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [onHydratePrograms]);

  const flowProgrammes = programs.filter((entry) => entry.methodology === "atos-flow");
  const classicCount = programs.length - flowProgrammes.length;

  return (
    <div className="v3fs-today">
      {!hydrated ? <div className="v3fs-empty">Loading every programme&rsquo;s record…</div> : null}
      <div className="v3fs-trkgrid">
        {flowProgrammes.map((entry) => {
          const days = daysToFirstDemo(entry);
          const decisions = listOpenFlowDecisions(entry).length;
          const inbox = listPortalInbox(entry).length;
          const tracks = listFlowTracks(entry);
          const stalled = tracks.filter((track) => trackPace(track, trackAcceptance(track).accepted).tone === "stalled").length;
          const coverage = listenCoverage(entry);
          const needsYou = decisions + inbox;
          return (
            <article key={entry.id} className={`v3fs-trk${entry.id === activeId ? " acc" : ""}`}>
              <div className="v3fs-trk-top">
                <h3>{entry.name}</h3>
                {needsYou > 0 ? <span className="v3fs-pace watch">{needsYou} waiting</span> : <span className="v3fs-pace on-pace">clear</span>}
              </div>
              {entry.client ? <p className="v3fs-trk-g">{entry.client}</p> : null}
              <div className="v3fs-trk-meta">
                <span>{days != null ? `${days}d to first demo` : "no demo date"}</span>
                {decisions ? <span>{decisions} decision{decisions === 1 ? "" : "s"}</span> : null}
                {inbox ? <span>{inbox} in quarantine</span> : null}
                {tracks.length ? <span>{stalled ? `${stalled} stalled` : "tracks on pace"}</span> : null}
                {coverage.total ? <span>{coverage.done}/{coverage.total} heard</span> : null}
              </div>
              <div className="v3fs-dec-cta">
                <button type="button" className="v3fs-btn" disabled={entry.id === activeId}
                  onClick={() => onSelectProgram(entry.id)}>
                  {entry.id === activeId ? "You are here" : "Open"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {classicCount > 0 ? (
        <div className="v3fs-empty">
          + {classicCount} classic programme{classicCount === 1 ? "" : "s"} — switch to one from the programme menu to work it in the classic workspace.
        </div>
      ) : null}
    </div>
  );
}

/* ── Library: everything the programme knows ─────────────────────────────── */

function FlowLibrary({ program, onSaveArtifactDoc, onOpenInbox }: { program: ProgramSummary; onSaveArtifactDoc: FlowShellProps["onSaveArtifactDoc"]; onOpenInbox?: () => void }) {
  const movements = useMemo(() => flowMovements(), []);
  const [query, setQuery] = useState("");
  const [docFor, setDocFor] = useState<import("@/v3/components/flow/flowShellData").ArtifactCardModel | null>(null);
  const all = useMemo(() => ({
    evidence: movements.flatMap((m) => movementEvidence(program, m)),
    artifacts: movements.flatMap((m) => movementArtifacts(program, m)),
  }), [program, movements]);
  const [evFor, setEvFor] = useState<import("@/v3/components/flow/flowShellData").EvidenceEntry | null>(null);
  const q = query.trim().toLowerCase();
  const evidence = q ? all.evidence.filter((e) => `${e.who} ${e.fieldLabel} ${e.excerpt} ${e.text}`.toLowerCase().includes(q)) : all.evidence;
  const artifacts = q ? all.artifacts.filter((a) => `${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(q)) : all.artifacts;
  const label = (id: string) => movements.find((m) => m.id === id)?.displayName ?? id;

  return (
    <div className="v3fs-grid2">
      <div className="v3fs-search-row">
        <input
          className="v3fs-search"
          placeholder="Search everything the programme knows — a name, a number, a phrase…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search evidence and artifacts"
        />
      </div>
      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Evidence</h3><span>conversations and source material</span></div>
        {evidence.length === 0 ? <div className="v3fs-empty">{q ? "Nothing matches that search." : "No evidence captured yet. Add the first conversation in Frame or Listen."}</div> : null}
        {evidence.map((entry, i) => (
          <div key={i} className="v3fs-row v3fs-row-open" role="button" tabIndex={0}
            onClick={() => setEvFor(entry)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setEvFor(entry); }}>
            <span className="v3fs-tag ev">{label(entry.movementId)}</span>
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">{entry.who}</div>
              <div className="v3fs-row-m">{entry.kind === "reference" ? entry.meta : `${entry.words.toLocaleString()} words`}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="v3fs-panel">
        <div className="v3fs-ph"><h3>Artifacts</h3><span>generated, traceable to evidence</span></div>
        {artifacts.map((artifact) => (
          <div key={`${artifact.movementId}:${artifact.id}`}
            className={`v3fs-row${artifact.present ? " v3fs-row-open" : ""}`}
            role={artifact.present ? "button" : undefined}
            tabIndex={artifact.present ? 0 : undefined}
            onClick={artifact.present ? () => setDocFor(artifact) : undefined}
            onKeyDown={artifact.present ? (event) => { if (event.key === "Enter" || event.key === " ") setDocFor(artifact); } : undefined}>
            <span className={`v3fs-st ${artifact.present ? (artifact.stale ? "stale" : "ok") : "none"}`} />
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">{artifact.title}</div>
              <div className="v3fs-row-m">
                {artifact.present
                  ? artifact.stale
                    ? "evidence changed since generation — regenerate from Flow"
                    : artifact.confidence != null ? `generated · ${artifact.confidence}%` : "generated"
                  : "not yet generated"}
              </div>
            </div>
            <span className="v3fs-tag gn">{label(artifact.movementId)}</span>
          </div>
        ))}
      </div>
      {docFor ? <FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)} onSaveDoc={onSaveArtifactDoc} onOpenInbox={onOpenInbox} /> : null}
      {evFor ? <EvidenceReader entry={evFor} onClose={() => setEvFor(null)} /> : null}
    </div>
  );
}

/* ── Pulse: the steering-meeting screen ──────────────────────────────────── */

function FlowPulse({ program }: { program: ProgramSummary }) {
  const days = daysToFirstDemo(program);
  const coverage = listenCoverage(program);
  const demos = demoAcceptance(program);
  const words = wordsOfEvidence(program);
  const kpis = frameKpis(program);
  const [packOpen, setPackOpen] = useState(false);

  return (
    <div className="v3fs-pulse">
      <div className="v3fs-pulse-bar">
        <button type="button" className="v3fs-btn" onClick={() => setPackOpen(true)}>
          ⎙ Board pack — print or save as PDF
        </button>
      </div>
      {packOpen ? <FlowBoardPack program={program} onClose={() => setPackOpen(false)} /> : null}
      <div className="v3fs-stats">
        <div className="v3fs-stat hero">
          <div className="v3fs-stat-n">{days != null ? <b>{days}</b> : <b>—</b>}{days != null ? <small> days</small> : null}</div>
          <div className="v3fs-stat-l">{days != null ? "to first demo" : "first-demo date unset"}</div>
        </div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{coverage.done}</b><small>/{coverage.total || "?"}</small></div><div className="v3fs-stat-l">stakeholders engaged</div></div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{demos.accepted}</b><small>/{demos.total || "?"}</small></div><div className="v3fs-stat-l">demonstrations accepted</div></div>
        <div className="v3fs-stat"><div className="v3fs-stat-n"><b>{words.toLocaleString()}</b></div><div className="v3fs-stat-l">words of evidence</div></div>
      </div>
      <div className="v3fs-grid2">
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Stakeholder demonstrations</h3><span>acceptance recorded person by person</span></div>
          {demos.rows.length === 0 ? <div className="v3fs-empty">Demonstrations are scheduled and recorded in the Show movement.</div> : null}
          {demos.rows.map((row, i) => (
            <div key={i} className="v3fs-row">
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{row.stakeholder || "—"}</div>
                <div className="v3fs-row-m">{row.reaction || row.date || ""}</div>
              </div>
              <span className={`v3fs-vc ${/accepted/i.test(row.verdict ?? "") ? "acc" : "pen"}`}>{row.verdict || "Pending"}</span>
            </div>
          ))}
        </div>
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Outcomes</h3><span>measured against stakeholder-stated baselines</span></div>
          {kpis.length === 0 ? <div className="v3fs-empty">Success KPIs defined in Frame appear here, with baselines drawn from discovery.</div> : null}
          {kpis.map((kpi, i) => (
            <div key={i} className="v3fs-kpi">
              <div className="v3fs-kpi-t"><b>{kpi.name}</b><span>{[kpi.baseline, kpi.target].filter(Boolean).join(" → ")}{kpi.unit ? ` ${kpi.unit}` : ""}</span></div>
              <div className="v3fs-river"><div className="v3fs-river-to" /><div className="v3fs-river-mk" /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
