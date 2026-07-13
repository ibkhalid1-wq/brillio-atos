import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import FlowCanvas from "@/v3/components/flow/FlowCanvas";
import { AttachFileButton, copyTextFromAction } from "@/v3/components/flow/flowCapture";
import FlowArtifactStudio, { type ArtifactEditInput } from "@/v3/components/flow/studio/FlowArtifactStudio";
import FlowBoardPack from "@/v3/components/flow/FlowBoardPack";
import EvidenceReader from "@/v3/components/flow/EvidenceReader";
import {
  flowMovements, movementEvidence, movementArtifacts, gateChecklist, gateReadiness, listenCoverage,
  demoAcceptance, daysToFirstDemo, wordsOfEvidence, readContradictions, parseGridRows,
  contradictionLogWithout,
} from "@/v3/components/flow/flowShellData";
import {
  listOpenFlowDecisions, listFlowAttestations, describeDecisionChanges,
  type FlowDecision,
} from "@/v3/components/flow/flowDecisions";
import {
  listFlowTracks, trackAcceptance, trackPace,
} from "@/v3/components/flow/flowTracks";
import { readFlowGovernance, flowAgentTier } from "@/v3/components/flow/flowGovernance";
import { resolveMovementStakeholders, deliveryRoleDirectory } from "@/v3/components/flow/flowStakeholders";
import { stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import { readMetricRegistry, metricConsistency } from "@/v3/components/flow/flowMetricRegistry";
import { routeAttachedDocument, buildRoutedBlocks, type DocRoute } from "@/v3/components/flow/flowDocRouting";
import { listPortalInbox } from "@/v3/components/flow/flowPortal";
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
  /** Per-artifact failure residue from the last run — shown on the card. */
  agentErrors?: Record<string, string>;
  onSelectProgram: (id: string) => void;
  onCreateProgram: () => void;
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
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
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
  /** Mint a follow-up link (ATOS asks the gaps itself); resolves to the URL. */
  onMintFollowUp: (input: { movementId: string; who: string; questions: string[]; captureField: string }) => Promise<string | null>;
  /** Mint a shareable sponsor brief (dated board-pack snapshot); resolves to the URL. */
  onMintBrief: () => Promise<string | null>;
  /** Record an in-room demonstration pass against a track (Show). */
  onRecordShowPass: (trackId: string, pass: { stakeholder?: string; verdict: "accepted" | "accepted-with-changes" | "rework"; stableDiff?: boolean }) => Promise<void>;
  /** Persist a studio edit to an artifact document (attested). */
  onSaveArtifactDoc: (input: ArtifactEditInput) => Promise<void>;
  /** Confirm a quarantined portal response into evidence. */
  onIngestPortalItem: (itemId: string) => Promise<void>;
  onDismissPortalItem: (itemId: string) => Promise<void>;
}

type FlowView = "today" | "flow" | "library" | "people" | "pulse" | "mission" | "portfolio";

/** The rail is programme-scoped: the work, then the system. App-global actions
 * (Search, Portfolio, Copilot, Help) live in the top bar instead — the rail
 * answers "where am I in THIS programme", the top bar "where can I go in the
 * app". ("mission" keeps its internal id; the person-facing name is Control.) */
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
  portfolio: "Portfolio — every programme and its engagements",
};

/** One stroke weight, currentColor — the rail's icons stop being a font-glyph grab bag. */
const DOCK_PATHS: Record<string, React.ReactNode> = {
  today: <><path d="M4 6h16v12H4z" /><path d="M4 13h5l2 2.5h2L15 13h5" /></>,
  flow: <><path d="M4 12h13" /><path d="M13 7l5 5-5 5" /></>,
  library: <><path d="M6 4v16" /><path d="M11 4v16" /><path d="M14.5 5.5L19 19.5" /></>,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.8-3.2 3-4.8 5.5-4.8s4.7 1.6 5.5 4.8" /><circle cx="17" cy="9.5" r="2.3" /><path d="M15.5 14.6c2.4.2 4.2 1.6 5 4.4" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  mission: <><path d="M5 8h14" /><path d="M5 16h14" /><circle cx="10" cy="8" r="2.1" /><circle cx="15" cy="16" r="2.1" /></>,
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
function FlowSearch({ programs, program, onSelectProgram, onGoView, onCreateProgram, onOpenDrill, onSponsor, onClose }: {
  programs: ProgramSummary[];
  program: ProgramSummary;
  onSelectProgram: (id: string) => void;
  onGoView: (view: FlowView) => void;
  onCreateProgram?: () => void;
  onOpenDrill?: () => void;
  onSponsor?: () => void;
  onClose: () => void;
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
          {!query ? (
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
            <h2>How ATOS Flow works</h2>
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
              <li><b>Search</b> — jump to any programme, or find evidence and artifacts (⌘K or /).</li>
              <li><b>Inbox</b> — responses and decisions waiting on your judgment.</li>
              <li><b>Flow</b> — the live programme, movement by movement.</li>
              <li><b>Library</b> — every conversation and generated artifact.</li>
              <li><b>Pulse</b> — the steering read and the board pack.</li>
              <li><b>Control</b> — agents, budgets, guardrails, and the audit trail.</li>
              <li><b>Portfolio</b> — every programme and its engagements.</li>
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
  // "Start here" — one prominent pointer at the right entry: Today when
  // anything waits on the user, the canvas otherwise. Dismissed for the
  // session the moment they go there.
  const openDisputeCount = useMemo(() => readContradictions(program, true).length, [program]);
  const waitingCount = openDecisions.length + portalInbox.length + openDisputeCount;
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
        setView(id);
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
            <div className="v3fs-hero-eyebrow">ATOS Flow{program.client ? <span> · {program.client}</span> : null}</div>
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
              return (
                <button key={id} type="button" className={view === id ? "on" : ""}
                  data-tip={DOCK_TIPS[id]}
                  aria-label={`${label} (shortcut ${shortcut})`}
                  onClick={() => {
                    // Navigating dismisses whatever overlay is up — the rail is
                    // always an exit, never dead under a modal.
                    setSearchOpen(false); setHelpOpen(false); setDrillOpen(false);
                    setView(id); window.scrollTo({ top: 0 }); if (id === startId) dismissStart();
                  }}>
                  {id === "today" && waitingCount > 0 ? <span className="v3fs-dock-n">{waitingCount}</span> : null}
                  <DockIcon id={id} /><span className="v3fs-rlb">{label}</span>
                  {id === startId && !startSeen && view !== startId ? (
                    <span className="v3fs-start" role="status">
                      <span className="v3fs-start-a" aria-hidden="true">◀</span>
                      Start here{startId === "today" ? ` — ${waitingCount} waiting` : ""}
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
          <span className="v3fs-appbar-brand">ATOS Flow</span>
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
          <button type="button" className="v3fs-appbar-nav" title="Help — how ATOS Flow works" aria-label="Help"
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
              <h1 className="v3fs-hero-title">Portfolio</h1>
              <p className="v3fs-hero-line v3fs-hero-current">
                Current programme — <b>{program.name}</b>
              </p>
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
          <FlowToday program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onResolveDecision={props.onResolveDecision} onSaveInputs={props.onSaveInputs}
            onIngestPortalItem={props.onIngestPortalItem} onDismissPortalItem={props.onDismissPortalItem}
            onGoFlow={() => { setView("flow"); window.scrollTo({ top: 0 }); }} />
        ) : view === "flow" ? (
          <FlowCanvas program={program} runningAgentIds={props.runningAgentIds} agentErrors={props.agentErrors} relatedPrograms={[...(drillParent ? [drillParent] : []), ...listChildDrilldowns(program, props.programs).map((c) => c.child)]} onSelectProgram={props.onSelectProgram} onComment={props.onComment} onRunAgent={props.onRunAgent} onSaveInputs={props.onSaveInputs} onMintPacks={props.onMintPacks} onMintDemoInvites={props.onMintDemoInvites} onCompileShipLanes={props.onCompileShipLanes} onToggleShipItem={props.onToggleShipItem} onSetShipLane={props.onSetShipLane} onScheduleFollowUp={props.onScheduleFollowUp} onMintFollowUp={props.onMintFollowUp} onRecordShowPass={props.onRecordShowPass} onSaveArtifactDoc={props.onSaveArtifactDoc} onRecordGate={props.onRecordGate} onReopenGate={props.onReopenGate} onRunAgentAndWait={props.onRunAgentAndWait} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }}
          />
        ) : view === "people" ? (
          <FlowPeople program={program} />
        ) : view === "library" ? (
          <FlowLibrary program={program} programs={props.programs} onSelectProgram={props.onSelectProgram} onSaveInputs={props.onSaveInputs} onTagClaim={props.onTagClaim} onComment={props.onComment} onSaveArtifactDoc={props.onSaveArtifactDoc} onOpenInbox={() => { setView("today"); window.scrollTo({ top: 0 }); }} onGoFlow={() => { setView("flow"); window.scrollTo({ top: 0 }); }} />
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
          />
        ) : view === "portfolio" ? (
          <FlowPortfolio
            onDeleteProgram={props.onDeleteProgram}
            onRenameProgram={props.onRenameProgram}
            programs={props.programs}
            activeId={program.id}
            onSelectProgram={(id) => { props.onSelectProgram(id); setView("flow"); window.scrollTo({ top: 0 }); }}
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

function FlowToday({ program, programs, onSelectProgram, onResolveDecision, onIngestPortalItem, onDismissPortalItem, onGoFlow, onSaveInputs }: {
  program: ProgramSummary;
  programs?: ProgramSummary[];
  onSelectProgram?: (id: string) => void;
  onResolveDecision: FlowShellProps["onResolveDecision"];
  onIngestPortalItem: FlowShellProps["onIngestPortalItem"];
  onDismissPortalItem: FlowShellProps["onDismissPortalItem"];
  onGoFlow: () => void;
  onSaveInputs?: FlowShellProps["onSaveInputs"];
}) {
  const movements = useMemo(() => flowMovements(), []);
  const open = listOpenFlowDecisions(program);
  const feed = listFlowAttestations(program);
  const inbox = listPortalInbox(program);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Open disputes queue HERE for the operator to ROUTE (to the person who can
  // settle it) or RESOLVE. Resolving writes the resolution to the record as
  // EVIDENCE and deletes the rows — there is no standing resolution log.
  const disputes = useMemo(() => readContradictions(program, true), [program]);
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
  const label = (id: string) => movements.find((m) => m.id === id)?.displayName ?? id;

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
        items.push({ movement: movement.displayName, what: readiness.detail ?? readiness.headline });
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
      {open.length === 0 && inbox.length === 0 && disputes.length === 0 ? (
        <div className="v3fs-quiet">
          <div className="v3fs-quiet-mark" aria-hidden="true">◈</div>
          {attention.length ? (
            <>
              <h2>The Inbox is clear — the record isn’t.</h2>
              <div className="v3fs-quiet-work">
                {attention.slice(0, 4).map((item) => (
                  <div key={item.movement} className="v3fs-quiet-row">
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
            <span>{open.length + inbox.length + disputes.length} item{open.length + inbox.length + disputes.length === 1 ? "" : "s"}</span>
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
                  : `${item.text.split(/\s+/).filter(Boolean).length.toLocaleString()} words${item.documents?.length ? ` · ${item.documents.length} document${item.documents.length === 1 ? "" : "s"} attached` : ""}`}
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
        </section>
      )}

    </div>
  );
}

/* ── Tracks: the build as demoable workstreams; acceptance is earned ─────── */

/* ── Mission Control: the fleet, the budgets, the levers, the trail ──────── */

function FlowMission({ program, fleet, loadMovementSpend, onSetHaltAll, onToggleAgentHalt, onSetMovementBudget, onRestoreSnapshot, aiStatus, onOpenAISettings }: {
  program: ProgramSummary;
  fleet: FlowShellProps["fleet"];
  loadMovementSpend: FlowShellProps["loadMovementSpend"];
  onSetHaltAll: FlowShellProps["onSetHaltAll"];
  onToggleAgentHalt: FlowShellProps["onToggleAgentHalt"];
  onSetMovementBudget: FlowShellProps["onSetMovementBudget"];
  onRestoreSnapshot?: (data: Record<string, unknown>) => Promise<void>;
  aiStatus?: string;
  onOpenAISettings?: () => void;
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
            <div className="v3fs-pf-head" role="button" tabIndex={0} aria-expanded={!isCollapsed} aria-controls={`${headId}-detail`}
              onClick={() => toggleCard(entry.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCard(entry.id); } }}>
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
                {isCollapsed && !active ? (
                  <button type="button" className="v3fs-btn sm" onClick={(e) => { e.stopPropagation(); onSelectProgram(entry.id); }}>Open</button>
                ) : null}
                <span className="v3fs-pf-chev" aria-hidden="true">⌄</span>
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
function FlowPeople({ program }: { program: ProgramSummary }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const evidence = useMemo(
    () => flowMovements().flatMap((m) => movementEvidence(program, m)),
    [program],
  );
  const roster = useMemo(() => resolveMovementStakeholders(program, "listen")
    .filter((entry) => !entry.isRole)
    .map((entry) => ({
      where: "Listen roster", name: entry.name, role: entry.role,
      email: stakeholderEmail(program, entry.name),
      heard: evidence.some((e) => e.who.toLowerCase().includes(entry.name.trim().toLowerCase())),
    })), [program, evidence]);
  const roles = useMemo(() => deliveryRoleDirectory(program).map((entry) => ({
    where: entry.movementId.charAt(0).toUpperCase() + entry.movementId.slice(1),
    name: entry.bound?.name ?? "", role: entry.role,
    email: entry.bound?.name ? (entry.bound.email ?? stakeholderEmail(program, entry.bound.name)) : null,
    bound: !!entry.bound?.name, isSponsor: entry.isSponsor,
  })), [program]);
  const match = (row: { name: string; role: string; where: string; email?: string | null }) =>
    !query || `${row.name} ${row.role} ${row.where} ${row.email ?? ""}`.toLowerCase().includes(query);
  const rosterShown = roster.filter(match);
  const rolesShown = roles.filter(match);
  const missing = roster.filter((r) => !r.email).length + roles.filter((r) => r.bound && !r.email && !r.isSponsor).length;
  return (
    <div className="v3fs-grid2">
      <div className="v3fs-search-row">
        <input className="v3fs-search" placeholder="Find a person, role, or address…"
          value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search people" />
      </div>
      <div className="v3fs-panel v3fs-panel-wide">
        <div className="v3fs-ph">
          <h3>People</h3>
          <span>everyone the programme collects from — {missing ? `${missing} without an address; ` : ""}edit on their collect card or in the Discovery Kit</span>
        </div>
        <table className="v3fs-dir">
          <thead><tr><th>Where</th><th>Person</th><th>Role</th><th>Email</th><th>Status</th></tr></thead>
          <tbody>
            {rosterShown.map((row, i) => (
              <tr key={`r-${i}`}>
                <td>{row.where}</td>
                <td>{row.name}</td>
                <td>{row.role}</td>
                <td>{row.email ?? <span className="v3fs-ivc-noaddr">✉ no address</span>}</td>
                <td><span className={`v3fs-vc ${row.heard ? "acc" : "pen"}`}>{row.heard ? "Heard" : "Awaiting"}</span></td>
              </tr>
            ))}
            {rolesShown.map((row, i) => (
              <tr key={`d-${i}`}>
                <td>{row.where}</td>
                <td>{row.name || <em>unbound — name them on the {row.where} collect card</em>}</td>
                <td>{row.role}</td>
                <td>{row.name ? (row.email ?? <span className="v3fs-ivc-noaddr">✉ no address</span>) : ""}</td>
                <td><span className={`v3fs-vc ${row.name ? "acc" : "pen"}`}>{row.name ? "Bound" : "Open"}</span></td>
              </tr>
            ))}
            {!rosterShown.length && !rolesShown.length ? (
              <tr><td colSpan={5}><div className="v3fs-empty">Nothing matches that search.</div></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlowLibrary({ program, programs, onSelectProgram, onSaveInputs, onTagClaim, onComment, onSaveArtifactDoc, onOpenInbox, onGoFlow }: { program: ProgramSummary; programs: ProgramSummary[]; onSelectProgram: (id: string) => void; onSaveInputs?: FlowShellProps["onSaveInputs"]; onTagClaim?: FlowShellProps["onTagClaim"]; onComment?: FlowShellProps["onComment"]; onSaveArtifactDoc: FlowShellProps["onSaveArtifactDoc"]; onOpenInbox?: () => void; onGoFlow?: () => void }) {
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
    evidence: movements.flatMap((m) => movementEvidence(program, m)),
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
  const label = (id: string) => movements.find((m) => m.id === id)?.displayName ?? id;



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
        <div className="v3fs-panel v3fs-dd-panel">
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
        <div className="v3fs-panel v3fs-claims">
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
            if (entry.kind === "document" && entry.sourceKey) {
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
        {artifactLedger.map((artifact) => (
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
            <span className="v3fs-tag gn">{label(artifact.movementId)}</span>
          </div>
        ))}
      </div>
      {docFor ? <FlowArtifactStudio program={program} artifact={docFor} onClose={() => setDocFor(null)} onSaveDoc={onSaveArtifactDoc} onSaveInputs={onSaveInputs} onComment={onComment} onOpenInbox={onOpenInbox}
        onOpenArtifact={(artifactId) => {
          for (const m of flowMovements()) {
            const hit = movementArtifacts(program, m).find((a) => a.id === artifactId && a.present);
            if (hit) { setDocFor(hit); return; }
          }
        }} /> : null}
      {evFor ? (
        <EvidenceReader entry={evFor} highlight={claimHighlight} targets={tagTargets}
          onTag={onTagClaim ? (target, quote) => onTagClaim({ quote, who: evFor.who, movementId: evFor.movementId, target }) : undefined}
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
