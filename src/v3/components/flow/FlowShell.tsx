import React, { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import FlowCanvas from "@/v3/components/flow/FlowCanvas";
import FlowGrounding from "@/v3/components/flow/FlowGrounding";
import BrilioLogo from "@/v3/components/BrilioLogo";
import { AttachFileButton, copyTextFromAction } from "@/v3/components/flow/flowCapture";
const FlowArtifactStudio = lazy(() => import("@/v3/components/flow/studio/FlowArtifactStudio"));
import type { ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import FlowBoardPack from "@/v3/components/flow/FlowBoardPack";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, movementEvidence, movementArtifacts, gateChecklist, gateReadiness, listenCoverage,
  demoAcceptance, daysToFirstDemo, wordsOfEvidence, readContradictions, parseGridRows, readMovementInputs,
  contradictionLogWithout, autoBuildEnabled, spineLabel,
} from "@/v3/components/flow/flowShellData";
import {
  listOpenFlowDecisions, listFlowAttestations, describeDecisionChanges,
  type FlowDecision,
} from "@/v3/components/flow/flowDecisions";
import {
  listFlowTracks, trackAcceptance, trackPace,
} from "@/v3/components/flow/flowTracks";
import { readFlowGovernance, flowAgentTier } from "@/v3/components/flow/flowGovernance";
import { resolveMovementStakeholders, deliveryRoleDirectory, readDirectoryPeople, validateProgramRole, readRoleBindings, knownProgramRoles, unresolvedCoverageNames, kitPersonaDirectory, readSuggestedVoices, readListenPlan, listenPlanWrite, dismissedListenRoles } from "@/v3/components/flow/flowStakeholders";
import DiscoveryKitAlign from "@/v3/components/flow/DiscoveryKitAlign";
import TheLine from "@/v3/components/flow/TheLine";
import { stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import { readMetricRegistry, metricConsistency } from "@/v3/components/flow/flowMetricRegistry";
import { routeAttachedDocument, buildRoutedBlocks, type DocRoute } from "@/v3/components/flow/flowDocRouting";
import { listPortalInbox, movementValidationCoverage, listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { governedExceptionsForInbox, readGovernedExceptions, withResolvedException } from "@/v3/components/flow/flowExceptions";
import { approvalEvidenceEntries, listApprovalResponses } from "@/v3/components/flow/flowApprovals";
import { listSnapshots, type BlobSnapshot } from "@/v3/lib/blobSnapshots";
import { supabase } from "@/integrations/supabase/client";
import { getProgramState } from "@/new/lib/programState";
import { listClaimTags, claimTargets } from "@/v3/components/flow/flowClaims";
import {
  DRILL_KINDS, drillAnchorCounts, listDrillAnchors, readDrillAnchor, readParentId,
  listChildDrilldowns, drillKindMeta, countNoun, buildDrilldownFindings, drillRollupTarget,
  type DrillKind,
} from "@/v3/components/flow/flowDrilldown";

interface FlowShellProps {
  program: ProgramSummary;
  programs: ProgramSummary[];
  runningAgentIds: Set<string>;
  /** Agents in flight OR queued for regeneration — Regenerate controls hide when
   *  their artifact is in this set. */
  regenActiveIds?: Set<string>;
  /** Enqueue an artifact regeneration (ordered, de-duplicated) instead of firing
   *  it immediately. */
  onEnqueueRegen?: (agentId: string, phaseId: string, label: string) => void;
  /** Per-artifact failure residue from the last run — shown on the card. */
  agentErrors?: Record<string, string>;
  onSelectProgram: (id: string) => void;
  onCreateProgram: () => void;
  /** Per-programme "auto-build artifacts on input" toggle (opt-in). */
  autoBuildOn?: boolean;
  onToggleAutoBuild?: () => void;
  /** Create a drill-down child anchored on one slice of this programme. */
  onDrillDown: (anchor: { kind: string; refId: string; label: string }) => void;
  /** Archive a programme — soft delete, hidden but recoverable. */
  onDeleteProgram?: (id: string) => void;
  /** Rename a programme inline from the Portfolio. */
  onRenameProgram?: (id: string, name: string) => void | Promise<void>;
  /** Tag/untag a quoted evidence span to an entity/KPI/track (attested). */
  onTagClaim?: (input: { quote: string; who: string; movementId: string; target: { kind: string; refId: string; label: string }; removeId?: string }) => Promise<void>;
  /** Add/resolve an anchored comment on an artifact (attested). */
  onComment?: (input: { fieldKey: string; movementId: string; title: string; text?: string; resolveId?: string }) => Promise<void>;
  onOpenSetup: () => void;
  onOpenCopilot: () => void;
  onRunAgent: (agentId: string, phaseId?: string) => void;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string }; extraInputs?: Record<string, Record<string, string>> }) => Promise<void>;
  /** Rename a person across the roster + contact bindings (People page). */
  onRenamePerson?: (oldName: string, newName: string) => Promise<void>;
  /** Rename a role-only roster row's label programme-wide (Discovery Kit). */
  onRenameRole?: (oldRole: string, newRole: string) => Promise<void>;
  /** Resolve an open decision (confirm applies its prepared payload). */
  onResolveDecision: (decisionId: string, resolution: "confirmed" | "declined") => Promise<void>;
  /** Record a movement's gate — demonstrated. Locks the movement's inputs. */
  onRecordGate?: (movementId: string) => Promise<void>;
  /** Reopen a demonstrated gate — evidence changed. Unlocks its inputs. */
  onReopenGate?: (movementId: string, reason: string) => Promise<void>;
  /** Restore the programme blob to a local snapshot's state. */
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
  /** AI provider connection status — powers the Control chip. */
  aiStatus?: string;
  /** Open the AI provider settings. */
  onOpenAISettings?: () => void;
  /** Awaitable agent run for the spine runner. */
  onRunAgentAndWait?: (agentId: string, phaseId: string) => Promise<void>;
  /** Presence keys (emails) of others in this programme right now. */
  presence?: string[];
  /** Record a show/refine pass on a track. */
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
  /** Set a whole ship lane done/undone at once. */
  onSetShipLane: (laneId: string, done: boolean) => Promise<void>;
  /** Hydrate every programme's full blob (Portfolio needs all of them). */
  onHydratePrograms: () => Promise<void>;
  /** Put a gap-closing follow-up on the calendar. */
  onScheduleFollowUp: (movementId: string, who: string, date: string) => Promise<void>;
  /** Mint a follow-up link (AURA asks the gaps itself); resolves to the URL. */
  onMintFollowUp: (input: { movementId: string; who: string; questions: string[]; captureField: string; unnamed?: boolean }) => Promise<string | null>;
  onMintReview: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean }) => Promise<string | null>;
  /** Mint a shareable sponsor brief (dated board-pack snapshot); resolves to the URL. */
  onMintBrief: () => Promise<string | null>;
  /** Send an artifact to a chosen approver — mints a no-login link, returns it. */
  onSendForApproval?: (input: { artifactId: string; movementId: string; artifactTitle: string; approver: { name: string; role: string; email?: string }; snapshot?: string }) => Promise<string | null>;
  /** Record an approver's verdict from the Inbox (flips the artifact, logs evidence). */
  onRecordApproval?: (itemId: string) => Promise<void>;
  /** Record an in-room demonstration pass against a track (Show). */
  onRecordShowPass: (trackId: string, pass: { stakeholder?: string; verdict: "accepted" | "accepted-with-changes" | "rework"; stableDiff?: boolean }) => Promise<void>;
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc: (input: ArtifactEditInput) => Promise<void>;
  /** Confirm a quarantined portal response into evidence. */
  onIngestPortalItem: (itemId: string) => Promise<void>;
  onDismissPortalItem: (itemId: string) => Promise<void>;
  /** Bumped by the shell to command a jump to the Flow board — used after a
   * new programme is created so setup lands on the work, not the last view. */
  jumpToFlowNonce?: number;
}

type FlowView = "today" | "flow" | "library" | "people" | "pulse" | "mission" | "grounding" | "portfolio" | "line";

/** The Line — the DEFAULT chrome, running beside the classic one: same live
 * record, read-only projection, so the two can never disagree. Classic stays
 * one toggle away (`?ui=classic`, or the persisted "off" the appbar toggle
 * writes) — deliberately NOT a rail tile, because the Line is a sibling
 * chrome for the whole programme, not an eighth view within this one. */
const lineViewPreferred = (): boolean => {
  try {
    const ui = new URLSearchParams(window.location.search).get("ui");
    if (ui === "line") return true;
    if (ui === "classic") return false;
    return localStorage.getItem("atos.lineView") !== "off";
  } catch { return true; }
};
const rememberLineView = (on: boolean): void => {
  try { localStorage.setItem("atos.lineView", on ? "on" : "off"); } catch { /* private mode — fine */ }
};

/** The rail is programme-scoped: the work, then the system. App-global actions
 * (Search, Portfolio, Copilot, Help) live in the top bar instead — the rail
 * answers "where am I in THIS programme", the top bar "where can I go in the
 * app". ("mission" keeps its internal id; the person-facing name is Control.) */
// Grounding is HIDDEN from the rail (still reachable via the ⌘K workbench).
const DOCK_ZONES: Array<Array<[FlowView, string]>> = [
  [["today", "Inbox"], ["flow", "Flow"], ["library", "Library"], ["people", "People"], ["pulse", "Pulse"]],
  [["mission", "Control"]],
];
const DOCK_ORDER: FlowView[] = DOCK_ZONES.flat().map(([id]) => id);

/** Hover copy for each rail item — a description, never a bare number that
 * could be mistaken for a count. The keyboard shortcut stays in aria-label. */
const DOCK_TIPS: Record<FlowView, string> = {
  today: "Inbox — responses and decisions waiting on you",
  flow: "Flow — the live programme, movement by movement",
  library: "Library — every conversation and artifact",
  people: "People — everyone the programme collects from, with contact state",
  pulse: "Pulse — the steering-meeting view",
  mission: "Control — agents, governance and settings",
  grounding: "Grounding — the standards the ontology is grounded in, plus the client vocabulary",
  portfolio: "Portfolio — every programme and its engagements",
  line: "The Line — the production-line view of this programme (read-only projection)",
};

/** One stroke weight, currentColor — the rail's icons stop being a font-glyph grab bag. */
const DOCK_PATHS: Record<string, React.ReactNode> = {
  today: <><path d="M4 6h16v12H4z" /><path d="M4 13h5l2 2.5h2L15 13h5" /></>,
  flow: <><path d="M4 12h13" /><path d="M13 7l5 5-5 5" /></>,
  library: <><path d="M6 4v16" /><path d="M11 4v16" /><path d="M14.5 5.5L19 19.5" /></>,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.8-3.2 3-4.8 5.5-4.8s4.7 1.6 5.5 4.8" /><circle cx="17" cy="9.5" r="2.3" /><path d="M15.5 14.6c2.4.2 4.2 1.6 5 4.4" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  mission: <><path d="M5 8h14" /><path d="M5 16h14" /><circle cx="10" cy="8" r="2.1" /><circle cx="15" cy="16" r="2.1" /></>,
  grounding: <><path d="M12 3.5l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 16.5l8 4 8-4" /></>,
  portfolio: <><path d="M5 5h6v6H5z" /><path d="M13 5h6v6h-6z" /><path d="M5 13h6v6H5z" /><path d="M13 13h6v6h-6z" /></>,
  copilot: <path d="M12 4l1.9 5.6L19.5 12l-5.6 2.4L12 20l-1.9-5.6L4.5 12l5.6-2.4z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.4 2.4 0 0 1 4.7.7c0 1.6-2.3 2-2.3 3.7" /><path d="M12 17h.01" /></>,
  lens: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
};

function DockIcon({ id }: { id: string }) {
  return (
    <svg className="v3fs-ric" viewBox="0 0 24 24" width="17" height="17" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DOCK_PATHS[id]}
    </svg>
  );
}

/* ── Global search — programmes + this programme's evidence & artifacts ───── */
function FlowSearch({ programs, program, onSelectProgram, onGoView, onCreateProgram, onOpenDrill, onSponsor, onClose, workbench }: {
  programs: ProgramSummary[];
  program: ProgramSummary;
  onSelectProgram: (id: string) => void;
  onGoView: (view: FlowView) => void;
  onCreateProgram?: () => void;
  onOpenDrill?: () => void;
  onSponsor?: () => void;
  onClose: () => void;
  /** Reimagined chrome opens this as the "Workbench": the six cross-cutting
   * homes that used to sit in the rail, browsable without typing. */
  workbench?: boolean;
}) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const query = q.trim().toLowerCase();
  const progHits = programs
    .filter((p) => p.methodology === "atos-flow" && (!query || `${p.name} ${p.client ?? ""}`.toLowerCase().includes(query)))
    .slice(0, 8);
  // Verbs, not just nouns: the palette can also DO things.
  const actions: Array<{ label: string; hint: string; run: () => void }> = [
    ...DOCK_ORDER.map((id) => {
      const label = DOCK_ZONES.flat().find(([zid]) => zid === id)?.[1] ?? id;
      return { label: `Go to ${label}`, hint: "view", run: () => onGoView(id) };
    }),
    // Portfolio lives in the top bar, not the rail — the palette still routes there.
    { label: "Go to Portfolio", hint: "view", run: () => onGoView("portfolio") },
    ...(onOpenDrill ? [{ label: "Drill into this programme…", hint: "creates a focused child", run: () => onOpenDrill() }] : []),
    ...(onCreateProgram ? [{ label: "New programme", hint: "opens setup", run: () => onCreateProgram() }] : []),
    ...(onSponsor ? [{ label: "Switch to sponsor view", hint: "read-only steering page", run: () => onSponsor() }] : []),
  ];
  const actionHits = query ? actions.filter((a) => a.label.toLowerCase().includes(query)).slice(0, 5) : [];
  const libHits = useMemo(() => {
    if (!query) return [] as Array<{ tag: string; label: string; sub: string }>;
    const movements = flowMovements();
    const ev = movements.flatMap((m) => movementEvidence(program, m))
      .filter((e) => `${e.who} ${e.fieldLabel} ${e.excerpt} ${e.text}`.toLowerCase().includes(query))
      .slice(0, 6).map((e) => ({ tag: "Evidence", label: e.who, sub: e.fieldLabel }));
    const ar = movements.flatMap((m) => movementArtifacts(program, m))
      .filter((a) => a.present && `${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(query))
      .slice(0, 6).map((a) => ({ tag: "Artifact", label: a.title, sub: "generated" }));
    return [...ev, ...ar];
  }, [program, query]);

  return (
    <div className="v3fs-cmd-overlay" role="dialog" aria-modal="true" aria-label="Search">
      <div className="v3fs-cmd-back" onClick={onClose} aria-hidden="true" />
      <div className="v3fs-cmd">
        <div className="v3fs-cmd-in">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search programmes, evidence, artifacts…" aria-label="Search"
            onKeyDown={(e) => { if (e.key === "Enter" && progHits[0]) onSelectProgram(progHits[0].id); }} />
          <kbd>Esc</kbd>
        </div>
        <div className="v3fs-cmd-body">
          {workbench && !query ? (
            <>
              <div className="v3fs-cmd-grp">Workbench</div>
              {([
                ["today", "Inbox", "Responses and decisions waiting on you"],
                ["flow", "Flow", "The work — the live programme, movement by movement"],
                ["library", "Library", "Every conversation and document"],
                ["people", "People", "Everyone the programme collects from"],
                ["pulse", "Overview", "The steering view — for the sponsor"],
                ["grounding", "Standards", "The industry standards the map is built on"],
                ["mission", "Settings", "Agents, governance and preferences"],
              ] as Array<[FlowView, string, string]>).map(([id, label, sub]) => (
                <button key={id} type="button" className="v3fs-cmd-row" onClick={() => { onGoView(id); onClose(); }}>
                  <span className="v3fs-cmd-tag">Go to</span>
                  <span className="v3fs-cmd-row-t">{label}</span>
                  <span className="v3fs-cmd-row-s">{sub}</span>
                </button>
              ))}
              <div className="v3fs-cmd-hint">Or type to search programmes, evidence and artifacts.</div>
            </>
          ) : null}
          {!query && !workbench ? (
            <div className="v3fs-cmd-hint">Search across every programme, plus this programme&rsquo;s evidence and artifacts.</div>
          ) : null}
          {actionHits.length ? <div className="v3fs-cmd-grp">Actions</div> : null}
          {actionHits.map((a) => (
            <button key={a.label} type="button" className="v3fs-cmd-row" onClick={() => { a.run(); onClose(); }}>
              <span className="v3fs-cmd-tag">Action</span>
              <span className="v3fs-cmd-row-t">{a.label}</span>
              <span className="v3fs-cmd-row-s">{a.hint}</span>
            </button>
          ))}
          {progHits.length ? <div className="v3fs-cmd-grp">Programmes</div> : null}
          {progHits.map((p) => (
            <button key={p.id} type="button" className="v3fs-cmd-row" onClick={() => onSelectProgram(p.id)}>
              <span className="v3fs-cmd-row-t">{p.name}</span>
              <span className="v3fs-cmd-row-s">{p.client || "programme"}</span>
            </button>
          ))}
          {libHits.length ? <div className="v3fs-cmd-grp">In {program.name}</div> : null}
          {libHits.map((it, i) => (
            <button key={i} type="button" className="v3fs-cmd-row" onClick={() => onGoView("library")}>
              <span className="v3fs-cmd-tag">{it.tag}</span>
              <span className="v3fs-cmd-row-t">{it.label}</span>
              <span className="v3fs-cmd-row-s">{it.sub}</span>
            </button>
          ))}
          {query && !progHits.length && !libHits.length ? (
            <div className="v3fs-empty">No matches for &ldquo;{q.trim()}&rdquo;.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Help — how the programme runs ───────────────────────────────────────── */
const HELP_MOVEMENTS: Array<[string, string]> = [
  ["Frame", "Set the mandate — the outcome, sponsor, and success measures the programme is funded to deliver."],
  ["Listen", "Hear every stakeholder. Discovery interviews and documents become attributed evidence."],
  ["Envision", "Turn evidence into the target architecture, blueprint, and the first thing to demonstrate."],
  ["Show", "Demonstrate the prototype back to the people who described the work, and record their acceptance."],
  ["Ship", "Harden, evaluate, and cut over — with the runbook and go-decision the sponsor signs."],
  ["Evolve", "Run it live, measure the outcome against baseline, and decide the next engagement."],
];
function FlowHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="v3fs-help-overlay" role="dialog" aria-modal="true" aria-label="Help">
      <div className="v3fs-cmd-back" onClick={onClose} aria-hidden="true" />
      <div className="v3fs-help">
        <div className="v3fs-help-head">
          <div>
            <span className="v3fs-pf-eyebrow">Help</span>
            <h2>How AURA Flow works</h2>
          </div>
          <button type="button" className="v3fs-help-x" onClick={onClose} aria-label="Close help">✕</button>
        </div>
        <div className="v3fs-help-body">
          <section>
            <h3>One live programme, six movements</h3>
            <p>The programme runs as a single spine, left to right. Each movement collects evidence from the people it depends on, then generates artifacts traceable back to that evidence. A movement&rsquo;s gate opens when its documents are grounded and confirmed.</p>
            <ol className="v3fs-help-steps">
              {HELP_MOVEMENTS.map(([name, desc]) => (
                <li key={name}><b>{name}</b> — {desc}</li>
              ))}
            </ol>
          </section>
          <section>
            <h3>The rail</h3>
            <ul className="v3fs-help-list">
              <li><b>Search</b> — jump to any programme, or find evidence and artifacts (⌘K or /). Portfolio opens from the breadcrumb up top.</li>
              <li><b>Inbox</b> — responses and decisions waiting on your judgment.</li>
              <li><b>Flow</b> — the live programme, movement by movement.</li>
              <li><b>Library</b> — every conversation and generated artifact.</li>
              <li><b>People</b> — everyone across the programme and who covers what.</li>
              <li><b>Pulse</b> — the steering read and the board pack.</li>
              <li><b>Control</b> — agents, budgets, guardrails, and the audit trail.</li>
            </ul>
          </section>
          <section>
            <h3>Working a programme</h3>
            <ul className="v3fs-help-list">
              <li>Start fresh with <b>New programme</b>, or seed a same-sector follow-up with <b>New from this programme</b> (from the programme switcher).</li>
              <li>Collect stakeholder evidence in each movement — schedule a meeting, or send a link.</li>
              <li>Edit a programme&rsquo;s name inline from the Portfolio; archive one there too.</li>
              <li><b>Shortcuts:</b> ⌘K or / to search · 1–7 to jump the rail · Esc to close.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Drill-down wizard — pick a lens, then an anchor from the parent's data ── */
function DrillIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path.split("M").filter(Boolean).map((seg, i) => <path key={i} d={`M${seg}`} />)}
    </svg>
  );
}
function FlowDrillWizard({ program, onCreate, onClose }: {
  program: ProgramSummary;
  onCreate: (anchor: { kind: string; refId: string; label: string }) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<DrillKind | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [scopeText, setScopeText] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const counts = useMemo(() => drillAnchorCounts(program), [program]);
  const meta = kind ? drillKindMeta(kind) : null;
  const options = kind && meta && !meta.freeform ? listDrillAnchors(program, kind) : [];
  const chosen = options.find((o) => o.refId === picked);
  const canCreate = meta?.freeform ? scopeText.trim().length > 0 : !!chosen;
  const create = () => {
    if (meta?.freeform) { if (scopeText.trim()) onCreate({ kind: "scope", refId: "", label: scopeText.trim() }); return; }
    if (chosen && kind) onCreate({ kind, refId: chosen.refId, label: chosen.label });
  };

  return (
    <div className="v3fs-drill-overlay" role="dialog" aria-modal="true" aria-label="Drill into this programme">
      <div className="v3fs-cmd-back" onClick={onClose} aria-hidden="true" />
      <div className="v3fs-drill">
        <div className="v3fs-drill-head">
          <div>
            <span className="v3fs-pf-eyebrow">Drill into this programme</span>
            <h2>{kind ? drillKindMeta(kind).title : "Pick a lens to go deeper"}</h2>
            <p>A drill-down is a focused child of <b>{program.name}</b> — it shares this programme&rsquo;s ontology and rolls its findings back up to the slice you choose.</p>
          </div>
          <button type="button" className="v3fs-help-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="v3fs-drill-body">
          {!kind ? (
            <div className="v3fs-drill-lenses">
              {DRILL_KINDS.map((k) => {
                const n = counts[k.kind];
                const disabled = !k.freeform && n === 0;
                return (
                  <button key={k.kind} type="button" className="v3fs-drill-lens" disabled={disabled}
                    onClick={() => { setKind(k.kind); setPicked(null); }}>
                    <span className="v3fs-drill-lens-i"><DrillIcon path={k.icon} /></span>
                    <span className="v3fs-drill-lens-t">{k.title}</span>
                    <span className="v3fs-drill-lens-b">{k.blurb}</span>
                    <span className="v3fs-drill-lens-n">{k.freeform ? "free scope" : disabled ? "none yet" : countNoun(k, n)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="v3fs-drill-pick">
              <button type="button" className="v3fs-drill-back" onClick={() => { setKind(null); setPicked(null); }}>← All lenses</button>
              {meta?.freeform ? (
                <div className="v3fs-drill-free">
                  <label htmlFor="drill-scope">Name the focus</label>
                  <input id="drill-scope" className="v3fs-pf-search" autoFocus value={scopeText}
                    onChange={(e) => setScopeText(e.target.value)}
                    placeholder="e.g. Enterprise deal desk, EU region, CRM sync boundary…"
                    onKeyDown={(e) => { if (e.key === "Enter" && scopeText.trim()) create(); }} />
                </div>
              ) : options.length ? (
                <div className="v3fs-drill-opts">
                  {options.map((o) => (
                    <button key={o.refId} type="button"
                      className={`v3fs-drill-opt${picked === o.refId ? " on" : ""}`} onClick={() => setPicked(o.refId)}>
                      <span className="v3fs-drill-opt-r" aria-hidden="true" />
                      <span className="v3fs-drill-opt-t">{o.label}</span>
                      {o.sub ? <span className="v3fs-drill-opt-s">{o.sub}</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="v3fs-empty">Nothing to drill into here yet — this programme has no {meta?.noun}s.</div>
              )}
            </div>
          )}
        </div>
        <div className="v3fs-drill-foot">
          <span className="v3fs-drill-foot-l">
            {canCreate
              ? <>New drill-down: <b>{meta?.freeform ? scopeText.trim() : chosen?.label}</b> — inherits the ontology, excludes everything else.</>
              : "Choose what to focus on."}
          </span>
          <button type="button" className="v3fs-btn pri" disabled={!canCreate} onClick={create}>Create drill-down</button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Paper & Flow" — the reimagined shell for AURA Flow programmes. None of the
 * classic chrome renders here: a floating dock (Flow · Library · Pulse ·
 * Copilot), an editorial hero with the one metric that matters (days to first
 * demo), and the pipeline as the page. Brand hues carry one grammar: blue =
 * what people said, indigo = what AURA made, green = what was demonstrated.
 * Theme-aware — follows the app's data-theme like every other surface.
 */
export default function FlowShell(props: FlowShellProps) {
  const { program } = props;
  // Land where the work is: Today only when something waits on the user's
  // judgment (decisions / quarantined evidence); the canvas otherwise, where
  // the spine pointer takes over. Today stays one badge-tap away.
  const [view, setView] = useState<FlowView>(() => {
    if (lineViewPreferred()) return "line";
    return listOpenFlowDecisions(program).length + listPortalInbox(program).length + governedExceptionsForInbox(program).length > 0 ? "today" : "flow";
  });
  // A freshly-created programme should open on the work — the shell bumps this
  // nonce after setup saves so we jump to the canvas regardless of the view the
  // operator was on (typically Portfolio, where they clicked "New programme").
  const jumpNonce = props.jumpToFlowNonce ?? 0;
  useEffect(() => {
    if (jumpNonce > 0) { setView(lineViewPreferred() ? "line" : "flow"); window.scrollTo({ top: 0 }); }
  }, [jumpNonce]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  // Audience lens — the same record through a different pair of eyes. The
  // sponsor lens is read-only: Pulse (numbers, story, board pack), no
  // operational chrome. Session-sticky so a projected screen stays clean.
  const [lens, setLens] = useState<"operator" | "sponsor">(() => {
    try { return window.sessionStorage.getItem("v3fs-lens") === "sponsor" ? "sponsor" : "operator"; } catch { return "operator"; }
  });
  const switchLens = (next: "operator" | "sponsor") => {
    setLens(next);
    try { window.sessionStorage.setItem("v3fs-lens", next); } catch { /* ignore */ }
  };
  const days = daysToFirstDemo(program);
  // If this programme is a drill-down, resolve its anchor + parent for the breadcrumb.
  const drillAnchor = readDrillAnchor(program);
  const drillParentId = readParentId(program);
  const drillParent = drillParentId ? props.programs.find((p) => p.id === drillParentId) : undefined;
  const openDecisions = listOpenFlowDecisions(program);
  const portalInbox = listPortalInbox(program);
  const approvalResponseCount = listApprovalResponses(program).length;
  // "Start here" — one prominent pointer at the right entry: Today when
  // anything waits on the user, the canvas otherwise. Dismissed for the
  // session the moment they go there.
  const openDisputeCount = useMemo(() => readContradictions(program, true).length, [program]);
  const unresolvedRoleCount = useMemo(() => readDirectoryPeople(program).filter((entry) => !entry.roleResolved).length, [program]);
  const coverageNameCount = useMemo(() => unresolvedCoverageNames(program).length, [program]);
  // Rebuilds owed do NOT count here: stale documents live on the ribbon (the
  // movement's "Regeneration required" bar + amber tabs), not in the Inbox.
  const waitingCount = openDecisions.length + portalInbox.length + approvalResponseCount + openDisputeCount + unresolvedRoleCount + coverageNameCount;
  // "Where to go next" — the single rail item the operator should visit now.
  // Waiting decisions/inbox items pull them to the Inbox; otherwise the work
  // continues on Flow. The pointer is persistent (it always shows the next
  // stop) but self-quiets: it hides the moment they are already on that view,
  // so it guides without nagging.
  const nextId: FlowView = waitingCount > 0 ? "today" : "flow";
  const nextHint = nextId === "today" ? `${waitingCount} waiting` : "Continue";

  // The switcher dismisses like a menu should: backdrop click or Escape.
  useEffect(() => {
    if (!switcherOpen) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSwitcherOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [switcherOpen]);

  // Shortcuts: ⌘/Ctrl-K or "/" opens global search; 1–7 jump between views.
  // Nothing fires while the user is typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/" && !typing) { event.preventDefault(); setSearchOpen(true); return; }
      if (typing) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const id = DOCK_ORDER[index];
      if (!Number.isNaN(index) && id) {
        // "Flow" means whichever chrome is active — the Line unless the
        // operator toggled Classic.
        setView(id === "flow" && lineViewPreferred() ? "line" : id);
        window.scrollTo({ top: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drill-down lineage, cross-programme evidence, and the portfolio inbox all
  // read OTHER programmes' blobs — hydrate them once up front (Portfolio does
  // the same on open; this makes the family visible from every view).
  const { onHydratePrograms } = props;
  useEffect(() => { void onHydratePrograms().catch(() => { /* metadata-only fallback */ }); }, [onHydratePrograms]);

  // Instrumentation: the shell's core promise is decision latency. Stamp when
  // it opens; the session's first resolution logs open→decided (see FlowToday).
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("v3fs-open-ts")) sessionStorage.setItem("v3fs-open-ts", String(Date.now()));
    } catch { /* metrics never block the shell */ }
  }, []);

  if (lens === "sponsor") {
    // The sponsor's page: the outcome numbers, the demonstrations, the story,
    // and the board pack — nothing to operate, nothing to break.
    return (
      <div className="v3fs-app v3fs-sponsor">
        <div className="v3fs-lens-bar">
          <button type="button" className="v3fs-lens-exit" title="Mint a no-login sponsor link and copy it"
            onClick={() => void copyTextFromAction(() => props.onMintBrief(), "Copy the sponsor link:")}>
            ⎘ Copy sponsor link
          </button>
          <button type="button" className="v3fs-lens-exit" onClick={() => switchLens("operator")}>
            <DockIcon id="lens" /> Sponsor view — exit
          </button>
        </div>
        <div className="v3fs-wrap">
          <header className="v3fs-hero">
            <div className="v3fs-hero-eyebrow">AURA Flow{program.client ? <span> · {program.client}</span> : null}</div>
            <h1 className="v3fs-hero-title">{program.name}</h1>
            {days != null ? (
              <p className="v3fs-hero-line">
                <b>{days}</b> day{Math.abs(days) === 1 ? "" : "s"} {days >= 0 ? "to first demo" : "past the first-demo target"}
              </p>
            ) : null}
          </header>
          <FlowPulse program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onMintBrief={props.onMintBrief} />
        </div>
      </div>
    );
  }

  return (
    <div className="v3fs-app">
      <nav className="v3fs-dock" aria-label="Primary">
        <button type="button" className="v3fs-brand" data-tip="Switch programme" onClick={() => setSwitcherOpen((v) => !v)} aria-label="Switch programme" aria-expanded={switcherOpen}>
          {(program.name || "F").slice(0, 1).toUpperCase()}
          <span className="v3fs-brand-caret" aria-hidden="true">▾</span>
        </button>
        {DOCK_ZONES.map((zone, zoneIndex) => (
          <React.Fragment key={zoneIndex}>
            <div className="v3fs-dock-sep" aria-hidden="true" />
            {zone.map(([id, label]) => {
              const shortcut = DOCK_ORDER.indexOf(id) + 1;
              const isNext = id === nextId && view !== nextId;
              return (
                <button key={id} type="button" className={`${view === id || (id === "flow" && view === "line") ? "on" : ""}${isNext ? " v3fs-dock-next" : ""}`.trim()}
                  data-tip={DOCK_TIPS[id]}
                  aria-label={`${label} (shortcut ${shortcut})${isNext ? " — go here next" : ""}`}
                  onClick={() => {
                    // Navigating dismisses whatever overlay is up — the rail is
                    // always an exit, never dead under a modal.
                    setSearchOpen(false); setHelpOpen(false); setDrillOpen(false);
                    setView(id === "flow" && lineViewPreferred() ? "line" : id);
                    window.scrollTo({ top: 0 });
                  }}>
                  {id === "today" && waitingCount > 0 ? <span className="v3fs-dock-n">{waitingCount}</span> : null}
                  <DockIcon id={id} /><span className="v3fs-rlb">{label}</span>
                  {isNext ? (
                    <span className="v3fs-next" role="status">
                      <span className="v3fs-next-arw" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
                      </span>
                      <span className="v3fs-next-txt"><span>Next</span><b>{nextHint}</b></span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </React.Fragment>
        ))}
        {/* Sponsor view stays reachable from Pulse and the command palette —
            it earns no standing dock slot. */}
      </nav>

      {/* The app bar — ONE slim strip, not floating islands. Portfolio sits
          left as the "up and out" of the current programme; the centre is a
          real search field (the command palette's front door); Help and
          Copilot close the right edge. Programme navigation stays in the rail. */}
      <header className="v3fs-appbar" aria-label="Global">
        <div className="v3fs-appbar-l">
          {/* Brand + breadcrumb: Portfolio / (parent) / programme. The trail IS
              the location — the hero no longer repeats it. The programme crumb
              opens the switcher; a drill-down shows its parent as a hop. */}
          {/* The lockup reads "brillio - ⟑URA" — the Drawn Line glyph IS the
              wordmark's leading A: cap-height sized, baseline-set, stroke
              weight matched to the 800 letters. Screen readers still hear
              "AURA" (role=img label); the glyph is decorative to them. */}
          <span className="v3fs-appbar-brandlock"><BrilioLogo className="v3fs-appbar-logo" title="Brillio" /><span className="v3fs-appbar-brandsep" aria-hidden="true">-</span><span className="v3fs-appbar-brand" role="img" aria-label="AURA"><svg className="v3fs-brand-a" viewBox="0 0 68 49" aria-hidden="true"><polyline points="4,44 18,44 34,10 50,44 64,44" fill="none" stroke="var(--aura-mark-ink, #1D1545)" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" /><line x1="25" y1="32" x2="43" y2="32" stroke="#6E5BFF" strokeWidth="7.5" strokeLinecap="round" /><circle cx="4" cy="44" r="4.5" fill="#6E5BFF" /><circle cx="64" cy="44" r="4.5" fill="#6E5BFF" /></svg>URA</span></span>
          <nav className="v3fs-appbar-crumbs" aria-label="Breadcrumb">
            <button type="button" className={`v3fs-appbar-nav${view === "portfolio" ? " on" : ""}`}
              title={DOCK_TIPS.portfolio} aria-label="Portfolio"
              onClick={() => {
                setSearchOpen(false); setHelpOpen(false); setDrillOpen(false);
                setView("portfolio"); window.scrollTo({ top: 0 });
              }}>
              <DockIcon id="portfolio" /><span>Portfolio</span>
            </button>
            {view !== "portfolio" && drillParent ? (
              <>
                <span className="v3fs-appbar-sl" aria-hidden="true">/</span>
                <button type="button" className="v3fs-appbar-nav v3fs-appbar-crumb parent" title={`Up to ${drillParent.name}`}
                  onClick={() => props.onSelectProgram(drillParent.id)}>
                  <span>{drillParent.name}</span>
                </button>
              </>
            ) : null}
            {view !== "portfolio" ? (
              <>
                <span className="v3fs-appbar-sl" aria-hidden="true">/</span>
                <button type="button" className="v3fs-appbar-nav v3fs-appbar-crumb here" title="Switch programme"
                  aria-haspopup="menu" aria-expanded={switcherOpen}
                  onClick={() => setSwitcherOpen((open) => !open)}>
                  <span>{program.name}</span>
                  <span className="v3fs-appbar-caret" aria-hidden="true">▾</span>
                </button>
              </>
            ) : null}
          </nav>
        </div>
        <button type="button" className="v3fs-appbar-search" title="Search — ⌘K or /" aria-label="Search (⌘K)"
          onClick={() => setSearchOpen(true)}>
          <DockIcon id="search" />
          <span>Search programmes, evidence, actions…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="v3fs-appbar-r">
          <button type="button" className="v3fs-appbar-nav"
            title={view === "line" ? "Back to the classic chrome — same record, nothing lost" : "The Line — the production-line view of this programme (read-only projection; runs beside the classic chrome)"}
            aria-label={view === "line" ? "Switch to the classic chrome" : "Switch to the Line view"}
            aria-pressed={view === "line"}
            onClick={() => {
              const next = view === "line" ? "flow" : "line";
              rememberLineView(next === "line");
              setView(next); window.scrollTo({ top: 0 });
            }}>
            <DockIcon id="flow" /><span>{view === "line" ? "Classic" : "Line"}</span>
          </button>
          <button type="button" className="v3fs-appbar-nav" title="Help — how AURA Flow works" aria-label="Help"
            onClick={() => setHelpOpen(true)}>
            <DockIcon id="help" /><span>Help</span>
          </button>
          <button type="button" className="v3fs-appbar-cp" title="Copilot" aria-label="Copilot" onClick={props.onOpenCopilot}>
            <DockIcon id="copilot" /><span>Copilot</span>
          </button>
        </div>
      </header>
      {searchOpen ? (
        <FlowSearch programs={props.programs} program={program}
          onSelectProgram={(id) => { props.onSelectProgram(id); setSearchOpen(false); }}
          onGoView={(v) => { setView(v); window.scrollTo({ top: 0 }); setSearchOpen(false); }}
          onCreateProgram={() => { setSearchOpen(false); props.onCreateProgram(); }}
          onOpenDrill={() => { setSearchOpen(false); setDrillOpen(true); }}
          onSponsor={() => { setSearchOpen(false); switchLens("sponsor"); }}
          onClose={() => setSearchOpen(false)} />
      ) : null}
      {helpOpen ? <FlowHelp onClose={() => setHelpOpen(false)} /> : null}
      {drillOpen ? (
        <FlowDrillWizard program={program}
          onCreate={(anchor) => { setDrillOpen(false); props.onDrillDown(anchor); }}
          onClose={() => setDrillOpen(false)} />
      ) : null}

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
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); setDrillOpen(true); }}>◇ Drill into this programme →</button>
          <button type="button" role="menuitem" onClick={() => { setSwitcherOpen(false); props.onOpenSetup(); }}>Programme setup</button>
        </div>
      ) : null}

      <div className="v3fs-wrap">
        <header className="v3fs-hero">
          {/* Location lives in the app bar's breadcrumb now — the eyebrow only
              carries what the trail doesn't: whose programme this is. */}
          {view !== "portfolio" && program.client ? (
            <div className="v3fs-hero-eyebrow"><span>{program.client}</span></div>
          ) : null}
          {view === "portfolio" ? (
            <>
              <div className="v3fs-portfolio-head">
                <div>
                  <h1 className="v3fs-hero-title">Portfolio</h1>
                  <p className="v3fs-hero-line v3fs-hero-current">
                    Current programme — <b>{program.name}</b>
                  </p>
                </div>
                {props.onCreateProgram ? (
                  <button type="button" className="v3fs-btn pri v3fs-portfolio-new" onClick={() => props.onCreateProgram()}>
                    ＋ New programme
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              {drillAnchor && (drillParent || drillParentId) ? (
                <button type="button" className="v3fs-breadcrumb"
                  onClick={() => drillParentId && props.onSelectProgram(drillParentId)}
                  title={`Back to ${drillParent?.name ?? "parent programme"}`}>
                  <span className="v3fs-bc-lens">◇ {drillKindMeta(drillAnchor.kind).noun}</span>
                  <span className="v3fs-bc-sep">Drill-down of</span>
                  <b>{drillParent?.name ?? "parent programme"}</b>
                  <span className="v3fs-bc-go">↩ back</span>
                </button>
              ) : null}
              <h1 className="v3fs-hero-title">{program.name}</h1>
              {days != null ? (
                <p className="v3fs-hero-line">
                  <b>{days}</b> day{Math.abs(days) === 1 ? "" : "s"} {days >= 0 ? "to first demo" : "past the first-demo target"}
                </p>
              ) : null}
            </>
          )}
          {props.presence?.length ? (
            <span className="v3fs-presence" title={props.presence.join(", ")}>
              <span className="v3fs-presence-dot" aria-hidden="true" />
              {props.presence.length === 1 ? `${props.presence[0].split("@")[0]} is here too` : `${props.presence.length} others are here`}
            </span>
          ) : null}
        </header>

        {/* The "Waiting on you" banner was removed from every view — the Inbox
            (nav item) already carries the waiting count, so the ribbon was noise. */}

        <ViewBoundary view={view}>
        {view === "today" ? (
          <FlowToday program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onResolveDecision={props.onResolveDecision} onSaveInputs={props.onSaveInputs}
            onIngestPortalItem={props.onIngestPortalItem} onDismissPortalItem={props.onDismissPortalItem} onRecordApproval={props.onRecordApproval}
            onGoFlow={() => { setView(lineViewPreferred() ? "line" : "flow"); window.scrollTo({ top: 0 }); }} />
        ) : view === "flow" ? (
          <FlowCanvas program={program} programs={props.programs} runningAgentIds={props.runningAgentIds} regenActiveIds={props.regenActiveIds} onEnqueueRegen={props.onEnqueueRegen} agentErrors={props.agentErrors} relatedPrograms={[...(drillParent ? [drillParent] : []), ...listChildDrilldowns(program, props.programs).map((c) => c.child)]} onSelectProgram={props.onSelectProgram} onComment={props.onComment} onRunAgent={props.onRunAgent} onSaveInputs={props.onSaveInputs} onMintPacks={props.onMintPacks} onMintDemoInvites={props.onMintDemoInvites} onCompileShipLanes={props.onCompileShipLanes} onToggleShipItem={props.onToggleShipItem} onSetShipLane={props.onSetShipLane} onScheduleFollowUp={props.onScheduleFollowUp} onMintFollowUp={props.onMintFollowUp} onMintReview={props.onMintReview} onRecordShowPass={props.onRecordShowPass} onSaveArtifactDoc={props.onSaveArtifactDoc} onRecordGate={props.onRecordGate} onReopenGate={props.onReopenGate} onRunAgentAndWait={props.onRunAgentAndWait} onSendForApproval={props.onSendForApproval} onRenamePerson={props.onRenamePerson} onRenameRole={props.onRenameRole} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }}
          />
        ) : view === "people" ? (
          <FlowPeople program={program} onSaveInputs={props.onSaveInputs} onRenamePerson={props.onRenamePerson} onGoInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }} />
        ) : view === "library" ? (
          <FlowLibrary program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onSaveInputs={props.onSaveInputs} onTagClaim={props.onTagClaim} onComment={props.onComment} onSaveArtifactDoc={props.onSaveArtifactDoc} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }} onGoFlow={() => { setView(lineViewPreferred() ? "line" : "flow"); window.scrollTo({ top: 0 }); }} onRenamePerson={props.onRenamePerson} onRenameRole={props.onRenameRole} />
        ) : view === "mission" ? (
          <FlowMission
            aiStatus={props.aiStatus}
            onOpenAISettings={props.onOpenAISettings}
            program={program}
            fleet={props.fleet}
            loadMovementSpend={props.loadMovementSpend}
            onSetHaltAll={props.onSetHaltAll}
            onToggleAgentHalt={props.onToggleAgentHalt}
            onSetMovementBudget={props.onSetMovementBudget}
            onRestoreSnapshot={props.onRestoreSnapshot}
            autoBuildOn={props.autoBuildOn}
            onToggleAutoBuild={props.onToggleAutoBuild}
          />
        ) : view === "grounding" ? (
          <FlowGrounding program={program} onSaveInputs={props.onSaveInputs} />
        ) : view === "line" ? (
          <TheLine program={program} onSaveInputs={props.onSaveInputs}
            onRenamePerson={props.onRenamePerson} onRenameRole={props.onRenameRole}
            onMintFollowUp={props.onMintFollowUp} onScheduleFollowUp={props.onScheduleFollowUp}
            onRunAgent={props.onRunAgent}
            onRecordGate={props.onRecordGate} onReopenGate={props.onReopenGate} />
        ) : view === "portfolio" ? (
          <FlowPortfolio
            onDeleteProgram={props.onDeleteProgram}
            onRenameProgram={props.onRenameProgram}
            programs={props.programs}
            activeId={program.id}
            onSelectProgram={(id) => { props.onSelectProgram(id); setView(lineViewPreferred() ? "line" : "flow"); window.scrollTo({ top: 0 }); }}
            onHydratePrograms={props.onHydratePrograms}
          />
        ) : (
          <FlowPulse program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onMintBrief={props.onMintBrief} />
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

function FlowToday({ program, programs, onSelectProgram, onResolveDecision, onIngestPortalItem, onDismissPortalItem, onRecordApproval, onGoFlow, onSaveInputs }: {
  program: ProgramSummary;
  programs?: ProgramSummary[];
  onSelectProgram?: (id: string) => void;
  onResolveDecision: FlowShellProps["onResolveDecision"];
  onIngestPortalItem: FlowShellProps["onIngestPortalItem"];
  onDismissPortalItem: FlowShellProps["onDismissPortalItem"];
  onRecordApproval?: FlowShellProps["onRecordApproval"];
  onGoFlow: () => void;
  onSaveInputs?: FlowShellProps["onSaveInputs"];
}) {
  const movements = useMemo(() => flowMovements(), []);
  const open = listOpenFlowDecisions(program);
  const feed = listFlowAttestations(program);
  const inbox = listPortalInbox(program);
  const approvals = listApprovalResponses(program);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Open disputes queue HERE for the operator to ROUTE (to the person who can
  // settle it) or RESOLVE. Resolving writes the resolution to the record as
  // EVIDENCE and deletes the rows — there is no standing resolution log.
  const disputes = useMemo(() => readContradictions(program, true), [program]);
  // Open governed exceptions that require operator interaction now — a logged
  // deviation is a standing decision to revisit, so it queues HERE (not buried
  // in a per-movement Collect panel) until it's resolved or a future review
  // date defers it. Resolving marks it closed on the record.
  const exceptions = useMemo(() => governedExceptionsForInbox(program), [program]);
  const resolveException = async (movementId: string, id: string) => {
    if (!onSaveInputs) return;
    const next = withResolvedException(readGovernedExceptions(program, movementId), id, "", "you");
    setBusyId(id);
    try {
      await onSaveInputs(movementId, { _governedExceptions: JSON.stringify(next) },
        { silent: true, attest: { action: `Governed exception resolved — ${movementId}` } });
    } finally { setBusyId(null); }
  };
  const people = useMemo(() => resolveMovementStakeholders(program, "listen")
    .filter((entry) => !entry.isRole).map((entry) => entry.name), [program]);
  const [disputeBusy, setDisputeBusy] = useState<string | null>(null);
  const listenBucket = () => {
    const inner = getProgramState((program.rawData ?? {}) as Record<string, unknown>).inner as Record<string, unknown>;
    return (typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
      ? (inner.phaseInputs as Record<string, Record<string, unknown>>).listen : undefined) ?? {};
  };
  const resolveDisputeHere = async (row: { statement: string; between: string }) => {
    if (!onSaveInputs) return;
    const statement = row.statement.trim();
    const bucket = listenBucket();
    // Paraphrase-aware: the displayed dispute stands for its near-duplicate
    // variants too — closing it removes them all.
    const next = contradictionLogWithout(program, statement);
    const existing = typeof bucket.interviewTranscripts === "string" ? bucket.interviewTranscripts : "";
    const note = `— Operator resolution, ${new Date().toISOString().slice(0, 10)} —\nDispute (${row.between}): "${statement}"\nSettled: the newer account stands. Recorded as evidence; the dispute is closed.`;
    setDisputeBusy(statement);
    try {
      await onSaveInputs("listen", {
        contradictionLog: next,
        interviewTranscripts: [existing.trimEnd(), note].filter(Boolean).join("\n\n"),
      }, { attest: { action: "Dispute resolved — resolution recorded as evidence", detail: statement.slice(0, 140) } });
    } finally { setDisputeBusy(null); }
  };
  // Roles the operator added that the programme doesn't yet recognise. Like
  // disputes, these are DERIVED from the record — the clarify card is present
  // exactly while a role is unresolved, so it keeps clarifying until the
  // operator maps it (or accepts it as a new programme role) right here.
  const unresolvedRoles = useMemo(() => readDirectoryPeople(program).filter((entry) => !entry.roleResolved), [program]);
  const roleOptions = useMemo(() => knownProgramRoles(program).sort((a, b) => a.localeCompare(b)), [program]);
  // Resolving who Listen will hear is PLAN-level scope, not just a directory
  // patch. Every resolution rides the same fingerprinted `listenPlan` write the
  // Listen-plan editor uses (listenPlanWrite + planRev stamps) in ONE atomic
  // call, so the Discovery Kit goes stale and regenerates against the resolved
  // cast. The directory overlay alone is fingerprint-safe by design — writing
  // only it left the kit permanently blind to accepted roles: "Keep as a new
  // role" changed nothing on the kit, and regeneration couldn't either.
  const savePlanAndDirectory = async (
    busyKey: string,
    nextPeople: unknown[],
    planRoles: (roles: string[]) => string[],
    attest: { action: string; detail?: string },
    listenExtra?: Record<string, string>,
  ) => {
    if (!onSaveInputs) return;
    const plan = readListenPlan(program);
    const { frame, planRev } = listenPlanWrite({ ...plan, roles: [...new Set(planRoles(plan.roles))] });
    setDisputeBusy(busyKey);
    try {
      await onSaveInputs("frame", frame, { attest, extraInputs: {
        listen: { planRev, _directoryPeople: JSON.stringify(nextPeople), ...(listenExtra ?? {}) },
        envision: { planRev },
        show: { planRev },
      } });
    } finally { setDisputeBusy(null); }
  };
  const patchDirectoryPerson = (id: string, patch: Record<string, unknown>, planRole: string, action: string, detail: string) =>
    savePlanAndDirectory(
      id,
      readDirectoryPeople(program).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      (roles) => roles.some((r) => r.trim().toLowerCase() === planRole.trim().toLowerCase()) ? roles : [...roles, planRole],
      { action, detail },
    );
  const mapRole = (id: string, name: string, role: string) =>
    patchDirectoryPerson(id, { role, roleResolved: true }, role, `Role clarified — ${name} → ${role}`, role);
  const acceptRole = (id: string, name: string, role: string) =>
    patchDirectoryPerson(id, { roleResolved: true }, role, `Role accepted as new — ${name} (${role})`, `"${role}" is now a recognised programme role`);
  const removeDirectoryPerson = (id: string, name: string, role: string) => {
    // Mirror the plan editor's remove: drop the entry, dismiss the name AND the
    // role so kit regeneration won't resurrect either as a placeholder.
    const keys = [name, role].map((s) => s.trim().toLowerCase()).filter(Boolean);
    const dismissed = new Set([...dismissedListenRoles(program), ...keys]);
    return savePlanAndDirectory(
      id,
      readDirectoryPeople(program).filter((entry) => entry.id !== id),
      (roles) => roles.filter((r) => !keys.includes(r.trim().toLowerCase())),
      { action: `Person removed — ${name}`, detail: "added in error" },
      { _dismissedListenRoles: JSON.stringify([...dismissed]) },
    );
  };

  // Names written into the kit coverage map that aren't people on the
  // programme — an Inbox item to resolve. Adding routes them into the
  // directory (role clarified there if unfamiliar); "not a person" records a
  // dismissal so a team/function label stops prompting.
  const coverageNames = useMemo(() => unresolvedCoverageNames(program), [program]);
  const addCoverageName = async (name: string, domain: string) => {
    if (!onSaveInputs) return;
    const role = domain || "Contributor";
    const resolved = validateProgramRole(program, role).known;
    const entry = { id: `dp-${Date.now().toString(36)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`, name, role, movementId: "listen", roleResolved: resolved };
    await savePlanAndDirectory(
      name,
      [...readDirectoryPeople(program), entry],
      (roles) => roles.some((r) => r.trim().toLowerCase() === name.trim().toLowerCase()) ? roles : [...roles, name],
      { action: `Person added from coverage — ${name}`, detail: resolved ? role : `${role} — needs clarification` },
    );
  };
  const dismissCoverageName = async (name: string) => {
    if (!onSaveInputs) return;
    const raw = readMovementInputs(program, "listen")._dismissedCoverageNames;
    let list: string[] = [];
    try { const a = typeof raw === "string" ? JSON.parse(raw) : []; list = Array.isArray(a) ? a.map(String) : []; } catch { /* reset */ }
    setDisputeBusy(name);
    try {
      await onSaveInputs("listen", { _dismissedCoverageNames: JSON.stringify([...new Set([...list, name])]) },
        { attest: { action: `Coverage label marked not-a-person — ${name}`, detail: "won't prompt again" } });
    } finally { setDisputeBusy(null); }
  };
  // Coverage names ADD THEMSELVES (operator direction 2026-07-14: do not
  // prompt). One per pass — each write refreshes the programme, which
  // re-fires this effect for the next — with any "— TBC" suffix stripped:
  // the label is a role awaiting a person, and People owns naming them.
  // A wrongly-added entry is removed on the People page in one click.
  const autoCoverageRef = useRef(false);
  useEffect(() => {
    if (!onSaveInputs || autoCoverageRef.current) return;
    const cov = coverageNames[0];
    if (!cov) return;
    autoCoverageRef.current = true;
    const cleanName = cov.name.replace(/\s*[—–−‑-]\s*TBC\s*$/i, "").trim() || cov.name;
    void addCoverageName(cleanName, cov.domain)
      .finally(() => { autoCoverageRef.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverageNames, onSaveInputs]);

  const routeDispute = async (statement: string, person: string) => {
    if (!onSaveInputs || !person) return;
    const rows = parseGridRows(listenBucket().contradictionLog as unknown);
    const next = rows.map((r) => ((r.statement ?? "").trim() === statement.trim() ? { ...r, routedTo: person } : r));
    setDisputeBusy(statement.trim());
    try {
      await onSaveInputs("listen", { contradictionLog: JSON.stringify(next) },
        { attest: { action: `Dispute routed — ${person} settles it`, detail: statement.slice(0, 140) } });
    } finally { setDisputeBusy(null); }
  };
  // The rest of the portfolio's judgment queue — one glance, one tap to switch.
  const elsewhere = (programs ?? [])
    .filter((p) => p.id !== program.id && p.methodology === "atos-flow")
    .map((p) => ({ p, waiting: listOpenFlowDecisions(p).length + listPortalInbox(p).length }))
    .filter((e) => e.waiting > 0);
  const label = (id: string) => spineLabel(id);

  const actOnItem = async (itemId: string, fn: (id: string) => Promise<void>) => {
    setBusyId(itemId);
    try { await fn(itemId); } finally { setBusyId(null); }
  };

  // j/k triage — move focus down/up the queue without touching the mouse.
  const inboxRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (event.key !== "j" && event.key !== "k") return;
      const cards = [...(inboxRef.current?.querySelectorAll<HTMLElement>(".v3fs-dec") ?? [])];
      if (!cards.length) return;
      event.preventDefault();
      const current = cards.findIndex((card) => card === document.activeElement || card.contains(document.activeElement));
      const next = current === -1 ? 0 : event.key === "j" ? Math.min(cards.length - 1, current + 1) : Math.max(0, current - 1);
      cards[next].tabIndex = -1;
      cards[next].focus();
      cards[next].scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // The quiet state must not overclaim: an empty Inbox with stale or
  // still-asking documents is "clear", not "done". Surface each movement
  // whose record needs work (amber only — untouched movements don't nag).
  const attention = useMemo(() => {
    const items: Array<{ movement: string; what: string }> = [];
    for (const movement of movements) {
      const artifacts = movementArtifacts(program, movement);
      const readiness = gateReadiness(program, movement, artifacts, gateChecklist(program, movement, artifacts));
      if (readiness.tone === "amber" && (readiness.kind === "trails" || readiness.kind === "gaps")) {
        items.push({ movement: spineLabel(movement.id), what: readiness.detail ?? readiness.headline });
      }
    }
    // Show validation coverage — an area with demo links out but ZERO recorded
    // verdicts is an open flank on validation, the same way an unheard voice is
    // an open flank on discovery. Validation lives in SHOW; Envision is the
    // delivery team's build studio and carries no client-validation coverage.
    {
      const displayName = spineLabel("show");
      for (const row of movementValidationCoverage(program, "show")) {
        if (row.validated === 0 && row.waiting > 0) {
          items.push({
            movement: displayName,
            what: `${row.area}: demo verdict still open — ${row.waiting} link${row.waiting === 1 ? "" : "s"} waiting`,
          });
        }
      }
    }
    return items;
  }, [program, movements]);

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
      {elsewhere.length && onSelectProgram ? (
        <div className="v3fs-elsewhere" role="note">
          <span className="v3fs-elsewhere-l">Across the portfolio</span>
          {elsewhere.map(({ p, waiting }) => (
            <button key={p.id} type="button" className="v3fs-elsewhere-chip" onClick={() => onSelectProgram(p.id)}>
              <b>{p.name}</b><span>{waiting} waiting</span>
            </button>
          ))}
        </div>
      ) : null}
      {open.length === 0 && inbox.length === 0 && approvals.length === 0 && disputes.length === 0 && unresolvedRoles.length === 0 && coverageNames.length === 0 && exceptions.length === 0 ? (
        <div className="v3fs-quiet">
          <div className="v3fs-quiet-mark" aria-hidden="true">◈</div>
          {attention.length ? (
            <>
              <h2>Inbox is clear.</h2>
              <div className="v3fs-quiet-work">
                {attention.slice(0, 4).map((item, ai) => (
                  <div key={`att-${item.movement}-${ai}`} className="v3fs-quiet-row">
                    <b>{item.movement}</b>
                    <span>{item.what}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="v3fs-btn pri" onClick={onGoFlow}>Review the flow</button>
            </>
          ) : (
            <>
              <h2>Nothing needs you right now.</h2>
              <p>Decisions and quarantined evidence appear here when they need you.</p>
              <button type="button" className="v3fs-btn" onClick={onGoFlow}>Review the flow</button>
            </>
          )}
        </div>
      ) : (
        <section className="v3fs-inbox" aria-label="Waiting on you" ref={inboxRef}>
          <div className="v3fs-ph">
            <h3>Waiting on you</h3>
            <span>{(() => { const n = open.length + inbox.length + approvals.length + disputes.length + unresolvedRoles.length + coverageNames.length + exceptions.length; return `${n} item${n === 1 ? "" : "s"}`; })()}</span>
          </div>
          {open.map((decision) => (
            <DecisionCard key={decision.id} program={program} decision={decision} movementLabel={label(decision.movementId)}
              busy={busyId === decision.id} onResolve={resolve} />
          ))}
          {/* Stale documents do NOT queue here — regeneration lives on the
              ribbon: each movement's "Regeneration required" bar, amber tabs,
              and per-tab Regenerate. The Inbox stays decisions-and-responses. */}
          {inbox.map((item, ii) => (
            <article key={`inbox-${item.id || ii}`} className="v3fs-dec v3fs-evitem">
              <div className="v3fs-dec-top">
                {item.kind === "demo-verdict" ? (
                  <span className={`v3fs-vc ${item.verdict === "rework" ? "pen" : "acc"}`}>{(item.verdict ?? "verdict").replace(/-/g, " ")}</span>
                ) : item.kind === "question" ? (
                  <span className="v3fs-tag ev">question · from the link</span>
                ) : item.kind === "design-feedback" ? (
                  <span className="v3fs-tag ev">design feedback</span>
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
                  : item.kind === "question"
                    ? "a non-design question the app couldn't answer from the design — reply to them on their link, then dismiss"
                    : item.kind === "design-feedback"
                      ? "folds into the Show demo feedback — the Prototype Loop reads it to raise a change request"
                      : `${item.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words${item.documents?.length ? ` · ${item.documents.length} document${item.documents.length === 1 ? "" : "s"} attached` : ""}`}
              </div>
              <div className="v3fs-dec-cta">
                {item.kind !== "question" ? (
                  <button type="button" className="v3fs-btn pri" disabled={busyId === item.id}
                    onClick={() => void actOnItem(item.id, onIngestPortalItem)}>
                    {busyId === item.id ? "Ingesting…" : item.kind === "demo-verdict" ? "Record the verdict" : item.kind === "design-feedback" ? "Fold into design feedback" : "Ingest as evidence"}
                  </button>
                ) : null}
                <button type="button" className="v3fs-btn" disabled={busyId === item.id}
                  onClick={() => void actOnItem(item.id, onDismissPortalItem)}>
                  {item.kind === "question" ? "Mark handled" : "Dismiss"}
                </button>
              </div>
            </article>
          ))}
          {onRecordApproval ? approvals.map((item, ai) => {
            const id = String(item.id ?? "") || `appr-${ai}`;
            const approver = (item.approver && typeof item.approver === "object" ? item.approver : {}) as { name?: string; role?: string };
            const verdict = item.verdict === "approved" ? "approved" : "changes";
            const comment = String(item.comment ?? "").trim();
            const title = String(item.artifactTitle ?? "a document");
            return (
              <article key={id} className="v3fs-dec v3fs-evitem">
                <div className="v3fs-dec-top">
                  <span className={`v3fs-vc ${verdict === "approved" ? "acc" : "pen"}`}>{verdict === "approved" ? "approved" : "changes requested"}</span>
                  <span className="v3fs-dec-mv">{approver.name || "Approver"}{approver.role ? ` · ${approver.role}` : ""}</span>
                  {item.receivedAt ? <span className="v3fs-dec-when">{timeAgo(String(item.receivedAt))}</span> : null}
                </div>
                <h3 className="v3fs-dec-t">{verdict === "approved" ? `Approved — ${title}` : `Changes requested — ${title}`}</h3>
                {comment ? <p className="v3fs-dec-s">“{comment.slice(0, 220)}{comment.length > 220 ? "…" : ""}”</p> : null}
                <div className="v3fs-dec-rec-b">
                  {verdict === "approved"
                    ? "recording marks the artifact approved and files the sign-off as evidence"
                    : "recording returns the artifact to draft with this note attached"}
                </div>
                <div className="v3fs-dec-cta">
                  <button type="button" className="v3fs-btn pri" disabled={busyId === id}
                    onClick={() => void actOnItem(id, onRecordApproval)}>
                    {busyId === id ? "Recording…" : verdict === "approved" ? "Record the approval" : "Record the request"}
                  </button>
                </div>
              </article>
            );
          }) : null}
          {disputes.map((row, i) => (
            <article key={`disp-${i}`} className="v3fs-dec">
              <div className="v3fs-dec-top">
                <span className="v3fs-vc pen">Dispute</span>
                <span className="v3fs-dec-mv">{row.between || "two accounts disagree"}</span>
                {row.routedTo ? <span className="v3fs-tag ev">routed → {row.routedTo}</span> : null}
              </div>
              <p className="v3fs-dec-s">“{row.statement.trim().slice(0, 200)}{row.statement.trim().length > 200 ? "…" : ""}”</p>
              <div className="v3fs-dec-rec-b">resolve writes the resolution to the record as evidence and closes the dispute — or route it to whoever can settle it (it lands on their follow-up script)</div>
              <div className="v3fs-dec-cta">
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn pri" disabled={disputeBusy === row.statement.trim()}
                    onClick={() => void resolveDisputeHere(row)}>
                    {disputeBusy === row.statement.trim() ? "Resolving…" : "✓ Resolve — the newer account stands"}
                  </button>
                ) : null}
                {onSaveInputs && people.length ? (
                  <label className="v3fs-dec-route">
                    route to
                    <select value={row.routedTo ?? ""} aria-label="Route this dispute to a person"
                      disabled={disputeBusy === row.statement.trim()}
                      onChange={(event) => { if (event.target.value) void routeDispute(row.statement, event.target.value); }}>
                      <option value="">choose…</option>
                      {people.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            </article>
          ))}
          {unresolvedRoles.map((person) => (
            <article key={`role-${person.id}`} className="v3fs-dec">
              <div className="v3fs-dec-top">
                <span className="v3fs-vc pen">Role to clarify</span>
                <span className="v3fs-dec-mv">{person.name}{person.movementId ? ` · ${person.movementId.charAt(0).toUpperCase()}${person.movementId.slice(1)}` : ""}</span>
              </div>
              <p className="v3fs-dec-s">&ldquo;{person.role}&rdquo; isn&rsquo;t a role this programme recognises. Map it to a known role, or accept it as a new one — the person can&rsquo;t be placed in coverage until it&rsquo;s settled.</p>
              <div className="v3fs-dec-rec-b">mapping or accepting resolves it; it keeps clarifying until you do</div>
              <div className="v3fs-dec-cta">
                {onSaveInputs ? (
                  <label className="v3fs-dec-route">
                    map to
                    <select defaultValue="" aria-label={`Map ${person.name}'s role to a known role`}
                      disabled={disputeBusy === person.id}
                      onChange={(event) => { if (event.target.value) void mapRole(person.id, person.name, event.target.value); }}>
                      <option value="">choose a known role…</option>
                      {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                ) : null}
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn" disabled={disputeBusy === person.id}
                    onClick={() => void acceptRole(person.id, person.name, person.role)}>
                    {disputeBusy === person.id ? "Saving…" : `✓ Keep "${person.role}" as a new role`}
                  </button>
                ) : null}
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn quiet" disabled={disputeBusy === person.id}
                    onClick={() => void removeDirectoryPerson(person.id, person.name, person.role)}>Remove</button>
                ) : null}
              </div>
            </article>
          ))}
          {coverageNames.map((cov, ci) => (
            <article key={`cov-${cov.name || ci}`} className="v3fs-dec">
              <div className="v3fs-dec-top">
                <span className="v3fs-vc pen">Identify person</span>
                <span className="v3fs-dec-mv">{cov.domain || "Discovery Kit coverage"}</span>
              </div>
              <p className="v3fs-dec-s">&ldquo;{cov.name}&rdquo; is listed in the Discovery Kit coverage but isn&rsquo;t a person on the programme yet. Add them to People, or mark it as a team/function label.</p>
              <div className="v3fs-dec-rec-b">adding routes them into People (their role is clarified there if it&rsquo;s unfamiliar)</div>
              <div className="v3fs-dec-cta">
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn pri" disabled={disputeBusy === cov.name}
                    onClick={() => void addCoverageName(cov.name, cov.domain)}>
                    {disputeBusy === cov.name ? "Adding…" : `✓ Add ${cov.name} to People`}
                  </button>
                ) : null}
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn quiet" disabled={disputeBusy === cov.name}
                    onClick={() => void dismissCoverageName(cov.name)}>Not a person</button>
                ) : null}
              </div>
            </article>
          ))}
          {exceptions.map((ex) => (
            <article key={`gex-${ex.id}`} className="v3fs-dec">
              <div className="v3fs-dec-top">
                <span className={`v3fs-vc ${ex.overdue ? "pen" : "acc"}`}>⚖ Governed exception</span>
                <span className="v3fs-dec-mv">{label(ex.movementId)}</span>
                {ex.overdue ? <span className="v3fs-tag ev">review overdue{ex.reviewBy ? ` · ${ex.reviewBy}` : ""}</span>
                  : ex.reviewBy ? <span className="v3fs-tag ev">review due</span> : null}
              </div>
              <h3 className="v3fs-dec-t">{ex.scope}</h3>
              <p className="v3fs-dec-s">{ex.justification}</p>
              <div className="v3fs-dec-rec-b">
                {ex.basis ? `${ex.basis} · ` : ""}logged {(ex.createdAt || "").slice(0, 10)} by {ex.createdBy} — resolving marks the deviation closed on the record
              </div>
              <div className="v3fs-dec-cta">
                {onSaveInputs ? (
                  <button type="button" className="v3fs-btn pri" disabled={busyId === ex.id}
                    onClick={() => void resolveException(ex.movementId, ex.id)}>
                    {busyId === ex.id ? "Resolving…" : "✓ Mark resolved"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}

    </div>
  );
}

/* ── Tracks: the build as demoable workstreams; acceptance is earned ─────── */

/* ── Mission Control: the fleet, the budgets, the levers, the trail ──────── */

function FlowMission({ program, fleet, loadMovementSpend, onSetHaltAll, onToggleAgentHalt, onSetMovementBudget, onRestoreSnapshot, aiStatus, onOpenAISettings, autoBuildOn, onToggleAutoBuild }: {
  program: ProgramSummary;
  fleet: FlowShellProps["fleet"];
  loadMovementSpend: FlowShellProps["loadMovementSpend"];
  onSetHaltAll: FlowShellProps["onSetHaltAll"];
  onToggleAgentHalt: FlowShellProps["onToggleAgentHalt"];
  onSetMovementBudget: FlowShellProps["onSetMovementBudget"];
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
  aiStatus?: string;
  onOpenAISettings?: () => void;
  autoBuildOn?: boolean;
  onToggleAutoBuild?: () => void;
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

      {(() => {
        const connected = aiStatus === "connected" || aiStatus === "ready" || aiStatus === "online";
        const checking = aiStatus === "checking" || aiStatus === undefined;
        const tone = connected ? "ok" : checking ? "warn" : "off";
        const label = connected ? "AI provider connected" : checking ? "Checking AI provider…" : "AI provider not connected";
        return (
          <button type="button" className={`v3fs-aichip ${tone}`} onClick={() => onOpenAISettings?.()}
            title="AI runs every generator — open provider settings">
            <span className="v3fs-aichip-dot" aria-hidden="true" />
            <span className="v3fs-aichip-l">{label}</span>
            <span className="v3fs-aichip-cta">{connected ? "Check →" : "Connect →"}</span>
          </button>
        );
      })()}

      <div className="v3fs-grid2">
        <div className="v3fs-panel">
          <div className="v3fs-ph"><h3>Fleet</h3><span>the complete roster — live status, hold/resume per agent</span></div>
          {(() => {
            // The COMPLETE fleet: every agent the programme can run, plus any
            // id currently in flight or held that the registry doesn't list
            // (watchers, planners). Ordered along the methodology spine —
            // Frame's agents first, then Listen, Envision, Show, Ship, Evolve;
            // unmapped ids (planner, watchers) close the list. Within a
            // movement: running, then held, then ready.
            const runByAgent = new Map<string, { status: string; phaseId?: string }>();
            for (const run of fleet) if (!runByAgent.has(run.agentId)) runByAgent.set(run.agentId, run);
            const movementOf = new Map<string, number>();
            movements.forEach((movement, index) => {
              for (const artifact of movementArtifacts(program, movement)) {
                if (!movementOf.has(artifact.id)) movementOf.set(artifact.id, index);
              }
            });
            const roster = [...new Set([...agentIds, ...fleet.map((run) => run.agentId), ...governance.haltedAgents])];
            const stateOf = (agentId: string): "running" | "held" | "ready" =>
              runByAgent.has(agentId) ? "running" : governance.haltedAgents.includes(agentId) ? "held" : "ready";
            const order = { running: 0, held: 1, ready: 2 } as const;
            const spineIndex = (agentId: string) => movementOf.get(agentId) ?? movements.length;
            roster.sort((a, b) => spineIndex(a) - spineIndex(b) || order[stateOf(a)] - order[stateOf(b)] || a.localeCompare(b));
            const runningCount = roster.filter((agentId) => stateOf(agentId) === "running").length;
            const renderAgent = (agentId: string) => {
              const state = stateOf(agentId);
              const run = runByAgent.get(agentId);
              const halted = governance.haltedAgents.includes(agentId);
              const mv = movements[movementOf.get(agentId) ?? -1];
              const movementName = mv ? spineLabel(mv.id, { distinct: true }) : "Programme-wide";
              return (
                <div key={agentId} className="v3fs-row">
                  {state === "running"
                    ? <span className="v3fs-gdot" aria-hidden="true" />
                    : <span className={`v3fs-fdot ${state}`} aria-hidden="true" />}
                  <div className="v3fs-row-g">
                    <div className="v3fs-row-n">{agentId}</div>
                    <div className="v3fs-row-m">
                      {state === "running" ? [movementName, run?.status || "running"].filter(Boolean).join(" · ")
                        : state === "held" ? `${movementName} · held — new runs are blocked`
                          : `${movementName} · ready`}
                    </div>
                  </div>
                  <span className="v3fs-tag gn">tier {flowAgentTier(agentId)}</span>
                  <button type="button" className={`v3fs-btn${halted ? " pri" : ""}`} disabled={busy}
                    title={halted ? "Resume — allow this agent to run again"
                      : state === "running" ? "Hold — the current run finishes; new runs are blocked until resumed"
                        : "Hold — block this agent's runs until resumed"}
                    onClick={() => void act(() => onToggleAgentHalt(agentId, !halted))}>
                    {halted ? "Resume" : "Hold"}
                  </button>
                </div>
              );
            };
            // Grouped by PHASE into collapsible sections — the fleet reads as the
            // methodology spine, each phase's agents folded until you open it.
            const groupIdx = [...new Set(roster.map(spineIndex))].sort((a, b) => a - b);
            const groupLabel = (idx: number) => { const mv = movements[idx]; return mv ? spineLabel(mv.id, { distinct: true }) : "Programme-wide"; };
            return (
              <>
                {runningCount === 0 ? <div className="v3fs-empty">The fleet is idle — every agent below is ready to run.</div> : null}
                {groupIdx.map((idx) => {
                  const group = roster.filter((a) => spineIndex(a) === idx);
                  const running = group.filter((a) => stateOf(a) === "running").length;
                  const held = group.filter((a) => stateOf(a) === "held").length;
                  return (
                    <details key={idx} className="v3fs-ctl-group">
                      <summary className="v3fs-ctl-group-h">
                        <span className="v3fs-ctl-group-t">{groupLabel(idx)}</span>
                        <span className="v3fs-ctl-group-n">{group.length}</span>
                        {running ? <span className="v3fs-ctl-group-run">● {running} running</span> : null}
                        {held ? <span className="v3fs-ctl-group-held">{held} held</span> : null}
                        <span className="v3fs-ctl-group-caret" aria-hidden="true">▾</span>
                      </summary>
                      <div className="v3fs-ctl-group-b">{group.map(renderAgent)}</div>
                    </details>
                  );
                })}
              </>
            );
          })()}
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
                  <b>{spineLabel(movement.id, { distinct: true })}</b>
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
                  <span className="v3fs-budget-edit-l">{spineLabel(movement.id, { distinct: true })}</span>
                  <input
                    inputMode="numeric"
                    placeholder="tokens · 0 removes"
                    value={capDrafts[movement.id] ?? ""}
                    onChange={(e) => setCapDrafts((d) => ({ ...d, [movement.id]: e.target.value.replace(/[^0-9]/g, "") }))}
                    aria-label={`${spineLabel(movement.id, { distinct: true })} budget cap`}
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
        {onToggleAutoBuild ? (
          <div className="v3fs-guard-row">
            <div className="v3fs-row-g">
              <div className="v3fs-row-n">Auto-build artifacts on input</div>
              <div className="v3fs-row-m">off by default — evidence stales the affected artifacts and waits for you to press Regenerate. When on, AURA regenerates them automatically as soon as their inputs arrive.</div>
            </div>
            <button type="button" role="switch" aria-checked={!!(autoBuildOn ?? autoBuildEnabled(program))}
              className={`v3fs-switch${(autoBuildOn ?? autoBuildEnabled(program)) ? " on" : ""}`} disabled={busy}
              title={(autoBuildOn ?? autoBuildEnabled(program)) ? "Turn off hands-off generation" : "Turn on hands-off generation"}
              onClick={() => void act(async () => { onToggleAutoBuild?.(); })}>
              <span className="v3fs-switch-dot" aria-hidden="true" />
              <span className="v3fs-switch-lbl">{(autoBuildOn ?? autoBuildEnabled(program)) ? "On" : "Off"}</span>
            </button>
          </div>
        ) : null}
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

type PfTone = "here" | "watch" | "clear";
/** A programme and the engagements cloned from it, nested. */
interface PfNode { entry: ProgramSummary; ordinal: number; children: PfNode[]; }
interface PfStats { days: number | null; decisions: number; inbox: number; tracksTotal: number; stalled: number; heard: number; total: number; pct: number | null; needsYou: number; }

function computePfStats(entry: ProgramSummary): PfStats {
  const decisions = listOpenFlowDecisions(entry).length;
  const inbox = listPortalInbox(entry).length;
  const tracks = listFlowTracks(entry);
  const stalled = tracks.filter((t) => trackPace(t, trackAcceptance(t).accepted).tone === "stalled").length;
  const coverage = listenCoverage(entry);
  return {
    days: daysToFirstDemo(entry), decisions, inbox,
    tracksTotal: tracks.length, stalled,
    heard: coverage.done, total: coverage.total,
    pct: coverage.total ? Math.round((coverage.done / coverage.total) * 100) : null,
    needsYou: decisions + inbox,
  };
}

/**
 * Build the engagement forest: each programme nests under the one it was cloned
 * from ("New from this programme"). The parent link is read from the stored
 * `lineage.parentId`; older clones that predate that field fall back to their
 * "Started from …" attestation matched by name. Roots keep newest-first order;
 * `ordinal` numbers follow-ons within a chain (Engagement 2, 3, …).
 */
function buildLineageForest(programmes: ProgramSummary[]): PfNode[] {
  const byId = new Map(programmes.map((p) => [p.id, p]));
  const byName = new Map<string, ProgramSummary>();
  for (const p of programmes) if (!byName.has(p.name)) byName.set(p.name, p);

  const parentOf = new Map<string, string | null>();
  for (const p of programmes) {
    const inner = getProgramState((p.rawData ?? {}) as Record<string, unknown>).inner as Record<string, unknown>;
    const lineage = inner.lineage as { parentId?: string } | undefined;
    let parentId: string | null =
      lineage?.parentId && lineage.parentId !== p.id && byId.has(lineage.parentId) ? lineage.parentId : null;
    if (!parentId) {
      const att = listFlowAttestations(p).find((a) => a.action.startsWith("Started from "));
      if (att) {
        const parent = byName.get(att.action.slice("Started from ".length).trim());
        if (parent && parent.id !== p.id) parentId = parent.id;
      }
    }
    parentOf.set(p.id, parentId);
  }

  // A parent link that loops back onto its own descendant is dropped to a root.
  const createsCycle = (childId: string, parentId: string): boolean => {
    let cur: string | null = parentId; const guard = new Set<string>();
    while (cur) { if (cur === childId || guard.has(cur)) return true; guard.add(cur); cur = parentOf.get(cur) ?? null; }
    return false;
  };

  const nodes = new Map<string, PfNode>(programmes.map((p) => [p.id, { entry: p, ordinal: 0, children: [] }]));
  const roots: PfNode[] = [];
  for (const p of programmes) {
    const pid = parentOf.get(p.id);
    if (pid && nodes.has(pid) && !createsCycle(p.id, pid)) nodes.get(pid)!.children.push(nodes.get(p.id)!);
    else roots.push(nodes.get(p.id)!);
  }
  for (const node of nodes.values()) node.children.forEach((child, i) => { child.ordinal = i + 1; });
  return roots;
}

/** Flatten the forest depth-first, carrying each node's depth. */
function flattenForest(roots: PfNode[]): Array<{ node: PfNode; depth: number }> {
  const out: Array<{ node: PfNode; depth: number }> = [];
  const walk = (n: PfNode, depth: number) => { out.push({ node: n, depth }); n.children.forEach((c) => walk(c, depth + 1)); };
  roots.forEach((r) => walk(r, 0));
  return out;
}

const PF_FILTERS: Array<[PfTone | "all", string]> = [["all", "All"], ["watch", "Needs you"], ["clear", "On track"], ["here", "Active"]];

function FlowPortfolio({ programs, activeId, onSelectProgram, onHydratePrograms, onDeleteProgram, onRenameProgram }: {
  programs: ProgramSummary[];
  activeId: string;
  onSelectProgram: (id: string) => void;
  onHydratePrograms: () => Promise<void>;
  onDeleteProgram?: (id: string) => void;
  onRenameProgram?: (id: string, name: string) => void | Promise<void>;
}) {
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [query, setQuery] = useState("");
  // Multi-select status filter — empty set means "All".
  const [activeFilters, setActiveFilters] = useState<Set<PfTone>>(new Set());
  // Which cards are open. Default is all-collapsed, so this tracks the exceptions.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Non-active programmes arrive metadata-only; the numbers need blobs.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let alive = true;
    void onHydratePrograms().then(() => { if (alive) setHydrated(true); }).catch(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [onHydratePrograms]);

  const flowProgrammes = useMemo(() => programs.filter((entry) => entry.methodology === "atos-flow"), [programs]);
  const classicCount = programs.length - flowProgrammes.length;
  const forest = useMemo(() => buildLineageForest(flowProgrammes), [flowProgrammes]);
  const statsById = useMemo(() => {
    const m = new Map<string, PfStats>();
    for (const p of flowProgrammes) m.set(p.id, computePfStats(p));
    return m;
  }, [flowProgrammes]);

  const toneOf = (entry: ProgramSummary): PfTone =>
    entry.id === activeId ? "here" : (statsById.get(entry.id)?.needsYou ?? 0) > 0 ? "watch" : "clear";

  const counts: Record<PfTone | "all", number> = { all: flowProgrammes.length, here: 0, watch: 0, clear: 0 };
  for (const p of flowProgrammes) counts[toneOf(p)] += 1;

  const allExpanded = flowProgrammes.length > 0 && flowProgrammes.every((p) => expanded.has(p.id));
  const toggleCard = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setExpanded(allExpanded ? new Set() : new Set(flowProgrammes.map((p) => p.id)));
  const toggleFilter = (tone: PfTone) => setActiveFilters((prev) => {
    const next = new Set(prev);
    if (next.has(tone)) next.delete(tone); else next.add(tone);
    return next;
  });
  const startRename = (entry: ProgramSummary) => { setEditingId(entry.id); setDraftName(entry.name); };
  const commitRename = (id: string) => {
    const name = draftName.trim();
    setEditingId(null);
    if (name) void onRenameProgram?.(id, name);
  };

  const renderCard = (entry: ProgramSummary, depth: number, ordinal: number, childCount: number, nested: boolean) => {
    const s = statsById.get(entry.id) ?? computePfStats(entry);
    const tone = toneOf(entry);
    const active = entry.id === activeId;
    const isCollapsed = !expanded.has(entry.id);
    const isEditing = editingId === entry.id;
    const childAnchor = depth > 0 ? readDrillAnchor(entry) : null;
    const headId = `pf-${entry.id}`;
    return (
      <article key={entry.id} className={`v3fs-pf-card ${tone}${nested && depth > 0 ? " child" : ""}${isCollapsed && !isEditing ? " collapsed" : ""}`}>
        <span className="v3fs-pf-stripe" aria-hidden="true" />
        <div className="v3fs-pf-body">
          {isEditing ? (
            <div className="v3fs-pf-editrow">
              <span className="v3fs-pf-eyebrow sm">{depth > 0 ? "Rename engagement" : (entry.client || "Rename programme")}</span>
              <div className="v3fs-pf-editrow-i">
                <input className="v3fs-pf-rename" value={draftName} autoFocus aria-label="Programme name"
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(entry.id); if (e.key === "Escape") setEditingId(null); }} />
                <button type="button" className="v3fs-btn pri" disabled={!draftName.trim()} onClick={() => commitRename(entry.id)}>Save</button>
                <button type="button" className="v3fs-btn" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="v3fs-pf-head" role="button" tabIndex={0} aria-label={`Open ${entry.name}`}
              onClick={() => onSelectProgram(entry.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectProgram(entry.id); } }}>
              <span className="v3fs-pf-id">
                <span className="v3fs-pf-eyebrow sm">
                  {depth > 0
                    ? <><span className="v3fs-lineage-tick" aria-hidden="true">↳</span>{childAnchor
                        ? `Drill-down · ${drillKindMeta(childAnchor.kind).noun}`
                        : <>Engagement {depth + 1}{ordinal > 1 ? String.fromCharCode(96 + ordinal) : ""}</>}</>
                    : (entry.client || "Programme")}
                </span>
                <span className="v3fs-pf-nrow">
                  <span className="v3fs-pf-name">{entry.name}</span>
                  {onRenameProgram ? (
                    <button type="button" className="v3fs-pf-edit" aria-label={`Rename ${entry.name}`} title="Rename"
                      onClick={(e) => { e.stopPropagation(); startRename(entry); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                  ) : null}
                </span>
              </span>
              <span className="v3fs-pf-head-r">
                {isCollapsed ? (
                  <span className="v3fs-pf-mini">
                    {s.days != null ? `${s.days}d to demo` : "no demo date"}{s.total ? ` · ${s.heard}/${s.total} heard` : ""}
                  </span>
                ) : null}
                <span className={`v3fs-pf-status ${tone}`}>
                  {active ? "You are here" : s.needsYou > 0 ? `${s.needsYou} waiting` : "On track"}
                </span>
                <button type="button" className="v3fs-pf-chev" aria-label={isCollapsed ? "Show details" : "Hide details"}
                  aria-expanded={!isCollapsed} aria-controls={`${headId}-detail`}
                  onClick={(e) => { e.stopPropagation(); toggleCard(entry.id); }}>⌄</button>
              </span>
            </div>
          )}

          {!isCollapsed || isEditing ? (
            <div className="v3fs-pf-detail" id={`${headId}-detail`}>
              <div className="v3fs-pf-stats">
                <div className="v3fs-pf-stat">
                  <b>{s.days != null ? s.days : "—"}</b>
                  <small>{s.days != null ? "days to demo" : "no demo date"}</small>
                </div>
                <div className="v3fs-pf-stat">
                  <b>{s.heard}<i>/{s.total || "?"}</i></b>
                  <small>stakeholders heard</small>
                  {s.pct != null ? <span className="v3fs-pf-bar"><span style={{ width: `${s.pct}%` }} /></span> : null}
                </div>
                <div className="v3fs-pf-stat">
                  <b>{s.tracksTotal ? (s.stalled || s.tracksTotal) : "—"}</b>
                  <small>{s.tracksTotal ? (s.stalled ? `stalled of ${s.tracksTotal}` : "tracks on pace") : "no tracks yet"}</small>
                </div>
              </div>

              {s.decisions || s.inbox || childCount > 0 || childAnchor ? (
                <div className="v3fs-pf-flags">
                  {childAnchor ? <span className="v3fs-pf-chip anchor">◇ {childAnchor.label}</span> : null}
                  {s.decisions ? <span className="v3fs-pf-chip dec">{s.decisions} decision{s.decisions === 1 ? "" : "s"}</span> : null}
                  {s.inbox ? <span className="v3fs-pf-chip q">{s.inbox} in quarantine</span> : null}
                  {childCount > 0 ? <span className="v3fs-pf-chip line">{childCount} drill-down{childCount === 1 ? "" : "s"}</span> : null}
                </div>
              ) : null}

              <div className="v3fs-pf-cta">
                <button type="button" className="v3fs-btn pri" disabled={active}
                  onClick={() => onSelectProgram(entry.id)}>
                  {active ? "You are here" : "Open programme"}
                </button>
                {onDeleteProgram ? (
                  armedDelete === entry.id ? (
                    <span className="v3fs-pf-arm">
                      <span className="v3fs-pf-arm-q">Archive this programme?</span>
                      <button type="button" className="v3fs-btn danger" onClick={() => { setArmedDelete(null); onDeleteProgram(entry.id); }}>Archive</button>
                      <button type="button" className="v3fs-btn" onClick={() => setArmedDelete(null)}>Keep</button>
                    </span>
                  ) : (
                    <button type="button" className="v3fs-btn quiet" title="Archive — hides it from the list, keeps the record"
                      onClick={() => setArmedDelete(entry.id)}>Archive</button>
                  )
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  // In "All" the forest nests; a status filter flattens (a tree with holes reads worse).
  const renderNode = (node: PfNode, depth: number): React.ReactNode => (
    <React.Fragment key={node.entry.id}>
      {renderCard(node.entry, depth, node.ordinal, node.children.length, true)}
      {node.children.length ? <div className="v3fs-pf-children">{node.children.map((c) => renderNode(c, depth + 1))}</div> : null}
    </React.Fragment>
  );
  // Search (name/client) and a multi-select status filter. Either one flattens
  // the list — a nested tree with holes reads worse than a clean flat result.
  const q = query.trim().toLowerCase();
  const matchesQuery = (e: ProgramSummary) => !q || `${e.name} ${e.client ?? ""}`.toLowerCase().includes(q);
  const isFlat = activeFilters.size > 0 || q.length > 0;
  const filtered = isFlat
    ? flattenForest(forest).filter(({ node }) =>
        (activeFilters.size === 0 || activeFilters.has(toneOf(node.entry))) && matchesQuery(node.entry))
    : [];
  const filterWords = PF_FILTERS.filter(([k]) => k !== "all" && activeFilters.has(k as PfTone)).map(([, l]) => l.toLowerCase()).join(" or ");
  const emptyMsg = q
    ? `No programmes match “${query.trim()}”${filterWords ? ` in ${filterWords}` : ""}.`
    : `No programmes are ${filterWords}.`;

  return (
    <div className="v3fs-pf">
      <div className="v3fs-pf-toolbar">
        <div className="v3fs-pf-search-wrap">
          <svg className="v3fs-pf-search-i" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
          <input className="v3fs-pf-search" type="search" placeholder="Search programmes by name or client…"
            value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search programmes" />
        </div>
        <div className="v3fs-pf-toolbar-row">
          <div className="v3fs-pf-filters" role="group" aria-label="Filter programmes by status">
            {PF_FILTERS.map(([key, label]) => {
              const on = key === "all" ? activeFilters.size === 0 : activeFilters.has(key as PfTone);
              return (
                <button key={key} type="button" role="checkbox" aria-checked={on}
                  className={`v3fs-pf-filter${on ? " on" : ""}`}
                  onClick={() => key === "all" ? setActiveFilters(new Set()) : toggleFilter(key as PfTone)}>
                  {label}<span className="v3fs-pf-filter-n">{counts[key]}</span>
                </button>
              );
            })}
          </div>
          {flowProgrammes.length > 1 ? (
            <button type="button" className="v3fs-pf-expand" onClick={toggleAll}>
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          ) : null}
        </div>
      </div>

      {!hydrated ? <div className="v3fs-empty">Loading every programme&rsquo;s record…</div> : null}
      <div className="v3fs-pf-list">
        {!isFlat
          ? forest.map((node) => renderNode(node, 0))
          : filtered.length
            ? filtered.map(({ node, depth }) => renderCard(node.entry, depth, node.ordinal, node.children.length, false))
            : <div className="v3fs-empty">{emptyMsg}</div>}
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

/* ── People — the programme-wide directory, its own destination ─────────── */
/** One normalized identity for a person or role, used to dedup the People page
 * across its four sources. Strips a trailing "— TBC", parentheticals, and
 * slashes, then collapses to lowercase alphanumerics — so "Sales / Head of
 * Sales", "Sales (Head of Sales)" and "sales head of sales" are one identity,
 * and "Recruitment Ops — TBC" matches "Recruitment Ops". */
const peopleIdentity = (value: string): string =>
  value.trim().toLowerCase()
    .replace(/\s*[—–−‑-]\s*tbc\s*$/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[/|]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Phase order for grouping delivery roles on the People page.
function FlowPeople({ program, onSaveInputs, onRenamePerson, onGoInbox }: { program: ProgramSummary; onSaveInputs?: FlowShellProps["onSaveInputs"]; onRenamePerson?: FlowShellProps["onRenamePerson"]; onGoInbox?: () => void }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  // The FULL Listen roster — including role placeholders ("Recruitment
  // Operations Staff — TBC"): a role awaiting a person is still someone the
  // programme must collect from, so it appears here with a bind-name input
  // instead of silently vanishing from the People page.
  // "Heard" uses the SAME source as the collect board and the People matrix —
  // stakeholderCollection over Listen evidence + packs — so the three surfaces
  // never disagree (a naive name-substring match false-positived on collisions
  // and ignored open follow-ups).
  const listenEvidence = useMemo(() => { const m = flowMovements().find((x) => x.id === "listen"); return m ? movementEvidence(program, m) : []; }, [program]);
  const listenPacks = useMemo(() => listInterviewPacks(program), [program]);
  const roster = useMemo(() => resolveMovementStakeholders(program, "listen")
    .map((entry) => ({
      where: "Listen roster",
      isRole: entry.isRole,
      name: entry.isRole ? "" : entry.name,
      role: entry.role || entry.name,
      email: entry.isRole ? null : stakeholderEmail(program, entry.name),
      heard: !entry.isRole && stakeholderCollection("listen", entry, listenPacks, listenEvidence).heard,
    })), [program, listenPacks, listenEvidence]);
  const roles = useMemo(() => deliveryRoleDirectory(program).map((entry) => ({
    where: entry.movementId.charAt(0).toUpperCase() + entry.movementId.slice(1),
    name: entry.bound?.name ?? "", role: entry.role,
    email: entry.bound?.name ? (entry.bound.email ?? stakeholderEmail(program, entry.bound.name)) : null,
    bound: !!entry.bound?.name, isSponsor: entry.isSponsor,
  })), [program]);
  const added = useMemo(() => readDirectoryPeople(program), [program]);
  // The kit's FULL persona cast — every role the discovery inventoried,
  // internal and external, spoken-for or not — so no role lives only inside
  // the kit document. Roles already surfaced as roster rows are not repeated.
  const personas = useMemo(() => {
    // Exclude any persona already surfaced elsewhere — as a roster row, a
    // delivery role, or an operator-added person — matched by ROLE and by NAME
    // through the ONE shared identity so "Patient Experience and Enrollment —
    // TBC", "Patient Experience and Enrollment" and "Patient Experience &
    // Enrollment" all collapse to a single row.
    const known = new Set<string>();
    for (const e of resolveMovementStakeholders(program, "listen")) {
      if (e.role) known.add(peopleIdentity(e.role));
      if (e.name) known.add(peopleIdentity(e.name));
    }
    for (const r of deliveryRoleDirectory(program)) {
      known.add(peopleIdentity(r.role));
      if (r.bound?.name) known.add(peopleIdentity(r.bound.name));
    }
    for (const p of readDirectoryPeople(program)) {
      if (p.role) known.add(peopleIdentity(p.role));
      if (p.name) known.add(peopleIdentity(p.name));
    }
    return kitPersonaDirectory(program).filter((persona) => !known.has(peopleIdentity(persona.name)));
  }, [program]);
  // Cross-source dedup for NAMED people: the same person must appear once, in
  // their richest row. The Listen roster (carries heard-state + email) outranks
  // a delivery-role binding, which outranks an operator-added row. Role
  // placeholders (no name) are never collapsed — a role awaiting a person still
  // needs to show. This kills the "same person listed 2–4 times" class.
  const dedup = useMemo(() => {
    // A role STAND-IN is a row that names no real person: an unbound placeholder,
    // or an entry whose "name" is just the role echoed back (an operator-added
    // "GTM Sales" that stands for the role, not a person). People outrank roles —
    // so once a role has a REAL named holder, its leftover stand-in rows are noise.
    // Collapsing them kills the "same role listed twice" the People page showed
    // (a named "Head of IT" beside an unbound "IT Architect"; "Prakash T M" beside
    // a bare "GTM Sales") without ever hiding a genuine second person in that role.
    const isStandIn = (name: string, role: string) => {
      const n = peopleIdentity(name);
      return !n || n === peopleIdentity(role);
    };
    const covered = new Set<string>();
    for (const r of roster) if (!r.isRole && !isStandIn(r.name, r.role)) covered.add(peopleIdentity(r.role));
    for (const r of roles) if (r.name && !isStandIn(r.name, r.role)) covered.add(peopleIdentity(r.role));
    for (const p of added) if (!isStandIn(p.name, p.role)) covered.add(peopleIdentity(p.role));

    const seen = new Set<string>();
    const claim = (name: string) => {
      const k = peopleIdentity(name);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    };
    // Keep at most ONE stand-in per role, and none once a real person owns it.
    // Evaluated in render order (added → roster → roles) so the first stand-in
    // for a role wins and the rest — the second "Legal", the leftover unbound
    // placeholder beside a bound person — drop.
    const seenStandInRole = new Set<string>();
    const keepStandIn = (role: string) => {
      const rk = peopleIdentity(role);
      if (!rk || covered.has(rk) || seenStandInRole.has(rk)) return false;
      seenStandInRole.add(rk);
      return true;
    };
    const addedD = added.filter((p) => (isStandIn(p.name, p.role) ? keepStandIn(p.role) : claim(p.name)));
    const rosterD = roster.filter((r) => {
      if (r.isRole || isStandIn(r.name, r.role)) return keepStandIn(r.role);
      return claim(r.name);
    });
    const rolesD = roles.filter((r) => {
      if (!r.name || isStandIn(r.name, r.role)) return keepStandIn(r.role);
      return claim(r.name);
    });
    return { rosterD, addedD, rolesD };
  }, [roster, added, roles]);
  // Remove a ROLE from the cast (operator judgement, attested). Named people
  // are never removed this way — people outrank roles.
  const removeRole = async (role: string) => {
    if (!onSaveInputs || !role.trim()) return;
    const raw = readMovementInputs(program, "listen")._dismissedListenRoles;
    let list: string[] = [];
    try { const parsed = typeof raw === "string" ? JSON.parse(raw) : []; list = Array.isArray(parsed) ? parsed.map(String) : []; } catch { /* reset */ }
    setBusyRow(`role-rm:${role}`);
    try {
      await onSaveInputs("listen", { _dismissedListenRoles: JSON.stringify([...new Set([...list, role.trim()])]) },
        { attest: { action: `Role removed from the cast — ${role}`, detail: "operator judgement; regeneration will not resurrect it" } });
    } finally { setBusyRow(null); }
  };

  // Add a person + role. The role is validated against the programme; a known
  // role lands resolved, an unfamiliar one lands UNRESOLVED and surfaces in the
  // Inbox to clarify (it keeps clarifying until the operator settles it there).
  const MOVEMENTS = ["listen", "envision", "show", "ship", "evolve"];
  const [form, setForm] = useState({ name: "", role: "", email: "", movementId: "listen" });
  const [addBusy, setAddBusy] = useState(false);
  const [lastAdd, setLastAdd] = useState<{ name: string; resolved: boolean } | null>(null);
  const addPerson = async () => {
    const name = form.name.trim(); const role = form.role.trim();
    if (!name || !role || !onSaveInputs) return;
    const resolved = validateProgramRole(program, role).known;
    const entry = {
      id: `dp-${Date.now().toString(36)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
      name, role, email: form.email.trim() || undefined, movementId: form.movementId, roleResolved: resolved,
    };
    setAddBusy(true);
    try {
      // Add the person, and — one contact store — bind any address into
      // `_roleBindings` on their movement in the same write, so sends and the
      // gate resolve it immediately regardless of whether the role is known.
      const rb = readRoleBindings(program, form.movementId);
      if (entry.email) rb[name] = { name, email: entry.email };
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify([...readDirectoryPeople(program), entry]) }, {
        attest: { action: `Person added — ${name} (${role})`, detail: resolved ? "role recognised" : "role needs clarification — routed to the Inbox" },
      });
      if (entry.email) await onSaveInputs(form.movementId, { _roleBindings: JSON.stringify(rb) }, { silent: true });
      setLastAdd({ name, resolved });
      setForm({ name: "", role: "", email: "", movementId: form.movementId });
    } finally { setAddBusy(false); }
  };

  // ── Reconcile with the Discovery Kit ─────────────────────────────────────
  // The kit is the cast's source of truth. One explicit gesture makes this
  // page mirror it: internal personas the kit lists but People doesn't gain a
  // row; operator-added Listen rows the kit no longer knows are removed.
  // External personas stay display-only — they're heard through whoever faces
  // them, not interviewed. ONE batched write; counts shown before and after.
  const kitIdentity = useMemo(() => {
    const s = new Set<string>();
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = (typeof raw.data === "object" && raw.data !== null ? raw.data : raw) as Record<string, unknown>;
    const kit = inner.discoveryKit;
    if (kit && typeof kit === "object" && !Array.isArray(kit)) {
      const k = kit as Record<string, unknown>;
      for (const iv of Array.isArray(k.interviews) ? k.interviews : []) {
        if (!iv || typeof iv !== "object") continue;
        const row = iv as Record<string, unknown>;
        for (const v of [row.role, row.stakeholder]) { const id = peopleIdentity(String(v ?? "")); if (id) s.add(id); }
      }
      for (const p of Array.isArray(k.personas) ? k.personas : []) {
        if (!p || typeof p !== "object") continue;
        const id = peopleIdentity(String((p as Record<string, unknown>).name ?? "")); if (id) s.add(id);
      }
    }
    // People added on the kit's coverage matrix are part of the kit too.
    for (const r of readListenPlan(program).roles) { const id = peopleIdentity(r); if (id) s.add(id); }
    return s;
  }, [program]);
  const reconcile = useMemo(() => ({
    toAdd: personas.filter((p) => p.kind !== "external"),
    toRemove: added.filter((p) => p.movementId === "listen"
      && !kitIdentity.has(peopleIdentity(p.name)) && !kitIdentity.has(peopleIdentity(p.role))),
  }), [personas, added, kitIdentity]);
  const [reconBusy, setReconBusy] = useState(false);
  const [reconNote, setReconNote] = useState<string | null>(null);
  const runReconcile = async () => {
    if (!onSaveInputs || (!reconcile.toAdd.length && !reconcile.toRemove.length)) return;
    setReconBusy(true);
    try {
      const dropIds = new Set(reconcile.toRemove.map((p) => p.id));
      const kept = readDirectoryPeople(program).filter((p) => !dropIds.has(p.id));
      const stamp = Date.now().toString(36);
      const additions = reconcile.toAdd.map((p, i) => ({
        id: `dp-${stamp}-${i}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
        name: p.name, role: p.name, email: undefined, movementId: "listen",
        roleResolved: validateProgramRole(program, p.name).known,
      }));
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify([...kept, ...additions]) }, {
        attest: { action: "People reconciled with the Discovery Kit", detail: `${additions.length} added, ${reconcile.toRemove.length} removed` },
      });
      setReconNote(`${additions.length} added · ${reconcile.toRemove.length} removed — People now mirrors the kit.`);
    } finally { setReconBusy(false); }
  };

  // ── Inline editing ──────────────────────────────────────────────────────
  const roleOptions = useMemo(() => knownProgramRoles(program).sort((a, b) => a.localeCompare(b)), [program]);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  // Set an address for anyone — resolves through `_roleBindings` (the one
  // contact store), keyed by the person's name on their movement.
  const setPersonEmail = async (movementId: string, name: string, email: string) => {
    if (!onSaveInputs || !name) return;
    const rb = readRoleBindings(program, movementId);
    const clean = email.trim();
    const existing = rb[name];
    if (clean) rb[name] = { name, email: clean };
    else if (existing) rb[name] = { name };
    setBusyRow(`${movementId}:${name}`);
    try { await onSaveInputs(movementId, { _roleBindings: JSON.stringify(rb) }, { attest: { action: `Email set — ${name}`, detail: clean || "cleared" } }); }
    finally { setBusyRow(null); }
  };
  // Rename anyone on the record — patches the Discovery-Kit roster (the join
  // key) and re-keys their contact binding, so the address follows the name.
  const renamePerson = async (oldName: string, newName: string) => {
    const clean = newName.trim();
    if (!onRenamePerson || !clean || clean === oldName) return;
    setBusyRow(`rename:${oldName}`);
    try { await onRenamePerson(oldName, clean); } finally { setBusyRow(null); }
  };
  // Edit an operator-added person in place. A role change RE-VALIDATES: an
  // unknown role flips roleResolved false and the person returns to the Inbox
  // to clarify; a known one resolves. A rename re-keys their binding.
  const editAdded = async (id: string, patch: { name?: string; role?: string; email?: string }) => {
    if (!onSaveInputs) return;
    const people = readDirectoryPeople(program);
    const target = people.find((p) => p.id === id);
    if (!target) return;
    const nextName = (patch.name ?? target.name).trim() || target.name;
    const nextRole = (patch.role ?? target.role).trim() || target.role;
    const nextEmail = patch.email !== undefined ? patch.email.trim() : target.email;
    const resolved = validateProgramRole(program, nextRole).known;
    const next = people.map((p) => (p.id === id ? { ...p, name: nextName, role: nextRole, email: nextEmail || undefined, roleResolved: resolved } : p));
    const rb = readRoleBindings(program, target.movementId);
    if (patch.name && patch.name.trim() && patch.name.trim() !== target.name) { const b = rb[target.name]; if (b) { delete rb[target.name]; rb[nextName] = { ...b, name: nextName }; } }
    if (patch.email !== undefined) { const clean = patch.email.trim(); if (clean) rb[nextName] = { name: nextName, email: clean }; else if (rb[nextName]) rb[nextName] = { name: nextName }; }
    setBusyRow(id);
    try {
      await onSaveInputs("listen", { _directoryPeople: JSON.stringify(next) }, { attest: { action: `Person edited — ${nextName}`, detail: patch.role ? (resolved ? `role → ${nextRole}` : `role → ${nextRole} (needs clarification)`) : "name/email" } });
      await onSaveInputs(target.movementId, { _roleBindings: JSON.stringify(rb) }, { silent: true });
    } finally { setBusyRow(null); }
  };

  const match = (row: { name: string; role: string; where: string; email?: string | null }) =>
    !query || `${row.name} ${row.role} ${row.where} ${row.email ?? ""}`.toLowerCase().includes(query);
  const rosterShown = dedup.rosterD.filter(match);
  const rolesShown = dedup.rolesD.filter(match);
  const personasShown = personas.filter((persona) => match({ name: persona.spokenForBy.join(", "), role: persona.name, where: "Discovery Kit persona" }));
  const addedShown = dedup.addedD.filter((p) => match({ name: p.name, role: p.role, where: "Added", email: p.email ?? "" }));
  const missing = dedup.rosterD.filter((r) => !r.isRole && !r.email).length + dedup.rolesD.filter((r) => r.bound && !r.email && !r.isSponsor).length;
  // Bind a Listen role placeholder to a real person, right from this page —
  // same store the collect card's bind box writes (`_roleBindings` on Listen).
  const bindListenRole = async (role: string, name: string) => {
    const clean = name.trim();
    if (!onSaveInputs || !role || !clean) return;
    const rb = readRoleBindings(program, "listen");
    rb[role] = { name: clean };
    setBusyRow(`bind:${role}`);
    try {
      await onSaveInputs("listen", { _roleBindings: JSON.stringify(rb) }, {
        attest: { action: `Role bound — ${role} → ${clean}` },
      });
    } finally { setBusyRow(null); }
  };
  const unresolved = added.filter((p) => !p.roleResolved).length;
  // People a respondent named on their link ("who else should we speak with?").
  const suggested = readSuggestedVoices(program);
  const rewriteSuggested = (dropName: string) => {
    const raw = readMovementInputs(program, "listen")._suggestedVoices;
    let list: unknown[] = [];
    try { const parsed = typeof raw === "string" ? JSON.parse(raw) : []; list = Array.isArray(parsed) ? parsed : []; } catch { /* reset */ }
    return list.filter((entry) => !(entry && typeof entry === "object" && String((entry as Record<string, unknown>).name ?? "").trim().toLowerCase() === dropName.toLowerCase()));
  };
  const addSuggested = async (voice: { name: string; role: string; from?: string }) => {
    if (!onSaveInputs) return;
    const role = voice.role.trim() || "Contributor";
    const resolved = validateProgramRole(program, role).known;
    const entry = { id: `dp-${Date.now().toString(36)}-${voice.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`, name: voice.name, role, email: undefined, movementId: "listen", roleResolved: resolved };
    setBusyRow(`sug-add:${voice.name}`);
    try {
      await onSaveInputs("listen", {
        _directoryPeople: JSON.stringify([...readDirectoryPeople(program), entry]),
        _suggestedVoices: JSON.stringify(rewriteSuggested(voice.name)),
      }, { attest: { action: `Suggested voice added — ${voice.name} (${role})`, detail: voice.from ? `named by ${voice.from}` : undefined } });
    } finally { setBusyRow(null); }
  };
  const dismissSuggested = async (name: string) => {
    if (!onSaveInputs) return;
    setBusyRow(`sug-dismiss:${name}`);
    try { await onSaveInputs("listen", { _suggestedVoices: JSON.stringify(rewriteSuggested(name)) }, { attest: { action: `Suggested voice dismissed — ${name}` } }); }
    finally { setBusyRow(null); }
  };

  // The COMPLETE roster as one flat table — no source grouping, no Where column.
  // Rows are ordered by the phase they belong to (Frame → Listen → Envision →
  // Show → Ship → Evolve); the source lives only in the sort, not a column.
  const PHASE_ORDER: Record<string, number> = { frame: 0, listen: 1, envision: 2, show: 3, ship: 4, evolve: 5 };
  const peopleRows: Array<{ rank: number; node: React.ReactNode }> = [];
  rosterShown.forEach((row, i) => peopleRows.push({ rank: PHASE_ORDER.listen, node: (
    row.isRole ? (
      <tr key={`r-${i}`} className={busyRow === `bind:${row.role}` ? "busy" : undefined}>
        <td>{row.role}</td>
        <td>
          {onSaveInputs ? (
            <input className="v3fs-dir-in" placeholder="who is this? add their name" aria-label={`Name the ${row.role}`}
              key={`rb-${i}-${row.role}`} disabled={busyRow === `bind:${row.role}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v) void bindListenRole(row.role, v); }} />
          ) : <em>unbound — name them on the Listen collect card</em>}
        </td>
        <td></td>
        <td>
          <span className="v3fs-vc pen">Unnamed role</span>
          {onSaveInputs ? (
            <button type="button" className="v3fs-btn quiet" disabled={busyRow === `role-rm:${row.role}`}
              title="Remove this role from the cast — regeneration will not bring it back"
              onClick={() => void removeRole(row.role)}>{busyRow === `role-rm:${row.role}` ? "…" : "Remove"}</button>
          ) : null}
        </td>
      </tr>
    ) : (
      <tr key={`r-${i}`} className={busyRow === `listen:${row.name}` || busyRow === `rename:${row.name}` ? "busy" : undefined}>
        <td>{row.role}</td>
        <td>
          {onRenamePerson ? (
            <input className="v3fs-dir-in" defaultValue={row.name} aria-label={`Name for ${row.name}`}
              key={`rn-${i}-${row.name}`} disabled={busyRow === `listen:${row.name}` || busyRow === `rename:${row.name}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== row.name) void renamePerson(row.name, v); }} />
          ) : row.name}
        </td>
        <td>
          {onSaveInputs ? (
            <input className="v3fs-dir-in" type="email" placeholder="add email" defaultValue={row.email ?? ""} aria-label={`Email for ${row.name}`}
              key={`re-${i}-${row.email ?? ""}`} disabled={busyRow === `listen:${row.name}`}
              onBlur={(e) => { if (e.target.value.trim() !== (row.email ?? "")) void setPersonEmail("listen", row.name, e.target.value); }} />
          ) : (row.email ?? <span className="v3fs-ivc-noaddr">✉ no address</span>)}
        </td>
        <td><span className={`v3fs-vc ${row.heard ? "acc" : "pen"}`}>{row.heard ? "Heard" : "Awaiting"}</span></td>
      </tr>
    )
  ) }));
  rolesShown.forEach((row, i) => peopleRows.push({ rank: PHASE_ORDER[row.where.toLowerCase()] ?? 98, node: (
    <tr key={`d-${i}`} className={row.name && busyRow === `${row.where.toLowerCase()}:${row.name}` ? "busy" : undefined}>
      <td>{row.role}</td>
      <td>
        {row.name && onRenamePerson ? (
          <input className="v3fs-dir-in" defaultValue={row.name} aria-label={`Name for ${row.name}`}
            key={`dn-${i}-${row.name}`} disabled={busyRow === `${row.where.toLowerCase()}:${row.name}` || busyRow === `rename:${row.name}`}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== row.name) void renamePerson(row.name, v); }} />
        ) : row.name || <em>unbound — name them on the {row.where} collect card</em>}
      </td>
      <td>
        {row.name && onSaveInputs && !row.isSponsor ? (
          <input className="v3fs-dir-in" type="email" placeholder="add email" defaultValue={row.email ?? ""} aria-label={`Email for ${row.name}`}
            key={`de-${i}-${row.email ?? ""}`} disabled={busyRow === `${row.where.toLowerCase()}:${row.name}`}
            onBlur={(e) => { if (e.target.value.trim() !== (row.email ?? "")) void setPersonEmail(row.where.toLowerCase(), row.name, e.target.value); }} />
        ) : row.name ? (row.email ?? <span className="v3fs-ivc-noaddr">✉ no address</span>) : ""}
      </td>
      <td><span className={`v3fs-vc ${row.name ? "acc" : "pen"}`}>{row.name ? "Bound" : "Open"}</span></td>
    </tr>
  ) }));
  personasShown.forEach((persona) => peopleRows.push({ rank: PHASE_ORDER.listen, node: (
    <tr key={`p-${persona.name}`} className={busyRow === `role-rm:${persona.name}` ? "busy" : undefined}>
      <td>{persona.name}</td>
      <td>{persona.spokenForBy.length ? <span title="who speaks for this role">via {persona.spokenForBy.join(", ")}</span> : <em>{persona.kind === "external" ? "external — heard through whoever faces them" : "no voice yet"}</em>}</td>
      <td></td>
      <td>
        <span className={`v3fs-vc ${persona.spokenForBy.length ? "acc" : "pen"}`}>
          {persona.kind === "external" ? "External" : persona.spokenForBy.length ? "Represented" : "Unheard"}
        </span>
        {onSaveInputs ? (
          <button type="button" className="v3fs-btn quiet" disabled={busyRow === `role-rm:${persona.name}`}
            title="Remove this role from the cast — regeneration will not bring it back"
            onClick={() => void removeRole(persona.name)}>{busyRow === `role-rm:${persona.name}` ? "…" : "Remove"}</button>
        ) : null}
      </td>
    </tr>
  ) }));
  addedShown.forEach((row) => peopleRows.push({ rank: PHASE_ORDER[row.movementId] ?? 98, node: (
    <tr key={row.id} className={busyRow === row.id ? "busy" : undefined}>
      <td>
        <select className="v3fs-dir-in" defaultValue={row.role} aria-label={`Role for ${row.name}`}
          key={`role-${row.id}-${row.role}`} disabled={!onSaveInputs || busyRow === row.id}
          onChange={(e) => { if (e.target.value !== row.role) void editAdded(row.id, { role: e.target.value }); }}>
          {!roleOptions.some((r) => r === row.role) ? <option value={row.role}>{row.role}{row.roleResolved ? "" : " (unclear)"}</option> : null}
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td>
        <input className="v3fs-dir-in" defaultValue={row.name} aria-label={`Name for ${row.name}`}
          key={`name-${row.id}-${row.name}`} disabled={!onSaveInputs || busyRow === row.id}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== row.name) void editAdded(row.id, { name: e.target.value }); }} />
      </td>
      <td>
        <input className="v3fs-dir-in" type="email" placeholder="add email" defaultValue={row.email ?? ""} aria-label={`Email for ${row.name}`}
          key={`email-${row.id}-${row.email ?? ""}`} disabled={!onSaveInputs || busyRow === row.id}
          onBlur={(e) => { if (e.target.value.trim() !== (row.email ?? "")) void editAdded(row.id, { email: e.target.value }); }} />
      </td>
      <td><span className={`v3fs-vc ${row.roleResolved ? "acc" : "pen"}`}>{row.roleResolved ? "Added" : "Role unclear"}</span></td>
    </tr>
  ) }));
  peopleRows.sort((a, b) => a.rank - b.rank);

  return (
    <div className="v3fs-grid2">
      <div className="v3fs-search-row">
        <input className="v3fs-search" placeholder="Find a person, role, or address…"
          value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search people" />
      </div>
      {onSaveInputs ? (
        <div className="v3fs-panel v3fs-panel-wide">
          <div className="v3fs-ph"><h3>Add a person</h3><span>name a new person and pick their role from the ones this programme knows — new roles are minted on the Discovery Kit matrix</span></div>
          <div className="v3fs-addp">
            <input placeholder="Name" aria-label="Name" value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <select aria-label="Role" value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="">Select a role…</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input placeholder="Email (optional)" type="email" aria-label="Email" value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <select value={form.movementId} aria-label="Movement" onChange={(event) => setForm({ ...form, movementId: event.target.value })}>
              {MOVEMENTS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
            <button type="button" className="v3fs-btn pri" disabled={addBusy || !form.name.trim() || !form.role.trim()}
              onClick={() => void addPerson()}>{addBusy ? "Adding…" : "Add person"}</button>
          </div>
          {lastAdd ? (
            <p className="v3fs-addp-note">{lastAdd.resolved
              ? `${lastAdd.name} added — role recognised.`
              : <>{lastAdd.name} added — their role needs clarification. {onGoInbox ? <button type="button" className="v3fs-a" onClick={() => onGoInbox()}>Clarify in the Inbox →</button> : "Clarify it in the Inbox."}</>}</p>
          ) : null}
        </div>
      ) : null}
      {onSaveInputs ? (
        <div className="v3fs-panel v3fs-panel-wide">
          <div className="v3fs-ph"><h3>Reconcile with the Discovery Kit</h3><span>make this cast mirror the kit — internal personas the kit lists gain a row; operator-added Listen rows the kit doesn&rsquo;t know are removed</span></div>
          <div className="v3fs-recon">
            {reconcile.toAdd.length || reconcile.toRemove.length ? (
              <>
                <span className="v3fs-recon-sum">
                  {reconcile.toAdd.length ? <>＋ {reconcile.toAdd.length} to add: {reconcile.toAdd.map((p) => p.name).slice(0, 4).join(", ")}{reconcile.toAdd.length > 4 ? ` +${reconcile.toAdd.length - 4} more` : ""}</> : null}
                  {reconcile.toAdd.length && reconcile.toRemove.length ? <b> · </b> : null}
                  {reconcile.toRemove.length ? <>− {reconcile.toRemove.length} to remove: {reconcile.toRemove.map((p) => p.name).slice(0, 4).join(", ")}{reconcile.toRemove.length > 4 ? ` +${reconcile.toRemove.length - 4} more` : ""}</> : null}
                </span>
                <button type="button" className="v3fs-btn pri" disabled={reconBusy}
                  onClick={() => void runReconcile()}>{reconBusy ? "Reconciling…" : "Reconcile"}</button>
              </>
            ) : (
              <span className="v3fs-recon-sum ok">✓ In sync with the Discovery Kit{reconNote ? ` (${reconNote})` : ""}</span>
            )}
          </div>
        </div>
      ) : null}
      {suggested.length ? (
        <div className="v3fs-panel v3fs-panel-wide v3fs-sugg">
          <div className="v3fs-ph">
            <h3>Suggested by stakeholders <span className="v3fs-sugg-count">{suggested.length}</span></h3>
            <span>people named on a response as &ldquo;who else should we speak with?&rdquo; — add them to collect from, or dismiss</span>
          </div>
          <div className="v3fs-sugg-list">
            {suggested.map((voice) => (
              <div key={voice.name} className="v3fs-sugg-row">
                <div className="v3fs-sugg-id">
                  <b>{voice.name}</b>
                  <span>{[voice.role, voice.from ? `named by ${voice.from}` : ""].filter(Boolean).join(" · ")}</span>
                  {voice.note ? <em>&ldquo;{voice.note}&rdquo;</em> : null}
                </div>
                {onSaveInputs ? (
                  <div className="v3fs-sugg-act">
                    <button type="button" className="v3fs-btn pri" disabled={busyRow === `sug-add:${voice.name}`}
                      onClick={() => void addSuggested(voice)}>{busyRow === `sug-add:${voice.name}` ? "Adding…" : "＋ Add"}</button>
                    <button type="button" className="v3fs-btn quiet" disabled={busyRow === `sug-dismiss:${voice.name}`}
                      onClick={() => void dismissSuggested(voice.name)}>Dismiss</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="v3fs-panel v3fs-panel-wide">
        <div className="v3fs-ph">
          <h3>People</h3>
          <span>everyone the programme collects from — {unresolved ? `${unresolved} role${unresolved === 1 ? "" : "s"} to clarify; ` : ""}{missing ? `${missing} without an address; ` : ""}edit names, emails and roles inline</span>
        </div>
        {/* The complete roster — one flat table, ordered by phase. */}
        {peopleRows.length ? (
          <table className="v3fs-dir">
            <thead><tr><th>Role</th><th>Person</th><th>Email</th><th>Status</th></tr></thead>
            <tbody>{peopleRows.map((r) => r.node)}</tbody>
          </table>
        ) : (
          <div className="v3fs-empty">Nothing matches that search.</div>
        )}
      </div>
    </div>
  );
}

function FlowLibrary({ program, programs, onSelectProgram, onSaveInputs, onTagClaim, onComment, onSaveArtifactDoc, onOpenInbox, onGoFlow, onRenamePerson, onRenameRole }: { program: ProgramSummary; programs: ProgramSummary[]; onSelectProgram: (id: string) => void; onSaveInputs?: FlowShellProps["onSaveInputs"]; onTagClaim?: FlowShellProps["onTagClaim"]; onComment?: FlowShellProps["onComment"]; onSaveArtifactDoc: FlowShellProps["onSaveArtifactDoc"]; onOpenInbox?: () => void; onGoFlow?: () => void; onRenamePerson?: FlowShellProps["onRenamePerson"]; onRenameRole?: FlowShellProps["onRenameRole"] }) {
  const claims = listClaimTags(program);
  const tagTargets = useMemo(() => claimTargets(program), [program]);
  const [claimHighlight, setClaimHighlight] = useState<string | undefined>(undefined);
  const movements = useMemo(() => flowMovements(), []);
  const [query, setQuery] = useState("");
  // Faceted browse: narrow the Library by KIND instead of scrolling panels.
    const [openPeople, setOpenPeople] = useState<Set<string>>(new Set());
  // An attached file is READ before it is filed: routeAttachedDocument infers
  // what it is (transcript vs. source material), whose voices it carries, and
  // which movement it belongs to. The inference is shown here and the record
  // only changes when the operator confirms.
  const [pendingDoc, setPendingDoc] = useState<{ filename: string; text: string; sourceKey?: string; route: DocRoute } | null>(null);
  const fileRoutedDoc = (attributeSpeakers: boolean) => {
    if (!pendingDoc || !onSaveInputs) return;
    const { filename, text, sourceKey, route } = pendingDoc;
    const docTitle = filename.replace(/\.[^.]+$/, "");
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const inner = getProgramState(raw).inner as Record<string, unknown>;
    const bucket = (typeof inner.phaseInputs === "object" && inner.phaseInputs !== null
      ? (inner.phaseInputs as Record<string, Record<string, unknown>>)[route.movementId] : undefined) ?? {};
    const existing = typeof bucket[route.captureField] === "string" ? bucket[route.captureField] as string : "";
    void onSaveInputs(route.movementId,
      { [route.captureField]: buildRoutedBlocks(route, docTitle, text, existing, sourceKey, attributeSpeakers) },
      { attest: {
        action: attributeSpeakers && route.speakerBlocks.length ? `Transcript mapped — ${docTitle}` : `Document added — ${docTitle}`,
        detail: `attached from the Library · filed in ${route.movementId}${route.matched.length ? ` · ${attributeSpeakers ? "speakers mapped" : "mentions"}: ${route.matched.join(", ")}` : ""}`,
      } });
    setPendingDoc(null);
  };
  // Drill-down integration: this programme's own anchor (if it is a child) and
  // the focused children that hang off it.
  const dd = useMemo(() => ({
    children: listChildDrilldowns(program, programs),
    parentId: readParentId(program),
    selfAnchor: readDrillAnchor(program),
  }), [program, programs]);
  const ddParent = dd.parentId ? programs.find((p) => p.id === dd.parentId) : undefined;
  const [pullBusy, setPullBusy] = useState<string | null>(null);
  const [pulled, setPulled] = useState<Set<string>>(new Set());
  // Roll a child's confirmed findings up into THIS programme as attributed
  // evidence at the anchor's movement — the standard save path attests it and
  // flags the affected documents stale, so regeneration absorbs the deep dive.
  const pullFindings = async (child: ProgramSummary, anchorKind: DrillKind | null) => {
    if (!onSaveInputs) return;
    const findings = buildDrilldownFindings(child, program);
    if (!findings) return;
    const target = drillRollupTarget(anchorKind ?? "scope");
    const raw = (program.rawData ?? {}) as Record<string, unknown>;
    const innerD = getProgramState(raw).inner as Record<string, unknown>;
    const bucket = (typeof innerD.phaseInputs === "object" && innerD.phaseInputs !== null
      ? (innerD.phaseInputs as Record<string, Record<string, unknown>>)[target.movementId] : undefined) ?? {};
    const existing = typeof bucket[target.captureField] === "string" ? bucket[target.captureField] as string : "";
    const header = `— Drill-down: ${child.name}, findings, ${new Date().toISOString().slice(0, 10)} —`;
    setPullBusy(child.id);
    try {
      await onSaveInputs(target.movementId,
        { [target.captureField]: [existing.trimEnd(), `${header}\n${findings}`].filter(Boolean).join("\n\n") },
        { attest: { action: `Pulled findings — ${child.name}`, detail: `Rolled up to ${target.movementId}. Affected documents flagged for regeneration.` } });
      setPulled((prev) => new Set(prev).add(child.id));
    } finally { setPullBusy(null); }
  };
  const [docFor, setDocFor] = useState<import("@/v3/components/flow/flowShellData").ArtifactCardModel | null>(null);
  const all = useMemo(() => ({
    // Approver sign-offs are first-class evidence — projected alongside the
    // captured transcripts so the Library reads them the same way.
    evidence: movements.flatMap((m) => [...movementEvidence(program, m), ...approvalEvidenceEntries(program, m.id)]),
    artifacts: movements.flatMap((m) => movementArtifacts(program, m)),
  }), [program, movements]);
  const [evFor, setEvFor] = useState<import("@/v3/components/flow/flowShellData").EvidenceEntry | null>(null);
  const q = query.trim().toLowerCase();
  // Newest first: capture stamps sort lexicographically ("2026-07-13 14:05");
  // undated entries keep their relative order at the end of the list.
  const byNewest = (list: typeof all.evidence) => [...list]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.capturedAt ?? "").localeCompare(a.entry.capturedAt ?? "") || a.index - b.index)
    .map(({ entry }) => entry);
  const evidence = byNewest(q ? all.evidence.filter((e) => `${e.who} ${e.fieldLabel} ${e.excerpt} ${e.text}`.toLowerCase().includes(q)) : all.evidence);
  const artifacts = q ? all.artifacts.filter((a) => `${a.title} ${a.excerpt ?? ""}`.toLowerCase().includes(q)) : all.artifacts;
  const label = (id: string) => spineLabel(id);



  // Evidence grouped by PERSON — one collapsible row per voice, not a flat wall.
  const evidenceByPerson = useMemo(() => {
    const groups = new Map<string, typeof evidence>();
    for (const entry of evidence) {
      const person = (entry.who.split(",")[0] || entry.who || "Unattributed").trim();
      const list = groups.get(person) ?? [];
      list.push(entry);
      groups.set(person, list);
    }
    return [...groups.entries()].map(([person, items]) => ({ person, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [evidence]);

  // Artifacts as a status ledger: stale (needs regen) first, then missing, then current.
  const artifactRank = (a: typeof artifacts[number]) => (a.present ? (a.stale ? 0 : 2) : 1);
  const artifactLedger = [...artifacts].sort((x, y) => artifactRank(x) - artifactRank(y));
  const staleCount = artifacts.filter((a) => a.present && a.stale).length;

  // "What moved since I last looked": newest evidence + freshly generated/edited docs.
  const recent = useMemo(() => {
    // Latest item PER PERSON, with what it was — four chips reading the same
    // name with different timestamps said nothing.
    const seen = new Set<string>();
    const out: Array<{ when: string; glyph: string; label: string; sub: string; entry: typeof evidence[number] }> = [];
    for (const e of evidence) {
      if (!e.capturedAt) continue;
      const person = (e.who.split(",")[0] || e.who).trim();
      if (seen.has(person)) continue;
      seen.add(person);
      out.push({
        when: e.capturedAt, entry: e,
        glyph: e.kind === "document" ? "≣" : "⌁",
        label: person,
        sub: (e.excerpt ?? "").replace(/\s+/g, " ").slice(0, 64),
      });
      if (out.length === 4) break;
    }
    return out;
  }, [evidence]);

  // People shows the DIRECTORY (who exists, contact state) — reading what a
  // person said lives under All/Documents and on the record rail.

  

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
      <p className="v3fs-lib-cap">Everything the programme knows — search it and read it. Artifacts regenerate from Flow; people live under People; the board pack exports from Pulse.</p>
      {!q && recent.length ? (
        <div className="v3fs-panel v3fs-panel-wide v3fs-recent">
          <div className="v3fs-ph"><h3>Recently changed</h3><span>what moved since you last looked</span></div>
          <div className="v3fs-recent-row">
            {recent.map((r, i) => (
              <button key={i} type="button" className="v3fs-recent-chip" onClick={() => setEvFor(r.entry)}>
                <span className="v3fs-recent-when">{r.glyph} {r.when}</span>
                <span className="v3fs-recent-l">{r.label}</span>
                {r.sub ? <span className="v3fs-recent-sub">“{r.sub}…”</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!q && (dd.children.length || ddParent) ? (
        <div className="v3fs-panel v3fs-panel-wide v3fs-dd-panel">
          <div className="v3fs-ph"><h3>Drill-downs</h3><span>focused children of this programme, wired to it</span></div>
          {ddParent ? (
            <button type="button" className="v3fs-dd-parent" onClick={() => onSelectProgram(ddParent.id)}>
              <span className="v3fs-dd-lens">◇ {dd.selfAnchor ? drillKindMeta(dd.selfAnchor.kind).noun : "drill-down"}</span>
              <span className="v3fs-dd-parent-t">Drill-down of <b>{ddParent.name}</b>{dd.selfAnchor ? ` · focused on ${dd.selfAnchor.label}` : ""}</span>
              <span className="v3fs-dd-open">↩ open parent</span>
            </button>
          ) : null}
          {dd.children.map(({ child, anchor }) => {
            const waiting = listOpenFlowDecisions(child).length + listPortalInbox(child).length;
            const hasFindings = !!buildDrilldownFindings(child, program);
            return (
              <div key={child.id} className="v3fs-row v3fs-row-open v3fs-dd-row" role="button" tabIndex={0}
                onClick={() => onSelectProgram(child.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelectProgram(child.id); }}>
                <span className="v3fs-dd-lens">◇ {anchor ? drillKindMeta(anchor.kind).noun : "scope"}</span>
                <div className="v3fs-row-g">
                  <div className="v3fs-row-n">{anchor?.label ?? child.name}</div>
                  <div className="v3fs-row-m">{child.name}</div>
                </div>
                {onSaveInputs && hasFindings ? (
                  <button type="button" className="v3fs-btn sm" disabled={pullBusy === child.id || pulled.has(child.id)}
                    title="Roll the drill-down's findings up into this programme as attributed evidence"
                    onClick={(e) => { e.stopPropagation(); void pullFindings(child, anchor?.kind ?? null); }}>
                    {pullBusy === child.id ? "Pulling…" : pulled.has(child.id) ? "✓ Pulled" : "⇪ Pull findings"}
                  </button>
                ) : null}
                <span className={`v3fs-dd-st ${waiting ? "watch" : "clear"}`}>{waiting ? `${waiting} waiting` : "on track"}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      {claims.length ? (
        <div className="v3fs-panel v3fs-panel-wide v3fs-claims">
          <div className="v3fs-ph"><h3>Claims</h3><span>curated quotes, tagged to the graph — select text in any transcript to add one</span></div>
          {claims.map((claim) => (
            <div key={claim.id} className="v3fs-row v3fs-row-open" role="button" tabIndex={0}
              onClick={() => {
                const hit = all.evidence.find((e) => e.text.includes(claim.quote.slice(0, 80)));
                if (hit) { setClaimHighlight(claim.quote); setEvFor(hit); }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") { const hit = all.evidence.find((x) => x.text.includes(claim.quote.slice(0, 80))); if (hit) { setClaimHighlight(claim.quote); setEvFor(hit); } } }}>
              <span className="v3fs-tag ev">{claim.target.kind}</span>
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">“{claim.quote.length > 90 ? `${claim.quote.slice(0, 90)}…` : claim.quote}”</div>
                <div className="v3fs-row-m">→ {claim.target.label} · {claim.who}</div>
              </div>
              {onTagClaim ? (
                <button type="button" className="v3fs-a" title="Untag — attested"
                  onClick={(e) => { e.stopPropagation(); void onTagClaim({ quote: claim.quote, who: claim.who, movementId: claim.movementId, target: claim.target, removeId: claim.id }); }}>✕</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="v3fs-panel">
        <div className="v3fs-ph v3fs-ph-attach">
          <h3>Evidence</h3><span>grouped by voice — click a person to expand</span>
          {onSaveInputs ? (
            <AttachFileButton programId={program.id}
              onExtracted={(filename, text, sourceKey) => {
                // Read before filing: infer what this is, whose voices it
                // carries, and which movement it belongs to — then ask.
                setPendingDoc({ filename, text, sourceKey, route: routeAttachedDocument(program, text) });
              }} />
          ) : null}
        </div>
        {pendingDoc ? (
          <div className={`v3fs-docroute${pendingDoc.route.kind === "transcript" ? " transcript" : ""}`} role="status">
            <div className="v3fs-docroute-g">
              <span className="v3fs-docroute-k">{pendingDoc.route.kind === "transcript" ? "⌁ Transcript" : "≣ Document"}</span>
              <span className="v3fs-docroute-t"><b>{pendingDoc.filename}</b> — {pendingDoc.route.summary}</span>
            </div>
            <div className="v3fs-docroute-cta">
              {pendingDoc.route.speakerBlocks.length ? (
                <button type="button" className="v3fs-btn pri" onClick={() => fileRoutedDoc(true)}
                  title={`Each matched person gets their own attributed evidence in ${pendingDoc.route.movementId}`}>
                  ✓ File as {pendingDoc.route.matched.length} {pendingDoc.route.matched.length === 1 ? "person's" : "people's"} evidence
                </button>
              ) : (
                <button type="button" className="v3fs-btn pri" onClick={() => fileRoutedDoc(false)}
                  title={`Files into the ${pendingDoc.route.movementId} evidence`}>
                  ✓ File in {pendingDoc.route.movementId.charAt(0).toUpperCase() + pendingDoc.route.movementId.slice(1)}
                </button>
              )}
              {pendingDoc.route.speakerBlocks.length ? (
                <button type="button" className="v3fs-btn" onClick={() => fileRoutedDoc(false)}
                  title="Keep the document whole — no per-speaker attribution">Just the document</button>
              ) : null}
              <label className="v3fs-docroute-move">
                in
                <select value={pendingDoc.route.movementId} aria-label="File in movement"
                  onChange={(e) => setPendingDoc({ ...pendingDoc, route: routeAttachedDocument(program, pendingDoc.text, e.target.value) })}>
                  {["frame", "listen", "show"].map((m) => (
                    <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="v3fs-btn quiet" onClick={() => setPendingDoc(null)}>Discard</button>
            </div>
          </div>
        ) : null}
        {evidence.length === 0 ? <div className="v3fs-empty">{q ? "Nothing matches that search." : "No evidence captured yet. Add the first conversation in Frame or Listen."}</div> : null}
        {(() => {
          const openEntry = (entry: typeof evidence[number]) => {
            // Text-based evidence (transcripts, Word, extracted documents) reads
            // in the formatted modal — the original file is downloadable from
            // there. Only a document whose text COULDN'T be extracted falls
            // straight through to a download.
            if (entry.kind === "document" && entry.sourceKey && !entry.text.trim()) {
              void supabase.functions.invoke("flow-extract", { body: { download: entry.sourceKey } })
                .then((result: { data: unknown }) => {
                  const url = (result.data as { url?: string } | null)?.url;
                  if (url) window.open(url, "_blank"); else setEvFor(entry);
                }).catch(() => setEvFor(entry));
              return;
            }
            setEvFor(entry);
          };
          const entryRow = (entry: typeof evidence[number], i: number) => (
            <div key={i} className="v3fs-row v3fs-row-open v3fs-ev-sub" role="button" tabIndex={0}
              onClick={() => openEntry(entry)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openEntry(entry); }}>
              <span className="v3fs-tag ev">{label(entry.movementId)}</span>
              <div className="v3fs-row-g">
                <div className="v3fs-row-n">{entry.excerpt ? `“${entry.excerpt}”` : entry.who}</div>
                <div className="v3fs-row-m">{entry.who}{entry.kind === "document" ? " · document" : ""}</div>
              </div>
              {entry.capturedAt ? <span className="v3fs-row-when" title="Captured">{entry.capturedAt}</span> : null}
            </div>
          );
          return evidenceByPerson.map(({ person, items }) => {
            const open = openPeople.has(person);
            return (
              <div key={person} className="v3fs-ev-group">
                <button type="button" className={`v3fs-ev-ghead${open ? " on" : ""}`}
                  onClick={() => setOpenPeople((prev) => { const n = new Set(prev); if (open) n.delete(person); else n.add(person); return n; })}>
                  <span className="v3fs-ev-gchev" aria-hidden="true">{open ? "▾" : "▸"}</span>
                  <span className="v3fs-ev-gkind" aria-hidden="true" title={items.some((e) => e.kind !== "document") ? "Conversation" : "Document"}>
                    {items.some((e) => e.kind !== "document") ? "⌁" : "≣"}
                  </span>
                  <span className="v3fs-ev-gname">{person.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()}</span>
                  <span className="v3fs-ev-gcount">{(() => {
                    const words = items.reduce((n, e) => n + (e.text ? e.text.trim().split(/\s+/).length : 0), 0);
                    return words >= 100 ? `${(words / 1000).toFixed(words >= 10000 ? 0 : 1)}k words` : `${items.length} item${items.length === 1 ? "" : "s"}`;
                  })()}</span>
                  <span className="v3fs-ev-gwhen">{items[0]?.capturedAt ?? ""}</span>
                </button>
                {open ? items.map(entryRow) : null}
              </div>
            );
          });
        })()}
      </div>
      <div className="v3fs-panel">
        <div className="v3fs-ph">
          <h3>Artifacts</h3>
          <span>{staleCount ? `${staleCount} need regenerating — shown first` : "generated, traceable to evidence"}</span>
          {staleCount && onGoFlow ? (
            <button type="button" className="v3fs-a" title="The spine runner lives on the Flow page — its Up-next queue leads with this"
              onClick={() => onGoFlow()}>↻ regenerate in Flow</button>
          ) : null}
        </div>
        {/* Grouped by PHASE into collapsible sections — the ledger reads as the
            methodology's shape, not a flat wall. Within a phase, stale-first. */}
        {movements.map((m) => {
          const group = artifactLedger.filter((a) => a.movementId === m.id);
          if (!group.length) return null;
          const groupStale = group.filter((a) => a.present && a.stale).length;
          const groupCurrent = group.filter((a) => a.present && !a.stale).length;
          return (
            <details key={m.id} className="v3fs-lib-group">
              <summary className="v3fs-lib-group-h">
                <span className="v3fs-lib-group-t">{spineLabel(m.id, { distinct: true })}</span>
                <span className="v3fs-lib-group-n">{groupCurrent}/{group.length}</span>
                {groupStale ? <span className="v3fs-lib-group-stale">{groupStale} stale</span> : null}
                <span className="v3fs-lib-group-caret" aria-hidden="true">▾</span>
              </summary>
              <div className="v3fs-lib-group-b">
                {group.map((artifact) => (
                  <div key={`${artifact.movementId}:${artifact.id}`}
                    className={`v3fs-row v3fs-art-row ${artifact.present ? (artifact.stale ? "stale" : "ok") : "missing"}${artifact.present ? " v3fs-row-open" : ""}`}
                    role={artifact.present ? "button" : undefined}
                    tabIndex={artifact.present ? 0 : undefined}
                    onClick={artifact.present ? () => setDocFor(artifact) : undefined}
                    onKeyDown={artifact.present ? (event) => { if (event.key === "Enter" || event.key === " ") setDocFor(artifact); } : undefined}>
                    <span className="v3fs-art-stripe" aria-hidden="true" />
                    <div className="v3fs-row-g">
                      <div className="v3fs-row-n">{artifact.title}</div>
                      <div className="v3fs-row-m">
                        {artifact.present
                          ? artifact.stale
                            ? "evidence changed — regenerate"
                            : artifact.confidence != null ? `current · confidence ${artifact.confidence}%` : "current"
                          : `not yet generated — runs in ${label(artifact.movementId)} once its inputs land`}
                      </div>
                    </div>
                    <span className={`v3fs-art-badge ${artifact.present ? (artifact.stale ? "stale" : "ok") : "missing"}`}>
                      {artifact.present ? (artifact.stale ? "Stale" : "Current") : "Missing"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
      {docFor ? <Suspense fallback={null}><FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)} onSaveDoc={onSaveArtifactDoc} onSaveInputs={onSaveInputs} onComment={onComment} onOpenInbox={onOpenInbox}
        header={docFor.id === "discovery-kit"
          ? <DiscoveryKitAlign program={program} onSaveInputs={onSaveInputs} onRenamePerson={onRenamePerson} onRenameRole={onRenameRole} />
          : undefined}
        onOpenArtifact={(artifactId) => {
          for (const m of flowMovements()) {
            const hit = movementArtifacts(program, m).find((a) => a.id === artifactId && a.present);
            if (hit) { setDocFor(hit); return; }
          }
        }} /></Suspense> : null}
      {evFor ? (
        <EvidenceReader entry={evFor} highlight={claimHighlight} targets={tagTargets}
          onTag={onTagClaim ? (target, quote) => onTagClaim({ quote, who: evFor.who, movementId: evFor.movementId, target }) : undefined}
          onDownload={evFor.sourceKey ? () => {
            const key = evFor.sourceKey;
            void supabase.functions.invoke("flow-extract", { body: { download: key } })
              .then((result: { data: unknown }) => {
                const url = (result.data as { url?: string } | null)?.url;
                if (url) window.open(url, "_blank");
              }).catch(() => { /* download best-effort */ });
          } : undefined}
          onClose={() => { setEvFor(null); setClaimHighlight(undefined); }} />
      ) : null}
    </div>
  );
}

/* ── Pulse: the steering-meeting screen ──────────────────────────────────── */

function FlowPulse({ program, programs, onSelectProgram, onMintBrief }: { program: ProgramSummary; programs?: ProgramSummary[]; onSelectProgram?: (id: string) => void; onMintBrief: () => Promise<string | null> }) {
  // The family: this programme's drill-downs, each with its steering numbers.
  const family = programs ? listChildDrilldowns(program, programs) : [];
  const days = daysToFirstDemo(program);
  const coverage = listenCoverage(program);
  const demos = demoAcceptance(program);
  const words = wordsOfEvidence(program);
  const kpis = readMetricRegistry(program);
  const metricHealth = metricConsistency(program);
  const [packOpen, setPackOpen] = useState(false);

  const engagedPct = coverage.total ? Math.round((coverage.done / coverage.total) * 100) : null;
  const demoPct = demos.total ? Math.round((demos.accepted / demos.total) * 100) : null;

  return (
    <div className="v3fs-pulse">
      <div className="v3fs-pulse-lead">
        <div className="v3fs-pulse-lead-l">
          <span className="v3fs-pf-eyebrow">Pulse</span>
          <p>The steering read — outcomes, demonstrations, and the board pack.</p>
        </div>
        <button type="button" className="v3fs-btn pri" onClick={() => setPackOpen(true)}>
          ⎙ Board pack
        </button>
      </div>
      {packOpen ? <FlowBoardPack program={program} onMintBrief={onMintBrief} onClose={() => setPackOpen(false)} /> : null}
      {family.length ? (
        <div className="v3fs-pulse-family">
          <span className="v3fs-pf-eyebrow sm">Drill-downs</span>
          {family.map(({ child, anchor }) => {
            const days = daysToFirstDemo(child);
            const waiting = listOpenFlowDecisions(child).length + listPortalInbox(child).length;
            return (
              <button key={child.id} type="button" className="v3fs-pulse-fam-chip" onClick={() => onSelectProgram?.(child.id)}>
                <span className="v3fs-dd-lens">◇ {anchor ? drillKindMeta(anchor.kind).noun : "scope"}</span>
                <b>{anchor?.label ?? child.name}</b>
                <span className="v3fs-pulse-fam-m">{days != null ? `${days}d to demo` : "no demo date"}{waiting ? ` · ${waiting} waiting` : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="v3fs-stats">
        <div className={`v3fs-stat hero${days == null ? " empty" : ""}`}>
          <div className="v3fs-stat-n">{days != null ? <b>{days}</b> : <b>—</b>}{days != null ? <small> days</small> : null}</div>
          <div className="v3fs-stat-l">{days != null ? "to first demo" : "first-demo date unset"}</div>
        </div>
        <div className="v3fs-stat">
          <div className="v3fs-stat-n"><b>{coverage.done}</b><small>/{coverage.total || "?"}</small></div>
          <div className="v3fs-stat-l">stakeholders engaged</div>
          {engagedPct != null ? <span className="v3fs-pf-bar"><span style={{ width: `${engagedPct}%` }} /></span> : null}
        </div>
        <div className="v3fs-stat">
          <div className="v3fs-stat-n"><b>{demos.accepted}</b><small>/{demos.total || "?"}</small></div>
          <div className="v3fs-stat-l">demonstrations accepted</div>
          {demoPct != null ? <span className="v3fs-pf-bar"><span style={{ width: `${demoPct}%` }} /></span> : null}
        </div>
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
          <div className="v3fs-ph"><h3>Outcomes</h3><span>one governed definition per measure</span></div>
          {kpis.length === 0 ? <div className="v3fs-empty">Success KPIs defined in Frame appear here, with baselines drawn from discovery.</div> : null}
          {kpis.length ? (
            <div className={`v3fs-metric-health${metricHealth.governed ? " ok" : ""}`}
              title="Every surface reads these from one registry, so a definition can't drift between the charter, the board pack and the brief.">
              {metricHealth.governed
                ? `✓ ${metricHealth.total} governed — each defined once, verifiable`
                : `${metricHealth.defined}/${metricHealth.total} defined${metricHealth.issues.some((issue) => issue.severity === "error") ? ` · ${metricHealth.issues.filter((issue) => issue.severity === "error").length} to resolve` : ""}`}
            </div>
          ) : null}
          {kpis.map((kpi, i) => (
            <div key={kpi.id || i} className="v3fs-kpi">
              <div className="v3fs-kpi-t"><b>{kpi.name}</b><span>{[kpi.baseline, kpi.target].filter(Boolean).join(" → ")}{kpi.unit ? ` ${kpi.unit}` : ""}</span></div>
              {kpi.definition ? <div className="v3fs-kpi-def">{kpi.definition}</div> : <div className="v3fs-kpi-def undefinedm">No definition yet — the metric isn’t governed until its meaning is recorded.</div>}
              <div className="v3fs-river"><div className="v3fs-river-to" /><div className="v3fs-river-mk" /></div>
            </div>
          ))}
        </div>
      </div>
      <FlowStory program={program} />
    </div>
  );
}

/* ── The story so far — the record as a chronological narrative ──────────── */
interface StoryEvent { ts: string; day: string; kind: "evidence" | "gate" | "action"; title: string; detail?: string; movementId?: string; entry?: import("@/v3/components/flow/flowShellData").EvidenceEntry; }

/** Merge attested actions and dated evidence into one timeline. Everything
 * here is already on the record — this is the record made readable. */
function buildStory(program: ProgramSummary): StoryEvent[] {
  const events: StoryEvent[] = [];
  for (const att of listFlowAttestations(program)) {
    if (!att.ts) continue;
    events.push({
      ts: att.ts, day: att.ts.slice(0, 10),
      kind: /gate|demonstrated/i.test(att.action) ? "gate" : "action",
      title: att.action, detail: att.detail || undefined, movementId: att.phaseId || undefined,
    });
  }
  const movements = flowMovements();
  for (const movement of movements) {
    for (const entry of movementEvidence(program, movement)) {
      const day = (`${entry.who} ${entry.meta}`.match(/\d{4}-\d{2}-\d{2}/) ?? [])[0];
      if (!day) continue;
      events.push({
        ts: `${day}T12:00:00Z`, day, kind: "evidence",
        title: entry.who, detail: entry.excerpt ? `“${entry.excerpt}”` : undefined, movementId: movement.id, entry,
      });
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

function FlowStory({ program }: { program: ProgramSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [evFor, setEvFor] = useState<import("@/v3/components/flow/flowShellData").EvidenceEntry | null>(null);
  // Snapshot scrubbing — replay the record as it stood at any saved point.
  // Snapshots come from the local safety ring; "now" is the live blob.
  const [snapshots, setSnapshots] = useState<BlobSnapshot[]>([]);
  const [asOf, setAsOf] = useState<string>("now");
  useEffect(() => {
    let alive = true;
    listSnapshots(program.id).then((list) => { if (alive) setSnapshots(list); }).catch(() => { /* ring unavailable */ });
    return () => { alive = false; };
  }, [program.id]);
  const viewProgram = useMemo(() => {
    if (asOf === "now") return program;
    const snap = snapshots.find((s) => String(s.ts) === asOf);
    return snap ? ({ ...program, rawData: snap.data } as ProgramSummary) : program;
  }, [program, snapshots, asOf]);
  const events = useMemo(() => buildStory(viewProgram), [viewProgram]);
  const movements = useMemo(() => flowMovements(), []);
  const label = (id?: string) => (id ? movements.find((m) => m.id === id)?.displayName ?? id : null);
  if (!events.length && asOf === "now") return null;
  const shown = expanded ? events : events.slice(0, 14);
  let prevDay = "";
  return (
    <div className="v3fs-panel v3fs-story">
      <div className="v3fs-ph">
        <h3>The story so far</h3><span>every event on the record, in order — evidence, actions, gates</span>
        {snapshots.length ? (
          <select className="v3fs-story-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} aria-label="View the record as of">
            <option value="now">As of now</option>
            {snapshots.map((s) => (
              <option key={String(s.ts)} value={String(s.ts)}>As of {new Date(s.ts).toLocaleString()}</option>
            ))}
          </select>
        ) : null}
      </div>
      {asOf !== "now" ? (
        <div className="v3fs-story-past" role="note">
          ⧗ Replaying the record as it stood then — the live record is untouched.
          <button type="button" className="v3fs-a" onClick={() => setAsOf("now")}>Back to now</button>
        </div>
      ) : null}
      <div className="v3fs-story-list">
        {shown.map((event, i) => {
          const dayHead = event.day !== prevDay ? event.day : null;
          prevDay = event.day;
          const openable = !!event.entry;
          const body = (
            <>
              <span className="v3fs-story-dot" aria-hidden="true" />
              <div className="v3fs-story-g">
                <div className="v3fs-story-t">
                  {event.title}
                  {label(event.movementId) ? <span className="v3fs-story-mv">{label(event.movementId)}</span> : null}
                  {openable ? <span className="v3fs-story-open">read ↗</span> : null}
                </div>
                {event.detail ? <div className="v3fs-story-d">{event.detail}</div> : null}
              </div>
            </>
          );
          return (
            <Fragment key={i}>
              {dayHead ? <div className="v3fs-story-day">{dayHead}</div> : null}
              {openable ? (
                <button type="button" className={`v3fs-story-row open ${event.kind}`} onClick={() => setEvFor(event.entry ?? null)}>
                  {body}
                </button>
              ) : (
                <div className={`v3fs-story-row ${event.kind}`}>{body}</div>
              )}
            </Fragment>
          );
        })}
      </div>
      {events.length > 14 ? (
        <button type="button" className="v3fs-btn quiet v3fs-story-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show recent only" : `Show the full story — ${events.length} events`}
        </button>
      ) : null}
      {evFor ? <EvidenceReader entry={evFor} onClose={() => setEvFor(null)} /> : null}
    </div>
  );
}
