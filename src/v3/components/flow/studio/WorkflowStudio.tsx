/**
 * The Current-State Atlas's workflows as a swimlane diagram: PERSONAS are
 * rows, the workflow overlays them left-to-right — each step tile sits in
 * the lane of the actor who performs it, at its position in the sequence.
 * Tiles carry the step's system, duration, the ontology's entity chips, and
 * the pain heatmap overlaid as a severity edge with the strongest voiced
 * complaint. The diagram IS the document: selection edits in the inspector;
 * add/reorder/remove rewrite the same steps array the generator emits.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  TextField, ChipsField, asArray, asRecord, asText, asStrings, useStudioLocked, useStudioAuthoring,
  curationNote, DismissControl, EmptyState, type StudioProps,
} from "./StudioKit";
import { workflowArea, programAreas, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";

interface PainHit {
  severity: string;
  pain: string;
  quote: string;
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

export default function WorkflowStudio({ doc, onChange, onOpenArtifact, program }: StudioProps) {
  const locked = useStudioLocked();
  const authoring = useStudioAuthoring();
  const workflows = useMemo(() => asArray(doc.workflows).map(asRecord), [doc.workflows]);
  const pains = useMemo(() => asArray(doc.painHeatmap).map(asRecord), [doc.painHeatmap]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const workflow = workflows[Math.min(active, Math.max(0, workflows.length - 1))];
  const steps = useMemo(() => (workflow ? asArray(workflow.steps).map(asRecord) : []), [workflow]);
  // The ontology's business events, woven into the diagram: an event chip on
  // the step that raises it, and the workflow's trigger named as an event
  // where one starts it. Division of record holds — events are DEFINED in the
  // Domain Ontology; the atlas only references them, like entities.
  const ontoEvents = useMemo(
    () => (program ? asArray(readArtifactDoc(program, "domainOntology")?.events).map(asRecord) : []),
    [program],
  );
  const triggerEvent = useMemo(() => {
    const trigger = asText(workflow?.trigger).toLowerCase();
    if (!trigger) return null;
    const hit = ontoEvents.find((event) => {
      const words = eventWords(asText(event.name));
      return words.length > 0 && words.every((word) => stemHit(trigger, word));
    });
    return hit ? asText(hit.name) : null;
  }, [workflow, ontoEvents]);

  // The atlas is organised BY the ontology's business areas: each workflow files
  // under its area (the generator's explicit tag, else inferred), so the tabs
  // read as the domain map the ontology defines — Sales workflows together,
  // Delivery together — rather than one flat undifferentiated row.
  const groupedTabs = useMemo(() => {
    const groups = new Map<string, Array<{ name: string; index: number }>>();
    workflows.forEach((entry, index) => {
      const area = workflowArea(entry);
      const list = groups.get(area) ?? [];
      list.push({ name: asText(entry.name) || `Workflow ${index + 1}`, index });
      groups.set(area, list);
    });
    return [...groups.entries()].sort(([a], [b]) =>
      a === GENERAL_AREA ? 1 : b === GENERAL_AREA ? -1 : a.localeCompare(b));
  }, [workflows]);
  const multiArea = groupedTabs.length > 1;
  // Areas the ONTOLOGY defines but the atlas hasn't mapped a workflow for yet —
  // e.g. Talent, whose entities are on the ontology but whose current-state
  // process has no evidence (its SME hasn't been heard). Surfacing them here
  // keeps the atlas honest: the domain is known, its workflow is still a gap.
  const unmappedAreas = useMemo(() => {
    if (!program) return [];
    const covered = new Set(groupedTabs.map(([area]) => area));
    // Clean single-domain areas only — a compound label ("Alliances/Finance")
    // is an entity spanning areas already mapped by their segments, not its own
    // missing workflow. So "Talent" surfaces; "Talent/Delivery" doesn't.
    return programAreas(program).filter((area) =>
      area !== GENERAL_AREA && !area.includes("/") && !covered.has(area)
      && ![...covered].some((mapped) => mapped.toLowerCase() === area.toLowerCase()));
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
  const removeStep = () => {
    if (selected == null) return;
    patchWorkflow({ steps: steps.filter((_, index) => index !== selected) });
    setSelected(null);
  };
  const addWorkflow = () => {
    writeWorkflows([...workflows, { name: `Workflow ${workflows.length + 1}`, owner: "", trigger: "", steps: [], handoffs: [], failureModes: [] }]);
    setActive(workflows.length);
    setSelected(null);
  };

  return (
    <div className="v3fs-wf">
      <div className={`v3fs-wf-tabs${multiArea ? " grouped" : ""}`} role="tablist" aria-label="Workflows">
        {groupedTabs.map(([area, items]) => (
          <div key={area} className="v3fs-wf-tabgroup">
            {multiArea ? <span className="v3fs-wf-tabgroup-l" title={`${area} workflows`}>{area}</span> : null}
            {items.map(({ name, index }) => (
              <button key={index} type="button" role="tab" aria-selected={index === active}
                className={index === active ? "on" : ""}
                onClick={() => { setActive(index); setSelected(null); }}>
                {name}
              </button>
            ))}
          </div>
        ))}
        {unmappedAreas.map((area) => (
          <div key={`unmapped-${area}`} className="v3fs-wf-tabgroup unmapped"
            title={`${area} is defined in the Domain Ontology but has no current-state workflow yet — hear the ${area} SME, then regenerate the Atlas to map it`}>
            <span className="v3fs-wf-tabgroup-l">{area}</span>
            <span className="v3fs-wf-unmapped">not mapped yet</span>
          </div>
        ))}
        {locked || !authoring ? null : <button type="button" className="v3fs-a" onClick={addWorkflow}>＋ workflow</button>}
      </div>

      {!workflow ? (
        <EmptyState icon="🔀" title="No workflows on record yet" hint="Add one above, or regenerate the Current-State Atlas once the SME transcripts are in." />
      ) : (
        <>
          {steps.length === 0 ? (
            <div className="v3fs-stu-empty">No steps yet — add the first one below.</div>
          ) : (
            <div className="v3fs-swim-scroll">
              <div className="v3fs-swim" style={{ gridTemplateColumns: `130px repeat(${steps.length}, minmax(178px, 1fr))` }}>
                {lanes.map((lane) => (
                  <React.Fragment key={lane}>
                    <div className="v3fs-swim-lane">{lane}</div>
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
                            className={`v3fs-swim-tile${selected === index ? " on" : ""}${pain ? ` pain-${pain.severity}` : ""}`}
                            onClick={() => setSelected(selected === index ? null : index)}
                            title={pain ? `${pain.pain}${pain.quote ? ` — “${pain.quote}”` : ""}` : undefined}
                          >
                            <span className="v3fs-swim-n" aria-hidden="true">{index + 1}</span>
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
            {selected != null ? (
              <>
                <button type="button" className="v3fs-btn" onClick={() => moveStep(-1)}>← Earlier</button>
                <button type="button" className="v3fs-btn" onClick={() => moveStep(1)}>Later →</button>
                <button type="button" className="v3fs-btn" onClick={removeStep}>Remove step</button>
              </>
            ) : <span className="v3fs-wf-hint">Select a step to edit it</span>}
          </div>
          )}
          {selected != null && steps[selected] ? (
            <div className="v3fs-wf-inspector">
              <TextField label="Persona (lane)" value={asText(steps[selected].actor)} onChange={(next) => patchStep(selected, { actor: next })} />
              <TextField label="Action" value={asText(steps[selected].action)} onChange={(next) => patchStep(selected, { action: next })} />
              <TextField label="System" value={asText(steps[selected].system)} onChange={(next) => patchStep(selected, { system: next })} />
              <TextField label="Duration" value={asText(steps[selected].duration)} onChange={(next) => patchStep(selected, { duration: next })} />
              <ChipsField label="Entities touched (from the ontology)" values={asStrings(steps[selected].entities)}
                onChange={(next) => patchStep(selected, { entities: next })} />
              <ChipsField label="Business events raised (from the ontology)" values={asStrings(steps[selected].events)}
                onChange={(next) => patchStep(selected, { events: next })} />
            </div>
          ) : null}

          <div className="v3fs-wf-details">
            <div className="v3fs-wf-head">
              <TextField label="Name" value={asText(workflow.name)} onChange={(next) => patchWorkflow({ name: next })} />
              <TextField label="Trigger" value={asText(workflow.trigger)} onChange={(next) => patchWorkflow({ trigger: next })} />
              <TextField label="Owner" value={asText(workflow.owner)} onChange={(next) => patchWorkflow({ owner: next })} />
            </div>
            {triggerEvent ? (
              <p className="v3fs-wf-trigev">
                Starts on the business event{" "}
                <span role="link" tabIndex={0} className="v3fs-wf-evt"
                  title="Defined in the Domain Ontology — open it"
                  onClick={() => onOpenArtifact?.("domain-ontology")}
                  onKeyDown={(event) => { if (event.key === "Enter") onOpenArtifact?.("domain-ontology"); }}>
                  ⚡{triggerEvent}
                </span>
              </p>
            ) : null}
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
        </>
      )}
    </div>
  );
}
