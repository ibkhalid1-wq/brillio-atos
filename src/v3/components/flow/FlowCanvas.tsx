import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
// The artifact studio pulls React Flow and every WYSIWYG editor — a heavy
// chunk only needed when a document is opened. Lazy-load it so it never
// weighs on the initial Flow render.
const FlowArtifactStudio = lazy(() => import("@/v3/components/flow/studio/FlowArtifactStudio"));
import type { ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts,
  gateReadiness, gateChecklist, listenCoverage, movementFacts, demoAcceptance,
  spineRegenerationPlan, attestHeardRoster, artifactOpenGaps,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";
import { artifactApprovalRollup, type ApprovalStatus, type ApproverState } from "@/v3/components/flow/flowApprovals";
import { gateAugmentations } from "@/v3/components/flow/flowCrossValidation";
import { meetingKit } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, listDemoInvites, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { readDrillAnchor } from "@/v3/components/flow/flowDrilldown";
import { gateApprovalIntegrity } from "@/v3/components/flow/flowGovernance";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { listFlowTracks, trackAcceptance } from "@/v3/components/flow/flowTracks";
import { safePrompt } from "@/v3/components/flow/flowCapture";
import { MOVEMENT_CAPTION, leadTab, type MovementTab } from "@/v3/components/flow/flowStages";
import { SpineQueueItem, UpNextButton, useSpineRunning, type UpNextItem } from "@/v3/components/flow/flowUpNext";
import { IntervieweeDiscovery, stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import MeetingKitCard from "@/v3/components/flow/MeetingKitCard";

interface FlowCanvasProps {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  /** Per-artifact failure residue from the last run — shown on the card
   * until the next attempt, so a dead run can never pass for a quiet one. */
  agentErrors?: Record<string, string>;
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
  /** Set a whole ship lane done/undone at once. */
  onSetShipLane?: (laneId: string, done: boolean) => Promise<void>;
  /** Put a gap-closing follow-up on the calendar. */
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a follow-up link (async form of the meeting); resolves to the URL. */
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string }) => Promise<string | null>;
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc?: (input: ArtifactEditInput) => Promise<void>;
  /** Send an artifact to a chosen approver — mints a no-login link. */
  onSendForApproval?: (input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string }; snapshot?: string }) => Promise<string | null>;
  /** Jump to the Inbox (regeneration-pending band in the studio). */
  onOpenInbox?: () => void;
  /** The drill-down family (parent + children) — powers cross-programme
   * evidence on stakeholder cards and "deep dive" chips on anchored objects. */
  relatedPrograms?: ProgramSummary[];
  onSelectProgram?: (id: string) => void;
  /** Add/resolve an anchored comment on an artifact (attested). */
  onComment?: (input: { fieldKey: string; movementId: string; title: string; text?: string; resolveId?: string }) => Promise<void>;
  /** Record an in-room demonstration pass against a track (Show). */
  onRecordShowPass?: (trackId: string, pass: { stakeholder?: string; verdict: "accepted" | "accepted-with-changes" | "rework"; stableDiff?: boolean }) => Promise<void>;
  /** Record a movement's gate — demonstrated. Locks the movement's inputs. */
  onRecordGate?: (movementId: string) => Promise<void>;
  /** Reopen a demonstrated gate — evidence changed. Unlocks its inputs. */
  onReopenGate?: (movementId: string, reason: string) => Promise<void>;
  /** Awaitable agent run — the spine runner sequences regenerations with it. */
  onRunAgentAndWait?: (agentId: string, phaseId: string) => Promise<void>;
}


/**
 * "Paper & Flow" — the Flow programme home. The pipeline is drawn as one
 * continuous line down the page; movements are chapters on that spine. Each
 * open chapter runs the loop left to right as three stages — Collect (people
 * and their record) → Paper (the documents ATOS made) → Gate (the verdict
 * ceremony) — with a header that carries the gate gauge, the movement's
 * one-line brief, and the ranked "Up next" queue. Nothing locks; editing
 * unfolds in place via the shared inputs panel.
 */
export default function FlowCanvas({ program, runningAgentIds, agentErrors, onRunAgent, onSaveInputs, onMintPacks, onMintDemoInvites, onCompileShipLanes, onToggleShipItem, onSetShipLane, onScheduleFollowUp, onMintFollowUp, onMintReview, onSaveArtifactDoc, onSendForApproval, onOpenInbox, onRecordShowPass, onRecordGate, onReopenGate, onRunAgentAndWait, relatedPrograms, onSelectProgram, onComment }: FlowCanvasProps) {
  const movements = useMemo(() => flowMovements(), []);
  // A spine regeneration in flight — the collect cards suppress their script
  // until it lands (a script off a half-regenerated kit is inaccurate).
  const spineRunning = useSpineRunning();
  const frontier = frontierMovementId(program);
  // The spine is horizontal: one movement is active at a time; the stepper on
  // top carries every movement's state and switches between them.
  const [active, setActive] = useState<string>(frontier);
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // The record rail: a slim full-height edge strip that reveals on hover,
  // pins open on demand, and auto-expands while a person's card is open —
  // its focus follows the card the operator is IN.
  const [railPin, setRailPin] = useState(false);
  const [railHover, setRailHover] = useState(false);
  const [railFocus, setRailFocus] = useState<string | null>(null);
  const [railRead, setRailRead] = useState<EvidenceEntry | null>(null);
  useEffect(() => { setRailFocus(null); setRailRead(null); setRailHover(false); }, [active]);
  // Hover-intent: the rail collapses on a GRACE DELAY, not on the first pixel
  // the pointer strays — and re-entering cancels the collapse. Pinning keeps
  // hover alive through the layout shift so the panel never flaps.
  const railLeaveTimer = useRef<number | null>(null);
  const railEnter = () => {
    if (railLeaveTimer.current) { window.clearTimeout(railLeaveTimer.current); railLeaveTimer.current = null; }
    setRailHover(true);
  };
  const railLeave = () => {
    if (railLeaveTimer.current) window.clearTimeout(railLeaveTimer.current);
    railLeaveTimer.current = window.setTimeout(() => { setRailHover(false); railLeaveTimer.current = null; }, 280);
  };
  useEffect(() => () => { if (railLeaveTimer.current) window.clearTimeout(railLeaveTimer.current); }, []);
  // The active stage per movement — falls back to the movement's lead stage
  // until the operator picks one.
  const [movementTab, setMovementTab] = useState<Record<string, MovementTab>>({});
  // [ and ] walk the loop's stages backward/forward — keyboard-first, and the
  // bracket keys don't collide with the shell's 1–5 view shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)) return;
      const stages: MovementTab[] = ["collect", "paper", "gate"];
      setMovementTab((prev) => {
        const current = prev[active] ?? leadTab(active);
        const step = event.key === "]" ? 1 : -1;
        const next = stages[(stages.indexOf(current) + step + stages.length) % stages.length];
        return { ...prev, [active]: next };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

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
    setActive(id);
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

  const spine = useMemo(() => spineRegenerationPlan(program), [program]);

  // Anchored drill-downs — "◇ deep dive" chips on the objects they zoom into.
  const anchoredChildren = useMemo(() => (relatedPrograms ?? [])
    .map((p) => ({ p, anchor: readDrillAnchor(p) }))
    .filter((e): e is { p: ProgramSummary; anchor: NonNullable<ReturnType<typeof readDrillAnchor>> } => !!e.anchor),
    [relatedPrograms]);

  return (
    <div className="v3fs-flow v3fs-flow-spine">
      {/* The horizontal spine — every movement's state at a glance; click to switch. */}
      <nav className="v3fs-stepper" aria-label="Movements" role="tablist">
        <div className="v3fs-stepper-rail" aria-hidden="true" />
        {rows.map(({ movement, artifacts }, index) => {
          const isDone = program.gateReviews?.[movement.id]?.status === "approved";
          const generating = artifacts.some((a) => runningAgentIds.has(a.id));
          const isLive = movement.id === frontier && !isDone;
          const isLoop = !!movement.movement?.isLoop;
          const isOn = movement.id === active;
          const stateLabel = generating ? "Generating" : isDone ? "Demonstrated" : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming";
          // The spine ring is the GATE ring, small — same source and colour as
          // the Gate column's gauge: gate criteria met / total, toned by
          // readiness. One source of truth, every phase.
          const stepChecks = [...gateChecklist(program, movement, artifacts), ...gateAugmentations(program, movement.id)];
          const stepReadiness = gateReadiness(program, movement, artifacts, stepChecks);
          const stepDone = stepChecks.filter((c) => c.done).length;
          const pct = stepChecks.length ? Math.round((100 * stepDone) / stepChecks.length) : (stepReadiness.tone === "green" ? 100 : 0);
          // "Where to go" — point at the frontier phase, but only when the
          // operator has wandered off it; on the frontier itself the highlight
          // already says "you're here", so the arrow would be noise.
          const isFrontier = movement.id === frontier;
          const pointHere = isFrontier && active !== frontier && !isDone;
          return (
            <button key={movement.id} type="button" role="tab" aria-selected={isOn}
              className={`v3fs-step${isOn ? " on" : ""}${pointHere ? " v3fs-step-next" : ""}`}
              onClick={() => setActive(movement.id)}>
              {pointHere ? (
                <span className="v3fs-spoint" role="status" aria-label={`Continue in ${movement.displayName}`}>
                  <span className="v3fs-spoint-t">Continue here</span>
                  <span className="v3fs-spoint-a" aria-hidden="true">▾</span>
                </span>
              ) : null}
              <span className={`v3fs-sring ${stepReadiness.tone}`} style={{ "--pct": `${pct}%` } as React.CSSProperties}
                title={`Gate ${stepDone}/${stepChecks.length} — ${stepReadiness.headline}`} aria-hidden="true">
                <span className={`v3fs-sdot${isDone ? " done" : isLive ? " live" : ""}`}>
                  {isDone ? "✓" : isLoop ? "∞" : index + 1}
                </span>
              </span>
              <span className="v3fs-sname">{movement.displayName}</span>
              {/* "Upcoming" ×4 is noise — only states that MEAN something get a word. */}
              {stateLabel === "Upcoming"
                ? <span className="v3fs-sstate wait" aria-hidden="true">&nbsp;</span>
                : <span className={`v3fs-sstate ${generating ? "gen" : isDone ? "done" : isLive ? "live" : "wait"}`}>{stateLabel}</span>}
            </button>
          );
        })}
      </nav>
      {rows.filter(({ movement }) => movement.id === active).map(({ movement, artifacts, evidence }, index) => {
        void index;
        const isOpen = true;
        const isDone = program.gateReviews?.[movement.id]?.status === "approved";
        const generating = artifacts.some((a) => runningAgentIds.has(a.id));
        const isLive = movement.id === frontier && !isDone;
        // The base checklist plus the validation model's criteria: contributor
        // sign-off on Listen's documents, cross-artifact consistency on
        // Envision — the gate ring and the Gate tab read the same augmented list.
        const checks = [...gateChecklist(program, movement, artifacts), ...gateAugmentations(program, movement.id)];
        const readiness = gateReadiness(program, movement, artifacts, checks);
        const openChecks = checks.filter((item) => !item.done).length;
        void openChecks;
        // Audit F-001 read-time backstop: a recorded approval whose criteria
        // aren't met is a forgery masquerading as a gate — surface it, loudly.
        const gateIntegrity = gateApprovalIntegrity(program, movement.id, checks);
        const isLoop = !!movement.movement?.isLoop;
        const coverage = movement.id === "listen" ? listenCoverage(program) : null;
        // "Where am I" summary: heard / artifacts current / gate — computed
        // once so the operator reads the movement's state before scrolling.
        const sumStakeholders = resolveMovementStakeholders(program, movement.id);
        // ONE source of truth for "heard": the same stakeholderCollection the
        // People board uses (evidence attribution + responded links + provided
        // documents) — so the tab badge, the caption and the board never disagree.
        const sumPacks = listInterviewPacks(program);
        const evaluated = sumStakeholders.map((s) => stakeholderCollection(movement.id, s, sumPacks, evidence));
        const unheard = sumStakeholders.filter((_, i) => !evaluated[i].heard);
        const sumHeard = sumStakeholders.length - unheard.length;
        const sumWord = movement.id === "show" ? "reviewed" : movement.id === "listen" || movement.id === "frame" ? "heard" : "consulted";
        const sumDocsCurrent = artifacts.filter((a) => a.present && !a.stale && a.gaps === 0).length;
        const sumChecksDone = checks.filter((c) => c.done).length;
        const staleArtifacts = artifacts.filter((a) => a.present && a.stale);
        const missingArtifacts = artifacts.filter((a) => !a.present);
        // The "Up next" queue — the loop's frontier, ranked. Stale paper first
        // (it poisons everything downstream), then generation, then the voices
        // still to hear, then roster attestation, then the gate itself. Capped
        // at three: a queue, not a backlog. The system states its opinion of
        // the next move so the operator never hunts.
        const spineOwnsRegen = spine.length >= 2 && !!onRunAgentAndWait;
        const upNext: UpNextItem[] = [];
        if (!isDone) {
          if (spineOwnsRegen || staleArtifacts.length) {
            // Stale documents rebuild THEMSELVES now — no "regenerate, evidence
            // changed" prompt. A passive note while they catch up; the manual
            // regenerate stays available on the Paper tab as an option.
            upNext.push({ icon: "↻", label: generating ? "Documents updating from the latest evidence…" : "Documents refreshing from the latest evidence", toTab: "paper" });
          } else if (missingArtifacts.length && evidence.length) {
            upNext.push({ icon: "✦", label: `Generate the ${missingArtifacts[0].title}`, toTab: "paper", run: async () => onRunAgent(missingArtifacts[0].id, movement.id) });
          }
          if (unheard.length) {
            const who = unheard[0].name.split(",")[0].trim();
            upNext.push({ icon: "✉", label: unheard.length === 1 ? `Collect from ${who}` : `Collect from ${who} +${unheard.length - 1} more`, toTab: "collect" });
          }
          if (coverage && coverage.total > 0 && coverage.done < coverage.total) {
            // Evidence has landed for people the roster hasn't attested —
            // propose the flip. Two-step (arm → confirm) because attestation
            // is the operator's judgment, and the write lands attested.
            const heardNames = sumStakeholders.filter((_, i) => evaluated[i].heard).map((s) => s.name);
            const proposal = attestHeardRoster(program, heardNames);
            if (proposal) {
              upNext.push({
                icon: "✓",
                label: `Attest ${proposal.attested.length === 1 ? proposal.attested[0].split(",")[0] : `${proposal.attested.length} heard voices`} in the roster`,
                confirm: `Confirm — marks ${proposal.attested.length === 1 ? proposal.attested[0].split(",")[0] : `${proposal.attested.length} voices`} as Heard`,
                toTab: "gate",
                run: async () => onSaveInputs("listen", { interviewRoster: proposal.value }, {
                  attest: {
                    action: `Roster attested — ${proposal.attested.length} voice${proposal.attested.length === 1 ? "" : "s"} marked Heard`,
                    detail: proposal.attested.join(", ").slice(0, 140),
                  },
                }),
              });
            }
          }
          if (!staleArtifacts.length && !missingArtifacts.length) {
            // VALIDATE: documents are current — the loop's next stage is the
            // contributors' sign-off. Named, so the operator knows who to nudge.
            const awaiting = artifacts
              .filter((a) => a.present)
              .map((a) => artifactApprovalRollup(program, movement.id, a.id))
              .filter((r) => r.total > 0 && r.overall !== "approved");
            if (awaiting.length) {
              const names = [...new Set(awaiting.flatMap((r) => r.approvers
                .filter((ap) => ap.status !== "approved" || ap.preDatesDocument)
                .map((ap) => ap.name.split(" ")[0])))].slice(0, 3);
              upNext.push({
                icon: "✍",
                label: names.length ? `Validate — request sign-off from ${names.join(", ")}` : "Validate — request contributor sign-off",
                toTab: "collect",
              });
            }
          }
          {
            // Decisions waiting in the Inbox target this movement — the
            // cross-surface work flows through the same queue.
            const inboxCheck = checks.find((c) => c.inbox && !c.done);
            if (inboxCheck && onOpenInbox) {
              upNext.push({ icon: "◫", label: inboxCheck.label, openInbox: true });
            }
          }
          if (readiness.kind === "ready" && onRecordGate) {
            upNext.push({ icon: "⚑", label: "Record the gate — demonstrated", toTab: "gate" });
          }
          if (!upNext.length && checks.length && sumChecksDone < checks.length) {
            upNext.push({ icon: "○", label: "Review the open gate criteria", toTab: "gate" });
          }
        }
        const queue = upNext.slice(0, 3);
        // Which stage is showing — the operator's pick, else the movement's lead.
        const hasPeople = sumStakeholders.length > 0;
        const tabKey: MovementTab = movementTab[movement.id] ?? leadTab(movement.id);
        const goTab = (t: MovementTab) => setMovementTab((prev) => ({ ...prev, [movement.id]: t }));
        const gaugePct = checks.length ? Math.round((100 * sumChecksDone) / checks.length) : (readiness.tone === "green" ? 100 : 0);
        // Stage chips read as a sentence — glyph + meaning per stage ("● 3
        // waiting → ⟳ 2 stale → ◔ 8/11"), so the bar IS the loop's state.
        const collectState = !hasPeople && !evidence.length
          ? { glyph: "○", text: "", tone: "dim" }
          : unheard.length
            ? { glyph: "●", text: `${unheard.length} waiting`, tone: "warn" }
            : { glyph: "✓", text: hasPeople ? `all ${sumWord}` : `${evidence.length} on record`, tone: "ok" };
        const paperState = !artifacts.length ? null
          : staleArtifacts.length
            ? { glyph: "⟳", text: `${staleArtifacts.length} stale`, tone: "warn" }
            : missingArtifacts.length
              ? { glyph: "○", text: `${missingArtifacts.length} to generate`, tone: "dim" }
              : sumDocsCurrent < artifacts.length
                // Present and fresh, but the documents themselves declare open
                // gaps — not "current" until the gaps close.
                ? { glyph: "!", text: `${artifacts.length - sumDocsCurrent} with open gaps`, tone: "warn" }
                : { glyph: "✓", text: "current", tone: "ok" };
        const gateState = isDone
          ? { glyph: "✓", text: "demonstrated", tone: "ok" }
          : readiness.kind === "ready"
            ? { glyph: "⚑", text: "ready", tone: "ok" }
            : checks.length
              ? { glyph: "◔", text: `${sumChecksDone}/${checks.length}`, tone: readiness.tone === "amber" ? "warn" : "dim" }
              : { glyph: "○", text: "", tone: "dim" };
        const tabDefs: Array<{ key: MovementTab; label: string; state: { glyph: string; text: string; tone: string } | null; show: boolean }> = [
          { key: "collect", label: "Collect", state: collectState, show: true },
          { key: "paper", label: "Artifacts", state: paperState, show: artifacts.length > 0 },
          { key: "gate", label: isLoop ? "Health" : "Gate", state: gateState, show: true },
        ];

        return (
          <Fragment key={movement.id}>
          <article
            className={["v3fs-ch open", isDone ? "done" : "", isLive ? "live" : ""].filter(Boolean).join(" ")}
          >
            <div className="v3fs-ch-h v3fs-ch-h-static">
              <h2>{movement.displayName}</h2>
              <span className={`v3fs-state ${generating ? "gen" : isDone ? "done" : isLive ? "live" : isLoop ? "loop" : "wait"}`}>
                {generating ? "Generating" : isDone ? "Demonstrated" : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming"}
              </span>
            </div>
            {/* The header band: gate gauge, the movement's one-line brief, and
                the ranked "Up next" queue — one place for state and the verbs
                that move it. The spine regeneration lives in the queue with
                live progress, not in a separate banner. */}
            <div className="v3fs-movebar" role="status">
              {checks.length ? (
                <button type="button" className={`v3fs-mgauge ${readiness.tone}`} style={{ "--pct": `${gaugePct}%` } as React.CSSProperties}
                  onClick={() => goTab("gate")} title={`Gate ${sumChecksDone}/${checks.length} — ${readiness.headline}`}>
                  <span className="v3fs-mgauge-c">{readiness.kind === "demonstrated" ? <b>✓</b> : <><b>{sumChecksDone}</b><i>/{checks.length}</i></>}</span>
                </button>
              ) : null}
              <div className="v3fs-movebar-txt">
                {MOVEMENT_CAPTION[movement.id]
                  ? <div className="v3fs-movebar-cap">{MOVEMENT_CAPTION[movement.id]}</div>
                  : <div className="v3fs-movebar-cap">{sumHeard}/{sumStakeholders.length} {sumWord} · {sumDocsCurrent}/{artifacts.length} artifacts current</div>}
              </div>
              {queue.length ? (
                <div className="v3fs-upnext" aria-label="Up next">
                  <span className="v3fs-upnext-l">Up next</span>
                  {queue.map((item, index) => item.spine && onRunAgentAndWait ? (
                    <SpineQueueItem key="spine" plan={spine} primary={index === 0}
                      runningAgentIds={runningAgentIds} onRun={onRunAgentAndWait}
                      onGo={() => goTab("paper")} />
                  ) : (
                    <UpNextButton key={item.label} item={item} primary={index === 0}
                      onGo={() => {
                        if (item.openInbox) onOpenInbox?.();
                        else if (item.anchor) openEditor(movement.id, item.anchor);
                        else if (item.toTab) goTab(item.toTab);
                      }} />
                  ))}
                </div>
              ) : null}
            </div>

            {isOpen ? (
              <>
              {/* The stage bar draws the loop left to right — Collect → Paper →
                  Gate — each chip carrying its state as a glyph + meaning. */}
              <nav className="v3fs-mtabs" role="tablist" aria-label={`${movement.displayName} stages`}>
                {tabDefs.filter((t) => t.show).map((t, index, arr) => (
                  <Fragment key={t.key}>
                    <button type="button" role="tab" aria-selected={tabKey === t.key}
                      className={`v3fs-mtab${tabKey === t.key ? " on" : ""}`} onClick={() => goTab(t.key)}>
                      {t.state ? <span className={`v3fs-mtab-g ${t.state.tone}`} aria-hidden="true">{t.state.glyph}</span> : null}
                      {t.label}
                      {t.state?.text ? <span className={`v3fs-mtab-n${t.state.tone === "warn" ? " warn" : ""}`}>{t.state.text}</span> : null}
                    </button>
                    {index < arr.length - 1 ? <span className="v3fs-mtab-arr" aria-hidden="true">→</span> : null}
                  </Fragment>
                ))}
              </nav>
              <div className="v3fs-ch-b tabbed" data-tab={tabKey}>
                <div className={`v3fs-evcol${tabKey === "collect" ? "" : " v3fs-tabhide"}`}>
                  {/* Collect: the WORK on the left (board / kit / capture), the
                      RECORD on a sticky right rail whose focus follows the card
                      the operator is in — open a person, read their trail. */}
                  {(() => {
                    const railIdx = railFocus ? sumStakeholders.findIndex((s) => s.id === railFocus) : -1;
                    const railPerson = railIdx >= 0 ? sumStakeholders[railIdx] : null;
                    const railEntries = railIdx >= 0 ? evaluated[railIdx].mine : null;
                    return (
                  <div className={`v3fs-collect-wrap${railPin ? " pinned" : ""}`}>
                    <div className="v3fs-collect-main">
                      {hasPeople ? (
                        <IntervieweeDiscovery program={program} movementId={movement.id}
                          captureField={meetingKit(program, movement.id)?.captureField ?? "interviewTranscripts"}
                          docsStale={staleArtifacts.length > 0}
                          regenerating={spineRunning || generating}
                          onRegenerateStale={onRunAgentAndWait ? async () => {
                            for (const artifact of staleArtifacts) {
                              await onRunAgentAndWait(artifact.id, movement.id);
                            }
                          } : undefined}
                          onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp} onMintReview={onMintReview}
                          onMintPacks={movement.id === "listen" ? onMintPacks : undefined}
                          onScheduleFollowUp={onScheduleFollowUp}
                          onSendForApproval={onSendForApproval}
                          onFocusPerson={(id, open) => setRailFocus((cur) => (open ? id : cur === id ? null : cur))}
                          onCaptured={() => onRunAgent("contradiction-detector", movement.id)}
                          onDocumentCaptured={onRunAgentAndWait ? async () => {
                            // A transcript/document just landed — regenerate this
                            // movement's present artifacts from the new evidence,
                            // in dependency order, without waiting for the operator.
                            for (const art of artifacts.filter((a) => a.present)) {
                              await onRunAgentAndWait(art.id, movement.id);
                            }
                          } : undefined} />
                      ) : (
                        <MeetingKitCard
                          kit={meetingKit(program, movement.id)}
                          movementId={movement.id}
                          hasEvidence={evidence.length > 0}
                          docsStale={artifacts.some((artifact) => artifact.present && artifact.stale)}
                          onRegenerateStale={onRunAgentAndWait ? async () => {
                            for (const artifact of artifacts.filter((entry) => entry.present && entry.stale)) {
                              await onRunAgentAndWait(artifact.id, movement.id);
                            }
                          } : undefined}
                          program={program}
                          onSaveInputs={onSaveInputs}
                          onScheduleFollowUp={onScheduleFollowUp}
                          onMintFollowUp={onMintFollowUp}
                          onMintPacks={onMintPacks}
                          onMintDemoInvites={onMintDemoInvites}
                          onCaptured={() => onRunAgent("contradiction-detector", movement.id)}
                        />
                      )}
                      {/* Quiet escape hatch only — the checklist and gate CTA are
                          the purposeful doors into the editor now. Opening
                          SCROLLS to the editor so the click visibly lands. */}
                      <button type="button" className="v3fs-edit-toggle quiet"
                        onClick={() => editing.has(movement.id) ? toggle(setEditing, movement.id) : openEditor(movement.id)}>
                        {editing.has(movement.id) ? "Close structured inputs" : "Structured inputs"}
                      </button>
                    </div>
                    <div className="v3fs-railzone"
                      onPointerEnter={railEnter}
                      onPointerLeave={railLeave}>
                    {/* Opening a person's card FOCUSES the rail but never
                        forces it open — the rail reveals on hover or pin,
                        already switched to the person you're in. */}
                    {railPin || railHover ? (
                    <aside className={`v3fs-recrail${railPin ? "" : " floating"}`} aria-label="The record">
                      <div className="v3fs-recrail-h">
                        <span className="v3fs-recrail-t">{railPerson ? railPerson.name.split(",")[0].trim() : "The record"}</span>
                        <span className="v3fs-recrail-n">{railPerson ? (railEntries?.length ?? 0) : evidence.length}</span>
                        {railPerson ? (
                          <button type="button" className="v3fs-a" onClick={() => setRailFocus(null)} title="Back to the movement's record">all</button>
                        ) : null}
                        <button type="button" className={`v3fs-recrail-x${railPin ? " on" : ""}`}
                          onClick={() => { setRailPin((pinned) => !pinned); railEnter(); }}
                          title={railPin ? "Unpin — the rail returns to hover-reveal" : "Pin the rail open"}
                          aria-pressed={railPin}
                          aria-label={railPin ? "Unpin the record rail" : "Pin the record rail"}>⌖ {railPin ? "unpin" : "pin"}</button>
                      </div>
                      {railPerson ? (
                        <div className="v3fs-recrail-body">
                        <div className="v3fs-ivc-fb">
                          {(railEntries ?? []).map((entry, i) => (
                            <button key={i} type="button" className="v3fs-ivc-fb-row" onClick={() => setRailRead(entry)} title="Read in full">
                              <span className="v3fs-ivc-fb-top">
                                {entry.kind === "document" ? <span className="v3fs-ivc-fb-kind">doc</span> : null}
                                {entry.kind === "document" ? <span className="v3fs-ivc-fb-m">{entry.who}</span> : null}
                                {entry.capturedAt ? <span className="v3fs-ivc-fb-when">{entry.capturedAt}</span> : null}
                                <span className="v3fs-ivc-fb-go">Open ↗</span>
                              </span>
                              {entry.excerpt ? <span className="v3fs-ivc-fb-q">“{entry.excerpt}”</span> : null}
                            </button>
                          ))}
                          {!(railEntries ?? []).length ? (
                            <div className="v3fs-ivc-fb-empty">Nothing from {railPerson.name.split(",")[0].trim()} yet — reach out from their card.</div>
                          ) : null}
                        </div>
                        </div>
                      ) : (
                      <>
                      {/* CONTEXT leads: the movement's established facts —
                          objective, sponsor, measure — before the records. */}
                      {(() => {
                        const facts = movementFacts(program, movement);
                        return facts.length || (coverage && coverage.total > 0) ? (
                          <div className="v3fs-recrail-ctx">
                            {facts.map((fact) => (
                              <div key={fact.label} className="v3fs-fact"><b>{fact.label}</b><span>{fact.value}</span></div>
                            ))}
                            {coverage && coverage.total > 0 ? (
                              <div className="v3fs-coverage">
                                <div className="v3fs-coverage-cap"><span>Coverage</span><span>{coverage.done} of {coverage.total}</span></div>
                                <div className="v3fs-coverage-bar"><div className="v3fs-coverage-fill" style={{ width: `${Math.round((coverage.done / coverage.total) * 100)}%` }} /></div>
                              </div>
                            ) : null}
                          </div>
                        ) : null;
                      })()}
                      <div className="v3fs-recrail-body">
                      {!evidence.length && hasPeople ? (
                        <div className="v3fs-tab-ghost">
                          Nothing on the record yet — reach out from the cards; what comes back lands here, attributed.
                        </div>
                      ) : null}
                  {/* The records fill the rail's remaining height, scrolling
                      in place beneath the pinned context. */}
                  {(() => {
                    if (!evidence.length) return null;
                    const voice = (entry: typeof evidence[number], i: number) => (
                      <div key={`${entry.fieldLabel}-${i}`} className="v3fs-voice">
                        {entry.excerpt ? <div className="v3fs-voice-q">“{entry.excerpt}”</div> : null}
                        <div className="v3fs-voice-who">
                          {entry.who}
                          <span>{entry.kind === "reference" ? `referenced · ${entry.meta}` : entry.meta}</span>
                        </div>
                      </div>
                    );
                    // From Show onward the tracks LIVE in this column: each
                    // is a header carrying its live state (acceptance, pass
                    // dots), with its attributed quotes beneath. Show lists
                    // every track; Ship/Evolve only those with evidence.
                    const trackable = ["show", "ship", "evolve"].includes(movement.id);
                    const tracks = trackable ? listFlowTracks(program) : [];
                    const grouped = tracks
                      .map((track) => ({
                        track,
                        entries: evidence.filter((entry) => (entry.track ?? "").toLowerCase() === track.name.toLowerCase()),
                      }))
                      .filter((group) => group.entries.length || movement.id === "show");
                    if (!grouped.length) {
                      // The movement's COMPLETE record, newest first — every
                      // entry a clickable row (who · kind · when · excerpt)
                      // that opens the reader. No hidden tail: the rail
                      // scrolls, the record doesn't truncate.
                      const rows = evidence.slice().sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
                      return (
                        <div className="v3fs-ivc-fb">
                          {rows.map((entry, i) => (
                            <button key={entry.id ?? i} type="button" className="v3fs-ivc-fb-row" onClick={() => setRailRead(entry)} title="Read in full">
                              <span className="v3fs-ivc-fb-top">
                                <span className="v3fs-ivc-fb-m">{entry.who.split(",")[0].trim()}</span>
                                {entry.kind === "document" ? <span className="v3fs-ivc-fb-kind">doc</span> : null}
                                {entry.capturedAt ? <span className="v3fs-ivc-fb-when">{entry.capturedAt}</span> : null}
                                <span className="v3fs-ivc-fb-go">Open ↗</span>
                              </span>
                              {entry.excerpt ? <span className="v3fs-ivc-fb-q">“{entry.excerpt}”</span> : null}
                            </button>
                          ))}
                        </div>
                      );
                    }
                    const tagged = new Set(grouped.flatMap((group) => group.entries));
                    const rest = evidence.filter((entry) => !tagged.has(entry));
                    return (
                      <>
                        {grouped.map(({ track, entries }) => {
                          const acceptance = trackAcceptance(track);
                          return (
                            <Fragment key={track.id}>
                              <div className="v3fs-ev-track">
                                <span className="v3fs-ev-track-n">{track.name}</span>
                                <span className={`v3fs-vc ${acceptance.accepted ? "acc" : "pen"}`}>
                                  {acceptance.accepted ? "Accepted" : acceptance.passes ? `${acceptance.acceptedPasses}/${acceptance.passes} passes` : "no demos yet"}
                                </span>
                                {(() => {
                                  const dd = anchoredChildren.find((e) => e.anchor.kind === "track" && e.anchor.label.toLowerCase() === track.name.toLowerCase());
                                  return dd && onSelectProgram ? (
                                    <button type="button" className="v3fs-ddchip" title={`Open ${dd.p.name}`}
                                      onClick={() => onSelectProgram(dd.p.id)}>◇ deep dive</button>
                                  ) : null;
                                })()}
                                {track.showPasses.length ? (
                                  <span className="v3fs-ev-track-dots" aria-hidden="true">
                                    {track.showPasses.slice(-6).map((pass, i) => (
                                      <span key={i} className={`v3fs-pdot ${pass.verdict === "rework" ? "rw" : "ok"}`} />
                                    ))}
                                  </span>
                                ) : null}
                              </div>
                              {movement.id === "show" ? (() => {
                                const lead = (track.leadStakeholder ?? "").trim().toLowerCase();
                                if (!lead) return null;
                                const raw = (program.rawData ?? {}) as Record<string, unknown>;
                                const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
                                const doc = inner.demoScripts;
                                const scripts = doc && typeof doc === "object" && !Array.isArray(doc) && Array.isArray((doc as Record<string, unknown>).scripts)
                                  ? ((doc as Record<string, unknown>).scripts as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
                                  : [];
                                // Tracks name leads by ROLE ("Sales Lead"); scripts and
                                // verdicts name PEOPLE. The script's role field bridges:
                                // match either, then use the person for the rest.
                                const script = scripts.find((entry) =>
                                  [entry.stakeholder, entry.role].some((value) => String(value ?? "").trim().toLowerCase() === lead));
                                const person = (script ? String(script.stakeholder ?? "") : track.leadStakeholder ?? "").trim();
                                const personKey = person.toLowerCase();
                                const invite = [...listDemoInvites(program)].reverse().find((entry) =>
                                  [entry.stakeholder, entry.role].some((value) => (value ?? "").trim().toLowerCase() === personKey || (value ?? "").trim().toLowerCase() === lead));
                                const verdictRow = demoAcceptance(program).rows.find((row) =>
                                  (row.stakeholder ?? "").trim().toLowerCase() === personKey || (row.stakeholder ?? "").trim().toLowerCase() === lead);
                                const steps = script && Array.isArray(script.steps)
                                  ? (script.steps as unknown[]).filter((step): step is Record<string, unknown> => typeof step === "object" && step !== null)
                                  : [];
                                return (
                                  <div className="v3fs-ev-track-panel">
                                    <div className="v3fs-ev-track-lead">
                                      {person && personKey !== lead ? `${person} — ${track.leadStakeholder}` : track.leadStakeholder}
                                      {verdictRow?.verdict
                                        ? <span className={`v3fs-vc ${/accepted/i.test(verdictRow.verdict) ? "acc" : "pen"}`}>{verdictRow.verdict}</span>
                                        : <span className="v3fs-vc pen">No verdict yet</span>}
                                    </div>
                                    {script ? (
                                      <details className="v3fs-ev-script">
                                        <summary>Demo script — their workflow, their words</summary>
                                        {typeof script.openingQuote === "string" && script.openingQuote ? <blockquote>“{script.openingQuote}”</blockquote> : null}
                                        {steps.length ? (
                                          <ol>
                                            {steps.slice(0, 6).map((step, i) => (
                                              <li key={i}>{[step.beat, step.say ?? step.show].filter(Boolean).map(String).join(" — ")}</li>
                                            ))}
                                          </ol>
                                        ) : null}
                                        {typeof script.acceptanceAsk === "string" && script.acceptanceAsk ? <p className="v3fs-ev-script-ask">{script.acceptanceAsk}</p> : null}
                                      </details>
                                    ) : scripts.length ? (
                                      <div className="v3fs-ev-track-none">“{track.leadStakeholder}” isn’t a person on the record — re-adopt the Blueprint’s plan and this track binds to a real stakeholder.</div>
                                    ) : (
                                      <div className="v3fs-ev-track-none">No demo script yet — generate Demo Scripts and it appears here.</div>
                                    )}
                                    {invite ? (
                                      <div className="v3fs-async-row">
                                        <span className={`v3fs-st ${invite.respondedAt ? "ok" : "none"}`} />
                                        <div className="v3fs-async-who">
                                          demo link
                                          <span>{invite.respondedAt ? "verdict received" : "waiting"}</span>
                                        </div>
                                        <button type="button" className="v3fs-a" onClick={() => {
                                          void navigator.clipboard.writeText(portalLinkFor(program.id, invite)).catch(() => safePrompt("Copy the link:", portalLinkFor(program.id, invite)));
                                        }}>Copy link</button>
                                      </div>
                                    ) : null}
                                    {onRecordShowPass ? (
                                      <TrackPassRecorder trackId={track.id} person={person}
                                        onRecord={(trackId, pass) => onRecordShowPass(trackId, pass)} />
                                    ) : null}
                                  </div>
                                );
                              })() : null}
                              {entries.length
                                ? entries.map(voice)
                                : movement.id !== "show"
                                  ? <div className="v3fs-ev-track-none">No attributed feedback yet — tag the track when capturing.</div>
                                  : null}
                            </Fragment>
                          );
                        })}
                        {rest.length ? (
                          <>
                            <div className="v3fs-ev-grp dim">Programme-wide</div>
                            {rest.map(voice)}
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                      </div>
                      </>
                      )}
                    </aside>
                    ) : (
                      <button type="button" className="v3fs-recrail-tab"
                        onClick={() => { setRailPin(true); railEnter(); }} onFocus={railEnter}
                        aria-label="Open the record rail" title="The record — hover to peek, click to pin">
                        ◧<span>The record</span><b>{evidence.length}</b>
                      </button>
                    )}
                    </div>
                  </div>
                    );
                  })()}
                  {railRead ? <EvidenceReader entry={railRead} onClose={() => setRailRead(null)} /> : null}
                </div>

                <div className={`v3fs-artgrid${tabKey === "paper" ? "" : " v3fs-tabhide"}`}>
                  <div className="v3fs-colh gn">{generating ? "Generating…" : "Generated by ATOS"}</div>
                  {movement.id === "ship" && onCompileShipLanes && onToggleShipItem ? (
                    <ShipLanesBoard program={program} onCompile={onCompileShipLanes} onToggle={onToggleShipItem} onSetLane={onSetShipLane} />
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
                  {artifacts.map((artifact) => {
                    // Approval rolls up from the STAKEHOLDER cards: an
                    // artifact is approved when every relevant contributor
                    // has approved it. The asks live on the collect board.
                    const rollup = artifact.present ? artifactApprovalRollup(program, movement.id, artifact.id) : null;
                    // The MATURITY LADDER — every document states where it is
                    // on Draft → Grounded → Validated, so "generated ✓" never
                    // masquerades as "done". Draft: partial evidence or stale;
                    // Grounded: every voice heard at a current generation;
                    // Validated: fresh sign-off from every contributor.
                    const voices = sumStakeholders.filter((s) => !s.isRole).length;
                    const voicesHeard = sumStakeholders.filter((s, i) => !s.isRole && evaluated[i].heard).length;
                    const maturity = !artifact.present ? undefined
                      : rollup?.overall === "approved"
                        ? { label: "Validated", tone: "validated" as const, hint: `signed off by all ${rollup.total} contributor${rollup.total === 1 ? "" : "s"}` }
                        : !artifact.stale && voices > 0 && voicesHeard >= voices
                          ? { label: "Grounded", tone: "grounded" as const, hint: `every voice heard (${voices}) — ready for sign-off` }
                          : { label: "Draft", tone: "draft" as const, hint: artifact.stale ? "evidence changed since generation — resynthesize" : voices > 0 ? `reads ${voicesHeard} of ${voices} voices` : undefined };
                    return (
                    <ArtifactDoc
                      key={artifact.id}
                      artifact={artifact}
                      running={runningAgentIds.has(artifact.id)}
                      evidenceNames={evidence.map((entry) => entry.who)}
                      evidenceCount={evidence.length}
                      lastError={agentErrors?.[artifact.id]}
                      openGaps={artifactOpenGaps(program, artifact.id)}
                      onGenerate={() => onRunAgent(artifact.id, movement.id)}
                      onOpen={artifact.present ? () => setDocFor(artifact) : undefined}
                      onGoEvidence={() => goTab("collect")}
                      approvalRollup={rollup}
                      maturity={maturity}
                      onGoApprovals={() => goTab("collect")}
                    />
                    );
                  })}
                </div>

                <div className={tabKey === "gate" ? "" : "v3fs-tabhide"}>
                  <div className={`v3fs-colh gt${isDone ? " done" : ""}`}>{isLoop ? "Steady-state health" : "Gate"}</div>
                  <div className="v3fs-gate inline">
                    {/* Verdict first: one composed state over the whole loop —
                        evidence criteria, record current, Inbox clear. The
                        command strip's gauge already carries the count ring, so
                        this panel leads with the words and the criteria live
                        INLINE below — the tab is the place, not a modal. */}
                    <div className={`v3fs-gstate ${readiness.tone}`}>
                      <div className="v3fs-gstate-top">
                        <span className={`v3fs-gstate-g ${readiness.tone}`} aria-hidden="true">
                          {readiness.kind === "demonstrated" ? "✓" : readiness.kind === "trails" ? "⟳" : readiness.tone === "green" ? "✓" : readiness.tone === "amber" ? "⚠" : "○"}
                        </span>
                        <div className="v3fs-gstate-txt">
                          {(() => {
                            const countHeadline = /criteria met/.test(readiness.headline);
                            const primary = countHeadline && readiness.detail ? readiness.detail : readiness.headline;
                            const secondary = primary === readiness.headline ? readiness.detail : (countHeadline ? null : readiness.detail);
                            return (
                              <>
                                <div className="v3fs-gstate-h">{primary}</div>
                                {secondary ? <div className="v3fs-gstate-d">{secondary}</div> : null}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      {gateIntegrity.approved && !gateIntegrity.defensible ? (
                        <div className="v3fs-gate-forged" role="alert">
                          ⚠ {gateIntegrity.reason}. This approval is not server-attested and must not be relied on.
                        </div>
                      ) : null}
                      {readiness.kind === "ready" && !isDone && onRecordGate ? (
                        <GateActionButton
                          idle="Record the gate — demonstrated"
                          armedLabel="Confirm — records the gate and locks inputs"
                          busyLabel="Recording…"
                          onAct={() => onRecordGate(movement.id)}
                        />
                      ) : null}
                      {readiness.kind === "demonstrated" && onReopenGate ? (
                        <GateActionButton
                          idle="Reopen — evidence changed"
                          armedLabel="Confirm — reopens the gate and unlocks inputs"
                          busyLabel="Reopening…"
                          quiet
                          onAct={() => onReopenGate(movement.id, "Evidence changed after the demonstration")}
                        />
                      ) : null}
                    </div>
                    {checks.length ? (
                    <div className="v3fs-checks">
                      {checks.map((item, itemIndex) => {
                        const group = item.group ?? "evidence";
                        const prevGroup = itemIndex ? (checks[itemIndex - 1].group ?? "evidence") : null;
                        const grouped = checks.some((c) => (c.group ?? "evidence") !== "evidence");
                        const artifact = item.artifactId ? artifacts.find((a) => a.id === item.artifactId) : undefined;
                        // Every criterion is a door to where it's settled: an
                        // anchor opens the editor on its field (the coverage
                        // ledger's row opens the roster, where attesting
                        // happens), a document opens the studio, an Inbox item
                        // opens the Inbox.
                        const isLedger = /attest/i.test(item.label);
                        const onClick = item.anchor
                          ? () => openEditor(movement.id, item.anchor)
                          : artifact?.present
                            ? () => setDocFor(artifact)
                            : item.inbox && !item.done && onOpenInbox
                              ? () => onOpenInbox()
                              : undefined;
                        const title = isLedger
                          ? "Attest voices in the roster — the People tab shows who's actually been heard"
                          : item.anchor
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
                              const name = group === "evidence" ? "Evidence" : group === "record" ? "Documents" : "Inbox";
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
                    ) : null}
                    <p className="v3fs-gate-say foot">{movement.movement?.readyWhen ?? ""}</p>
                  </div>
                </div>

                {editing.has(movement.id) ? (
                  <div className="v3fs-editor" data-movement={movement.id}>
                    {/* The editor announces itself — a headed surface, not a
                        form that materialises in the whitespace below. */}
                    <div className="v3fs-editor-h">
                      <span className="v3fs-editor-t">Structured inputs — {movement.displayName}</span>
                      <span className="v3fs-editor-sub">the raw fields behind this movement&rsquo;s record</span>
                      <button type="button" className="v3fs-editor-x" aria-label="Close structured inputs"
                        onClick={() => toggle(setEditing, movement.id)}>✕</button>
                    </div>
                    <PhaseInputsPanel program={program} phaseId={movement.id} onSave={onSaveInputs} locked={isDone} />
                  </div>
                ) : null}
              </div>
              </>
            ) : null}
          </article>
          </Fragment>
        );
      })}
      {docFor ? (
        <Suspense fallback={null}><FlowArtifactStudio
          program={program}
          artifact={docFor}
          onSaveInputs={onSaveInputs}
          onComment={onComment}
          onOpenArtifact={(artifactId) => {
            for (const m of flowMovements()) {
              const hit = movementArtifacts(program, m).find((a) => a.id === artifactId && a.present);
              if (hit) { setDocFor(hit); return; }
            }
          }}
          onClose={() => setDocFor(null)}
          onRegenerate={() => onRunAgent(docFor.id, docFor.movementId)}
          onSaveDoc={onSaveArtifactDoc}
          onOpenInbox={onOpenInbox}
        /></Suspense>
      ) : null}
    </div>
  );
}


/**
 * The gate column's own actions: recording the gate (READY state) and
 * reopening it (DEMONSTRATED state). Two-step — the first press arms, the
 * second acts — because both flip the movement's input lock.
 */
function GateActionButton({ idle, armedLabel, busyLabel, quiet, onAct }: {
  idle: string;
  armedLabel: string;
  busyLabel: string;
  quiet?: boolean;
  onAct: () => Promise<void>;
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
    try { await onAct(); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <button type="button" className={`v3fs-gate-rec${armed ? " armed" : ""}${quiet ? " quiet" : ""}`} disabled={busy} onClick={() => void press()}>
      {busy ? busyLabel : armed ? armedLabel : idle}
    </button>
  );
}


/** An in-room demonstration, recorded where the track lives. Demo links are
 * the usual path; this covers the demo that happened live, in the room —
 * verdict lands as a show pass on the track, same as a link verdict. */
function TrackPassRecorder({ trackId, person, onRecord }: {
  trackId: string;
  person: string;
  onRecord: (trackId: string, pass: { stakeholder?: string; verdict: "accepted" | "accepted-with-changes" | "rework" }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(person);
  const [verdict, setVerdict] = useState<"accepted" | "accepted-with-changes" | "rework">("accepted");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="v3fs-a v3fs-ev-passbtn" onClick={() => { setWho(person); setOpen(true); }}>
        ＋ Record an in-room pass
      </button>
    );
  }
  return (
    <div className="v3fs-ev-pass">
      <input value={who} onChange={(event) => setWho(event.target.value)} placeholder="Who watched it run?" aria-label="Who watched the demonstration" />
      <select value={verdict} onChange={(event) => setVerdict(event.target.value as typeof verdict)} aria-label="Verdict">
        <option value="accepted">Accepted</option>
        <option value="accepted-with-changes">Accepted with changes</option>
        <option value="rework">Needs rework</option>
      </select>
      <button type="button" className="v3fs-btn pri" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await onRecord(trackId, { stakeholder: who.trim() || undefined, verdict }); setOpen(false); } finally { setBusy(false); }
      }}>{busy ? "Recording…" : "Record"}</button>
      <button type="button" className="v3fs-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}


/**
 * Async interviews — the Listen column's "no meeting required" lane. Links
 * mint from the Discovery Kit's per-stakeholder packs; what comes back waits
 * in Today's evidence inbox until ingested.
 */
function ShipLanesBoard({ program, onCompile, onToggle, onSetLane }: {
  program: ProgramSummary;
  onCompile: () => Promise<void>;
  onToggle: (laneId: string, itemId: string) => Promise<void>;
  onSetLane?: (laneId: string, done: boolean) => Promise<void>;
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
            {onSetLane ? (
              lane.items.every((entry) => entry.done) ? (
                <button type="button" className="v3fs-a v3fs-shiplane-all" disabled={busy}
                  onClick={() => void act(() => onSetLane(lane.id, false))}>Reset lane</button>
              ) : (
                <button type="button" className="v3fs-a v3fs-shiplane-all" disabled={busy}
                  onClick={() => void act(() => onSetLane(lane.id, true))}>Check all</button>
              )
            ) : null}
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

function ArtifactDoc({ artifact, running, evidenceNames, evidenceCount, lastError, openGaps, onGenerate, onOpen, onGoEvidence, approvalRollup, maturity, onGoApprovals }: {
  artifact: ArtifactCardModel;
  running: boolean;
  evidenceNames: string[];
  /** How many evidence items this movement holds — the card's provenance. */
  evidenceCount?: number;
  /** The last run died — its message stays on the card until the next try. */
  lastError?: string;
  /** The document's own declared gaps — readable on the CARD, and the same
   * texts the follow-up scripts ask in Collect. One set, two surfaces. */
  openGaps?: string[];
  onGenerate: () => void;
  onOpen?: () => void;
  /** "evidence changed" chip → the Evidence tab, where the change lives. */
  onGoEvidence?: () => void;
  /** Sign-off ROLLUP: approval is asked per stakeholder on the collect board;
   * the card only reports where the artifact stands across its contributors. */
  approvalRollup?: { approvers: ApproverState[]; approvedCount: number; total: number; overall: ApprovalStatus } | null;
  /** Where this document sits on the maturity ladder — Draft (partial
   * evidence or stale) → Grounded (all voices, current) → Validated. */
  maturity?: { label: string; tone: "draft" | "grounded" | "validated"; hint?: string };
  /** The rollup chip → the Collect board, where the per-person asks live. */
  onGoApprovals?: () => void;
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
        {/* A document leads with a toned paper tile, not a bare status dot —
            the state colours the tile: green current, amber stale, dim absent. */}
        <span className={`v3fs-doc-tile ${artifact.present ? (artifact.stale ? "stale" : "ok") : "none"}`} aria-hidden="true">¶</span>
        {onOpen ? (
          <button type="button" className="v3fs-doc-open" onClick={onOpen}>{artifact.title}</button>
        ) : (
          <b>{artifact.title}</b>
        )}
        {artifact.stale ? (
          onGoEvidence
            ? <button type="button" className="v3fs-stale-tag" title="See what changed — open the Evidence tab" onClick={onGoEvidence}>evidence changed →</button>
            : <span className="v3fs-stale-tag">evidence changed</span>
        ) : null}
        {maturity ? (
          <span className={`v3fs-doc-mat ${maturity.tone}`} title={maturity.hint}>
            {maturity.tone === "validated" ? "✓ " : ""}{maturity.label}
          </span>
        ) : null}
        {artifact.confidence != null ? <span className="v3fs-conf">{artifact.confidence}%</span> : null}
      </div>
      <div className="v3fs-doc-x">{artifact.excerpt ?? artifact.description}</div>
      {maturity?.hint && maturity.tone !== "validated" ? (
        <div className="v3fs-doc-mat-hint">{maturity.hint}</div>
      ) : null}
      {lastError ? (
        <div className="v3fs-doc-err" role="alert">
          ⚠ The last run failed: {lastError.slice(0, 160)} — try again.
        </div>
      ) : null}
      {artifact.present && evidenceCount != null ? (
        <div className="v3fs-doc-prov">
          reads {evidenceCount} evidence item{evidenceCount === 1 ? "" : "s"}
          {artifact.gaps ? ` · ${artifact.gaps} open gap${artifact.gaps === 1 ? "" : "s"}` : " · no open gaps"}
        </div>
      ) : null}
      {artifact.present && openGaps?.length ? (
        <details className="v3fs-doc-gaps">
          <summary>Open gaps — {openGaps.length}</summary>
          <ul>
            {openGaps.map((gap, index) => <li key={index}>{gap}</li>)}
          </ul>
          <div className="v3fs-doc-gaps-note">
            These land as questions on the follow-up scripts
            {onGoEvidence ? <button type="button" className="v3fs-a" onClick={onGoEvidence}>→ Collect</button> : null}
          </div>
        </details>
      ) : null}
      <div className="v3fs-doc-foot">
        {onOpen ? <button type="button" className="v3fs-a" onClick={onOpen}>Read</button> : null}
        {/* The card's action mirrors its state: a stale document's regenerate
            is THE thing to do (primary); a current one stays quiet. */}
        {artifact.present && artifact.stale ? (
          <button type="button" className="v3fs-btn pri v3fs-doc-regen" onClick={onGenerate}>↻ Regenerate — evidence changed</button>
        ) : (
          <button type="button" className="v3fs-a" onClick={onGenerate}>
            {artifact.present ? "Regenerate" : "✦ Generate"}
          </button>
        )}
      </div>
      {/* Sign-off ROLLUP: the asks live on each contributor's card in Collect;
          the artifact only reports where it stands across all of them. */}
      {approvalRollup && approvalRollup.total > 0 ? (
        approvalRollup.overall === "approved" ? (
          <div className="v3fs-doc-appr ok">✓ Approved by all {approvalRollup.total} contributor{approvalRollup.total === 1 ? "" : "s"}</div>
        ) : (
          <div className={`v3fs-doc-appr ${approvalRollup.overall === "changes" ? "changes" : "wait"}`}>
            <span>
              {approvalRollup.overall === "changes" ? "↺ " : "◷ "}
              Sign-off {approvalRollup.approvedCount}/{approvalRollup.total}
              {(() => {
                const open = approvalRollup.approvers.filter((a) => a.status !== "approved");
                const named = open.slice(0, 3).map((a) => a.name.split(" ")[0]).join(", ");
                return open.length ? ` — awaiting ${named}${open.length > 3 ? ` +${open.length - 3}` : ""}` : "";
              })()}
            </span>
            {onGoApprovals ? (
              <button type="button" className="v3fs-a" onClick={onGoApprovals}>→ request on their cards</button>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
