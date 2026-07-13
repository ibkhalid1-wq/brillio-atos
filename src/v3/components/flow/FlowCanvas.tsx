import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import FlowArtifactStudio, { type ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts,
  gateReadiness, gateChecklist, listenCoverage, movementFacts, demoAcceptance,
  spineRegenerationPlan, evidenceStamp, locateQuote, attestHeardRoster,
  type ArtifactCardModel,
} from "@/v3/components/flow/flowShellData";
import { buildMeetingIcs, mailtoLink, meetingKit, stakeholderEmail, type MeetingKit } from "@/v3/components/flow/flowMeetings";
import { supabase } from "@/integrations/supabase/client";
import { listInterviewPacks, listDemoInvites, portalLinkFor, visibleLinks } from "@/v3/components/flow/flowPortal";
import { resolveMovementStakeholders, type MovementStakeholder } from "@/v3/components/flow/flowStakeholders";
import { readDrillAnchor } from "@/v3/components/flow/flowDrilldown";
import { gateApprovalIntegrity } from "@/v3/components/flow/flowGovernance";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { listFlowTracks, trackAcceptance } from "@/v3/components/flow/flowTracks";
import { rankEvidence, isNoiseEvidence, EVIDENCE_LEAD_COUNT } from "@/v3/components/flow/flowEvidenceRank";
import { listClaimTags } from "@/v3/components/flow/flowClaims";

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
  /** Set a whole ship lane done/undone at once. */
  onSetShipLane?: (laneId: string, done: boolean) => Promise<void>;
  /** Put a gap-closing follow-up on the calendar. */
  onScheduleFollowUp?: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a follow-up link (async form of the meeting); resolves to the URL. */
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc?: (input: ArtifactEditInput) => Promise<void>;
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

/** Every movement runs the same loop, and its body is organised as the
 * loop's three stages — Collect (people + what they said) → Paper (what ATOS
 * made of it) → Gate (can we demonstrate?). The active one. */
type MovementTab = "collect" | "paper" | "gate";

/** One line saying what a movement leads with — so every phase reads the same
 * way and the operator knows where its centre of gravity is (item 1c). */
const MOVEMENT_CAPTION: Record<string, string> = {
  frame: "Frame leads with the sponsor conversation — one recorded talk drafts the charter and the discovery kit.",
  listen: "Listen gathers each stakeholder's workflow, in their own words.",
  envision: "Envision weighs the architecture options and frames the blueprint.",
  show: "Show puts each stakeholder in front of their own workflow, running.",
  ship: "Ship leads with hardening — prove the evals, then cut over.",
  evolve: "Evolve keeps the system honest — the benefits pulse and the drift review.",
};

/** Which stage a movement opens on: conversation-led movements start on
 * Collect, build-led movements start on Paper. */
function leadTab(movementId: string): MovementTab {
  if (movementId === "envision" || movementId === "ship" || movementId === "evolve") return "paper";
  return "collect";
}

/** One ranked frontier action — a verb with its object. The queue states the
 * system's opinion of the next move so the operator never hunts. */
interface UpNextItem {
  icon: string;
  label: string;
  /** Stage the action lands in (also where a click navigates). */
  toTab?: MovementTab;
  /** Async work the item runs (regenerate / generate / attest). */
  run?: () => Promise<void>;
  /** Two-step verbs (writes that flip judgment): the first press arms and
   * shows this label; the second runs. */
  confirm?: string;
  /** Opens the editor at a field instead of switching stage. */
  anchor?: string;
  /** Opens the Inbox — cross-surface work also flows through Up next. */
  openInbox?: boolean;
  /** This item IS the spine regeneration — rendered with live progress. */
  spine?: boolean;
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
export default function FlowCanvas({ program, runningAgentIds, onRunAgent, onSaveInputs, onMintPacks, onMintDemoInvites, onCompileShipLanes, onToggleShipItem, onSetShipLane, onScheduleFollowUp, onMintFollowUp, onSaveArtifactDoc, onOpenInbox, onRecordShowPass, onRecordGate, onReopenGate, onRunAgentAndWait, relatedPrograms, onSelectProgram, onComment }: FlowCanvasProps) {
  const movements = useMemo(() => flowMovements(), []);
  const frontier = frontierMovementId(program);
  // The spine is horizontal: one movement is active at a time; the stepper on
  // top carries every movement's state and switches between them.
  const [active, setActive] = useState<string>(frontier);
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // Salience over volume: the evidence column leads with the ranked best
  // quotes; "show all" unfolds the rest per movement.
  const [evAll, setEvAll] = useState<Set<string>>(() => new Set());
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
          const stepChecks = gateChecklist(program, movement, artifacts);
          const stepReadiness = gateReadiness(program, movement, artifacts, stepChecks);
          const stepDone = stepChecks.filter((c) => c.done).length;
          const pct = stepChecks.length ? Math.round((100 * stepDone) / stepChecks.length) : (stepReadiness.tone === "green" ? 100 : 0);
          return (
            <button key={movement.id} type="button" role="tab" aria-selected={isOn}
              className={`v3fs-step${isOn ? " on" : ""}`}
              onClick={() => setActive(movement.id)}>
              <span className={`v3fs-sring ${stepReadiness.tone}`} style={{ "--pct": `${pct}%` } as React.CSSProperties}
                title={`Gate ${stepDone}/${stepChecks.length} — ${stepReadiness.headline}`} aria-hidden="true">
                <span className={`v3fs-sdot${isDone ? " done" : isLive ? " live" : ""}`}>
                  {isDone ? "✓" : isLoop ? "∞" : index + 1}
                </span>
              </span>
              <span className="v3fs-sname">{movement.displayName}</span>
              <span className={`v3fs-sstate ${generating ? "gen" : isDone ? "done" : isLive ? "live" : "wait"}`}>{stateLabel}</span>
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
        const checks = gateChecklist(program, movement, artifacts);
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
          if (spineOwnsRegen) {
            upNext.push({ icon: "↻", label: `Regenerate ${spine.length} documents — down the spine`, toTab: "paper", spine: true });
          } else if (staleArtifacts.length && onRunAgentAndWait) {
            upNext.push({
              icon: "↻",
              label: staleArtifacts.length === 1 ? `Regenerate the ${staleArtifacts[0].title}` : `Regenerate ${staleArtifacts.length} stale documents`,
              toTab: "paper",
              run: async () => { for (const a of staleArtifacts) await onRunAgentAndWait(a.id, movement.id); },
            });
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
          { key: "paper", label: "Paper", state: paperState, show: artifacts.length > 0 },
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
                  {/* Collect: one stage, one subject — the people and what they
                      said. The status board leads (it's the work); the record
                      follows (it's what the work produced). */}
                  {hasPeople ? (
                    <IntervieweeDiscovery program={program} movementId={movement.id}
                      captureField={meetingKit(program, movement.id)?.captureField ?? "interviewTranscripts"}
                      related={relatedPrograms}
                      onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp}
                      onMintPacks={movement.id === "listen" ? onMintPacks : undefined}
                      onCaptured={() => onRunAgent("contradiction-detector", movement.id)} />
                  ) : null}
                  <div className="v3fs-colh ev">The record{coverage && coverage.total ? ` — ${coverage.done}/${coverage.total}` : ""}</div>
                  {!evidence.length && hasPeople ? (
                    <div className="v3fs-tab-ghost">
                      Nothing on the record yet — reach out from the cards above; what comes back lands here, attributed.
                    </div>
                  ) : null}
                  {/* The column leads with the evidence itself — voices, then
                      facts, then coverage. The kit is the action and follows,
                      collapsed to one line once a conversation is on record. */}
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
                      // Frame/Listen: salience-ranked — claim-tagged and
                      // substantive voices lead. The full record unfolds
                      // GROUPED BY PERSON (documents together), newest group
                      // first, instead of stretching into a flat wall.
                      const ranked = rankEvidence(evidence, listClaimTags(program).map((c) => c.quote));
                      const showAll = evAll.has(movement.id);
                      const lead = ranked.filter((e) => !isNoiseEvidence(e)).slice(0, EVIDENCE_LEAD_COUNT);
                      const hidden = ranked.length - lead.length;
                      const byWho = new Map<string, typeof evidence>();
                      for (const entry of evidence) {
                        // Voices group by person; documents group by who
                        // PROVIDED them (parsed from the meta line), so a
                        // person's conversations and their documents sit
                        // together instead of one giant "Documents" bucket.
                        const provider = entry.kind === "document" ? (entry.meta.split("·")[1] ?? "").trim() : "";
                        const key = entry.kind === "document"
                          ? `Documents — ${provider || "programme"}`
                          : (entry.who.split(",")[0].trim() || entry.who);
                        const bucket = byWho.get(key) ?? [];
                        if (!bucket.length) byWho.set(key, bucket);
                        bucket.push(entry);
                      }
                      const evGroups = [...byWho.entries()].map(([name, items]) => ({
                        name,
                        items: items.slice().sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? "")),
                        latest: items.reduce((max, entry) => (entry.capturedAt && entry.capturedAt > max ? entry.capturedAt : max), ""),
                      })).sort((a, b) => b.latest.localeCompare(a.latest));
                      return (
                        <>
                          {showAll ? null : lead.map(voice)}
                          {hidden > 0 || showAll ? (
                            <button type="button" className="v3fs-a v3fs-ev-more"
                              onClick={() => setEvAll((prev) => { const next = new Set(prev); if (showAll) next.delete(movement.id); else next.add(movement.id); return next; })}>
                              {showAll ? "Back to the highlights" : `Show all ${ranked.length} — grouped by person`}
                            </button>
                          ) : null}
                          {showAll ? evGroups.map((group) => (
                            <details key={group.name} className="v3fs-evg">
                              <summary>
                                <span className="v3fs-evg-n">{group.name}</span>
                                <span className="v3fs-evg-c">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                                {group.latest ? <span className="v3fs-evg-when">{group.latest}</span> : null}
                              </summary>
                              {group.items.map(voice)}
                            </details>
                          )) : null}
                        </>
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
                                          void navigator.clipboard.writeText(portalLinkFor(program.id, invite)).catch(() => window.prompt("Copy the link:", portalLinkFor(program.id, invite)));
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
                  {/* Stakeholder evidence collection lives in a full-width board
                      below the three columns (see v3fs-ch-collect). The column
                      keeps just the evidence + facts + coverage. When a movement
                      has no per-stakeholder roster, the meeting kit stays here. */}
                  {resolveMovementStakeholders(program, movement.id).length > 0 ? null : (
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
                      the purposeful doors into the editor now. */}
                  <button type="button" className="v3fs-edit-toggle quiet" onClick={() => toggle(setEditing, movement.id)}>
                    {editing.has(movement.id) ? "Close" : "Structured inputs"}
                  </button>
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
                  {artifacts.map((artifact) => (
                    <ArtifactDoc
                      key={artifact.id}
                      artifact={artifact}
                      running={runningAgentIds.has(artifact.id)}
                      evidenceNames={evidence.map((entry) => entry.who)}
                      evidenceCount={evidence.length}
                      onGenerate={() => onRunAgent(artifact.id, movement.id)}
                      onOpen={artifact.present ? () => setDocFor(artifact) : undefined}
                      onGoEvidence={() => goTab("collect")}
                    />
                  ))}
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
        <FlowArtifactStudio
          program={program}
          artifact={docFor}
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
        />
      ) : null}
    </div>
  );
}

/**
 * Regenerate down the spine — the staged runner. The app knows the document
 * dependency order (movement order); when several documents trail the
 * evidence this runs them one at a time, upstream first, so each generation
 * reads its refreshed upstream context. Hand-edited documents keep their
 * guard: those runs land as proposals in the Inbox, never overwrites.
 */
// The spine run outlives the component: switching views mid-run remounts the
// canvas, and a multi-minute regeneration must neither stop nor lose its
// progress display when that happens. Module-level store; remounts re-attach.
type SpineState =
  | { phase: "running"; index: number; total: number; title: string }
  | { phase: "done"; completed: number; failed: string[] }
  | null;
let spineState: SpineState = null;
const spineListeners = new Set<() => void>();
function setSpineState(next: SpineState) {
  spineState = next;
  for (const listener of spineListeners) listener();
}
const subscribeSpine = (listener: () => void) => {
  spineListeners.add(listener);
  return () => { spineListeners.delete(listener); };
};

/** The spine regeneration as the queue's top item — same staged runner, now
 * living where every other frontier verb lives, with inline progress. */
function SpineQueueItem({ plan, primary, runningAgentIds, onRun, onGo }: {
  plan: Array<{ artifactId: string; movementId: string; title: string }>;
  primary: boolean;
  runningAgentIds: Set<string>;
  onRun: (agentId: string, phaseId: string) => Promise<void>;
  onGo: () => void;
}) {
  const state = React.useSyncExternalStore(subscribeSpine, () => spineState);
  const progress = state?.phase === "running" ? state : null;
  const done = state?.phase === "done" ? state : null;
  const busyElsewhere = runningAgentIds.size > 0 && !progress;
  const run = async () => {
    if (spineState?.phase === "running") return;
    const steps = [...plan];
    let completed = 0;
    const failed: string[] = [];
    for (const [index, step] of steps.entries()) {
      setSpineState({ phase: "running", index: index + 1, total: steps.length, title: step.title });
      // A step can reject transiently — a watcher run holding the single
      // agent slot right after the previous document landed. Back off and
      // retry before conceding, and never let one failure stop the rest.
      let attempts = 0;
      for (;;) {
        try {
          await onRun(step.artifactId, step.movementId);
          completed += 1;
          break;
        } catch {
          attempts += 1;
          if (attempts >= 3) { failed.push(step.title); break; }
          await new Promise((resolve) => setTimeout(resolve, 5000 * attempts));
        }
      }
    }
    setSpineState({ phase: "done", completed, failed });
  };
  if (progress) {
    return (
      <div className="v3fs-upnext-run" role="status">
        <span>↻ Regenerating {progress.index} of {progress.total} — {progress.title}…</span>
        <div className="v3fs-upnext-bar" aria-hidden="true">
          <div className="v3fs-upnext-fill" style={{ width: `${Math.round(((progress.index - 1) / progress.total) * 100)}%` }} />
        </div>
      </div>
    );
  }
  return (
    <>
      <button type="button" className={`v3fs-upnext-btn${primary ? " pri" : ""}`} disabled={busyElsewhere}
        title={`Evidence changed — ${plan.length} documents regenerate in dependency order, upstream first`}
        onClick={() => { onGo(); void run(); }}>
        <span className="v3fs-upnext-i" aria-hidden="true">↻</span>
        {busyElsewhere ? "An agent is running…" : done?.failed.length ? `Retry — ${done.failed.length} did not finish` : `Regenerate ${plan.length} documents — down the spine`}
      </button>
      {done && !done.failed.length && done.completed > 0 ? (
        <span className="v3fs-upnext-note">Regenerated {done.completed} — hand-edited documents ask first, in the Inbox.</span>
      ) : null}
    </>
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

/**
 * One "Up next" verb. An item with async `run` (regenerate / generate) shows
 * progress and jumps to the stage where the result lands; a navigation-only
 * item just goes there so the operator sees the thing they need to act on.
 * The first item in the queue is the primary; the rest stay quiet.
 */
function UpNextButton({ item, primary, onGo }: {
  item: UpNextItem;
  primary: boolean;
  onGo: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Verbs that write judgment (roster attestation) are two-step: the first
  // press arms and names exactly what will happen; the second acts. The arm
  // decays so a stray click never leaves a loaded button behind.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const press = async () => {
    if (item.confirm && !armed) { setArmed(true); return; }
    onGo();
    if (!item.run) return;
    setBusy(true);
    try { await item.run(); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <button type="button" className={`v3fs-upnext-btn${primary ? " pri" : ""}${armed ? " armed" : ""}`} disabled={busy} onClick={() => void press()}>
      <span className="v3fs-upnext-i" aria-hidden="true">{item.icon}</span>
      {busy ? "Working…" : armed && item.confirm ? item.confirm : item.label}
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
/** A movement's discovery, organized by stakeholder. One card per person or
 * role: their script, their link/meeting channels, their captured evidence, a
 * capture box — followed until they've been heard. Driven by
 * resolveMovementStakeholders, so it serves every movement. */
/** Derive a stakeholder's collection status, their live link pack, and the
 * evidence attributed to them — the single source of truth for the status
 * board grouping and each card. */
function stakeholderCollection(
  movementId: string,
  stakeholder: MovementStakeholder,
  packs: ReturnType<typeof listInterviewPacks>,
  evidence: ReturnType<typeof movementEvidence>,
) {
  const key = stakeholder.name.toLowerCase();
  const pack = [...packs].reverse().find((p) => String(p.stakeholder ?? "").trim().toLowerCase() === key
    && (movementId === "listen" ? (!p.movementId || p.movementId === "listen") : p.movementId === movementId));
  // Their evidence: attributed voice blocks, PLUS documents they provided
  // (document entries carry the provider in their meta, not in `who`).
  const mine = (key.length > 2 ? evidence.filter((e) =>
    e.who.toLowerCase().includes(key)
    || key.includes(e.who.split(",")[0].trim().toLowerCase())
    || (e.kind === "document" && e.meta.toLowerCase().includes(key))) : [])
    // Newest first — the latest response leads the trail.
    .slice().sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
  const heard = mine.length > 0 || Boolean(pack?.respondedAt);
  const status: "heard" | "waiting" | "toreach" = heard ? "heard" : pack ? "waiting" : "toreach";
  return { key, pack, mine, heard, status };
}
type StakeholderCollection = ReturnType<typeof stakeholderCollection>;

const COLLECT_COLUMNS: Array<{ key: "heard" | "waiting" | "toreach"; label: string }> = [
  { key: "heard", label: "Heard" },
  { key: "waiting", label: "Awaiting response" },
  { key: "toreach", label: "To reach" },
];

/** The movement's stakeholder data collection as a STATUS BOARD: cards grouped
 * into columns by collection state (Heard · Awaiting · To reach), each card the
 * person's quote, dated feedback trail (click → transcript), follow-ups,
 * meeting, and link channels. Driven by resolveMovementStakeholders. */
function IntervieweeDiscovery({ program, movementId, captureField, related, onSaveInputs, onMintFollowUp, onMintPacks, onCaptured }: {
  program: ProgramSummary;
  movementId: string;
  captureField: string;
  related?: ProgramSummary[];
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  onMintPacks?: () => Promise<void>;
  onCaptured?: () => void;
}) {
  const stakeholders = resolveMovementStakeholders(program, movementId);
  const movement = flowMovements().find((m) => m.id === movementId);
  const evidence = movement ? movementEvidence(program, movement) : [];
  const packs = listInterviewPacks(program);
  const [mintBusy, setMintBusy] = useState(false);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  // Same person, other programmes in the family: their quotes project here
  // read-only, tagged with origin — evidence never moves between programmes.
  const crossAll = useMemo(() =>
    (related ?? []).flatMap((rp) => flowMovements().flatMap((m) =>
      movementEvidence(rp, m).map((entry) => ({ entry, from: rp.name })))),
    [related]);
  if (!stakeholders.length) return null;
  const evaluated = stakeholders.map((s) => ({ s, coll: stakeholderCollection(movementId, s, packs, evidence) }));
  const heardCount = evaluated.filter((e) => e.coll.status === "heard").length;
  const word = movementId === "show" ? "reviewed" : movementId === "listen" || movementId === "frame" ? "heard" : "consulted";
  const columns = COLLECT_COLUMNS
    .map((c) => ({ ...c, items: evaluated.filter((e) => e.coll.status === c.key) }))
    .filter((c) => c.items.length);
  const toggleAll = () => {
    const next = !allCollapsed;
    boardRef.current?.querySelectorAll("details.v3fs-ivc").forEach((node) => { (node as HTMLDetailsElement).open = !next; });
    setAllCollapsed(next);
  };
  return (
    <div className="v3fs-ch-collect">
      <div className="v3fs-collect-h">
        <div className="v3fs-colh ev">Stakeholder data collection</div>
        <span className="v3fs-collect-count"
          title={movementId === "listen"
            ? "Counted from collected evidence and responded links. The gate's coverage ledger is separate — voices are attested heard or waived in the roster."
            : "Counted from collected evidence and responded links."}>
          {heardCount} of {stakeholders.length} {word}
        </span>
        <div className="v3fs-collect-tools">
          {movementId === "listen" && onMintPacks ? (
            <button type="button" className="v3fs-btn" disabled={mintBusy}
              onClick={async () => { setMintBusy(true); try { await onMintPacks(); } finally { setMintBusy(false); } }}>
              {packs.length ? "↺ Refresh & add links" : "✳ Create everyone's link"}
            </button>
          ) : null}
          {stakeholders.length > 1 ? (
            <button type="button" className="v3fs-btn quiet" onClick={toggleAll}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
          ) : null}
        </div>
      </div>
      <div className="v3fs-collect-board" ref={boardRef}>
        {columns.map((col) => (
          <div key={col.key} className="v3fs-collect-col">
            <div className="v3fs-collect-col-h"><span className={`v3fs-cdot ${col.key}`} aria-hidden="true" />{col.label}<span className="v3fs-cn">{col.items.length}</span></div>
            {col.items.map(({ s, coll }) => {
              const key = s.name.toLowerCase();
              const cross = key.length > 2 ? crossAll.filter(({ entry }) => {
                const who = entry.who.split(",")[0].trim().toLowerCase();
                return who && (who.includes(key) || key.includes(who));
              }) : [];
              return (
                <IntervieweeCard key={s.id} program={program} movementId={movementId} stakeholder={s} captureField={captureField}
                  coll={coll} cross={cross} onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp} onCaptured={onCaptured} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntervieweeCard({ program, movementId, stakeholder, captureField, coll, cross, onSaveInputs, onMintFollowUp, onCaptured }: {
  program: ProgramSummary;
  movementId: string;
  stakeholder: MovementStakeholder;
  captureField: string;
  coll: StakeholderCollection;
  cross?: Array<{ entry: ReturnType<typeof movementEvidence>[number]; from: string }>;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  onCaptured?: () => void;
}) {
  const { name, role, questions } = stakeholder;
  const { pack, mine, heard, status } = coll;
  const first = name.split(" ")[0] || "they";
  const email = stakeholderEmail(program, name);
  // A minted link is only "the" link while its questions still match the
  // current script — when the script has moved on, the old link goes stale and
  // Copy/Send mint a fresh pack (which supersedes the unanswered one).
  const packMatches = !!pack && (Array.isArray(pack.questions) ? pack.questions.map(String).join(" ") : "")
    === questions.slice(0, 8).join(" ");
  const statusLabel = heard ? "Heard" : pack ? (packMatches ? "Link sent" : "Link outdated") : "To reach";
  const [capture, setCapture] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [mintedLink, setMintedLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [evFor, setEvFor] = useState<typeof mine[number] | null>(null);
  // Passage to highlight when the reader opens from a contradiction question.
  const [evHighlight, setEvHighlight] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const effectiveLink = (pack && packMatches ? portalLinkFor(program.id, pack) : null) ?? mintedLink;

  const ensureLink = async (): Promise<string | null> => {
    if (effectiveLink) return effectiveLink;
    if (!onMintFollowUp || !questions.length) return null;
    setLinkBusy(true);
    try {
      const link = await onMintFollowUp({ movementId, who: name, questions, captureField });
      if (link) setMintedLink(link);
      return link;
    } finally { setLinkBusy(false); }
  };
  const copyLink = async () => { const link = await ensureLink(); if (link) { try { await navigator.clipboard.writeText(link); } catch { window.prompt("Copy the link:", link); } } };
  const sendLink = async () => { if (!email) return; const link = await ensureLink(); if (link) window.location.href = mailtoLink(email, { stakeholder: name, programmeName: program.name, link }); };

  const save = async () => {
    const text = capture.trim();
    if (!text) return;
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const phase = flowMovements().find((m) => m.id === movementId);
      const phaseId = movementId;
      void phase;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const header = `— ${[name, role, evidenceStamp()].filter(Boolean).join(", ")} —`;
      await onSaveInputs(phaseId, { [captureField]: [existing.trimEnd(), `${header}\n${text}`].filter(Boolean).join("\n\n") },
        { attest: { action: `Captured — ${name}` } });
      setCapture("");
      onCaptured?.();
    } finally { setBusy(false); }
  };

  // An attached file is EVIDENCE the moment it lands: saved as a document
  // block in the person's name — canonical header + [source:] pointer — so the
  // Library lists it and the original stays downloadable. No manual step.
  // A MEETING TRANSCRIPT goes further: detected speakers are auto-mapped to
  // the movement's roster and each matched person gets their turns as their
  // OWN attributed block — everyone in the room is heard, not just this card.
  const saveAttachedDoc = async (filename: string, text: string, sourceKey?: string) => {
    const docTitle = filename.replace(/\.[^.]+$/, "");
    setBusy(true);
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = typeof raw.data === "object" && raw.data !== null ? raw.data as Record<string, unknown> : raw;
      const bucket = (inner.phaseInputs && typeof inner.phaseInputs === "object" ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[movementId] : undefined) ?? {};
      const existing = typeof bucket[captureField] === "string" ? bucket[captureField] as string : "";
      const day = evidenceStamp();
      const docBlock = `— Document: ${docTitle}, provided by ${name}, ${day} —\n${sourceKey ? `[source: ${sourceKey}]\n` : ""}${text}`;
      const roster = resolveMovementStakeholders(program, movementId).map((s) => ({ name: s.name, role: s.role }));
      const mapping = mapTranscriptSpeakers(text, roster);
      const speakerBlocks = (mapping?.blocks ?? []).map((b) =>
        `— ${[b.name, b.role, day].filter(Boolean).join(", ")} —\n${b.text}`);
      const attestDetail = mapping
        ? `provided by ${name} · speakers mapped: ${mapping.matched.join(", ") || "none"}${mapping.unmatched.length ? ` · unmatched: ${mapping.unmatched.join(", ")}` : ""}`
        : `provided by ${name}`;
      await onSaveInputs(movementId,
        { [captureField]: [existing.trimEnd(), docBlock, ...speakerBlocks].filter(Boolean).join("\n\n") },
        { attest: { action: mapping?.blocks.length ? `Transcript mapped — ${docTitle}` : `Document added — ${docTitle}`, detail: attestDetail } });
      onCaptured?.();
    } finally { setBusy(false); }
  };
  const downloadOriginal = (entry: typeof mine[number]) => {
    void supabase.functions.invoke("flow-extract", { body: { download: entry.sourceKey } })
      .then((result: { data: unknown }) => {
        const url = (result.data as { url?: string } | null)?.url;
        if (url) window.open(url, "_blank"); else setEvFor(entry);
      })
      .catch(() => setEvFor(entry));
  };

  return (
    <>
      <details className={`v3fs-ivc ${status}`} open={!heard}>
        <span className="v3fs-ivc-strip" aria-hidden="true" />
        <summary>
          <span className="v3fs-ivc-who">{name || "Stakeholder"}{role && role !== name ? <span>{role}</span> : null}</span>
          <span className={`v3fs-ivc-st ${status}`}>{statusLabel}</span>
          <span className="v3fs-ivc-chev" aria-hidden="true" />
        </summary>
        <div className="v3fs-ivc-b">
          {/* Feedback trail — every dated response, click to read the transcript. */}
          <div className="v3fs-ivc-sec">
            <div className="v3fs-ivc-sec-h">Feedback &amp; responses</div>
            {mine.length || cross?.length ? (
              <div className="v3fs-ivc-fb">
                {mine.map((e, i) => (
                  <button key={i} type="button" className="v3fs-ivc-fb-row" onClick={() => setEvFor(e)}
                    title={e.kind === "document" ? "Open the extracted content — ⤓ fetches the original file" : "Read the transcript"}>
                    <span className="v3fs-ivc-fb-top">
                      {e.kind === "document" ? <span className="v3fs-ivc-fb-kind">doc</span> : null}
                      {e.kind === "document" ? <span className="v3fs-ivc-fb-m">{e.who}</span> : null}
                      {e.capturedAt ? <span className="v3fs-ivc-fb-when">{e.capturedAt}</span> : null}
                      {e.kind === "document" && e.sourceKey ? (
                        <span role="button" tabIndex={0} className="v3fs-ivc-fb-dl" title="Download the original file"
                          onClick={(ev) => { ev.stopPropagation(); downloadOriginal(e); }}
                          onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); downloadOriginal(e); } }}>⤓ original</span>
                      ) : null}
                      <span className="v3fs-ivc-fb-go">Open ↗</span>
                    </span>
                    {e.excerpt ? <span className="v3fs-ivc-fb-q">“{e.excerpt}”</span> : null}
                  </button>
                ))}
                {(cross ?? []).slice(0, 4).map(({ entry, from }, i) => (
                  <button key={`x-${i}`} type="button" className="v3fs-ivc-fb-row cross" onClick={() => setEvFor(entry)}
                    title={`Said in ${from} — shown here read-only`}>
                    <span className="v3fs-ivc-fb-top"><span className="v3fs-ivc-fb-from">◇ {from}</span><span className="v3fs-ivc-fb-m">{entry.meta}</span><span className="v3fs-ivc-fb-go">Open ↗</span></span>
                    {entry.excerpt ? <span className="v3fs-ivc-fb-q">“{entry.excerpt}”</span> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="v3fs-ivc-fb-empty">No responses yet — collect via a link or a meeting.</div>
            )}
          </div>

          {/* Follow-up questions / their script. A question born from a
              contradiction carries its receipts: the disputed passage links
              straight into the evidence reader, highlighted, so the operator
              (or the stakeholder on a call) reviews the source before judging. */}
          {questions.length ? (
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Still open — ask on the next round" : "Their script"}
                {heard ? <span className="v3fs-ivc-sec-note">these are unresolved gaps &amp; disputes; they clear when the artifact is regenerated or the dispute resolved</span> : null}</div>
              <ul className="v3fs-ivc-q">{questions.map((q, i) => {
                const disputed = q.match(/disagree[^"]*"(.{8,140}?)"/i)?.[1];
                const source = disputed
                  ? flowMovements().flatMap((m) => movementEvidence(program, m)).find((entry) => entry.text && locateQuote(entry.text, disputed))
                  : undefined;
                return (
                  <li key={i}>
                    {q}
                    {source ? (
                      <button type="button" className="v3fs-a v3fs-ivc-evlink" title={`Said by ${source.who} — read the passage in the source`}
                        onClick={() => { setEvHighlight(disputed ?? null); setEvFor(source); }}>
                        ⤷ review evidence
                      </button>
                    ) : null}
                  </li>
                );
              })}</ul>
            </div>
          ) : null}

          {/* Meeting + link channels. Not-yet-heard people get "Reach out";
              heard people KEEP the same three channels as "Follow up" whenever
              the kit still has questions for them (it swaps in the gap-driven
              follow-up script once a conversation is on record) — so the Frame
              sponsor's single card never strands the operator without a send
              button, and every movement's card behaves identically. */}
          {!heard || questions.length ? (
            <div className="v3fs-ivc-sec">
              <div className="v3fs-ivc-sec-h">{heard ? "Follow up" : "Reach out"}</div>
              {/* Three ways in, no standing form: copy the link, email the
                  link, or send a meeting invite — the date picker lives INSIDE
                  the invite action, asked for only when it's needed. */}
              <div className="v3fs-ivc-ch">
                <button type="button" className={`v3fs-btn${email ? "" : " pri"}`} disabled={linkBusy} onClick={() => void copyLink()}>
                  {linkBusy && !email ? "…" : effectiveLink ? "⎘ Copy link" : "⎘ Create & copy link"}
                </button>
                {email ? (
                  <button type="button" className="v3fs-btn pri" disabled={linkBusy} title={`Opens a draft to ${email}`} onClick={() => void sendLink()}>✉ Send link</button>
                ) : null}
                <button type="button" className="v3fs-btn" title={`Pick a date — downloads a calendar invite for ${name}`}
                  onClick={() => {
                    const picker = dateRef.current;
                    if (!picker) return;
                    if ("showPicker" in picker) { try { (picker as HTMLInputElement & { showPicker: () => void }).showPicker(); return; } catch { /* fall through */ } }
                    picker.focus(); picker.click();
                  }}>🗓 Send meeting invite</button>
                <input ref={dateRef} type="date" className="v3fs-ivc-date-hidden" tabIndex={-1} aria-label={`Meeting date for ${name}`}
                  value={date}
                  onChange={(e) => {
                    const picked = e.target.value;
                    setDate(picked);
                    if (!picked) return;
                    const ics = buildMeetingIcs({ who: name, email, date: picked, programmeName: program.name, intro: "", questions });
                    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = `${movementId}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }} />
              </div>
            </div>
          ) : null}

          {/* Capture what they said — typed, or spoken and transcribed. */}
          <div className="v3fs-ivc-cap">
            <textarea rows={2} value={capture} onChange={(e) => setCapture(e.target.value)}
              placeholder={`What ${first} said — attribution added for you`} aria-label={`Capture ${name}'s input`} />
            <div className="v3fs-ivc-cap-row">
              <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
                {busy ? "Saving…" : "Capture"}
              </button>
              <TranscribeButton onText={(transcript) => setCapture((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
              <AttachFileButton programId={program.id}
                onExtracted={(filename, text, sourceKey) => void saveAttachedDoc(filename, text, sourceKey)} />
            </div>
          </div>
        </div>
      </details>
      {evFor ? <EvidenceReader entry={evFor} highlight={evHighlight ?? undefined} onClose={() => { setEvFor(null); setEvHighlight(null); }} /> : null}
    </>
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

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Any document → reviewable text via flow-extract (decode, Office XML, or the
 * model reading PDFs/images natively). The operator reads the extraction in
 * the form before "Add the document" makes it evidence — nothing lands blind. */
export function AttachFileButton({ programId, onExtracted }: { programId: string; onExtracted: (filename: string, text: string, sourceKey?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const ingest = async (file: File) => {
    setBusy(true);
    setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("flow-extract", {
        body: { file: await fileToBase64(file), mime: file.type || "", filename: file.name, store: true, programId },
      });
      if (error) {
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        setNote((detail as { error?: string } | null)?.error ?? "Could not read that file — paste the text instead.");
        return;
      }
      const text = typeof (data as { text?: string } | null)?.text === "string" ? (data as { text: string }).text : "";
      const sourceKey = typeof (data as { sourceKey?: string } | null)?.sourceKey === "string" ? (data as { sourceKey: string }).sourceKey : undefined;
      if (text) onExtracted(file.name, text, sourceKey);
      else setNote("The file produced no readable text.");
    } catch {
      setNote("Could not read that file — paste the text instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v3fs-kit-rec">
      <input ref={inputRef} type="file" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void ingest(file);
        }} />
      <button type="button" className="v3fs-a" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? "Reading…" : "⌲ Attach a file — PDF, Word, Excel, text…"}
      </button>
      {note ? <span className="v3fs-kit-rec-note">{note}</span> : null}
    </div>
  );
}

/** Recording → reviewable text. The audio is transcribed server-side and the
 * transcript lands in the capture box for the operator to READ before it
 * becomes evidence — the recording itself is never stored. Hidden after a
 * 501 (transcription not configured on the project). */
let transcribeAvailable: boolean | null = null;
let transcribeProbeInFlight: Promise<void> | null = null;

function TranscribeButton({ onText }: { onText: (transcript: string) => void }) {
  const [state, setState] = useState<"idle" | "busy" | "unavailable">("idle");
  const [note, setNote] = useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Probe once per session: an empty POST answers 501 before any body
  // validation when the key is missing, so the button never advertises a
  // feature the project can't deliver.
  useEffect(() => {
    if (transcribeAvailable !== null) {
      if (!transcribeAvailable) setState("unavailable");
      return;
    }
    const probe = transcribeProbeInFlight ??= supabase.functions.invoke("flow-transcribe", { body: {} }).then(({ error }: { error: unknown }) => {
      const status = (error as { context?: { status?: number } } | null)?.context?.status;
      transcribeAvailable = status !== 501;
    });
    void probe.then(() => { if (!transcribeAvailable) setState("unavailable"); });
  }, []);
  if (state === "unavailable") return null;

  const ingest = async (file: File) => {
    setState("busy");
    setNote(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
      }
      const { data, error } = await supabase.functions.invoke("flow-transcribe", {
        body: { audio: btoa(binary), mime: file.type || "audio/webm", filename: file.name },
      });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 501) { setState("unavailable"); return; }
        const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
        setNote((detail as { error?: string } | null)?.error ?? "Transcription failed — paste the notes instead.");
        setState("idle");
        return;
      }
      const text = typeof (data as { text?: string } | null)?.text === "string" ? (data as { text: string }).text : "";
      if (text) onText(text); else setNote("The recording produced no speech to transcribe.");
      setState("idle");
    } catch {
      setNote("Could not read that file — paste the notes instead.");
      setState("idle");
    }
  };

  return (
    <div className="v3fs-kit-rec">
      <input ref={inputRef} type="file" accept="audio/*,video/webm,video/mp4" hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void ingest(file);
        }} />
      <button type="button" className="v3fs-a" disabled={state === "busy"} onClick={() => inputRef.current?.click()}>
        {state === "busy" ? "Transcribing\u2026" : "\u2b06 Transcribe a recording"}
      </button>
      {note ? <span className="v3fs-kit-rec-note">{note}</span> : null}
    </div>
  );
}

function MeetingKitCard({ kit, movementId, hasEvidence, program, docsStale, onRegenerateStale, onSaveInputs, onScheduleFollowUp, onMintFollowUp, onMintPacks, onMintDemoInvites, onCaptured }: {
  kit: MeetingKit | null;
  movementId: string;
  hasEvidence: boolean;
  /** Mint Listen's response links from the Discovery Kit. */
  onMintPacks?: () => Promise<void>;
  /** Mint Show's demo links from the Demo Scripts. */
  onMintDemoInvites?: () => Promise<void>;
  /** Fired after a capture lands — Show wires the contradiction watcher here. */
  onCaptured?: () => void;
  /** A movement document trails the evidence — answered gaps fall off this
   * script only when the documents regenerate. */
  docsStale?: boolean;
  /** Regenerate this movement's stale documents (the kit offers it in place
   * of a stale follow-up script). */
  onRegenerateStale?: () => Promise<void>;
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
  const [docSourceKey, setDocSourceKey] = useState<string | null>(null);
  const [docTick, setDocTick] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [fileContradiction, setFileContradiction] = useState(false);
  // Show captures attribute their track: default to the track that demos to
  // this stakeholder; "programme-wide" stays available for cross-track sessions.
  const trackNames = useMemo(
    () => (movementId === "show" ? listFlowTracks(program).map((track) => ({ name: track.name, lead: (track.leadStakeholder ?? "").toLowerCase() })) : []),
    [movementId, program],
  );
  const [trackSel, setTrackSel] = useState<string>(() => {
    const who = (kit?.who ?? "").toLowerCase();
    return trackNames.find((track) => track.lead && who.includes(track.lead))?.name ?? "";
  });
  const [resolveIdx, setResolveIdx] = useState<Set<number>>(() => new Set());
  // Open contradictions — offered as "this answer settles it" checkboxes on
  // the SPONSOR's capture (Frame): the sponsor arbitrates, the row resolves.
  const openContradictions = useMemo(() => {
    if (movementId !== "frame") return [] as Array<{ index: number; statement: string }>;
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
    const bucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
      ? ((inner.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
      : {};
    let rows: Array<Record<string, string>> = [];
    try {
      const parsed = JSON.parse(typeof bucket.contradictionLog === "string" ? bucket.contradictionLog : "[]");
      if (Array.isArray(parsed)) rows = parsed.filter((row) => row && typeof row === "object");
    } catch { rows = []; }
    return rows.map((row, index) => ({ index, statement: String(row.statement ?? ""), open: /open/i.test(String(row.status ?? "")) }))
      .filter((row) => row.open && row.statement)
      .map(({ index, statement }) => ({ index, statement }));
  }, [movementId, program.rawData]);

  // "Attach" on a referenced document: land in the ingest form with the
  // name prefilled — the capture area is where evidence arrives.
  const attachDocument = (name: string) => {
    setDocName(name);
    setDocOpen(true);
  };

  if (!kit) {
    return hasEvidence ? null : (
      <div className="v3fs-kit v3fs-kit-ghost">
        Generate the previous step’s document first — this conversation’s script is built from it.
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
      const taggedHeader = movementId === "show" && trackSel
        ? kit.header.replace("Demo session", `Demo session (${trackSel})`)
        : kit.header;
      const block = taggedHeader ? `${taggedHeader}\n${text}` : text;
      const next = kit.header
        ? [existing.trimEnd(), block].filter(Boolean).join("\n\n")
        : text; // single-line refs (go/no-go) replace rather than append
      // Contradictions the sponsor's answer settles flip to Resolved in
      // Listen's log — a second write (conflict-rebase absorbs it), each row
      // naming the arbiter and pointing at the transcript.
      let resolvedRows: string | null = null;
      let resolvedCount = 0;
      if (resolveIdx.size && movementId === "frame") {
        const raw2 = (program.rawData ?? {}) as Record<string, unknown>;
        const inner2 = typeof raw2.data === "object" && raw2.data !== null ? (raw2.data as Record<string, unknown>) : raw2;
        const bucket2 = typeof inner2.phaseInputs === "object" && inner2.phaseInputs !== null
          ? ((inner2.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
          : {};
        try {
          const rows = JSON.parse(typeof bucket2.contradictionLog === "string" ? bucket2.contradictionLog : "[]");
          if (Array.isArray(rows)) {
            for (const index of resolveIdx) {
              if (rows[index] && typeof rows[index] === "object") {
                // The complete resolution: what was decided (the answer, in
                // the arbiter's words), who settled it, and when — the row
                // becomes the record, not a pointer to one.
                rows[index].status = "Resolved";
                rows[index].resolution = text.replace(/\s+/g, " ").slice(0, 200);
                rows[index].resolvedBy = kit.who;
                rows[index].resolvedAt = new Date().toISOString().slice(0, 10);
                resolvedCount += 1;
              }
            }
            if (resolvedCount) resolvedRows = JSON.stringify(rows);
          }
        } catch { /* malformed log — leave it untouched */ }
      }
      await onSaveInputs(movementId, { [kit.captureField]: next }, {
        attest: {
          action: `Evidence captured — ${kit.who}${resolvedCount ? ` · ${resolvedCount} contradiction${resolvedCount === 1 ? "" : "s"} settled` : ""}`,
          detail: text.replace(/\s+/g, " ").slice(0, 140),
        },
      });
      if (resolvedRows) {
        await onSaveInputs("listen", { contradictionLog: resolvedRows }, {
          attest: { action: `Contradictions resolved — arbitrated by ${kit.who}`, detail: `${resolvedCount} row${resolvedCount === 1 ? "" : "s"} settled` },
        });
      }
      setResolveIdx(new Set());
      // Demo feedback that disputes the record routes UPSTREAM too: an open
      // contradiction lands in Listen's log, so Listen's gate re-asks the
      // question and its documents re-derive from the corrected record.
      if (fileContradiction && movementId === "show") {
        const raw = (program.rawData ?? {}) as Record<string, unknown>;
        const inner = typeof raw.data === "object" && raw.data !== null ? (raw.data as Record<string, unknown>) : raw;
        const listenBucket = typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
          ? ((inner.phaseInputs as Record<string, Record<string, unknown>>).listen ?? {})
          : {};
        let rows: Array<Record<string, string>> = [];
        try {
          const parsed = JSON.parse(typeof listenBucket.contradictionLog === "string" ? listenBucket.contradictionLog : "[]");
          if (Array.isArray(parsed)) rows = parsed.filter((row) => row && typeof row === "object");
        } catch { rows = []; }
        const statement = text.replace(/\s+/g, " ").slice(0, 110);
        rows.push({
          statement,
          between: `${kit.who} (demo session) vs the record`,
          positions: "Filed from Show feedback — see the demo session transcript",
          status: `Open — filed ${new Date().toISOString().slice(0, 10)}`,
        });
        await onSaveInputs("listen", { contradictionLog: JSON.stringify(rows) }, {
          attest: { action: `Contradiction filed to Listen — from ${kit.who}'s demo feedback`, detail: statement },
        });
        setFileContradiction(false);
      }
      // The system reads what just arrived: fire-and-forget watcher pass.
      onCaptured?.();
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
      const block = `— Document: ${name}, provided by ${kit.who}, ${new Date().toISOString().slice(0, 10)} —\n${docSourceKey ? `[source: ${docSourceKey}]\n` : ""}${text}`;
      await onSaveInputs(movementId, { [kit.captureField]: [existing.trimEnd(), block].filter(Boolean).join("\n\n") }, {
        attest: { action: `Document added — ${name}`, detail: `provided by ${kit.who}` },
      });
      setDocName("");
      setDocText("");
      setDocSourceKey(null);
      setDocTick(true);
      onCaptured?.();
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

  // Minting is implicit: Copy/Send create the link if none is live yet.
  const mintLink = async (): Promise<string | null> => {
    if (!onMintFollowUp) return null;
    setBusy(true);
    try {
      return await onMintFollowUp({ movementId, who: kit.who, questions: kit.questions, captureField: kit.captureField });
    } finally { setBusy(false); }
  };
  const copyMintedLink = async () => {
    const link = await mintLink();
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch { window.prompt("Copy the follow-up link:", link); }
    setLinkTick(true);
    window.setTimeout(() => setLinkTick(false), 2200);
  };
  const sendMintedLink = async (email: string) => {
    const link = await mintLink();
    if (!link) return;
    window.location.href = mailtoLink(email, { stakeholder: kit.who, programmeName: program.name, link });
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
        {kit.followUp && docsStale ? (
          <div className="v3fs-kit-regen">
            <p>
              New answers are on the record — the artifacts haven&rsquo;t read them yet, so this
              script would re-ask questions that may already be answered. Regenerate first;
              a fresh script builds from whatever remains open.
            </p>
            {onRegenerateStale ? (
              <button type="button" className="v3fs-btn pri" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await onRegenerateStale(); } finally { setBusy(false); }
              }}>{busy ? "Regenerating…" : "↻ Regenerate artifacts"}</button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="v3fs-kit-cap">Interview script — {kit.who}</div>
            <ol className="v3fs-kit-qs">
              {kit.questions.map((question, index) => <li key={index}>{question}</li>)}
            </ol>
            <div className="v3fs-kit-actions">
              <button type="button" className="v3fs-btn pri" onClick={() => void copyScript()}>
                {copied ? "Copied ✓" : "Copy the script"}
              </button>
            </div>
          </>
        )}
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
            <p className="v3fs-script-docs-note">Attach it and it becomes evidence beside the conversation, with its source noted.</p>
          </div>
        ) : null}
        {(() => {
          // ONE list of links per movement: Listen owns the discovery packs,
          // Show adds its demo invites, every movement carries its own
          // follow-ups. Each row offers exactly one send action — email when
          // the address is on file, copy otherwise.
          const packRows = visibleLinks(listInterviewPacks(program).filter((pack) =>
            movementId === "listen" ? (!pack.movementId || pack.movementId === "listen") : pack.movementId === movementId,
          )).map((pack) => {
            // A link whose questions no longer match the current script is
            // OUTDATED — say so, and point at the refresh that re-mints it.
            const isKitPerson = pack.stakeholder.trim().toLowerCase() === kit.who.trim().toLowerCase() && pack.role !== "Follow-up";
            const outdated = isKitPerson && pack.questions.map(String).join(" ") !== kit.questions.slice(0, 8).map(String).join(" ");
            return {
              id: pack.id, who: pack.stakeholder, responded: Boolean(pack.respondedAt),
              meta: pack.respondedAt ? "responded"
                : outdated ? "script changed — refresh links to re-mint"
                : `${pack.role === "Follow-up" ? "follow-up · " : ""}${pack.questions.length} question${pack.questions.length === 1 ? "" : "s"} · waiting`,
              link: portalLinkFor(program.id, pack),
            };
          });
          const inviteRows = movementId === "show" ? listDemoInvites(program).map((invite) => ({
            id: invite.id, who: invite.stakeholder, responded: Boolean(invite.respondedAt),
            meta: invite.respondedAt ? "verdict received" : "demo · waiting for their verdict",
            link: portalLinkFor(program.id, invite),
          })) : [];
          // Responded links drop off — their answers are captured and live in
          // the Library; a "responded" row here is just clutter.
          const rows = [...inviteRows, ...packRows].filter((row) => !row.responded);
          const canMintPacks = movementId === "listen" && onMintPacks;
          const canMintInvites = movementId === "show" && onMintDemoInvites;
          if (!(onScheduleFollowUp || onMintFollowUp || canMintPacks || canMintInvites || rows.length)) return null;
          return (
          <>
            <div className="v3fs-kit-cap">Channels</div>
            <div className="v3fs-kit-ch">
              {onScheduleFollowUp && !(kit.followUp && docsStale) ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Meeting<span>Book it — the invite carries the script as its agenda</span></div>
                  <div className="v3fs-kit-chan-a">
                    <input type="date" value={followDate} onChange={(event) => setFollowDate(event.target.value)} aria-label="Follow-up date" />
                    <button type="button" className="v3fs-btn pri" disabled={busy || !followDate} onClick={() => void schedule()}>
                      {scheduledTick ? "Scheduled ✓" : "Schedule"}
                    </button>
                    <button type="button" className="v3fs-btn" disabled={!followDate}
                      title={stakeholderEmail(program, kit.who) ? `Attendee: ${stakeholderEmail(program, kit.who)}` : "No email on file — the invite downloads without an attendee"}
                      onClick={() => {
                        const ics = buildMeetingIcs({
                          who: kit.who, email: stakeholderEmail(program, kit.who), date: followDate,
                          programmeName: program.name, intro: kit.purpose, questions: kit.questions,
                        });
                        const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = `discovery-${kit.who.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                      }}>⤓ Invite (.ics)</button>
                  </div>
                </div>
              ) : null}
              {(onMintFollowUp && kit.questions.length > 0) || canMintPacks || canMintInvites || rows.length ? (
                <div className="v3fs-kit-chan">
                  <div className="v3fs-kit-chan-t">Links<span>ATOS asks for you — answers arrive in the Inbox, attributed</span></div>
                  {rows.length ? (
                    <div className="v3fs-kit-links">
                      {rows.map((row) => {
                        const email = row.responded ? null : stakeholderEmail(program, row.who);
                        return (
                          <div key={row.id} className="v3fs-async-row">
                            <span className={`v3fs-st ${row.responded ? "ok" : "none"}`} />
                            <div className="v3fs-async-who">
                              {row.who}
                              <span>{row.meta}</span>
                            </div>
                            {row.responded ? null : (
                              <span className="v3fs-async-cta">
                                <button type="button" className={`v3fs-btn${email ? "" : " pri"}`}
                                  onClick={() => { void navigator.clipboard.writeText(row.link).catch(() => window.prompt("Copy the link:", row.link)); }}>
                                  Copy link
                                </button>
                                {email ? (
                                  <button type="button" className="v3fs-btn pri" title={`Opens a draft to ${email} with the link inside`}
                                    onClick={() => { window.location.href = mailtoLink(email, { stakeholder: row.who, programmeName: program.name, link: row.link }); }}>
                                    ✉ Send link
                                  </button>
                                ) : null}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="v3fs-kit-chan-a">
                    {canMintPacks ? (
                      <button type="button" className="v3fs-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onMintPacks!(); } finally { setBusy(false); } }}>
                        {rows.length ? "↺ Refresh & add response links" : "✳ Create response links"}
                      </button>
                    ) : null}
                    {canMintInvites ? (
                      <button type="button" className="v3fs-btn" disabled={busy} onClick={async () => { setBusy(true); try { await onMintDemoInvites!(); } finally { setBusy(false); } }}>
                        {inviteRows.length ? "↺ Demo links for new stakeholders" : "✳ Create demo links"}
                      </button>
                    ) : null}
                    {onMintFollowUp && kit.questions.length > 0 && (!kit.followUp || !docsStale) && !rows.some((row) => !row.responded && row.who.trim().toLowerCase() === kit.who.trim().toLowerCase()) ? (
                      <>
                        <button type="button" className={`v3fs-btn${stakeholderEmail(program, kit.who) ? "" : " pri"}`} disabled={busy} onClick={() => void copyMintedLink()}>
                          {linkTick ? "Link copied ✓" : "Copy link"}
                        </button>
                        {stakeholderEmail(program, kit.who) ? (
                          <button type="button" className="v3fs-btn pri" disabled={busy}
                            title={`Opens a draft to ${stakeholderEmail(program, kit.who)} with the link inside`}
                            onClick={() => void sendMintedLink(stakeholderEmail(program, kit.who)!)}>
                            ✉ Send link
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </>
          );
        })()}
        <div className="v3fs-kit-cap">What came back</div>
        <div className="v3fs-kit-capture">
          <textarea
            rows={3}
            placeholder={kit.header ? `${kit.captureLabel} — attribution added for you (${kit.header})` : kit.captureLabel}
            value={capture}
            onChange={(event) => setCapture(event.target.value)}
            aria-label={kit.captureLabel}
          />
          <TranscribeButton onText={(transcript) => setCapture((current) => (current.trim() ? `${current.trim()}\n\n${transcript}` : transcript))} />
          {movementId === "show" && trackNames.length ? (
            <label className="v3fs-kit-track">
              <span>Track</span>
              <select value={trackSel} onChange={(event) => setTrackSel(event.target.value)} aria-label="Which track was demonstrated">
                <option value="">Programme-wide</option>
                {trackNames.map((track) => <option key={track.name} value={track.name}>{track.name}</option>)}
              </select>
            </label>
          ) : null}
          {openContradictions.length ? (
            <div className="v3fs-kit-resolves">
              {openContradictions.map(({ index, statement }) => (
                <label key={index} className="v3fs-kit-flag">
                  <input
                    type="checkbox"
                    checked={resolveIdx.has(index)}
                    onChange={(event) => setResolveIdx((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(index); else next.delete(index);
                      return next;
                    })}
                  />
                  <span>This answer settles: “{statement.slice(0, 90)}”</span>
                </label>
              ))}
            </div>
          ) : null}
          {movementId === "show" ? (
            <label className="v3fs-kit-flag">
              <input
                type="checkbox"
                checked={fileContradiction}
                onChange={(event) => setFileContradiction(event.target.checked)}
              />
              <span>This contradicts earlier evidence — also log it as an open contradiction in Listen</span>
            </label>
          ) : null}
          <button type="button" className="v3fs-btn pri" disabled={busy || !capture.trim()} onClick={() => void save()}>
            {busy ? "Saving…" : savedTick ? "Captured ✓" : "Capture"}
          </button>
          <details className="v3fs-kit-doc" open={docOpen} onToggle={(event) => setDocOpen(event.currentTarget.open)}>
            <summary>＋ Add a referenced document</summary>
            <div className="v3fs-kit-docrow">
              <input value={docName} onChange={(event) => setDocName(event.target.value)}
                placeholder="Document name (e.g. Q2 pricing export)" aria-label="Document name" />
              <AttachFileButton programId={program.id} onExtracted={(filename, text, sourceKey) => {
                if (!docName.trim()) setDocName(filename.replace(/\.[^.]+$/, ""));
                if (sourceKey) setDocSourceKey(sourceKey);
                setDocText((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text));
              }} />
              <textarea rows={2} value={docText} onChange={(event) => setDocText(event.target.value)}
                placeholder="Paste its content — or attach the file above; review before adding." aria-label="Document content" />
              <button type="button" className="v3fs-btn" disabled={busy || !docName.trim() || !docText.trim()}
                onClick={() => void saveDoc()}>
                {docTick ? "Added ✓" : "Add the document"}
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

function ArtifactDoc({ artifact, running, evidenceNames, evidenceCount, onGenerate, onOpen, onGoEvidence }: {
  artifact: ArtifactCardModel;
  running: boolean;
  evidenceNames: string[];
  /** How many evidence items this movement holds — the card's provenance. */
  evidenceCount?: number;
  onGenerate: () => void;
  onOpen?: () => void;
  /** "evidence changed" chip → the Evidence tab, where the change lives. */
  onGoEvidence?: () => void;
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
        {artifact.stale ? (
          onGoEvidence
            ? <button type="button" className="v3fs-stale-tag" title="See what changed — open the Evidence tab" onClick={onGoEvidence}>evidence changed →</button>
            : <span className="v3fs-stale-tag">evidence changed</span>
        ) : null}
        {artifact.confidence != null ? <span className="v3fs-conf">{artifact.confidence}%</span> : null}
      </div>
      <div className="v3fs-doc-x">{artifact.excerpt ?? artifact.description}</div>
      {artifact.present && evidenceCount != null ? (
        <div className="v3fs-doc-prov">
          reads {evidenceCount} evidence item{evidenceCount === 1 ? "" : "s"}
          {artifact.gaps ? ` · ${artifact.gaps} open gap${artifact.gaps === 1 ? "" : "s"}` : " · no open gaps"}
        </div>
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
    </div>
  );
}
