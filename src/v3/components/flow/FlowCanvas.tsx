import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import PhaseInputsPanel from "@/v3/components/PhaseInputsPanel";
import { acceptedAgentPatterns } from "@/v3/components/flow/flowPatterns";
import EnvisionCockpit from "@/v3/components/flow/EnvisionCockpit";
import ShowCockpit from "@/v3/components/flow/ShowCockpit";
import ProductOwnerCockpit from "@/v3/components/flow/ProductOwnerCockpit";
import ListenCockpit from "@/v3/components/flow/ListenCockpit";
import { loopState } from "@/v3/components/flow/flowLoop";
import { areaHasModel } from "@/v3/components/flow/flowAreas";
import OntologyAtlasModal from "@/v3/components/flow/OntologyAtlasModal";
import ExternalBuildPanel from "@/v3/components/flow/ExternalBuildPanel";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
// The artifact studio pulls React Flow and every WYSIWYG editor — a heavy
// chunk only needed when a document is opened. Lazy-load it so it never
// weighs on the initial Flow render.
const FlowArtifactStudio = lazy(() => import("@/v3/components/flow/studio/FlowArtifactStudio"));
import type { ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, frontierMovementId, movementEvidence, movementArtifacts, readMovementInputs,
  gateReadiness, gateChecklist, listenCoverage, movementFacts, demoAcceptance,
  attestHeardRoster, artifactOpenGaps,
  type ArtifactCardModel, type EvidenceEntry,
} from "@/v3/components/flow/flowShellData";
import { gateAugmentations } from "@/v3/components/flow/flowCrossValidation";
import { meetingKit, askableMovementGaps } from "@/v3/components/flow/flowMeetings";
import { listInterviewPacks, listDemoInvites, portalLinkFor } from "@/v3/components/flow/flowPortal";
import { resolveMovementStakeholders, operatorAsksFor } from "@/v3/components/flow/flowStakeholders";
import { readDrillAnchor } from "@/v3/components/flow/flowDrilldown";
import { gateApprovalIntegrity } from "@/v3/components/flow/flowGovernance";
import { listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { listFlowTracks, trackAcceptance } from "@/v3/components/flow/flowTracks";
import { safePrompt } from "@/v3/components/flow/flowCapture";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import PrototypeCommandBar from "@/v3/components/flow/PrototypeCommandBar";
import { openPrototypeInBrowser } from "@/v3/components/flow/studio/PrototypeStudio";
import { MOVEMENT_CAPTION, leadTab, type MovementTab } from "@/v3/components/flow/flowStages";
import { useSpineRunning } from "@/v3/components/flow/flowUpNext";
import { IntervieweeDiscovery, stakeholderCollection, directoryCardRetired } from "@/v3/components/flow/CollectBoard";
import MeetingKitCard from "@/v3/components/flow/MeetingKitCard";

interface FlowCanvasProps {
  program: ProgramSummary;
  runningAgentIds: Set<string>;
  /** Artifacts in flight OR queued for regeneration — controls hide when set. */
  regenActiveIds?: Set<string>;
  /** Enqueue a regeneration (ordered, de-duplicated) rather than firing it now. */
  onEnqueueRegen?: (agentId: string, phaseId: string, label: string) => void;
  /** Per-artifact failure residue from the last run — shown on the card
   * until the next attempt, so a dead run can never pass for a quiet one. */
  agentErrors?: Record<string, string>;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  /** The full portfolio — for cross-programme accepted-agent patterns. */
  programs?: ProgramSummary[];
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
  onMintFollowUp?: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean }) => Promise<string | null>;
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
export default function FlowCanvas({ program, programs, runningAgentIds, regenActiveIds, onEnqueueRegen, agentErrors, onRunAgent, onSaveInputs, onMintPacks, onMintDemoInvites, onCompileShipLanes, onToggleShipItem, onSetShipLane, onScheduleFollowUp, onMintFollowUp, onMintReview, onSaveArtifactDoc, onSendForApproval, onOpenInbox, onRecordShowPass, onRecordGate, onReopenGate, relatedPrograms, onSelectProgram, onComment }: FlowCanvasProps) {
  // A regeneration is "active" for an artifact when it's in flight OR queued. All
  // Regenerate controls check this to hide themselves; enqueueRegen is the single
  // ordered/de-duplicated path (falls back to an immediate run if unwired).
  const regenActive = (id: string) => regenActiveIds?.has(id) ?? runningAgentIds.has(id);
  const enqueueRegen = (agentId: string, phaseId: string, label: string) => {
    if (onEnqueueRegen) onEnqueueRegen(agentId, phaseId, label);
    else onRunAgent(agentId, phaseId);
  };
  const movements = useMemo(() => flowMovements(), []);
  // A spine regeneration in flight — the collect cards suppress their script
  // until it lands (a script off a half-regenerated kit is inaccurate).
  const spineRunning = useSpineRunning();
  const frontier = frontierMovementId(program);
  // The spine is horizontal: one movement is active at a time; the stepper on
  // top carries every movement's state and switches between them.
  const [active, setActive] = useState<string>(frontier);
  // The Gate is a verdict ceremony pulled out of the stage row into a modal,
  // opened from the top-right button (or the movebar gauge). Holds the movement
  // whose gate is open, or null.
  const [gateModalFor, setGateModalFor] = useState<string | null>(null);
  // The graphical ontology/atlas map, opened from a Listen area lane's
  // "Open the map →" — the lane headers carry the per-area summary now.
  const [ontoModal, setOntoModal] = useState<{ area: string | null } | null>(null);
  useEffect(() => {
    if (!gateModalFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGateModalFor(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gateModalFor]);
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  const [docFor, setDocFor] = useState<ArtifactCardModel | null>(null);
  // The record rail: a slim full-height edge strip that reveals on hover,
  // pins open on demand, and auto-expands while a person's card is open —
  // its focus follows the card the operator is IN.
  const [railPin, setRailPin] = useState(false);
  const [railHover, setRailHover] = useState(false);
  const [railFocus, setRailFocus] = useState<string | null>(null);
  const [railRead, setRailRead] = useState<EvidenceEntry | null>(null);
  // Next chrome: the workstream phases open on the parallel-area board; this
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
      // The tab order is Discovery first, then one tab per artifact — walk the
      // live set for the active movement so [ and ] cross every artifact.
      const mv = flowMovements().find((m) => m.id === active);
      const keys: string[] = mv
        ? ["collect", ...movementArtifacts(program, mv).map((a) => `art:${a.id}`), ...(mv.id === "ship" ? ["ship:lanes"] : [])]
        : ["collect"];
      setMovementTab((prev) => {
        const stored = prev[active];
        const current = stored && keys.includes(stored) ? stored : keys[0];
        const step = event.key === "]" ? 1 : -1;
        const next = keys[(keys.indexOf(current) + step + keys.length) % keys.length];
        return { ...prev, [active]: next };
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, program]);

  // AUTO-ACCEPT heard voices: any roster voice that has evidence on record is
  // marked Heard automatically — no manual "attest N voices" step. attestHeard-
  // Roster returns null once every evidence-backed voice is already Heard, so
  // the write fires once and then settles (the persisted roster no longer
  // proposes a change on the next render).
  useEffect(() => {
    const listen = flowMovements().find((m) => m.id === "listen");
    if (!listen) return;
    const heardNames = [...new Set(movementEvidence(program, listen).map((e) => e.who).filter(Boolean))];
    if (!heardNames.length) return;
    const proposal = attestHeardRoster(program, heardNames);
    if (!proposal) return;
    void onSaveInputs("listen", { interviewRoster: proposal.value }, {
      silent: true,
      attest: {
        action: `Roster auto-attested — ${proposal.attested.length} voice${proposal.attested.length === 1 ? "" : "s"} Heard on evidence`,
        detail: proposal.attested.join(", ").slice(0, 140),
      },
    });
  }, [program, onSaveInputs]);

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


  // Phases whose artifacts have gone stale — almost always because an EARLIER
  // phase was regenerated and the change cascaded downstream (a fingerprint
  // shift), leaving a later document built on inputs that have since moved. The
  // spine surfaces these as "regeneration required" so nothing silently drifts.
  // Envision + Show fold into the single "Prototype" node the spine shows.
  const staleGroups = useMemo(() => {
    // A stale artifact ALREADY queued or running has left the "still required"
    // set — drop it, so requesting a regen removes its banner entry immediately.
    const active = (id: string) => regenActiveIds?.has(id) ?? runningAgentIds.has(id);
    const raw = rows
      .map(({ movement, artifacts }) => ({ movement, stale: artifacts.filter((a) => a.present && a.stale && !active(a.id)) }))
      .filter((entry) => entry.stale.length > 0);
    const loop = raw.filter((e) => e.movement.id === "envision" || e.movement.id === "show");
    const groups = raw
      .filter((e) => e.movement.id !== "envision" && e.movement.id !== "show")
      .map((e) => ({ key: e.movement.id, label: e.movement.displayName, items: e.stale.map((a) => ({ movementId: e.movement.id, artifact: a })) }));
    if (loop.length) {
      groups.push({ key: "prototype", label: "Prototype", items: loop.flatMap((e) => e.stale.map((a) => ({ movementId: e.movement.id, artifact: a }))) });
    }
    return groups;
  }, [rows, regenActiveIds, runningAgentIds]);
  const totalStale = staleGroups.reduce((n, g) => n + g.items.length, 0);
  // Enqueue one phase's stale artifacts. The queue orders them by the
  // methodology's generate order and de-duplicates, so clicking several phases
  // (or a phase twice) never scrambles the order or double-books a run. The
  // items leave the banner the moment they're queued.
  const regenGroup = (_key: string, items: { movementId: string; artifact: ArtifactCardModel }[]) => {
    for (const it of items) enqueueRegen(it.artifact.id, it.movementId, it.artifact.title);
  };

  // Anchored drill-downs — "◇ deep dive" chips on the objects they zoom into.
  const anchoredChildren = useMemo(() => (relatedPrograms ?? [])
    .map((p) => ({ p, anchor: readDrillAnchor(p) }))
    .filter((e): e is { p: ProgramSummary; anchor: NonNullable<ReturnType<typeof readDrillAnchor>> } => !!e.anchor),
    [relatedPrograms]);

  return (
    <div className="v3fs-flow v3fs-flow-spine">
      {/* The horizontal spine — every movement's state at a glance; click to
          switch. Envision (Design) and Show (Validate) are folded into ONE
          Prototype Loop node with a mode toggle + iteration/approval meter. */}
      <nav className="v3fs-stepper" aria-label="Movements" role="tablist">
        <div className="v3fs-stepper-rail" aria-hidden="true" />
        {(() => {
          // The Prototype Loop IS a numbered step now: Frame 1 · Listen 2 ·
          // Prototype 3 · Ship 4 · Evolve ∞. Only the folded Show and the ∞
          // Evolve loop are skipped; envision carries the loop node's number.
          let n = 0;
          const stepNum: Record<string, number | null> = {};
          for (const { movement } of rows) {
            if (movement.id === "show") { stepNum[movement.id] = null; continue; }
            if (movement.movement?.isLoop && movement.id !== "envision") { stepNum[movement.id] = null; continue; }
            n += 1; stepNum[movement.id] = n;
          }
          const ls = loopState(program);
          // Stale artifacts across the folded loop (Envision + Show) — the spine
          // marker for the Prototype node.
          const loopOn = active === "envision" || active === "show";
          const loopTone = ls.converged ? "green" : ls.court === "design" ? "amber" : ls.hasPrototype ? "blue" : "";
          const loopIsFrontier = frontier === "envision" || frontier === "show";
          return rows.map(({ movement, artifacts }) => {
            if (movement.id === "show") return null; // folded into the loop node
            if (movement.id === "envision") {
              return (
                <div key="prototype-loop" className={`v3fs-step v3fs-loopstep${loopOn ? " on" : ""}${loopIsFrontier && !loopOn ? " v3fs-step-next" : ""}`}
                  role="tab" aria-selected={loopOn} tabIndex={0} aria-label="Prototype Loop"
                  onClick={() => { if (!loopOn) setActive("envision"); }}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); setActive("envision"); } }}>
                  <span className={`v3fs-sring ${loopTone}`} style={{ "--pct": `${ls.areasTotal ? Math.round((100 * ls.areasConverged) / ls.areasTotal) : 0}%` } as React.CSSProperties} aria-hidden="true">
                    <span className={`v3fs-sdot${ls.converged ? " done" : loopOn ? " live" : ""}`}>{ls.converged ? "✓" : (stepNum.envision ?? 3)}</span>
                  </span>
                  <span className="v3fs-sname">Prototype <span className="v3fs-loopmark" aria-hidden="true">⟳</span></span>
                  {/* The Design/Validate toggle and the iteration meter were removed
                      from the spine node — the toggle lives on the Prototype page
                      itself (the loop switch), so the spine stays a plain step. */}
                  <span className={`v3fs-sstate ${loopOn ? "live" : ls.converged ? "done" : "wait"}`}>{ls.converged ? "Converged" : loopOn ? "In progress" : " "}</span>
                </div>
              );
            }
            const isDone = program.gateReviews?.[movement.id]?.status === "approved";
            const generating = artifacts.some((a) => runningAgentIds.has(a.id));
            const isLive = movement.id === frontier && !isDone;
            const isLoop = !!movement.movement?.isLoop;
            const isOn = movement.id === active;
            // "Demonstrated" is the GATE ceremony's word — on the spine a
            // finished movement reads as plain completion ("Frame —
            // Demonstrated" confused more than it informed).
            const stateLabel = generating ? "Generating" : isDone ? (movement.id === "ship" ? "Shipped" : "Complete") : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming";
            const stepChecks = [...gateChecklist(program, movement, artifacts), ...gateAugmentations(program, movement.id)];
            const stepReadiness = gateReadiness(program, movement, artifacts, stepChecks);
            const stepDone = stepChecks.filter((c) => c.done).length;
            const pct = stepChecks.length ? Math.round((100 * stepDone) / stepChecks.length) : (stepReadiness.tone === "green" ? 100 : 0);
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
                    {isDone ? "✓" : isLoop ? "∞" : stepNum[movement.id]}
                  </span>
                </span>
                <span className="v3fs-sname">{movement.displayName}</span>
                {stateLabel === "Upcoming"
                  ? <span className="v3fs-sstate wait" aria-hidden="true">&nbsp;</span>
                  : <span className={`v3fs-sstate ${generating ? "gen" : isDone ? "done" : isLive ? "live" : "wait"}`}>{stateLabel}</span>}
              </button>
            );
          });
        })()}
      </nav>
      {/* Regeneration required — a downstream document is stale because an
          upstream phase moved. Prompt on the spine with a per-phase regen. */}
      {staleGroups.length ? (
        <div className="v3fs-regenbar" role="status" aria-label="Regeneration required">
          <span className="v3fs-regenbar-ico" aria-hidden="true">⟳</span>
          <span className="v3fs-regenbar-txt">
            <b>Regeneration required</b>
            <em>An upstream change left {totalStale} downstream document{totalStale === 1 ? "" : "s"} built on inputs that have since moved — regenerate to bring {totalStale === 1 ? "it" : "them"} current.</em>
          </span>
          <span className="v3fs-regenbar-acts">
            {staleGroups.map((g) => (
              <button key={g.key} type="button" className="v3fs-regenbar-btn"
                disabled={spineRunning}
                onClick={() => regenGroup(g.key, g.items)}>
                ⟳ {g.label}<i className="v3fs-regenbar-n">{g.items.length}</i>
              </button>
            ))}
          </span>
        </div>
      ) : null}
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
        // Advisory rows (persona coverage, emails, open questions) inform but
        // don't gate — the gauge and counts read the STRUCTURAL criteria only.
        const blockingChecks = checks.filter((item) => !item.advisory);
        const readiness = gateReadiness(program, movement, artifacts, checks);
        const openChecks = blockingChecks.filter((item) => !item.done).length;
        void openChecks;
        // Audit F-001 read-time backstop: a recorded approval whose criteria
        // aren't met is a forgery masquerading as a gate — surface it, loudly.
        const gateIntegrity = gateApprovalIntegrity(program, movement.id, checks);
        const isLoop = !!movement.movement?.isLoop;
        const coverage = movement.id === "listen" ? listenCoverage(program) : null;
        // "Where am I" summary: heard / artifacts current / gate — computed
        // once so the operator reads the movement's state before scrolling.
        // ONE source of truth for "heard": the same stakeholderCollection the
        // People board uses (evidence attribution + responded links + provided
        // documents) — so the tab badge, the caption and the board never
        // disagree. Same for retirement: the board drops question-less
        // directory cards, so the chip must not count them either.
        const sumPacks = listInterviewPacks(program);
        const sumLive = resolveMovementStakeholders(program, movement.id)
          .map((s) => ({ s, coll: stakeholderCollection(movement.id, s, sumPacks, evidence) }))
          .filter(({ s, coll }) => !directoryCardRetired(program, movement.id, s, coll.heard));
        const sumStakeholders = sumLive.map((x) => x.s);
        const evaluated = sumLive.map((x) => x.coll);
        const unheard = sumStakeholders.filter((_, i) => !evaluated[i].heard);
        const sumHeard = sumStakeholders.length - unheard.length;
        // A heard person with OPEN questions still owes a round — pending script
        // questions plus operator asks (minus the deferred/deleted ones), the
        // same curation the collect card applies. The Discovery chip must not
        // read "all heard" while anyone has a question outstanding.
        const askCuration = (key: string, mapKey: string): string[] => {
          const raw = readMovementInputs(program, movement.id)[mapKey];
          try { const p = typeof raw === "string" ? JSON.parse(raw) : {}; const v = (p as Record<string, unknown>)?.[key]; return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
        };
        const sumWaiting = sumStakeholders.filter((s, i) => {
          if (!evaluated[i].heard) return true;
          const key = (s.name || s.role).trim().toLowerCase();
          const curated = new Set([...askCuration(key, "_deferredAsks"), ...askCuration(key, "_dismissedAsks")].map((q) => q.toLowerCase()));
          const openAsks = operatorAsksFor(program, movement.id, s.name || s.role).filter((q) => !curated.has(q.toLowerCase()));
          return s.questions.length + openAsks.length > 0;
        });
        const sumWord = movement.id === "show" ? "reviewed" : movement.id === "listen" || movement.id === "frame" ? "heard" : "consulted";
        const sumDocsCurrent = artifacts.filter((a) => a.present && !a.stale && a.gaps === 0).length;
        const sumChecksDone = blockingChecks.filter((c) => c.done).length;
        const staleArtifacts = artifacts.filter((a) => a.present && a.stale);
        // The "Up next" queue is gone — actions live where they belong: stale
        // documents show Regenerate on their own tab, generation on the artifact
        // tab, collection on Discovery, the gate on its button, the Inbox on the
        // rail. Heard voices are auto-attested on evidence (see the effect
        // above), so no confirm step remains.
        // Which stage is showing — the operator's pick, else the movement's lead.
        const hasPeople = sumStakeholders.length > 0;
        // Gate is no longer a stage — it opens as a modal — so a stored "gate"
        // pick falls back to the lead stage, and goTab("gate") opens the modal.
        // Tab order: Discovery first, then one tab per artifact. The valid keys
        // are the Discovery board plus `art:<id>` for each artifact; a stored
        // legacy value ("paper"/"plan"/"gate") or a since-removed artifact
        // falls back to the movement's default opening tab.
        // Architecture Strategy is a SOLUTION-level artifact owned by the design
        // team, not per-area work — so its tab shows only when the Design-team
        // tile is selected (like the Direction act). Excluded from the valid keys
        // otherwise, so a stored "architecture-strategy" tab falls back cleanly.
        // Design artifacts are solution-level documents — every one is always a
        // tab (no per-area gating). The area toggles don't apply to them, so the
        // orchestration band (with its area tiles) shows only on the Discovery
        // tab below, where collection genuinely is per-area.
        const artTabKeys = artifacts.map((a) => `art:${a.id}`);
        // Ship's cutover/ship plan (the compiled lanes board) is its OWN tab,
        // separate from the Hardening plan artifact — the two were previously
        // stacked on one tab. Only when the compile/toggle handlers exist.
        const hasShipPlanTab = movement.id === "ship" && !!onCompileShipLanes && !!onToggleShipItem;
        // Under Validate (Show), the built prototype gets its OWN tab — the client
        // opens the running app there rather than an inline collapsible. It reads
        // the same prototype-build doc the delivery team assembled in Design.
        // When the delivery team built OUTSIDE the app (a linked external URL),
        // the external build IS the prototype — so the tab shows a link to it,
        // not the internal generated build.
        const protoExternalUrl = movement.id === "show"
          ? String(readMovementInputs(program, "show").prototypeLocation ?? "").trim()
          : "";
        const protoHtml = (() => {
          if (movement.id !== "show" || protoExternalUrl) return "";
          const pb = readArtifactDoc(program, "prototypeBuild");
          return pb ? String(pb.html ?? "") : "";
        })();
        const hasProtoTab = movement.id === "show" && (!!protoExternalUrl || !!protoHtml);
        const validTabKeys = new Set<string>(["collect", ...artTabKeys, ...(hasProtoTab ? ["proto"] : []), ...(hasShipPlanTab ? ["ship:lanes"] : [])]);
        const defaultTab: MovementTab = leadTab(movement.id) === "paper" && artifacts.length ? `art:${artifacts[0].id}` : "collect";
        const storedTab = movementTab[movement.id];
        const tabKey: MovementTab = storedTab && validTabKeys.has(storedTab) ? storedTab : defaultTab;
        const activeArtifact = artifacts.find((a) => `art:${a.id}` === tabKey) ?? null;
        const goTab = (t: MovementTab) => {
          if (t === "gate") { setGateModalFor(movement.id); return; }
          setMovementTab((prev) => ({ ...prev, [movement.id]: t }));
        };
        // Area filtering was removed with the phase-home filter cards — every
        // per-area surface below now shows all areas (empty selection).
        const selAreas: string[] = [];
        const gaugePct = blockingChecks.length ? Math.round((100 * sumChecksDone) / blockingChecks.length) : (readiness.tone === "green" ? 100 : 0);
        // Stage chips read as a sentence — glyph + meaning per stage ("● 3
        // waiting → ⟳ 2 stale → ◔ 8/11"), so the bar IS the loop's state.
        // Presence, not a count: the chip shows a COLOUR state ("●" warn) when
        // anything is pending — an exact count kept disagreeing with the cards
        // because card-level follow-up gaps (the sponsor's open script, from
        // kitGaps) aren't per-stakeholder questions. askableMovementGaps IS
        // that script, so the chip and the cards read one truth.
        const followUpOpen = askableMovementGaps(program, movement.id).length > 0;
        const collectState = !hasPeople && !evidence.length
          ? { glyph: "○", text: "", tone: "dim" }
          : (sumWaiting.length || followUpOpen)
            ? { glyph: "●", text: "", tone: "warn" }
            : { glyph: "✓", text: hasPeople ? `all ${sumWord}` : `${evidence.length} on record`, tone: "ok" };
        const gateState = isDone
          ? { glyph: "✓", text: "passed", tone: "ok" }
          : readiness.kind === "ready"
            ? { glyph: "⚑", text: "ready", tone: "ok" }
            : blockingChecks.length
              ? { glyph: "◔", text: `${sumChecksDone}/${blockingChecks.length}`, tone: readiness.tone === "amber" ? "warn" : "dim" }
              : { glyph: "○", text: "", tone: "dim" };
        // Order: Discovery first (the stakeholder evidence board), then ONE TAB
        // per artifact — each tab shows that artifact's own view and a
        // Regenerate control. The Gate is not a stage — it lives in the
        // top-right button as a modal verdict. For Frame the Listen plan is
        // merged INTO the Discovery Kit tab (not a separate tab).
        // Colour-only, like the Discovery chip: amber ● when anything is
        // pending (stale or open gaps), green ✓ when clean, dim ○ when absent.
        const artifactTabState = (a: typeof artifacts[number]): { glyph: string; text: string; tone: string } => {
          if (!a.present) return { glyph: "○", text: "", tone: "dim" };
          if (a.stale || artifactOpenGaps(program, a.id).length) return { glyph: "●", text: "", tone: "warn" };
          return { glyph: "✓", text: "", tone: "ok" };
        };
        const shipPlanState = (() => {
          if (!hasShipPlanTab) return null;
          const lanes = listShipLanes(program);
          if (!lanes.length) return { glyph: "○", text: "", tone: "dim" };
          const prog = shipLaneProgress(lanes);
          return prog.validationDone && prog.cutoverDone
            ? { glyph: "✓", text: "", tone: "ok" }
            : { glyph: "◔", text: "", tone: "warn" };
        })();
        const tabDefs: Array<{ key: MovementTab; label: string; state: { glyph: string; text: string; tone: string } | null; show: boolean }> = [
          { key: "collect", label: "Discovery", state: collectState, show: true },
          ...(hasProtoTab ? [{ key: "proto" as MovementTab, label: "Prototype", state: { glyph: "▶", text: "", tone: "ok" }, show: true }] : []),
          ...artifacts.map((a) => ({ key: `art:${a.id}` as MovementTab, label: a.title, state: artifactTabState(a), show: true })),
          ...(hasShipPlanTab ? [{ key: "ship:lanes" as MovementTab, label: "Ship plan", state: shipPlanState, show: true }] : []),
        ];

        return (
          <Fragment key={movement.id}>
          <article
            className={["v3fs-ch open", isDone ? "done" : "", isLive ? "live" : ""].filter(Boolean).join(" ")}
          >
            <div className="v3fs-ch-h v3fs-ch-h-static">
              {movement.id === "envision" || movement.id === "show" ? (
                <h2>Prototype Loop</h2>
              ) : (
                <>
                  <h2>{movement.displayName}</h2>
                  <span className={`v3fs-state ${generating ? "gen" : isDone ? "done" : isLive ? "live" : isLoop ? "loop" : "wait"}`}>
                    {generating ? "Generating" : isDone ? (movement.id === "ship" ? "Shipped" : "Complete") : isLive ? "In progress" : isLoop ? "Continuous" : "Upcoming"}
                  </span>
                </>
              )}
              {/* Gate is the verdict, not a stage — a top-right button opening
                  the modal, carrying its readiness glyph + count at a glance. */}
              <button type="button" className={`v3fs-gatebtn ${readiness.tone}`}
                onClick={() => setGateModalFor(movement.id)}
                title={`${isLoop ? "Health" : "Gate"} — ${readiness.headline}`}>
                {gateState ? <span className={`v3fs-gatebtn-g ${gateState.tone}`} aria-hidden="true">{gateState.glyph}</span> : null}
                <span>{isLoop ? "Health" : "Gate"}</span>
                {blockingChecks.length ? <span className="v3fs-gatebtn-n">{sumChecksDone}/{blockingChecks.length}</span> : null}
              </button>
            </div>
            {/* The header band: gate gauge and the movement's one-line brief.
                The "Up next" queue was removed — actions live on their own
                surfaces (the artifact tab, Discovery, the Gate button). */}
            <div className="v3fs-movebar" role="status">
              {blockingChecks.length ? (
                <button type="button" className={`v3fs-mgauge ${readiness.tone}`} style={{ "--pct": `${gaugePct}%` } as React.CSSProperties}
                  onClick={() => goTab("gate")} title={`Gate ${sumChecksDone}/${blockingChecks.length} — ${readiness.headline}`}>
                  <span className="v3fs-mgauge-c">{readiness.kind === "demonstrated" ? <b>✓</b> : <><b>{sumChecksDone}</b><i>/{blockingChecks.length}</i></>}</span>
                </button>
              ) : null}
              <div className="v3fs-movebar-txt">
                {MOVEMENT_CAPTION[movement.id]
                  ? <div className="v3fs-movebar-cap">{MOVEMENT_CAPTION[movement.id]}</div>
                  : <div className="v3fs-movebar-cap">{sumHeard}/{sumStakeholders.length} {sumWord} · {sumDocsCurrent}/{artifacts.length} artifacts current</div>}
              </div>
            </div>

            {isOpen ? (
              <>
              {/* The loop cockpit sits at the PHASE HOME, above the tabs — the
                  scannable overview of what's being designed (Design) or the
                  validation state (Validate). Discovery below is pure data
                  collection. */}
              {/* The Product Owner view — across ALL areas — sits above the
                  per-area Design/Validate cockpit. Only shows for multi-area
                  programmes; the PO orchestrates, the areas iterate below. */}
              {/* One ORCHESTRATION band leads the Prototype home: the area board
                  (loop state per area) with the Design/Validate cockpit folded
                  under it, so it reads as a single surface — not two competing
                  dashboards. The stage tabs + studios below open on demand. */}
              {/* The Design/Validate switch — the loop control between the two
                  Prototype bodies. */}
              {movement.id === "envision" || movement.id === "show" ? (
                <div className="v3fs-loopswitch" role="tablist" aria-label="Design or Validate">
                  <button type="button" role="tab" aria-selected={active === "envision"}
                    className={`v3fs-loopswitch-b${active === "envision" ? " on" : ""}`} onClick={() => setActive("envision")}>
                    <span className="v3fs-loopswitch-i" aria-hidden="true">✎</span>
                    <span className="v3fs-loopswitch-t">Design Workspace<em>the team shapes the prototype</em></span>
                  </button>
                  <button type="button" role="tab" aria-selected={active === "show"}
                    className={`v3fs-loopswitch-b${active === "show" ? " on" : ""}`} onClick={() => setActive("show")}>
                    <span className="v3fs-loopswitch-i" aria-hidden="true">◉</span>
                    <span className="v3fs-loopswitch-t">Validate<em>clients sign off on it</em></span>
                  </button>
                </div>
              ) : null}
              {(movement.id === "envision" || movement.id === "show") && tabKey === "collect" ? (
                <section className="v3fs-protohome" aria-label="Prototype orchestration">
                  <ProductOwnerCockpit program={program} />
                  {movement.id === "envision" ? (
                    <EnvisionCockpit program={program} onSaveInputs={onSaveInputs} onOpenArtifact={(id) => goTab(`art:${id}` as MovementTab)} />
                  ) : null}
                  {movement.id === "show" ? (
                    <ShowCockpit program={program} onOpenDesign={() => { setActive("envision"); setMovementTab((prev) => ({ ...prev, envision: "art:prototype-build" as MovementTab })); }} />
                  ) : null}
                </section>
              ) : null}
              {/* Listen's phase home: the same scannable overview the Prototype
                  Loop has, but for listening — area as the primary axis, Collect
                  and Model state per area, and the open contradictions as a
                  first-class "To reconcile" strip. Discovery/Ontology/Atlas
                  detail lives on the tabs below. */}
              {movement.id === "listen" ? (
                <section className="v3fs-protohome" aria-label="Listen orchestration">
                  <ListenCockpit program={program} />
                </section>
              ) : null}
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
                      {/* The area lanes in the board below ARE the phase's area
                          cards: each lane header carries the per-area summary
                          (map state + "Open the map →" on Listen, validation
                          round/verdicts on Prototype) and expands to that
                          area's stakeholder cards — script, asks, link,
                          meeting invite, transcript capture and attachments. */}
                      {movement.id === "listen" && ontoModal ? (
                        <OntologyAtlasModal program={program} area={ontoModal.area}
                          onOpenWorkspace={(artifactId) => goTab(`art:${artifactId}` as MovementTab)}
                          onClose={() => setOntoModal(null)} />
                      ) : null}
                      {/* "Build outside the app" now lives on the Prototype Build
                          tab (its header), next to the internal build — not on
                          Discovery. */}
                      {/* The portfolio flywheel: agent designs ACCEPTED in other
                          programmes surface as seeded candidates while this
                          one envisions — proven patterns, not blank paper. */}
                      {movement.id === "envision" && programs?.length ? (() => {
                        const patterns = acceptedAgentPatterns(programs, program.id);
                        return patterns.length ? (
                          <div className="v3fs-patterns" role="note" aria-label="Accepted agent patterns from your portfolio">
                            <span className="v3fs-patterns-l">Proven in your portfolio</span>
                            {patterns.slice(0, 5).map((p, i) => (
                              <span key={i} className="v3fs-pattern-chip" title={`${p.purpose ?? ""}${p.autonomyLevel ? ` · ${p.autonomyLevel}` : ""}`}>
                                <b>{p.name}</b> <em>accepted in {p.programme}</em>
                              </span>
                            ))}
                          </div>
                        ) : null;
                      })() : null}
                      {hasPeople ? (
                        <IntervieweeDiscovery program={program} movementId={movement.id}
                          areaFilter={selAreas}
                          laneExtras={movement.id === "listen" ? (area) => {
                            const mapped = areaHasModel(program, area);
                            return (
                              <>
                                <span className={`v3fs-lanex-chip${mapped ? " ok" : ""}`}>{mapped ? "map confirmed" : "map drafting"}</span>
                                <button type="button" className="v3fs-lanex-btn"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOntoModal({ area }); }}>
                                  Open the map →
                                </button>
                              </>
                            );
                          } : movement.id === "envision" || movement.id === "show" ? (area) => {
                            const ls = loopState(program);
                            const P = ls.areas.find((a) => a.area === area);
                            if (!ls.hasPrototype) return <span className="v3fs-lanex-chip">prototype in design</span>;
                            const accepted = P?.accepted ?? 0;
                            const changes = (P?.objections ?? 0) + (P?.changes ?? 0);
                            const pending = P?.pending ?? 0;
                            return (
                              <>
                                <span className="v3fs-lanex-chip">Round {ls.round}</span>
                                {(P?.total ?? 0) === 0
                                  ? <span className="v3fs-lanex-chip">awaiting verdicts</span>
                                  : <span className="v3fs-lanex-chip">{accepted} ✓ · {changes} ✕ · {pending} ⧗</span>}
                                {P?.converged ? <span className="v3fs-lanex-chip ok">signed off</span> : null}
                              </>
                            );
                          } : undefined}
                          captureField={meetingKit(program, movement.id)?.captureField ?? "interviewTranscripts"}
                          docsStale={staleArtifacts.some((a) => !regenActive(a.id))}
                          regenerating={spineRunning || generating}
                          onRegenerateStale={async () => {
                            for (const artifact of staleArtifacts) enqueueRegen(artifact.id, movement.id, artifact.title);
                          }}
                          onSaveInputs={onSaveInputs} onMintFollowUp={onMintFollowUp} onMintReview={onMintReview}
                          onMintPacks={movement.id === "listen" ? onMintPacks : undefined}
                          onScheduleFollowUp={onScheduleFollowUp}
                          onSendForApproval={onSendForApproval}
                          onFocusPerson={(id, open) => setRailFocus((cur) => (open ? id : cur === id ? null : cur))}
                          onCaptured={() => onRunAgent("contradiction-detector", movement.id)}
                          /* Evidence arriving no longer auto-regenerates artifacts.
                             A landed document stales the impacted artifacts (by
                             fingerprint) and they show "Stale — regenerate" for the
                             operator to run when ready. Blocking every capture on a
                             full artifact rebuild blanked the board and could cascade
                             into "generate the previous phase first". Operators who
                             DO want hands-off rebuilds turn on "Auto-build artifacts
                             on input", which the autonomous effect honours. */ />
                      ) : (
                        <MeetingKitCard
                          kit={meetingKit(program, movement.id)}
                          movementId={movement.id}
                          hasEvidence={evidence.length > 0}
                          generating={generating || spineRunning}
                          docsStale={artifacts.some((artifact) => artifact.present && artifact.stale && !regenActive(artifact.id))}
                          onRegenerateStale={async () => {
                            for (const artifact of artifacts.filter((entry) => entry.present && entry.stale)) enqueueRegen(artifact.id, movement.id, artifact.title);
                          }}
                          program={program}
                          onSaveInputs={onSaveInputs}
                          onScheduleFollowUp={onScheduleFollowUp}
                          onMintFollowUp={onMintFollowUp}
                          onMintPacks={onMintPacks}
                          onMintDemoInvites={onMintDemoInvites}
                          onCaptured={() => onRunAgent("contradiction-detector", movement.id)}
                        />
                      )}
                      {/* The structured-inputs escape hatch is gone: facts now
                          come from the sponsor conversation and the captured
                          evidence/artifacts, not hand-typed fields. The editor
                          still opens from its purposeful doors — a gate
                          checklist item or an artifact gap — when a specific
                          fact genuinely needs a manual correction. Frame's
                          discovery plan lives on its own "Listen plan" tab. */}
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
                            // Evidence ids are content hashes — two identical excerpts collide,
                            // so pair the id with the index to keep the React key unique.
                            <button key={`${entry.id ?? "ev"}-${i}`} type="button" className="v3fs-ivc-fb-row" onClick={() => setRailRead(entry)} title="Read in full">
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

                {/* Prototype tab (Validate): the built app, full-width, with a
                    command line the delivery team uses to refine it — a plain-
                    language instruction that regenerates the prototype-build. */}
                {hasProtoTab && tabKey === "proto" ? (
                  <div className="v3fs-arttab">
                    <PrototypeTab html={protoHtml} externalUrl={protoExternalUrl}
                      regenerating={runningAgentIds.has("prototype-build") || spineRunning}
                      onRefine={async (instruction) => {
                        await onSaveInputs("envision", { _prototypeRefine: instruction }, { silent: true });
                        onRunAgent("prototype-build", "envision");
                      }} />
                  </div>
                ) : null}

                {/* Ship plan: the compiled cutover/validation lanes on their
                    OWN tab, distinct from the Hardening plan artifact. */}
                {hasShipPlanTab && tabKey === "ship:lanes" ? (
                  <div className="v3fs-arttab">
                    <ShipLanesBoard program={program} onCompile={onCompileShipLanes!} onToggle={onToggleShipItem!} onSetLane={onSetShipLane} />
                  </div>
                ) : null}

                {/* One tab per artifact: the active artifact renders its own
                    view inline (the same studio as the overlay, embedded) with
                    a Regenerate control in its header. Only the active tab's
                    studio mounts — the views are heavy, so they don't all sit
                    hidden. Show's demo tour rides on its first artifact tab. */}
                {activeArtifact ? (() => {
                  const artifact = activeArtifact;
                  const isFirstArtifact = artifacts[0]?.id === artifact.id;
                  return (
                    <div className="v3fs-arttab" data-artifact={artifact.id}>
                      {isFirstArtifact && movement.id === "show" ? (() => {
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
                      {agentErrors?.[artifact.id] ? (
                        <div className="v3fs-dv-band amber" role="alert"><span>Generation failed — {agentErrors[artifact.id]}</span></div>
                      ) : null}
                      <Suspense fallback={<div className="v3fs-artpanel-load">Opening {artifact.title}…</div>}>
                        <FlowArtifactStudio
                          embedded
                          program={program}
                          artifact={artifact}
                          regenerating={regenActive(artifact.id) || generating}
                          onSaveInputs={onSaveInputs}
                          onComment={onComment}
                          onOpenArtifact={(artifactId) => {
                            // Same movement → switch tab; otherwise open the overlay.
                            if (artifacts.some((a) => a.id === artifactId)) { goTab(`art:${artifactId}`); return; }
                            for (const m of flowMovements()) {
                              const hit = movementArtifacts(program, m).find((a) => a.id === artifactId && a.present);
                              if (hit) { setDocFor(hit); return; }
                            }
                          }}
                          onClose={() => {}}
                          onRegenerate={() => enqueueRegen(artifact.id, movement.id, artifact.title)}
                          onSaveDoc={onSaveArtifactDoc}
                          onOpenInbox={onOpenInbox}
                          header={movement.id === "frame" && artifact.id === "discovery-kit"
                            ? <DiscoveryKitAlign program={program} onSaveInputs={onSaveInputs}
                                locked={isDone} onOpenGate={() => setGateModalFor(movement.id)} />
                            : artifact.id === "prototype-build"
                              ? <ExternalBuildPanel program={program} onSaveInputs={onSaveInputs} />
                              : undefined}
                        />
                      </Suspense>
                    </div>
                  );
                })() : null}

                {gateModalFor === movement.id ? (
                <div className="v3fs-gatemodal-scrim" role="dialog" aria-modal="true" aria-label={isLoop ? "Steady-state health" : "Gate"}
                  onClick={() => setGateModalFor(null)}>
                <div className="v3fs-gatemodal" onClick={(e) => e.stopPropagation()}>
                  <div className="v3fs-gatemodal-h">
                    <span className={`v3fs-gatemodal-t${isDone ? " done" : ""}`}>{isLoop ? "Steady-state health" : `${movement.displayName} — Gate`}</span>
                    <button type="button" className="v3fs-gatemodal-x" aria-label="Close the gate" onClick={() => setGateModalFor(null)}>✕</button>
                  </div>
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
                        const attention = group === "record" && !item.done && !!artifact?.present && !item.advisory;
                        const boxGlyph = item.done ? "✓" : attention ? (artifact?.stale ? "⟳" : "!") : item.advisory ? "◦" : "";
                        return (
                          <Fragment key={item.id}>
                            {grouped && group !== prevGroup ? (() => {
                              // Advisory rows are shown but not counted — the
                              // group tally reflects the criteria that gate.
                              const members = checks.filter((c) => (c.group ?? "evidence") === group && !c.advisory);
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
                              className={`v3fs-check${item.done ? " done" : ""}${attention ? " stale" : ""}${item.advisory ? " advisory" : ""}`}
                              disabled={!onClick}
                              onClick={onClick}
                              title={item.advisory ? "Advisory — worth doing, but it doesn't hold the gate" : title}
                            >
                              <span className="v3fs-check-box" aria-hidden="true">{boxGlyph}</span>
                              <span className="v3fs-check-l">
                                {item.label}
                                {item.advisory ? <span className="v3fs-check-adv">advisory</span> : null}
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
                </div>
                ) : null}

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
                    {/* Not locked when the gate is approved: the save chokepoint
                        auto-reopens the gate on a substantive edit (attested),
                        announced by its own toast. */}
                    <PhaseInputsPanel program={program} phaseId={movement.id} onSave={onSaveInputs} />
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
/**
 * The Prototype tab under Validate: the built app full-width, plus a command
 * line the delivery team uses to refine it. A plain-language instruction is
 * stashed on Envision's inputs (`_prototypeRefine`, fingerprint-safe) and the
 * prototype-build agent re-runs — the refined build replaces the current one.
 */
function PrototypeTab({ html, externalUrl, regenerating, onRefine }: {
  html: string;
  /** When set, the delivery team built OUTSIDE the app — the tab links to that
   * build instead of embedding the internal one (external hosts commonly
   * refuse to be iframed, and the external build IS the real prototype). */
  externalUrl?: string;
  regenerating: boolean;
  onRefine: (instruction: string) => Promise<void> | void;
}) {
  const [copied, setCopied] = useState(false);
  if (externalUrl) {
    const copy = async () => {
      try { await navigator.clipboard.writeText(externalUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard denied — the URL is selectable */ }
    };
    return (
      <div className="v3fs-prototab">
        <div className="v3fs-protoext">
          <span className="v3fs-protoext-eyebrow">Prototype · built outside the app</span>
          <h3 className="v3fs-protoext-t">The prototype lives at your linked build</h3>
          <p className="v3fs-protoext-sub">This programme links an external prototype — stakeholders open it directly at the URL below.</p>
          <div className="v3fs-protoext-urlrow">
            <a className="v3fs-protoext-url" href={externalUrl} target="_blank" rel="noreferrer" title={externalUrl}>{externalUrl}</a>
            <button type="button" className="v3fs-nb-open" onClick={() => void copy()}>{copied ? "✓ Copied" : "Copy link"}</button>
            <a className="v3fs-nb-open ghost" href={externalUrl} target="_blank" rel="noreferrer">Open ↗</a>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="v3fs-prototab">
      {/* Consistent with the Design-side Prototype Build studio: a header bar
          with the running-app framing + Open-in-browser, the same sandboxed
          iframe, then the refine command line. */}
      <div className="v3fs-prototab-head">
        <div className="v3fs-prototab-headtext">
          <span className="v3fs-prototab-t">The prototype</span>
          <span className="v3fs-prototab-sub">The running app every stakeholder validates — walk it here, or open it full-screen.</span>
        </div>
        <button type="button" className="v3fs-proto-open" title="Open the running prototype in a new browser tab"
          onClick={() => openPrototypeInBrowser(html)}>↗ Open in browser</button>
      </div>
      <iframe className="v3fs-prototab-frame" sandbox="allow-scripts allow-forms" srcDoc={html} title="Prototype" />
      {/* Command line — the delivery team refines & polishes the prototype in
          plain language. Shared with the Design-side studio. */}
      <PrototypeCommandBar onRefine={onRefine} regenerating={regenerating} />
      {regenerating ? <div className="v3fs-protocmd-note" role="status">Rebuilding the prototype with your changes — the refined build replaces the current one when it lands.</div> : null}
    </div>
  );
}

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
