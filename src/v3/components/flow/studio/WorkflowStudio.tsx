/**
 * The Current-State Atlas's workflows as a swimlane diagram: PERSONAS are
 * rows, the workflow overlays them left-to-right — each step tile sits in
 * the lane of the actor who performs it, at its position in the sequence.
 * Tiles carry the step's system, duration, the ontology's entity chips, and
 * the pain heatmap overlaid as a severity edge with the strongest voiced
 * complaint. The diagram IS the document: selection edits in the inspector;
 * add/reorder/remove rewrite the same steps array the generator emits.
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
function PrintWorkflowDiagram({ workflow, pains, ontoEvents, area }: {
  workflow: Record<string, unknown>;
  pains: Array<Record<string, unknown>>;
  ontoEvents: Array<Record<string, unknown>>;
  area: string;
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

export default function WorkflowStudio({ doc, onChange, onOpenArtifact, program, onFocus }: StudioProps & {
  onFocus?: (focus: AtlasFocus | null) => void;
}) {
  const locked = useStudioLocked();
  const authoring = useStudioAuthoring();
  const printing = useStudioPrinting();
  const workflows = useMemo(() => asArray(doc.workflows).map(asRecord), [doc.workflows]);
  const pains = useMemo(() => asArray(doc.painHeatmap).map(asRecord), [doc.painHeatmap]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const workflow = workflows[Math.min(active, Math.max(0, workflows.length - 1))];
  const steps = useMemo(() => (workflow ? asArray(workflow.steps).map(asRecord) : []), [workflow]);

  // LEDGER-AWARE: this atlas edit surface reads the same claims ledger every other
  // surface reads, so each step shows its CLAIM STATUS (source + open/weak/closed/
  // conflict per slot) — the atlas is a ledger surface, not a detached form. Matched
  // by CONTENT (workflow name + the step's action prefix), which is exactly the
  // ledger's content-derived step id (migrate: contentId over actor+action) — so a
  // reorder never restrands a step's claims (identity is content, not position).
  const ledger = useProgramLedger(program);
  const ledgerWf = useMemo(
    () => ledger.atlas.find((w) => w.name.trim().toLowerCase() === asText(workflow?.name).trim().toLowerCase()),
    [ledger.atlas, workflow],
  );
  const claimsForStep = useCallback((action: string): StepView | undefined => {
    const n = action.slice(0, 60).trim().toLowerCase();
    return ledgerWf?.steps.find((s) => s.name.trim().toLowerCase() === n);
  }, [ledgerWf]);
  // A compact claim-status summary for a step's slots (open unknowns loudest).
  const stepClaimSummary = (sv?: StepView): { openSlots: SlotView[]; weak: number; closed: number; conflict: number } => {
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
  // it. Events LIVE on this document now (the atlas's own events table below
  // the diagram); ontology-doc events are read through for legacy programmes
  // that predate the move.
  const ontoEvents = useMemo(() => {
    const own = asArray(doc.events).map(asRecord);
    const legacy = program ? asArray(readArtifactDoc(program, "domainOntology")?.events).map(asRecord) : [];
    const seen = new Set(own.map((event) => asText(event.name).toLowerCase()));
    return [...own, ...legacy.filter((event) => !seen.has(asText(event.name).toLowerCase()))];
  }, [doc.events, program]);
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
  // Registers inside the combined card: filtered read-only to the focus by
  // default (editing a filtered table would drop hidden rows); one toggle
  // opens the full editors.
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

  const writeWorkflows = useCallback((next: Array<Record<string, unknown>>) => {
    onChange({ ...doc, workflows: next });
  }, [doc, onChange]);
  const patchWorkflow = useCallback((patch: Record<string, unknown>) => {
    writeWorkflows(workflows.map((entry, index) => (index === active ? { ...entry, ...patch } : entry)));
  }, [workflows, active, writeWorkflows]);
  const patchStep = useCallback((index: number, patch: Record<string, unknown>) => {
    patchWorkflow({ steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  }, [steps, patchWorkflow]);

  const addStep = () => {
    const at = selected != null ? selected + 1 : steps.length;
    const next = [...steps];
    next.splice(at, 0, { actor: selected != null ? asText(steps[selected].actor) : "", action: "New step", system: "", duration: "" });
    patchWorkflow({ steps: next });
    setSelected(at);
  };
  const moveStep = (delta: number) => {
    if (selected == null) return;
    const to = selected + delta;
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [step] = next.splice(selected, 1);
    next.splice(to, 0, step);
    patchWorkflow({ steps: next });
    setSelected(to);
  };
  // MARK-DROPPED, not hard-delete: a step can carry closed claims (its lineage),
  // and reconcile's element handling keeps a dropped element findable as an orphan
  // rather than destroying it. So "remove" sets a soft `dropped` flag — the step
  // stays in the document (and in the ledger, findable), rendered struck-through,
  // and is restorable. A true hard delete of a claim-carrying element is refused.
  const dropStep = () => {
    if (selected == null) return;
    patchStep(selected, { dropped: !asRecord(steps[selected]).dropped });
  };
  const addWorkflow = () => {
    writeWorkflows([...workflows, { name: `Workflow ${workflows.length + 1}`, owner: "", trigger: "", steps: [], handoffs: [], failureModes: [] }]);
    setActive(workflows.length);
    setSelected(null);
  };

  const activeArea = workflow ? frameAreaFor(workflowArea(workflow)) : "";
  const areaWorkflows = groupedTabs.find(([area]) => area === activeArea)?.[1] ?? [];

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
                pains={pains} ontoEvents={ontoEvents} area={area} />
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

  return (
    <div className="v3fs-wf">
      {/* ONE consolidated view: the multi-area seam overview (compare workflows
          across the areas they cross), then the single-workflow editor below.
          Picking a workflow in the overview opens it in the editor. */}
      <CollapsibleCard label="Areas & seams — every workflow across the areas it crosses" defaultOpen>
        <AtlasSeamView doc={doc} program={program} frameAreas={frameAreas} onOpenArtifact={onOpenArtifact}
          onChange={onChange} editable={!locked}
          onPickWorkflow={(i) => { setActive(i); setSelected(null); }} />
      </CollapsibleCard>
      <CollapsibleCard label="Lifecycle × area — the derived second axis (area across, phase down)" defaultOpen={false}>
        <AtlasLifecycleGrid doc={doc} program={program} frameAreas={frameAreas}
          onPickWorkflow={(i) => { setActive(i); setSelected(null); }} />
      </CollapsibleCard>
      <CollapsibleCard label="Ledger lens — one claims ledger, migrated from these artifacts (read-only)" defaultOpen={false}>
        <LedgerLensPanel program={program} />
      </CollapsibleCard>
      <div className="v3fs-wf-editor-h">Edit a workflow</div>
      {/* Cascading filters: pick the AREA, then one of ITS workflows — the
          grouped pill strip outgrew the tab metaphor once every area mapped. */}
      <div className="v3fs-wf-filters">
        <label className="v3fs-wf-filter">
          <span>Area</span>
          <select value={activeArea} aria-label="Filter by area"
            onChange={(e) => {
              const first = groupedTabs.find(([area]) => area === e.target.value)?.[1]?.[0];
              if (first) { setActive(first.index); setSelected(null); }
            }}>
            {groupedTabs.map(([area, items]) => (
              <option key={area} value={area}>{area} ({items.length})</option>
            ))}
          </select>
        </label>
        <label className="v3fs-wf-filter grow">
          <span>Workflow</span>
          <select value={String(active)} aria-label="Pick a workflow"
            onChange={(e) => { setActive(Number(e.target.value)); setSelected(null); }}>
            {areaWorkflows.map(({ name, index }) => (
              <option key={index} value={String(index)}>{name}</option>
            ))}
          </select>
        </label>
        {locked || !authoring ? null : <button type="button" className="v3fs-a" onClick={addWorkflow}>＋ workflow</button>}
      </div>
      {unmappedAreas.length ? (
        <div className="v3fs-wf-unmapped-row"
          title="Areas the Frame covers whose current-state workflow has no evidence yet — hear their SMEs, then regenerate the Atlas (or assign a workflow's Area below)">
          Not mapped yet: {unmappedAreas.map((area) => <span key={area} className="v3fs-wf-unmapped">{area}</span>)}
        </div>
      ) : null}

      {!workflow ? (
        <EmptyState icon="🔀" title="No workflows on record yet" hint="Add one above, or regenerate the Current-State Atlas once the SME transcripts are in." />
      ) : (
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
          {/* WORKFLOW SUMMARY — the whole flow's editable facts, ABOVE the
              diagram: the read goes summary → swimlane → one step's form.
              Indigo card; the step form below is the white working card with
              the accent spine, so the two levels never look alike. */}
          <div className="v3fs-wf-details">
            <div className="v3fs-wf-card-eyebrow">Workflow summary</div>
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
              onDismiss={(reason) => {
                onChange({
                  ...doc,
                  workflows: workflows.filter((_, index) => index !== active),
                  ...curationNote(doc, `Dismissed workflow “${asText(workflow.name) || `#${active + 1}`}”`, reason),
                });
                setActive(Math.max(0, active - 1));
                setSelected(null);
              }} />
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
                      if (actor !== lane) return <div key={index} className="v3fs-swim-cell" aria-hidden="true" />;
                      const pain = painForStep(step, pains);
                      const entities = asStrings(step.entities);
                      const stepEvents = eventsForStep(step, ontoEvents);
                      return (
                        <div key={index} className="v3fs-swim-cell has">
                          <button
                            type="button"
                            className={`v3fs-swim-tile${selected === index ? " on" : ""}${pain ? ` pain-${pain.severity}` : ""}${asRecord(step).dropped ? " dropped" : ""}`}
                            onClick={() => setSelected(selected === index ? null : index)}
                            onMouseEnter={showStepPeek(index)}
                            onMouseLeave={() => setPeek(null)}
                          >
                            <span className="v3fs-swim-n" aria-hidden="true">{index + 1}</span>
                            {pain ? <span className={`v3fs-swim-paindot ${pain.severity}`} aria-label={`${pain.severity} pain: ${pain.pain}`} role="img" /> : null}
                            <span className="v3fs-swim-action">{asText(step.action) || "—"}</span>
                            <span className="v3fs-swim-meta">
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
                          {index < steps.length - 1 ? <span className="v3fs-swim-arrow" aria-hidden="true">→</span> : null}
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {locked ? null : (
          <div className="v3fs-wf-bar">
            <button type="button" className="v3fs-btn" onClick={addStep}>＋ Step{selected != null ? " after selected" : ""}</button>
            {selected == null ? <span className="v3fs-wf-hint">Select a step to edit it</span> : null}
          </div>
          )}
          {/* ONE card for the working context: the selected step's form plus
              the three registers (events / pain / systems), each scoped to
              the focus with a shared "Show all & edit" escape. */}
          <CollapsibleCard key={selected != null ? `ctx-step-${selected}` : "ctx-wf"} defaultOpen
            label={selected != null ? `Step ${selected + 1} — details & registers` : "Registers — events · pain · systems"}
            hint={focus ? `scoped to ${focus.label}` : undefined}>
            {selected != null && steps[selected] ? (
              <div className="v3fs-wf-inspector">
                <div className="v3fs-wf-insp-h">
                  <span className="v3fs-wf-insp-t">Step {selected + 1} <i>of {steps.length}</i>
                    {asRecord(steps[selected]).dropped ? <span className="v3fs-wf-dropped-tag" title="Mark-dropped — the step and its claims stay findable; not hard-deleted">⊘ dropped</span> : null}</span>
                  {locked ? null : (
                    <span className="v3fs-wf-insp-actions">
                      <button type="button" className="v3fs-btn" disabled={selected === 0} onClick={() => moveStep(-1)}>← Earlier</button>
                      <button type="button" className="v3fs-btn" disabled={selected === steps.length - 1} onClick={() => moveStep(1)}>Later →</button>
                      <button type="button" className="v3fs-btn" onClick={dropStep}
                        title={asRecord(steps[selected]).dropped ? "Restore this step" : "Mark dropped — the step's claims stay findable (not hard-deleted)"}>
                        {asRecord(steps[selected]).dropped ? "↩ Restore" : "⊘ Mark dropped"}</button>
                    </span>
                  )}
                </div>
                {/* CLAIM STATUS per element — this atlas edit surface reads the ledger.
                    Editing a slot is a claim on that locus; a ?unknown slot is an open
                    unknown, shown here (answering it in the ledger is the gated write). */}
                {(() => {
                  const sv = claimsForStep(asText(steps[selected].action));
                  const sum = stepClaimSummary(sv);
                  if (!sv) return <div className="v3fs-wf-claims none">No ledger claims matched this step yet (content-derived id — set the action to ground it).</div>;
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
              </div>
            ) : null}
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
        </>
      )}
    </div>
  );
}
