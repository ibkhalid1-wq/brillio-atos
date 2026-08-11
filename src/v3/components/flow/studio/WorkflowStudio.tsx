/**
 * THE WORKFLOWS as a swimlane diagram: PERSONAS are
 * rows, the workflow overlays them left-to-right — each step tile sits in
 * the lane of the actor who performs it, at its position in the sequence.
 * Tiles carry the step's system, duration, the ontology's entity chips, and
 * the pain heatmap overlaid as a severity edge with the strongest voiced
 * complaint. The diagram IS the document: selection edits in the inspector;
 * add/reorder/remove rewrite the same steps array the generator emits.
 *
 * ONE SURFACE, NOT TWO. The atlas used to be a read-only overview (the seam
 * view) followed by a separate "Edit a workflow" panel with its own cascading
 * Area/Workflow selects — the only place a workflow or a step could be changed.
 * Two lists of the same workflows, one to look at and one to edit. Now the seam
 * view IS the editor: a workflow's row carries its create/dismiss affordances,
 * and opening a row expands THIS file's summary card, swimlane and step
 * inspector inline underneath it (handed to AtlasSeamView as
 * `renderWorkflowDetail`, so the diagram and the inspector are moved, not
 * reimplemented). Picking a workflow in the lifecycle grid opens the same row.
 *
 * ONE COMPONENT, TWO SURFACES. The workflows belong to the CURRENT-STATE ATLAS —
 * that is where the work is described, and where every structural change is made:
 * rename a workflow, retarget its area, add / reorder / drop a step, dismiss the
 * whole thing. AGENTIFY draws the SAME workflows and decides exactly one thing
 * about them: can this step be agentified. So `surface` splits the two:
 *
 *   surface="atlas"    (default) — full CRUD, and NO agentify control. The Atlas
 *                      describes the work; it does not decide automation, and it
 *                      does not display a call it did not make.
 *   surface="agentify" — read-only as to STRUCTURE (no add/remove/reorder, no
 *                      workflow fields, no dismiss). The flag is the only edit, and
 *                      it does not write a workflow: it writes a DECISION, keyed by
 *                      the atlas step's ledger element id (agentifyDecisions).
 *
 * There is deliberately no second copy of the workflows. Agentify's caller hands
 * this component the ATLAS's own array, so a rename on the Atlas is a rename on
 * Agentify, immediately, with nothing to reconcile.
 *
 * The registers (events · pain · systems) are properties of the ATLAS document, not
 * of a workflow, so they render outside this component — exported below as
 * `AtlasRegisters`. `registerDoc` points at whichever document holds them, so the
 * swimlane's pain shading and event chips read the same register on both tabs.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  TextField, SelectField, ChipsField, TableEditor, CollapsibleCard,
  asArray, asRecord, asText, asStrings, useStudioLocked, useStudioAuthoring, useStudioPrinting,
  curationNote, DismissControl, EmptyState, type StudioProps,
} from "./StudioKit";
import { workflowArea, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { listenCoverageAreas, canonicalFrameArea } from "@/v3/components/flow/listenCoverage";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { useProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { anchorWorkflowsToAtlas, resolveWorkflow, resolveStep } from "@/v3/lib/ledger/agentifyAnchor";
import {
  AGENTIFY_MODES, asMode, decisionStepId, type AgentifyMode, type DecisionMap,
} from "@/v3/lib/ledger/agentifyDecisions";
import type { SlotView, StepView } from "@/v3/lib/ledger/projections";
import { ClaimStatus } from "@/v3/components/flow/studio/ledgerPrimitives";
import AtlasSeamView from "./AtlasSeamView";
import AtlasLifecycleGrid from "./AtlasLifecycleGrid";
import LedgerLensPanel from "./LedgerLensPanel";

interface PainHit {
  severity: string;
  pain: string;
  quote: string;
}

/** What the diagram is looking at right now — the selected step, else the
 * active workflow. The Atlas's register cards (events / pains / systems)
 * filter to it, so clicking a step narrows the whole tab to its context. */
export interface AtlasFocus {
  label: string;
  events: string[];
  systems: string[];
  pains: string[];
  /** Free-text terms (workflow name, actors, entities…) — the gaps and open
   * questions filter to items that mention one. */
  terms: string[];
}

/** Loose word-stem hit so "QuoteAmended" lands on "Amend the quote". */
const stemHit = (haystack: string, word: string) => haystack.includes(word.replace(/(ed|ing|s)$/i, ""));
const eventWords = (name: string) =>
  name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/** The business events on a step — the ontology's event names. Explicit
 * annotations (`step.events`, the generator's or the operator's) lead; a
 * deterministic match follows, same discipline as painForStep but STRICT:
 * every significant word of the event's name must appear in the step's
 * action. (Matching on shared entities was tried and dropped — it put
 * "Opportunity Created" on every step that touches an Opportunity.) */
function eventsForStep(step: Record<string, unknown>, events: Array<Record<string, unknown>>): string[] {
  const explicit = asStrings(step.events);
  const action = asText(step.action).toLowerCase();
  const matched = events
    .filter((event) => {
      const name = asText(event.name);
      if (!name || explicit.includes(name)) return false;
      const words = eventWords(name);
      return words.length > 0 && words.every((word) => stemHit(action, word));
    })
    .map((event) => asText(event.name));
  return [...explicit, ...matched];
}

/** The business-event register: the atlas document's own events, plus any still
 * sitting on a legacy ontology doc that predates the move. One reader, so the
 * swimlane's chips and the Atlas tab's events table can never disagree. */
function atlasEvents(atlasDoc: Record<string, unknown>, program?: StudioProps["program"]): Array<Record<string, unknown>> {
  const own = asArray(atlasDoc.events).map(asRecord);
  const legacy = program ? asArray(readArtifactDoc(program, "domainOntology")?.events).map(asRecord) : [];
  const seen = new Set(own.map((event) => asText(event.name).toLowerCase()));
  return [...own, ...legacy.filter((event) => !seen.has(asText(event.name).toLowerCase()))];
}

/** Deterministic pain↔step match: a heatmap entry lands on a step when a
 * significant word of its area appears in the step's action/system, or the
 * step's system appears in the entry. Highest severity wins. */
function painForStep(step: Record<string, unknown>, pains: Array<Record<string, unknown>>): PainHit | null {
  const hay = `${asText(step.action)} ${asText(step.system)}`.toLowerCase();
  const system = asText(step.system).toLowerCase();
  const rank = (severity: string) => (severity === "high" ? 3 : severity === "medium" ? 2 : 1);
  let best: PainHit | null = null;
  for (const entry of pains) {
    const area = asText(entry.area).toLowerCase();
    const painText = asText(entry.pain).toLowerCase();
    const words = area.split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
    const hits = words.some((word) => hay.includes(word))
      || (system.length >= 3 && (area.includes(system) || painText.includes(system)));
    if (!hits) continue;
    const severity = asText(entry.severity) || "medium";
    if (!best || rank(severity) > rank(best.severity)) {
      best = { severity, pain: asText(entry.pain) || asText(entry.area), quote: asText(entry.quote) };
    }
  }
  return best;
}

/**
 * ONE workflow, drawn for paper.
 *
 * The screen studio shows the swimlane of whichever workflow is selected, and
 * everything around it — the tile buttons, the entity links, the hover peek —
 * exists to change that selection. None of it means anything printed, and the
 * unselected workflows are not in the DOM at all, which is why an exported
 * atlas used to carry one diagram out of ten.
 *
 * So this is a flatter twin of that markup: same grid, same lanes, same pain
 * shading, but static — and the caller renders it once per workflow. The step
 * chips also stop truncating here (`slice(0, 3)` on screen, all of them on
 * paper): a page has the room a tile does not.
 */
function PrintWorkflowDiagram({ workflow, pains, ontoEvents, area, modeOf }: {
  workflow: Record<string, unknown>;
  pains: Array<Record<string, unknown>>;
  ontoEvents: Array<Record<string, unknown>>;
  area: string;
  /** The call on a step, or "" — empty on the Atlas, which makes no call. */
  modeOf: (step: Record<string, unknown>) => string;
}) {
  const steps = asArray(workflow.steps).map(asRecord);
  const lanes: string[] = [];
  for (const step of steps) {
    const actor = asText(step.actor).trim() || "Unassigned";
    if (!lanes.includes(actor)) lanes.push(actor);
  }
  const initials = (lane: string): string => {
    const words = lane.split(/[^A-Za-z0-9]+/).filter(Boolean);
    return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || lane.slice(0, 2).toUpperCase();
  };
  return (
    <section className="v3fs-wf-printwf">
      <div className="v3fs-wf-cockpit">
        <div className="v3fs-wf-ckpt-id">
          <span className="v3fs-wf-ckpt-name">{asText(workflow.name) || "Untitled workflow"}</span>
          {area ? <span className="v3fs-wf-ckpt-trig">{area}</span> : null}
          {asText(workflow.trigger) ? <span className="v3fs-wf-ckpt-trig">{asText(workflow.trigger)}</span> : null}
        </div>
        <div className="v3fs-wf-ckpt-stats">
          <span><b>{steps.length}</b> step{steps.length === 1 ? "" : "s"}</span>
          <span><b>{lanes.length}</b> persona{lanes.length === 1 ? "" : "s"}</span>
          {asText(workflow.owner) ? <span className="v3fs-wf-ckpt-owner">{asText(workflow.owner)}</span> : null}
        </div>
      </div>
      {steps.length === 0 ? (
        <div className="v3fs-stu-empty">No steps recorded for this workflow.</div>
      ) : (
        <div className="v3fs-swim-scroll">
          <div className="v3fs-swim" style={{ gridTemplateColumns: `110px repeat(${steps.length}, minmax(0, 1fr))` }}>
            {lanes.map((lane) => (
              <React.Fragment key={lane}>
                <div className="v3fs-swim-lane"><span className="v3fs-swim-av" aria-hidden="true">{initials(lane)}</span>{lane}</div>
                {steps.map((step, index) => {
                  const actor = asText(step.actor).trim() || "Unassigned";
                  if (actor !== lane) return <div key={index} className="v3fs-swim-cell" aria-hidden="true" />;
                  const pain = painForStep(step, pains);
                  const entities = asStrings(step.entities);
                  const stepEvents = eventsForStep(step, ontoEvents);
                  return (
                    <div key={index} className="v3fs-swim-cell has">
                      <div className={`v3fs-swim-tile${pain ? ` pain-${pain.severity}` : ""}`}>
                        <span className="v3fs-swim-n" aria-hidden="true">{index + 1}</span>
                        <span className="v3fs-swim-action">{asText(step.action) || "—"}</span>
                        <span className="v3fs-swim-meta">
                          {/* The agentification call, where one has been made. An
                              undecided step shows NOTHING — never a default mode
                              dressed up as a decision. (And the Atlas makes no
                              calls at all, so `modeOf` is empty there.) */}
                          {modeOf(step)
                            ? <span className={`v3fs-wf-flag ${modeOf(step)}`}>{AGENTIFY_MODE_LABEL[modeOf(step)]}</span>
                            : null}
                          {asText(step.system) ? <span className="v3fs-wf-system">{asText(step.system)}</span> : null}
                          {asText(step.duration) ? <span className="v3fs-wf-dur">{asText(step.duration)}</span> : null}
                        </span>
                        {pain ? <span className="v3fs-swim-pain">{pain.pain}</span> : null}
                        {entities.length || stepEvents.length ? (
                          <span className="v3fs-wf-ents">
                            {entities.map((entity) => <span key={entity} className="v3fs-wf-ent">{entity}</span>)}
                            {stepEvents.map((name) => <span key={`ev-${name}`} className="v3fs-wf-evt">⚡{name}</span>)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** The agentification call on one step — the same three modes flowFutureState
 * projects, now RECORDED rather than only inferred. The list itself lives with the
 * decisions (agentifyDecisions), so the surface and the store cannot drift. */
export { AGENTIFY_MODES } from "@/v3/lib/ledger/agentifyDecisions";
export const AGENTIFY_MODE_LABEL: Record<string, string> = {
  agentify: "Agentify", assist: "Assist", keep: "Keep manual",
};
const AGENTIFY_MODE_HINT: Record<string, string> = {
  agentify: "An agent runs this step end to end.",
  assist: "An agent prepares it; a human still decides.",
  keep: "This step stays a human judgement.",
};
/** The mode recorded ON A STEP, or "" when nobody has decided yet. NEVER guessed
 * here — an undecided step reads undecided, and the Envision projection falls
 * back to its own heuristic rather than this surface inventing one.
 *
 * This is the LEGACY reading: a decision that was written onto a copy of the
 * workflow. New decisions live in `agentify.decisions`, keyed by the atlas step's
 * element id, and reach the diagram through the `decisions` prop. */
export const stepMode = (step: Record<string, unknown>): string => asMode(step.mode);

export default function WorkflowStudio({
  doc, onChange, onOpenArtifact, program, onFocus, registerDoc,
  surface = "atlas", anchorDoc, decisions, onDecide,
}: StudioProps & {
  onFocus?: (focus: AtlasFocus | null) => void;
  /** Where the pain heatmap and the business-event register live. Defaults to
   * `doc` for a caller that holds the workflows and the registers together — the
   * Current-State Atlas does. */
  registerDoc?: Record<string, unknown>;
  /** Which tab this is: the Atlas edits the work, Agentify decides one thing about
   * it. See the header. */
  surface?: "atlas" | "agentify";
  /** The STORED Current-State Atlas — what the claims ledger was migrated from, and
   * therefore what an anchor has to be computed against. Distinct from `doc` (which
   * on the Atlas tab is the unsaved DRAFT) and from `registerDoc`: anchoring the
   * draft to itself would stamp a workflow the operator just invented with an id the
   * ledger has never held, and it would read STRANDED instead of honestly empty. */
  anchorDoc?: Record<string, unknown>;
  /** Agentify only: the call on each step, by atlas step element id. */
  decisions?: DecisionMap;
  /** Agentify only: record or withdraw the call on one step. Its presence is what
   * makes the flag control appear at all. */
  onDecide?: (stepId: string, patch: { mode?: AgentifyMode | ""; rationale?: string }) => void;
}) {
  const locked = useStudioLocked();
  const authoring = useStudioAuthoring();
  const printing = useStudioPrinting();
  const regDoc = registerDoc ?? doc;
  // STRUCTURE IS THE ATLAS'S. Agentify draws the same workflows and may not reshape
  // them — no add, no reorder, no drop, no rename, no dismiss. Separate from `locked`
  // (the artifact's own lock/derived gate) because the flag control below must stay
  // live on an unlocked Agentify while everything around it is frozen.
  const structureLocked = locked || surface === "agentify";
  // ANCHORED WORKFLOWS — each carrying the ledger element id of the ATLAS
  // workflow/step it describes (agentifyAnchor). Derived here, over the document AS
  // IT STANDS, because that is the last moment the draft and the stored atlas are
  // known to agree: every write below maps over THIS array, so an operator's rename
  // carries the anchor computed from the name they are replacing.
  //
  // Reading is still pure — `anchorWorkflowsToAtlas` returns the same array when
  // there is nothing to add, and nothing here calls onChange. The anchors reach the
  // document only when the operator writes something, on the write they made.
  const anchorSource = anchorDoc ?? regDoc;
  const workflows = useMemo(
    () => anchorWorkflowsToAtlas(asArray(doc.workflows).map(asRecord), anchorSource),
    [doc.workflows, anchorSource],
  );
  // The call on a step: Agentify's decisions register, keyed by the step's atlas
  // element id, with the legacy per-step `mode` behind it. On the ATLAS this is
  // always "" — the Atlas describes the work and shows no call, because it makes
  // none.
  const modeOf = useCallback((step: Record<string, unknown>): string => {
    if (surface !== "agentify") return "";
    const wf = workflows.find((entry) => asArray(entry.steps).includes(step));
    const id = wf ? decisionStepId(wf, step) : "";
    return (id && decisions?.[id]?.mode) || stepMode(step);
  }, [surface, workflows, decisions]);
  const pains = useMemo(() => asArray(regDoc.painHeatmap).map(asRecord), [regDoc.painHeatmap]);
  // `active` is now the workflow OPENED INLINE in the seam view — null when none
  // is open (there is no separate editor below to keep pointed at something).
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const workflow = active == null ? undefined : workflows[active];
  const steps = useMemo(() => (workflow ? asArray(workflow.steps).map(asRecord) : []), [workflow]);

  // LEDGER-AWARE: this surface reads the same claims ledger every other surface
  // reads, so each step shows its CLAIM STATUS (source + open/weak/closed/conflict
  // per slot) — the diagram is a ledger surface, not a detached form.
  //
  // Resolved by ANCHOR, not by text. The ledger is migrated from the ATLAS, and this
  // document is Agentify's own copy of the atlas's workflows; matching the two on
  // workflow name and step action held only while the copies read identically, which
  // the first rename on this tab ended — silently, into an empty state that read
  // exactly like "never had claims". agentifyAnchor gives each workflow/step the
  // atlas element id it was drafted from and resolves through that, and where it
  // genuinely cannot resolve it says STRANDED rather than nothing. See that module.
  const ledger = useProgramLedger(program);
  const wfClaims = useMemo(() => resolveWorkflow(ledger.atlas, workflow), [ledger.atlas, workflow]);
  const claimsForStep = useCallback(
    (step: Record<string, unknown> | undefined) => resolveStep(wfClaims, step),
    [wfClaims],
  );
  // A compact claim-status summary for a step's slots (open unknowns loudest).
  const stepClaimSummary = (sv?: StepView | null): { openSlots: SlotView[]; weak: number; closed: number; conflict: number } => {
    const slots = sv?.slots ?? [];
    return {
      openSlots: slots.filter((s) => s.state === "open" || s.state === "blocked"),
      weak: slots.filter((s) => s.state === "weak").length,
      closed: slots.filter((s) => s.state === "closed").length,
      conflict: slots.filter((s) => s.state === "conflict").length,
    };
  };
  // Business events woven into the diagram: an event chip on the step that
  // raises it, and the workflow's trigger named as an event where one starts
  // it. Events live on the ATLAS document (its own events register), which is
  // what `registerDoc` points at when the workflows are Agentify's.
  const ontoEvents = useMemo(() => atlasEvents(regDoc, program), [regDoc, program]);
  const triggerEvent = useMemo(() => {
    const trigger = asText(workflow?.trigger).toLowerCase();
    if (!trigger) return null;
    const hit = ontoEvents.find((event) => {
      const words = eventWords(asText(event.name));
      return words.length > 0 && words.every((word) => stemHit(trigger, word));
    });
    return hit ? asText(hit.name) : null;
  }, [workflow, ontoEvents]);

  // The atlas is organised BY the FRAME's areas — the same list the Discovery
  // Kit covers. The generator's own area tag is free-form ("Sales & Delivery")
  // and drifted outside the frame, so each workflow's tag is CANONICALISED to
  // the closest frame area: exact label first, else the frame area sharing the
  // most words ("Sales & Delivery" → Delivery), else General. Tabs therefore
  // always read in the programme's own vocabulary.
  const frameAreas = useMemo(
    () => (program ? listenCoverageAreas(program).map((area) => area.label) : []),
    [program],
  );
  const frameAreaFor = useCallback((raw: string): string => canonicalFrameArea(frameAreas, raw), [frameAreas]);
  const groupedTabs = useMemo(() => {
    const groups = new Map<string, Array<{ name: string; index: number }>>();
    workflows.forEach((entry, index) => {
      const area = frameAreaFor(workflowArea(entry));
      const list = groups.get(area) ?? [];
      list.push({ name: asText(entry.name) || `Workflow ${index + 1}`, index });
      groups.set(area, list);
    });
    return [...groups.entries()].sort(([a], [b]) =>
      a === GENERAL_AREA ? 1 : b === GENERAL_AREA ? -1 : a.localeCompare(b));
  }, [workflows, frameAreaFor]);
  // Areas the FRAME's coverage plan promises but the atlas hasn't mapped a
  // workflow for yet — e.g. Talent, whose SME hasn't been heard. Surfacing
  // them keeps the atlas honest: the domain is in scope, its workflow is
  // still a gap. Bounded by the Discovery Kit's areas ON PURPOSE — the raw
  // programAreas union carries canonical keyword seeds (Support, People…)
  // that are placement vocabulary, not programme scope, and they nagged as
  // "not mapped yet" for domains the Frame never included.
  const unmappedAreas = useMemo(() => {
    if (!program) return [];
    const covered = new Set(groupedTabs.map(([area]) => area.toLowerCase()));
    // Clean single-domain areas only — a compound label ("Alliances/Finance")
    // is an entity spanning areas already mapped by their segments, not its own
    // missing workflow. So "Talent" surfaces; "Talent/Delivery" doesn't.
    return listenCoverageAreas(program).map((area) => area.label).filter((area) =>
      area !== GENERAL_AREA && !area.includes("/") && !covered.has(area.toLowerCase()));
  }, [program, groupedTabs]);

  // Personas: rows in order of first appearance; blank actors pool at the foot.
  const lanes = useMemo(() => {
    const seen: string[] = [];
    for (const step of steps) {
      const actor = asText(step.actor).trim() || "Unassigned";
      if (!seen.includes(actor)) seen.push(actor);
    }
    return seen;
  }, [steps]);

  // The cockpit strip's live facts + the hover evidence peek.
  const laneInitials = (lane: string): string => {
    const words = lane.split(/[^A-Za-z0-9]+/).filter(Boolean);
    return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || lane.slice(0, 2).toUpperCase();
  };
  // A step's system is often a compound ("CRM, Email, Teams") — split it so
  // counts and the register filter speak in single systems.
  const splitSystems = (value: string): string[] => value.split(/[,/&]+| and /i).map((s) => s.trim()).filter(Boolean);
  const systems = useMemo(() => [...new Set(steps.flatMap((step) => splitSystems(asText(step.system))))], [steps]);
  const painCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const step of steps) {
      const hit = painForStep(step, pains);
      if (hit) counts[(hit.severity as "high" | "medium" | "low") in counts ? (hit.severity as "high" | "medium" | "low") : "medium"] += 1;
    }
    return counts;
  }, [steps, pains]);
  const [peek, setPeek] = useState<null | { index: number; x: number; y: number }>(null);
  const showStepPeek = (index: number) => (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPeek({ index, x: Math.min(rect.left, Math.max(8, window.innerWidth - 380)), y: rect.bottom + 8 });
  };

  // The diagram's focus (selected step, else the active workflow) — drives
  // the combined details-and-registers card here and, via onFocus, the gaps
  // and open-question sections in the parent studio.
  const focus = useMemo<AtlasFocus | null>(() => {
    if (!workflow) return null;
    const step = selected != null ? steps[selected] : null;
    if (step) {
      const events = eventsForStep(step, ontoEvents);
      const stepSystems = splitSystems(asText(step.system));
      return {
        label: `${asText(workflow.name) || "workflow"} · step ${(selected ?? 0) + 1}`,
        events,
        systems: stepSystems,
        pains: [painForStep(step, pains)?.pain ?? ""].filter(Boolean),
        terms: [asText(workflow.name), asText(step.actor), ...stepSystems, ...asStrings(step.entities), ...events].filter(Boolean),
      };
    }
    const wfEvents = [...new Set([...(triggerEvent ? [triggerEvent] : []), ...steps.flatMap((s) => eventsForStep(s, ontoEvents))])];
    return {
      label: asText(workflow.name) || "workflow",
      events: wfEvents,
      systems,
      pains: [...new Set(steps.map((s) => painForStep(s, pains)?.pain ?? "").filter(Boolean))],
      terms: [asText(workflow.name), ...lanes, ...systems, ...wfEvents].filter(Boolean),
    };
  }, [workflow, steps, selected, ontoEvents, pains, systems, lanes, triggerEvent]);
  useEffect(() => { onFocus?.(focus); }, [onFocus, focus]);
  // (The registers that used to sit under the diagram now live on the Current-
  // State Atlas tab — see AtlasRegisters below. The focus they were scoped to is
  // still published through onFocus, which is what scopes THIS artifact's own
  // open questions and gaps.)

  // THE ONE DOOR to the workflows array — and it is bolted shut on Agentify. Every
  // structural affordance is already hidden there, so this is the belt to that
  // braces: no path through this component can put a copy of the Atlas's workflows
  // onto the Agentify document, however the surface is later rearranged.
  const writeWorkflows = useCallback((next: Array<Record<string, unknown>>) => {
    if (structureLocked) return;
    onChange({ ...doc, workflows: next });
  }, [doc, onChange, structureLocked]);
  const patchWorkflow = useCallback((patch: Record<string, unknown>) => {
    if (active == null) return;
    writeWorkflows(workflows.map((entry, index) => (index === active ? { ...entry, ...patch } : entry)));
  }, [workflows, active, writeWorkflows]);
  const patchStep = useCallback((index: number, patch: Record<string, unknown>) => {
    patchWorkflow({ steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  }, [steps, patchWorkflow]);

  // ── THE THREE STEP WRITES ───────────────────────────────────────────────────
  // One insert, one move, one drop-toggle — and every affordance goes through
  // exactly one of them. The toolbar under the diagram and the controls ON a tile
  // are two DOORS to the same three writes, never two implementations of them: a
  // drag that reordered by its own path would be a second way for the document to
  // change, and the first one to drift would do it silently.
  const insertStep = useCallback((at: number, actor: string) => {
    if (structureLocked) return;
    const next = [...steps];
    next.splice(at, 0, { actor, action: "New step", system: "", duration: "" });
    patchWorkflow({ steps: next });
    setSelected(at);
  }, [steps, patchWorkflow, structureLocked]);
  /**
   * Move the step at `from` to index `to`. The ONE reorder — `← Earlier`, `Later →`
   * and a dropped tile all land here, so the keyboard path and the pointer path
   * cannot disagree about what a move is.
   *
   * The step OBJECT is carried, never rebuilt: its `_atlasStepId` anchor (and hence
   * the Agentify decision filed under that id) rides along with it. Dropped steps
   * are ordinary members of the array here — they move like any other step and are
   * neither skipped nor resurrected, because `dropped` is a flag on a step, not a
   * separate list.
   */
  const reorderStep = useCallback((from: number, to: number) => {
    if (structureLocked) return;
    if (from === to) return;
    if (from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(from, 1);
    next.splice(to, 0, step);
    patchWorkflow({ steps: next });
    setSelected(to);
  }, [steps, patchWorkflow, structureLocked]);
  // MARK-DROPPED, not hard-delete: a step can carry closed claims (its lineage),
  // and reconcile's element handling keeps a dropped element findable as an orphan
  // rather than destroying it. So "remove" sets a soft `dropped` flag — the step
  // stays in the document (and in the ledger, findable), rendered struck-through,
  // and is restorable. A true hard delete of a claim-carrying element is refused.
  const toggleDropped = useCallback((index: number) => {
    if (structureLocked || !steps[index]) return;
    patchStep(index, { dropped: !asRecord(steps[index]).dropped });
  }, [steps, patchStep, structureLocked]);

  const addStep = () => insertStep(
    selected != null ? selected + 1 : steps.length,
    selected != null ? asText(steps[selected].actor) : "",
  );
  const moveStep = (delta: number) => { if (selected != null) reorderStep(selected, selected + delta); };
  const dropStep = () => { if (selected != null) toggleDropped(selected); };

  // ── DIRECT MANIPULATION ─────────────────────────────────────────────────────
  // Dragging a tile reorders the step. `drag` holds where the drag started and where
  // it would LAND (an insertion index, 0…steps.length) — the landing point is drawn
  // as a marker in the column, because a drag with no drop feedback is a guess.
  //
  // It is a POINTER CONVENIENCE and never the only way: HTML5 drag-and-drop cannot be
  // reached from a keyboard at all, so `← Earlier` / `Later →` remain the keyboard
  // path to the very same `reorderStep`. Nothing here is the sole route to anything.
  const [drag, setDrag] = useState<{ from: number; at: number } | null>(null);
  /** Our own drag, told apart from a file or a drag from elsewhere on the page. */
  const DRAG_MIME = "application/x-atlas-step";
  /**
   * Which SLOT a pointer at this column means: before it, or after it. Halved on the
   * column's own box, so the marker sits where the tile will actually go.
   * A zero-width box (jsdom, or a column not yet laid out) reads as "before" — a
   * defined answer rather than a coin toss.
   */
  const insertionAt = (e: React.DragEvent<HTMLElement>, index: number): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.width > 0 && e.clientX > rect.left + rect.width / 2 ? index + 1 : index;
  };
  /**
   * The whole COLUMN is the target, not just the tile: a step's tile sits in one
   * lane, and dropping into the empty cells above or below it plainly means "here",
   * so every cell of the column carries these. Locked/derived and Agentify get an
   * empty object — no drop handler at all, rather than one that fails silently.
   */
  const dropZone = (index: number) => (structureLocked ? {} : {
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!drag) return;                       // not our drag — let the page have it
      e.preventDefault();                      // "yes, you may drop here"
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const at = insertionAt(e, index);
      setDrag((prev) => (prev && prev.at !== at ? { ...prev, at } : prev));
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      const at = insertionAt(e, index);
      const from = drag.from;
      setDrag(null);
      // An insertion index counts the gaps; an array index counts the steps. Pulling
      // the dragged step out first shifts every gap after it down by one.
      reorderStep(from, at > from ? at - 1 : at);
    },
  });
  // CREATE — the ＋ workflow affordance the removed panel's filter row carried,
  // now reachable from the seam view (and from the empty state). Authoring-gated
  // by the caller; the new workflow opens inline straight away.
  const addWorkflow = useCallback(() => {
    writeWorkflows([...workflows, { name: `Workflow ${workflows.length + 1}`, owner: "", trigger: "", steps: [], handoffs: [], failureModes: [] }]);
    setActive(workflows.length);
    setSelected(null);
  }, [workflows, writeWorkflows]);
  // DISMISS — one destructive path, still reason-bearing and still noted on the
  // curation trail, exactly as the removed panel's DismissControl did.
  const dismissWorkflow = useCallback((index: number, reason: string) => {
    const entry = workflows[index];
    if (!entry || structureLocked) return;
    onChange({
      ...doc,
      workflows: workflows.filter((_, i) => i !== index),
      ...curationNote(doc, `Dismissed workflow “${asText(entry.name) || `#${index + 1}`}”`, reason),
    });
    setActive(null);
    setSelected(null);
  }, [workflows, doc, onChange, structureLocked]);
  // Opening a row toggles it; the lifecycle grid always opens (never closes).
  const toggleWorkflow = useCallback((index: number) => {
    setActive((prev) => (prev === index ? null : index));
    setSelected(null);
  }, []);
  const openWorkflow = useCallback((index: number) => { setActive(index); setSelected(null); }, []);

  // EXPORT: every workflow, in area order, instead of the one on the tab.
  // Placed after every hook so the hook order never changes between the screen
  // render and the print render.
  if (printing) {
    return (
      <div className="v3fs-wf printing">
        {workflows.length === 0 ? <div className="v3fs-stu-empty">No workflows on record.</div> : null}
        {groupedTabs.map(([area, items]) => (
          <React.Fragment key={area}>
            <h3 className="v3fs-wf-printarea">{area} · {items.length} workflow{items.length === 1 ? "" : "s"}</h3>
            {items.map(({ index }) => (
              <PrintWorkflowDiagram key={index} workflow={workflows[index]}
                pains={pains} ontoEvents={ontoEvents} area={area} modeOf={modeOf} />
            ))}
          </React.Fragment>
        ))}
        {/* Frame areas with no workflow yet are part of the picture too — an
            atlas that silently omits them reads as complete when it isn't. */}
        {unmappedAreas.length ? (
          <div className="v3fs-wf-unmapped-row">
            Not mapped yet: {unmappedAreas.map((area) => <span key={area} className="v3fs-wf-unmapped">{area}</span>)}
          </div>
        ) : null}
      </div>
    );
  }

  // THE MOVED EDITOR — the cockpit, the workflow summary card, the swimlane and
  // the step inspector: the same markup the deleted "Edit a workflow" section
  // carried, handed to the seam view so it renders INSIDE the opened workflow's
  // own row. Never a second copy of the diagram; the same one, relocated.
  const workflowDetail = (wfIndex: number) => {
    if (!workflow || wfIndex !== active) return null;
    return (
      <>
      {/* The cockpit: this workflow's vitals in one glance — what starts
          it, who owns it, its size, and where the pain sits. */}
      <div className="v3fs-wf-cockpit">
        <div className="v3fs-wf-ckpt-id">
          <span className="v3fs-wf-ckpt-name">{asText(workflow.name) || "Untitled workflow"}</span>
          {triggerEvent
            ? <span className="v3fs-wf-evt" title="The business event that starts this workflow">⚡{triggerEvent}</span>
            : asText(workflow.trigger) ? <span className="v3fs-wf-ckpt-trig" title="What starts this workflow">{asText(workflow.trigger)}</span> : null}
        </div>
        <div className="v3fs-wf-ckpt-stats">
          <span><b>{steps.length}</b> step{steps.length === 1 ? "" : "s"}</span>
          <span><b>{lanes.length}</b> persona{lanes.length === 1 ? "" : "s"}</span>
          <span><b>{systems.length}</b> system{systems.length === 1 ? "" : "s"}</span>
          {painCounts.high || painCounts.medium || painCounts.low ? (
            <span className="v3fs-wf-ckpt-pains" title="Steps carrying voiced pain, by severity">
              {painCounts.high ? <i className="high">{painCounts.high}</i> : null}
              {painCounts.medium ? <i className="medium">{painCounts.medium}</i> : null}
              {painCounts.low ? <i className="low">{painCounts.low}</i> : null}
              pain
            </span>
          ) : null}
          {asText(workflow.owner) ? <span className="v3fs-wf-ckpt-owner">{asText(workflow.owner)}</span> : null}
        </div>
      </div>
      {/* WORKFLOW SUMMARY — the whole flow's facts, ABOVE the diagram: the read
          goes summary → swimlane → one step's form. Indigo card; the step form
          below is the white working card with the accent spine, so the two levels
          never look alike.
          On the ATLAS these fields are editable — this is where the work is
          described. On AGENTIFY they are the same facts, stated and not offered,
          because reshaping a workflow is not a call Agentify gets to make. */}
      <div className="v3fs-wf-details">
        <div className="v3fs-wf-card-eyebrow">Workflow summary
          {surface === "agentify" ? <em className="v3fs-wf-src">from the Current-State Atlas</em> : null}</div>
        {/* A stranded WORKFLOW strands every step under it (the steps' claims are
            filed beneath its id), so it is said once here rather than repeated on
            each step — and said WITHOUT having to select a step to discover it. */}
        {wfClaims.state === "stranded" ? (
          <div className="v3fs-wf-claims stranded">
            <span className="v3fs-wf-claims-h">⚠ Evidence stranded</span>
            <span className="v3fs-wf-claims-sum">
              The Current-State Atlas no longer holds the workflow this was drafted from, so none of
              its steps can reach their claims. Regenerate Agentify from the Atlas to re-anchor it.
            </span>
            <span className="v3fs-wf-claims-note">Anchor: <code>{wfClaims.anchor}</code></span>
          </div>
        ) : null}
        {surface === "agentify" ? (
          <div className="v3fs-wf-ro">
            {[["Name", asText(workflow.name)], ["Trigger", asText(workflow.trigger)],
              ["Owner", asText(workflow.owner)], ["Area", frameAreaFor(workflowArea(workflow))],
              ["Hand-offs", asStrings(workflow.handoffs).join(" · ")],
              ["Failure modes", asStrings(workflow.failureModes).join(" · ")]]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="v3fs-dv-fact">
                  <span className="v3fs-dv-fl">{label}</span><span className="v3fs-dv-fv">{value}</span>
                </div>
              ))}
            <p className="v3fs-wf-ro-note">
              The workflow itself — its steps, their order, who does them — is edited on the{" "}
              <b>Current-State Atlas</b>. Here you decide one thing: which of its steps can be agentified.
            </p>
          </div>
        ) : (
          <>
            <div className="v3fs-wf-head">
              <TextField label="Name" value={asText(workflow.name)} onChange={(next) => patchWorkflow({ name: next })} />
              <TextField label="Trigger" value={asText(workflow.trigger)} onChange={(next) => patchWorkflow({ trigger: next })} />
              <TextField label="Owner" value={asText(workflow.owner)} onChange={(next) => patchWorkflow({ owner: next })} />
              {/* Reassigning the area moves this workflow's tab group — how an
                  "unmapped" frame area gets its first workflow. */}
              {frameAreas.length ? (
                <SelectField label="Area (from the Frame)" value={frameAreaFor(workflowArea(workflow))}
                  options={[...frameAreas, GENERAL_AREA]}
                  onChange={(next) => patchWorkflow({ area: next })} />
              ) : null}
            </div>
            <div className="v3fs-wf-head">
              <ChipsField label="Hand-offs" values={asStrings(workflow.handoffs)} onChange={(next) => patchWorkflow({ handoffs: next })} />
              <ChipsField label="Failure modes" values={asStrings(workflow.failureModes)} onChange={(next) => patchWorkflow({ failureModes: next })} />
            </div>
            <DismissControl label="Dismiss this workflow" confirmLabel="Dismiss workflow"
              onDismiss={(reason) => dismissWorkflow(wfIndex, reason)} />
          </>
        )}
      </div>
      {steps.length === 0 ? (
        <div className="v3fs-stu-empty">No steps yet — add the first one below.</div>
      ) : (
        <div className="v3fs-swim-scroll">
          <div className="v3fs-swim" style={{ gridTemplateColumns: `130px repeat(${steps.length}, minmax(178px, 1fr))` }}>
            {lanes.map((lane) => (
              <React.Fragment key={lane}>
                <div className="v3fs-swim-lane"><span className="v3fs-swim-av" aria-hidden="true">{laneInitials(lane)}</span>{lane}</div>
                {steps.map((step, index) => {
                  const actor = asText(step.actor).trim() || "Unassigned";
                  // THE INSERTION MARKER — where the dragged tile would land. Drawn in
                  // every lane of the target column, so it reads as one full-height
                  // line between two steps rather than a hint on one row.
                  const marks = drag ? (
                    <>
                      {drag.at === index ? <span className="v3fs-swim-ins before" aria-hidden="true" /> : null}
                      {drag.at === steps.length && index === steps.length - 1
                        ? <span className="v3fs-swim-ins after" aria-hidden="true" /> : null}
                    </>
                  ) : null;
                  if (actor !== lane) {
                    // A lane this step does not touch: still part of the column, so
                    // still a place you can drop into it. Hidden from the reading
                    // order — a drop target is not something to announce.
                    return <div key={index} className="v3fs-swim-cell" data-step={index} aria-hidden="true" {...dropZone(index)}>{marks}</div>;
                  }
                  const pain = painForStep(step, pains);
                  const entities = asStrings(step.entities);
                  const stepEvents = eventsForStep(step, ontoEvents);
                  const dropped = asRecord(step).dropped === true;
                  return (
                    <div key={index} className="v3fs-swim-cell has" data-step={index} {...dropZone(index)}>
                      {marks}
                      <button
                        type="button"
                        className={`v3fs-swim-tile${selected === index ? " on" : ""}${pain ? ` pain-${pain.severity}` : ""}${dropped ? " dropped" : ""}${drag?.from === index ? " dragging" : ""}`}
                        // NOT draggable when the artifact is locked or derived, and not
                        // on Agentify: a frozen tile cannot start a drag at all, rather
                        // than starting one that is refused on drop.
                        draggable={!structureLocked}
                        onDragStart={(e) => {
                          if (structureLocked) return;
                          if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox refuses to start a drag with no data on it.
                            e.dataTransfer.setData?.(DRAG_MIME, String(index));
                            e.dataTransfer.setData?.("text/plain", asText(step.action) || `Step ${index + 1}`);
                          }
                          setPeek(null);
                          setDrag({ from: index, at: index });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onClick={() => setSelected(selected === index ? null : index)}
                        onMouseEnter={showStepPeek(index)}
                        onMouseLeave={() => setPeek(null)}
                      >
                        <span className="v3fs-swim-n" aria-hidden="true">{index + 1}</span>
                        {pain ? <span className={`v3fs-swim-paindot ${pain.severity}`} aria-label={`${pain.severity} pain: ${pain.pain}`} role="img" /> : null}
                        <span className="v3fs-swim-action">{asText(step.action) || "—"}</span>
                        <span className="v3fs-swim-meta">
                          {/* THE FLAG, where a call has been made. An undecided step
                              shows NOTHING — never a default mode dressed up as a
                              decision — and the Atlas shows nothing at all, because
                              deciding is not what the Atlas is for. */}
                          {modeOf(step)
                            ? <span className={`v3fs-wf-flag ${modeOf(step)}`}>{AGENTIFY_MODE_LABEL[modeOf(step)]}</span>
                            : null}
                          {asText(step.system) ? <span className="v3fs-wf-system">{asText(step.system)}</span> : null}
                          {asText(step.duration) ? <span className="v3fs-wf-dur">{asText(step.duration)}</span> : null}
                        </span>
                        {pain ? <span className="v3fs-swim-pain">{pain.pain.slice(0, 46)}</span> : null}
                        {entities.length || stepEvents.length ? (
                          <span className="v3fs-wf-ents">
                            {entities.slice(0, 3).map((entity) => (
                              <span key={entity} role="link" tabIndex={0} className="v3fs-wf-ent"
                                title="Defined in the Domain Ontology — open it"
                                onClick={(event) => { event.stopPropagation(); onOpenArtifact?.("domain-ontology"); }}
                                onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); onOpenArtifact?.("domain-ontology"); } }}>
                                {entity}
                              </span>
                            ))}
                            {stepEvents.slice(0, 2).map((name) => (
                              <span key={`ev-${name}`} role="link" tabIndex={0} className="v3fs-wf-evt"
                                title="Business event — defined in the Domain Ontology; open it"
                                onClick={(event) => { event.stopPropagation(); onOpenArtifact?.("domain-ontology"); }}
                                onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); onOpenArtifact?.("domain-ontology"); } }}>
                                ⚡{name}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </button>
                      {/* ADD AND DROP, ON THE TILE ITSELF — no select-then-toolbar
                          dance. Real <button>s and SIBLINGS of the tile, never nested
                          inside it: a button inside a button is invalid, and it is what
                          makes the tile keyboard-operable AND these reachable by Tab.
                          The toolbar below keeps both actions too — discoverability,
                          not replacement.
                          Each name says WHICH step it acts on, because twenty buttons
                          all announcing "Add step" are individually named and
                          collectively useless. */}
                      {structureLocked ? null : (
                        <span className="v3fs-swim-acts">
                          <button type="button" className="v3fs-swim-act"
                            aria-label={`Insert a new step after step ${index + 1}`}
                            title={`Insert a new step after step ${index + 1}`}
                            onClick={() => insertStep(index + 1, asText(step.actor))}>
                            <span aria-hidden="true">＋</span>
                          </button>
                          <button type="button" className={`v3fs-swim-act${dropped ? " restore" : " drop"}`}
                            aria-label={dropped
                              ? `Restore step ${index + 1} — put it back in the workflow`
                              : `Mark step ${index + 1} dropped — reversible, and it keeps its claims`}
                            title={dropped
                              ? "Restore this step — it was marked dropped, not deleted"
                              : "Mark dropped — reversible. The step and its ledger claims stay on record; nothing is deleted."}
                            onClick={() => toggleDropped(index)}>
                            <span aria-hidden="true">{dropped ? "↩" : "⊘"}</span>
                          </button>
                        </span>
                      )}
                      {index < steps.length - 1 ? <span className="v3fs-swim-arrow" aria-hidden="true">→</span> : null}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {structureLocked ? (
        surface === "agentify" && selected == null && steps.length ? (
          <div className="v3fs-wf-bar"><span className="v3fs-wf-hint">Select a step to decide whether it can be agentified</span></div>
        ) : null
      ) : (
      <div className="v3fs-wf-bar">
        <button type="button" className="v3fs-btn" onClick={addStep}>＋ Step{selected != null ? " after selected" : ""}</button>
        {selected == null ? <span className="v3fs-wf-hint">Select a step to edit it</span> : null}
        {steps.length > 1 ? (
          <span className="v3fs-wf-hint">Drag a tile to reorder it — or select one and use ← Earlier / Later →.</span>
        ) : null}
      </div>
      )}
      {/* The step inspector travels WITH the diagram — a step is only
          editable where it is drawn. (The registers below are a property of
          the document, not of a workflow, so they stayed behind.) */}
      {selected != null && steps[selected] ? (
          <div className="v3fs-wf-inspector">
            <div className="v3fs-wf-insp-h">
              <span className="v3fs-wf-insp-t">Step {selected + 1} <i>of {steps.length}</i>
                {asRecord(steps[selected]).dropped ? <span className="v3fs-wf-dropped-tag" title="Mark-dropped — the step and its claims stay findable; not hard-deleted">⊘ dropped</span> : null}</span>
              {structureLocked ? null : (
                <span className="v3fs-wf-insp-actions">
                  <button type="button" className="v3fs-btn" disabled={selected === 0} onClick={() => moveStep(-1)}>← Earlier</button>
                  <button type="button" className="v3fs-btn" disabled={selected === steps.length - 1} onClick={() => moveStep(1)}>Later →</button>
                  <button type="button" className="v3fs-btn" onClick={dropStep}
                    title={asRecord(steps[selected]).dropped
                      ? "Restore this step — it was marked dropped, not deleted"
                      : "Mark dropped — reversible. The step and its ledger claims stay on record; nothing is deleted."}>
                    {asRecord(steps[selected]).dropped ? "↩ Restore" : "⊘ Mark dropped (reversible)"}</button>
                </span>
              )}
            </div>
            {/* CLAIM STATUS per element — this atlas edit surface reads the ledger.
                Editing a slot is a claim on that locus; a ?unknown slot is an open
                unknown, shown here (answering it in the ledger is the gated write). */}
            {(() => {
              const res = claimsForStep(steps[selected]);
              // STRANDED — this step HAS an atlas anchor and the ledger holds no such
              // element: the Atlas moved (re-synthesised, its workflow renamed, its
              // step reworded or dismissed). Its own state, loudly, because the whole
              // point is that this must not read like "nothing was ever claimed here".
              if (res.state === "stranded") return (
                <div className="v3fs-wf-claims stranded">
                  <span className="v3fs-wf-claims-h">⚠ Evidence stranded</span>
                  <span className="v3fs-wf-claims-sum">
                    This step no longer matches its Atlas evidence. It was drafted from an Atlas
                    {wfClaims.state === "stranded" ? " workflow" : " step"} the record no longer holds —
                    renamed, reworded or dismissed there since Agentify was generated.
                  </span>
                  {res.textWouldMatch ? (
                    <span className="v3fs-wf-claims-sum">The Atlas does hold a step reading like this one, under a different id — the Atlas was rewritten, not emptied.</span>
                  ) : null}
                  <span className="v3fs-wf-claims-note">
                    Its claims are not lost, only unreachable from here. Regenerate Agentify from the
                    Current-State Atlas to re-anchor it. Anchor: <code>{res.anchor}</code>
                  </span>
                </div>
              );
              const sv = res.view;
              const sum = stepClaimSummary(sv);
              if (!sv) return <div className="v3fs-wf-claims none">No ledger claims matched this step yet — nothing in the Atlas has ever claimed it (a step added here carries no evidence until the Atlas does).</div>;
              return (
                <div className="v3fs-wf-claims">
                  <span className="v3fs-wf-claims-h">Ledger claims on this step</span>
                  <span className="v3fs-wf-claims-sum">
                    {sum.closed ? <span><ClaimStatus state="closed" showLabel={false} /> {sum.closed} closed</span> : null}
                    {sum.weak ? <span><ClaimStatus state="weak" showLabel={false} /> {sum.weak} weak</span> : null}
                    {sum.conflict ? <span><ClaimStatus state="conflict" showLabel={false} /> {sum.conflict} conflict</span> : null}
                    {sum.openSlots.length ? <span><ClaimStatus state="open" showLabel={false} /> {sum.openSlots.length} open unknown{sum.openSlots.length === 1 ? "" : "s"}</span> : null}
                  </span>
                  {sum.openSlots.length ? (
                    <ul className="v3fs-wf-claims-open">
                      {sum.openSlots.map((s) => (
                        <li key={s.about} title={s.about}><code>{s.slot}</code> <span className="v3fs-wf-claims-q">= ?unknown</span> <span className="v3fs-wf-claims-src">{s.source}</span></li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="v3fs-wf-claims-note">Answering a ?unknown lands as an attributed ledger closure through reconcile — the gated write path (operator edits here persist to the atlas doc today).</span>
                </div>
              );
            })()}
            {/* THE FLAG — Agentify's whole job, and the only edit it has. Three
                exclusive calls, and a fourth state that is not a call: nobody has
                decided. Clicking the active one again clears it back to undecided
                rather than leaving a decision no one made.
                It writes a DECISION under the step's atlas element id, never onto
                the step — which is why the Atlas can rename that step tomorrow and
                the call still points at it. */}
            {surface === "agentify" && onDecide ? (() => {
              const step = steps[selected!];
              const id = workflow ? decisionStepId(workflow, step) : "";
              const chosen = modeOf(step);
              return (
                <>
                  <div className="v3fs-wf-modebar">
                    <span className="v3fs-wf-modebar-l">Can this step be agentified?</span>
                    <span className="v3fs-wf-modebar-b">
                      {AGENTIFY_MODES.map((mode) => {
                        const on = chosen === mode;
                        return (
                          <button key={mode} type="button" disabled={locked || !id} aria-pressed={on}
                            className={`v3fs-wf-agentify${on ? " on" : ""}`} title={AGENTIFY_MODE_HINT[mode]}
                            onClick={() => onDecide(id, { mode: on ? "" : mode })}>
                            {AGENTIFY_MODE_LABEL[mode]}
                          </button>
                        );
                      })}
                    </span>
                    {chosen ? null : <span className="v3fs-wf-modebar-n">Not decided yet</span>}
                  </div>
                  {chosen ? (
                    <TextField label="Why — the reason this call was made"
                      value={decisions?.[id]?.rationale ?? asText(step.modeRationale)}
                      onChange={(next) => onDecide(id, { rationale: next })} />
                  ) : null}
                </>
              );
            })() : null}
            {/* The step itself: EDITED on the Atlas, merely STATED on Agentify. */}
            {structureLocked && surface === "agentify" ? (
              <div className="v3fs-wf-ro">
                {[["Action", asText(steps[selected].action)], ["Persona (lane)", asText(steps[selected].actor)],
                  ["System", asText(steps[selected].system)], ["Duration", asText(steps[selected].duration)],
                  ["Entities touched", asStrings(steps[selected].entities).join(" · ")],
                  ["Business events raised", asStrings(steps[selected].events).join(" · ")]]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="v3fs-dv-fact">
                      <span className="v3fs-dv-fl">{label}</span><span className="v3fs-dv-fv">{value}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <>
                <TextField label="Action — what happens in this step" value={asText(steps[selected].action)} onChange={(next) => patchStep(selected, { action: next })} />
                <div className="v3fs-stu-grid3">
                  <TextField label="Persona (lane)" value={asText(steps[selected].actor)} onChange={(next) => patchStep(selected, { actor: next })} />
                  <TextField label="System" value={asText(steps[selected].system)} onChange={(next) => patchStep(selected, { system: next })} />
                  <TextField label="Duration" value={asText(steps[selected].duration)} onChange={(next) => patchStep(selected, { duration: next })} />
                </div>
                <div className="v3fs-stu-grid2">
                  <ChipsField label="Entities touched (from the ontology)" values={asStrings(steps[selected].entities)}
                    onChange={(next) => patchStep(selected, { entities: next })} />
                  <ChipsField label="Business events raised" values={asStrings(steps[selected].events)}
                    onChange={(next) => patchStep(selected, { events: next })} />
                </div>
              </>
            )}
          </div>
        ) : null}
      </>
    );
  };

  return (
    <div className="v3fs-wf">
      {/* ONE surface. The seam overview compares every workflow across the areas
          it crosses AND is where each one is created, edited, opened and
          dismissed — opening a row expands workflowDetail inside it. */}
      <CollapsibleCard label="Areas & seams — every workflow across the areas it crosses" defaultOpen>
        <AtlasSeamView doc={doc} program={program} frameAreas={frameAreas} onOpenArtifact={onOpenArtifact}
          onChange={onChange} editable={!structureLocked}
          expandedWf={active} onPickWorkflow={toggleWorkflow} renderWorkflowDetail={workflowDetail}
          {...(structureLocked ? {} : { onAddWorkflow: addWorkflow, onDismissWorkflow: dismissWorkflow })} />
      </CollapsibleCard>
      {workflows.length === 0 ? (
        surface === "agentify" ? (
          <EmptyState icon="⚡" title="No workflows to decide on yet"
            hint="Agentify flags the Current-State Atlas's workflows — that Atlas holds none yet. Record them there and they appear here." />
        ) : (
        <EmptyState icon="🔀" title="No workflows on record yet"
          hint="Add one here, or regenerate the Current-State Atlas once the SME transcripts are in."
          action={structureLocked || !authoring ? undefined
            : <button type="button" className="v3fs-a" onClick={addWorkflow}>＋ workflow</button>} />)
      ) : null}
      {/* An unmapped area is an ATLAS gap — hear the SME, record the workflow. It
          is not a decision Agentify can take, so it is not raised there. */}
      {unmappedAreas.length && surface !== "agentify" ? (
        <div className="v3fs-wf-unmapped-row"
          title="Areas the Frame covers whose current-state workflow has no evidence yet — hear their SMEs, then regenerate the Atlas (or open a workflow above and reassign its Area)">
          Not mapped yet: {unmappedAreas.map((area) => <span key={area} className="v3fs-wf-unmapped">{area}</span>)}
        </div>
      ) : null}
      <CollapsibleCard label="Lifecycle × area — the derived second axis (area across, phase down)" defaultOpen={false}>
        <AtlasLifecycleGrid doc={doc} program={program} frameAreas={frameAreas}
          onPickWorkflow={openWorkflow} />
      </CollapsibleCard>
      <CollapsibleCard label="Ledger lens — one claims ledger, migrated from these artifacts (read-only)" defaultOpen={false}>
        <LedgerLensPanel program={program} />
      </CollapsibleCard>
      {/* Hover evidence peek — the step's verbatim grounding without a
          click. Fixed-position and pointer-transparent (same pattern as
          the kit matrix and gap peeks). */}
      {peek && steps[peek.index] ? (() => {
        const step = steps[peek.index];
        const pain = painForStep(step, pains);
        const stepEvents = eventsForStep(step, ontoEvents);
        const entities = asStrings(step.entities);
        return (
          <div className="v3fs-wf-peek" role="presentation" style={{ left: peek.x, top: peek.y }}>
            <div className="pk-t">{peek.index + 1}. {asText(step.action) || "—"}</div>
            <div className="pk-r">{asText(step.actor) || "Unassigned"}{asText(step.system) ? ` · ${asText(step.system)}` : ""}{asText(step.duration) ? ` · ${asText(step.duration)}` : ""}</div>
            {asText(step.evidence) ? <blockquote className="pk-q">{asText(step.evidence)}</blockquote> : null}
            {pain ? <div className={`pk-pain ${pain.severity}`}>{pain.pain}{pain.quote ? ` — “${pain.quote}”` : ""}</div> : null}
            {entities.length || stepEvents.length ? (
              <div className="pk-chips">
                {entities.slice(0, 4).map((entity) => <span key={entity} className="v3fs-wf-ent">{entity}</span>)}
                {stepEvents.slice(0, 2).map((name) => <span key={name} className="v3fs-wf-evt">⚡{name}</span>)}
              </div>
            ) : null}
          </div>
        );
      })() : null}
    </div>
  );
}

/**
 * THE ATLAS TAB'S REGISTERS — events · pain · systems.
 *
 * They are properties of the Current-State Atlas DOCUMENT, not of a workflow, so
 * when the workflows moved to Agentify these stayed behind. Lifted out of
 * WorkflowStudio unchanged, `focus` and all: the scoping is still here for any
 * caller that has a selected workflow to scope to, and the Atlas tab — which no
 * longer draws workflows — passes `focus={null}` and gets the full editors.
 * Filtered views stay READ-ONLY on purpose (editing a filtered table would
 * silently drop the hidden rows); "Show all & edit" is the escape.
 */
export function AtlasRegisters({ doc, onChange, program, focus }: {
  doc: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  program?: StudioProps["program"];
  focus: AtlasFocus | null;
}) {
  const locked = useStudioLocked();
  const authoring = useStudioAuthoring();
  const pains = useMemo(() => asArray(doc.painHeatmap).map(asRecord), [doc.painHeatmap]);
  const ontoEvents = useMemo(() => atlasEvents(doc, program), [doc, program]);
  const [showAllReg, setShowAllReg] = useState(false);
  const regFiltering = !!focus && !showAllReg;
  const regHit = (value: string, list: string[]) => {
    const needle = value.trim().toLowerCase();
    if (!needle) return false;
    return list.some((entry) => {
      const hay = entry.trim().toLowerCase();
      return hay === needle || hay.includes(needle) || needle.includes(hay);
    });
  };
  return (
      <CollapsibleCard defaultOpen label="Registers — events · pain · systems"
        hint={focus ? `scoped to ${focus.label}` : undefined}>
        {focus && showAllReg ? (
          <div className="v3fs-atlas-fltbar">
            <button type="button" className="v3fs-a" onClick={() => setShowAllReg(false)}>Filter to {focus.label}</button>
          </div>
        ) : null}
        {(() => {
          const filteredEvents = regFiltering ? ontoEvents.filter((event) => regHit(asText(event.name), focus!.events)) : null;
          return (
            <div className="v3fs-wf-reg">
              <div className="v3fs-wf-reg-h"><span>Business events</span>
                <em>{filteredEvents ? `${filteredEvents.length} of ${ontoEvents.length}` : ontoEvents.length}</em></div>
              <div>
                {filteredEvents ? (
                  <>
                    <div className="v3fs-atlas-fltbar">
                      <span>{filteredEvents.length} of {ontoEvents.length} for <b>{focus!.label}</b></span>
                      <button type="button" className="v3fs-a" onClick={() => setShowAllReg(true)}>Show all &amp; edit</button>
                    </div>
                    {filteredEvents.length ? filteredEvents.map((event, i) => (
                      <div key={i} className="v3fs-atlas-flt-row">
                        <b>⚡ {asText(event.name)}</b>
                        <span>{[asText(event.triggers), asText(event.produces)].filter(Boolean).join(" → ")}</span>
                      </div>
                    )) : <div className="v3fs-stu-empty">No business events touch this selection.</div>}
                  </>
                ) : (
                  <TableEditor
                    columns={[
                      { key: "name", label: "Event" },
                      { key: "triggers", label: "Triggered by", grow: 1.4 },
                      { key: "produces", label: "Produces", grow: 1.4 },
                    ]}
                    rows={ontoEvents}
                    onChange={(next) => onChange({ ...doc, events: next })}
                    addLabel="Add event"
                    emptyHint="No business events captured yet."
                  />
                )}
              </div>
            </div>
          );
        })()}
        {(() => {
          const filteredPains = regFiltering ? pains.filter((pain) => regHit(asText(pain.pain), focus!.pains)) : null;
          return (
            <div className="v3fs-wf-reg">
              <div className="v3fs-wf-reg-h"><span>Pain heatmap</span>
                <em>{filteredPains ? `${filteredPains.length} of ${pains.length}` : pains.length}</em></div>
              <div>
                {filteredPains ? (
                  filteredPains.length ? filteredPains.map((pain, i) => (
                    <div key={i} className={`v3fs-atlas-flt-row sev-${asText(pain.severity) || "medium"}`}>
                      <b>{asText(pain.area) || "—"}</b>
                      <span>{asText(pain.pain)}</span>
                    </div>
                  )) : <div className="v3fs-stu-empty">No voiced pain on this selection.</div>
                ) : (
                  <div className="v3fs-stu-heat">
                    {pains.map((pain, index) => (
                      <div key={index} className={`v3fs-stu-heat-row sev-${asText(pain.severity) || "medium"}`}>
                        <select value={asText(pain.severity) || "medium"} aria-label="Severity" disabled={locked}
                          onChange={(e) => onChange({ ...doc, painHeatmap: pains.map((p, i) => (i === index ? { ...p, severity: e.target.value } : p)) })}>
                          {["high", "medium", "low"].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input value={asText(pain.area)} placeholder="Area" aria-label="Area" disabled={locked}
                          onChange={(e) => onChange({ ...doc, painHeatmap: pains.map((p, i) => (i === index ? { ...p, area: e.target.value } : p)) })} />
                        <input value={asText(pain.pain)} placeholder="The pain" aria-label="Pain" style={{ flexGrow: 2 }} disabled={locked}
                          onChange={(e) => onChange({ ...doc, painHeatmap: pains.map((p, i) => (i === index ? { ...p, pain: e.target.value } : p)) })} />
                        {locked ? null : <button type="button" className="v3fs-stu-x" aria-label="Remove"
                          onClick={() => onChange({ ...doc, painHeatmap: pains.filter((_, i) => i !== index) })}>×</button>}
                      </div>
                    ))}
                    {locked || !authoring ? null : <button type="button" className="v3fs-a"
                      onClick={() => onChange({ ...doc, painHeatmap: [...pains, { area: "", pain: "", severity: "medium", voicedBy: [] }] })}>＋ Add pain</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {(() => {
          const inventory = asArray(doc.systemsInventory).map(asRecord);
          const filteredSystems = regFiltering ? inventory.filter((row) => regHit(asText(row.system), focus!.systems)) : null;
          return (
            <div className="v3fs-wf-reg">
              <div className="v3fs-wf-reg-h"><span>Systems inventory</span>
                <em>{filteredSystems ? `${filteredSystems.length} of ${inventory.length}` : inventory.length}</em></div>
              <div>
                {filteredSystems ? (
                  filteredSystems.length ? filteredSystems.map((row, i) => (
                    <div key={i} className="v3fs-atlas-flt-row">
                      <b>{asText(row.system)}</b>
                      <span>{asText(row.usedFor)}</span>
                    </div>
                  )) : <div className="v3fs-stu-empty">No systems named on this selection.</div>
                ) : (
                  <TableEditor
                    columns={[{ key: "system", label: "System" }, { key: "usedFor", label: "Used for", grow: 2 }]}
                    rows={inventory}
                    onChange={(next) => onChange({ ...doc, systemsInventory: next })}
                    addLabel="Add system"
                    emptyHint="No systems captured."
                  />
                )}
              </div>
            </div>
          );
        })()}
      </CollapsibleCard>
  );
}
