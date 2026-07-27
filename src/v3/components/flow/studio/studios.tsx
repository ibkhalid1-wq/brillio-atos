/**
 * One WYSIWYG editor per generated artifact type. Each edits the SAME
 * structured shape its generator emits — the reading pane, gate criteria,
 * semantics and downstream generators keep working on hand-edited docs.
 * The ontology's graph editor lives in OntologyStudio; everything here is
 * composed from the StudioKit primitives.
 */
import React from "react";
import { stakeholderEmail } from "@/v3/components/flow/flowMeetings";
import OntologyStudio from "./OntologyStudio";
import WorkflowStudio, { type AtlasFocus } from "./WorkflowStudio";
import JourneyGrid from "./JourneyGrid";
import BlueprintGraph from "./BlueprintGraph";
import StrategyBoard from "./StrategyBoard";
import ExperienceDesignStudio from "./ExperienceDesignStudio";
import PrototypeStudio from "./PrototypeStudio";
import { GapRoutingEditor } from "./GapRoutingEditor";
import {
  Section, CollapsibleCard, TextField, TextArea, SelectField, ChipsField, StringListEditor, TableEditor,
  asArray, asRecord, asText, asStrings, useStudioLocked, type StudioProps,
} from "./StudioKit";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import { listenCoverageAreas, listenAreaCoverage, canonicalFrameArea } from "@/v3/components/flow/listenCoverage";
import { stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";

/* ── shared card-list scaffolding ─────────────────────────────────────────── */

function CardList({ items, render, onAdd, onRemove, onMove, addLabel, itemLabel }: {
  items: Record<string, unknown>[];
  render: (item: Record<string, unknown>, index: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** ↑/↓ on each card — pass only when the list's order carries meaning. */
  onMove?: (index: number, delta: number) => void;
  addLabel: string;
  itemLabel: (item: Record<string, unknown>, index: number) => string;
}) {
  const locked = useStudioLocked();
  return (
    <div className="v3fs-stu-cards">
      {items.map((item, index) => (
        <details key={index} className="v3fs-stu-card" open={items.length <= 2}>
          <summary>
            <span className="v3fs-stu-card-t">{itemLabel(item, index)}</span>
            {locked || !onMove ? null : (
              <span className="v3fs-stu-mv">
                <button type="button" className="v3fs-stu-x" aria-label="Move up" disabled={index === 0}
                  onClick={(e) => { e.preventDefault(); onMove(index, -1); }}>↑</button>
                <button type="button" className="v3fs-stu-x" aria-label="Move down" disabled={index === items.length - 1}
                  onClick={(e) => { e.preventDefault(); onMove(index, 1); }}>↓</button>
              </span>
            )}
            {locked ? null : <button type="button" className="v3fs-stu-x" aria-label="Remove"
              onClick={(e) => { e.preventDefault(); onRemove(index); }}>×</button>}
          </summary>
          <div className="v3fs-stu-card-b">{render(item, index)}</div>
        </details>
      ))}
      {locked ? null : <button type="button" className="v3fs-a" onClick={onAdd}>＋ {addLabel}</button>}
    </div>
  );
}

function useListOps(doc: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void, key: string) {
  const items = asArray(doc[key]).map(asRecord);
  const set = (index: number, changes: Record<string, unknown>) =>
    onChange({ ...doc, [key]: items.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  const add = (blank: Record<string, unknown>) => onChange({ ...doc, [key]: [...items, blank] });
  const remove = (index: number) => onChange({ ...doc, [key]: items.filter((_, i) => i !== index) });
  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ ...doc, [key]: next });
  };
  return { items, set, add, remove, move };
}

const patchOf = (doc: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void) =>
  (changes: Record<string, unknown>) => onChange({ ...doc, ...changes });

/* ── Frame ────────────────────────────────────────────────────────────────── */

function CharterStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  return (
    <>
      <Section label="Mandate" hint="why this programme exists and what authority it holds">
        <TextArea value={asText(doc.mandate)} rows={3} onChange={(next) => patch({ mandate: next })} />
        <div className="v3fs-stu-grid2">
          <TextField label="Sponsor" value={asText(doc.sponsor)} onChange={(next) => patch({ sponsor: next })} />
          <TextField label="Business objective" value={asText(doc.businessObjective)} onChange={(next) => patch({ businessObjective: next })} />
        </div>
      </Section>
      <Section label="Objectives">
        <StringListEditor values={asStrings(doc.objectives)} onChange={(next) => patch({ objectives: next })} addLabel="Add objective" />
      </Section>
      <div className="v3fs-stu-grid2">
        <Section label="In scope">
          <StringListEditor values={asStrings(doc.inScope)} onChange={(next) => patch({ inScope: next })} addLabel="Add" />
        </Section>
        <Section label="Out of scope">
          <StringListEditor values={asStrings(doc.outOfScope)} onChange={(next) => patch({ outOfScope: next })} addLabel="Add" />
        </Section>
      </div>
      <Section label="Success criteria" hint="measurable, anchored to the KPIs">
        <StringListEditor values={asStrings(doc.successCriteria)} onChange={(next) => patch({ successCriteria: next })} addLabel="Add criterion" />
      </Section>
      <Section label="Key risks">
        <StringListEditor values={asStrings(doc.keyRisks)} onChange={(next) => patch({ keyRisks: next })} addLabel="Add risk" />
      </Section>
      <Section label="Governance">
        <TextArea value={asText(doc.governanceSummary)} rows={2} onChange={(next) => patch({ governanceSummary: next })} />
      </Section>
      <Section label="Gaps" hint="what the evidence could not support">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

// Human-readable coverage states, stored as the boolean `thin` the generator emits.
const WELL_COVERED = "Well covered";
const THIN_COVERAGE = "Thin — needs another voice";

/**
 * Discovery Kit — people-first. The kit IS a list of conversations, so the
 * editor is a roster on the left and ONE person's essentials on the right:
 * who they are, how to reach them, and the flat list of questions to ask.
 * The generator's agenda-block shape (topic/minutes/questions[]) is flattened
 * for editing and written back as a single block, so every downstream reader
 * (scripts, links, coverage) keeps working untouched. Personas, coverage and
 * gaps fold below — present, but never in the way of the main job.
 */
function DiscoveryKitStudio({ doc, onChange, program }: StudioProps) {
  const locked = useStudioLocked();
  const patch = patchOf(doc, onChange);
  const interviews = useListOps(doc, onChange, "interviews");
  const personas = useListOps(doc, onChange, "personas");
  const [selected, setSelected] = React.useState(0);
  const current = interviews.items[selected] as Record<string, unknown> | undefined;
  // Reordering the roster keeps the operator's place: the selection follows
  // the interview it was on, not the slot number.
  const moveInterview = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= interviews.items.length) return;
    interviews.move(index, delta);
    setSelected((sel) => (sel === index ? to : sel === to ? index : sel));
  };

  const questionsOf = (interview: Record<string, unknown>): string[] =>
    asArray(interview.agenda).map(asRecord).flatMap((block) => asStrings(block.questions));
  const setQuestions = (index: number, next: string[]) => {
    const first = asArray((interviews.items[index] as Record<string, unknown>).agenda).map(asRecord)[0] ?? {};
    interviews.set(index, { agenda: [{ topic: asText(first.topic) || "Conversation", minutes: first.minutes ?? 45, questions: next }] });
  };

  const thinCount = asArray(doc.coverageMap).map(asRecord).filter((row) => row.thin === true).length;
  const curEmail = current && program ? stakeholderEmail(program, asText(current.stakeholder)) : null;

  return (
    <>
      {/* The kit is the GENERATED interview plan — coverage, who to talk to,
          and what to ask. Names, emails and role assignment are managed in
          People; here the operator refines the PLAN (questions, coverage). */}
      <p className="v3fs-stu-lead">This is the plan AURA generated: the coverage it needs, who to interview, and the questions each conversation should surface. Refine the questions and coverage here; <b>who</b> each person is and their contact details are managed in <b>Library&nbsp;&rsaquo;&nbsp;People</b>.</p>
      <Section label="Coverage" hint="who covers each workflow domain — mark the thin ones, then regenerate to deepen them">
        <p className="v3fs-stu-note">
          One row per workflow domain: who speaks to it, and whether its coverage is <b>thin</b> — only one
          voice, or shallow evidence. Mark a domain thin and <b>Regenerate the Discovery Kit</b> and the
          generator deepens that domain&rsquo;s questions (the new kit lands in the Inbox to confirm).
          {thinCount ? <> <b>{thinCount} domain{thinCount === 1 ? "" : "s"} flagged thin.</b></> : null}
        </p>
        {/* At-a-glance relationship: each area we'll cover ← the people we'll hear
            from on it. A thin or uncovered area stands out, so the gap is obvious
            before the editable table below. */}
        {(() => {
          const rows = asArray(doc.coverageMap).map(asRecord);
          if (!rows.length) return null;
          return (
            <div className="v3fs-covmap" role="table" aria-label="Who we'll hear, by area we'll cover">
              <div className="v3fs-covmap-h" role="row"><span>Area we&rsquo;ll cover</span><span>Who we&rsquo;ll hear</span></div>
              {rows.map((raw, i) => {
                const row = asRecord(raw);
                const domain = asText(row.domain) || "—";
                const people = Array.isArray(row.coveredBy) ? asStrings(row.coveredBy)
                  : asText(row.coveredBy).split(",").map((s) => s.trim()).filter(Boolean);
                const thin = row.thin === true || people.length === 0;
                return (
                  <div key={i} className={`v3fs-covmap-row${thin ? " thin" : ""}`} role="row">
                    <span className="v3fs-covmap-area">{domain}{thin ? <em className="v3fs-covmap-flag">{people.length ? "thin" : "uncovered"}</em> : null}</span>
                    <span className="v3fs-covmap-people">
                      {people.length ? people.map((p, j) => <span key={j} className="v3fs-covmap-chip">{p}</span>)
                        : <span className="v3fs-covmap-none">no one assigned yet</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <TableEditor
          columns={[{ key: "domain", label: "Domain" }, { key: "coveredBy", label: "Covered by (comma-separated)", grow: 1.6 }, { key: "thin", label: "Coverage", kind: "select", options: [WELL_COVERED, THIN_COVERAGE] }]}
          rows={asArray(doc.coverageMap).map(asRecord).map((row) => ({ ...row, coveredBy: Array.isArray(row.coveredBy) ? asStrings(row.coveredBy).join(", ") : asText(row.coveredBy), thin: row.thin === true ? THIN_COVERAGE : WELL_COVERED }))}
          onChange={(next) => patch({ coverageMap: next.map((row) => ({ ...row, coveredBy: asText(row.coveredBy), thin: asText(row.thin) === THIN_COVERAGE })) })}
          addLabel="Add domain"
          reorderable
        />
      </Section>
      <Section label="Interviews" hint="the conversations to run — pick one to refine its questions">
        <div className="v3fs-kit2">
          <aside className="v3fs-kit2-roster" role="tablist" aria-label="Planned interviews">
            {interviews.items.length === 0 ? (
              <div className="v3fs-stu-empty">No interviews planned yet — regenerate the kit to build them.</div>
            ) : null}
            {interviews.items.map((entry, index) => {
              const interview = entry as Record<string, unknown>;
              const count = questionsOf(interview).length;
              return (
                <div key={index} className="v3fs-kit2-rrow">
                  <button type="button" role="tab" aria-selected={index === selected}
                    className={`v3fs-kit2-person${index === selected ? " on" : ""}`} onClick={() => setSelected(index)}>
                    <span className="v3fs-kit2-pr">{asText(interview.role) || asText(interview.domain) || "Interview"}</span>
                    <span className="v3fs-kit2-pn">{asText(interview.stakeholder) || <em>unassigned — name them in People</em>}</span>
                    <span className="v3fs-kit2-pq">{count} question{count === 1 ? "" : "s"}</span>
                  </button>
                  {locked ? null : (
                    <span className="v3fs-kit2-rmv">
                      <button type="button" className="v3fs-stu-x" aria-label="Move interview up" disabled={index === 0}
                        onClick={() => moveInterview(index, -1)}>↑</button>
                      <button type="button" className="v3fs-stu-x" aria-label="Move interview down" disabled={index === interviews.items.length - 1}
                        onClick={() => moveInterview(index, 1)}>↓</button>
                    </span>
                  )}
                </div>
              );
            })}
          </aside>
          <div className="v3fs-kit2-detail">
            {current ? (
              <>
                {/* Read-only identity — the plan targets this role/person; the
                    person and their address are managed in People. */}
                <div className="v3fs-kit2-idh">
                  <div className="v3fs-kit2-idh-g">
                    <span className="v3fs-kit2-idh-n">{asText(current.stakeholder) || "Unassigned"}</span>
                    {asText(current.role) ? <span className="v3fs-kit2-idh-role">{asText(current.role)}</span> : null}
                  </div>
                  <span className="v3fs-kit2-idh-e">{(curEmail ?? asText(current.email)) || "no email on file"}</span>
                </div>
                <StringListEditor label="Questions — one per line, asked in this order" values={questionsOf(current)}
                  onChange={(next) => setQuestions(selected, next)} addLabel="Add question" />
                <ChipsField label="Ask them to bring" values={asStrings(current.askForArtifacts)}
                  onChange={(next) => interviews.set(selected, { askForArtifacts: next })} />
                <details className="v3fs-disc v3fs-disc-sm">
                  <summary><span className="v3fs-disc-l">Domain & objectives</span><span className="v3fs-disc-c" aria-hidden="true" /></summary>
                  <div className="v3fs-disc-b">
                    <TextField label="Domain they own" value={asText(current.domain)} onChange={(next) => interviews.set(selected, { domain: next })} />
                    <StringListEditor label="Objectives — what this conversation must surface" values={asStrings(current.objectives)}
                      onChange={(next) => interviews.set(selected, { objectives: next })} addLabel="Add objective" />
                  </div>
                </details>
              </>
            ) : (
              <div className="v3fs-stu-empty">Select an interview on the left to refine its questions.</div>
            )}
          </div>
        </div>
      </Section>

      <details className="v3fs-disc v3fs-disc-sm">
        <summary><span className="v3fs-disc-l">Workflow personas<em>{personas.items.length}</em></span><span className="v3fs-disc-hint">every role needs a voice</span><span className="v3fs-disc-c" aria-hidden="true" /></summary>
        <div className="v3fs-disc-b">
          <CardList
            items={personas.items}
            itemLabel={(it) => `${asText(it.name) || "Persona"}${asText(it.kind) === "external" ? " · external" : ""}`}
            onAdd={() => personas.add({ name: "", kind: "internal", partInWorkflow: "", spokenForBy: [], unrepresented: false })}
            onRemove={personas.remove}
            onMove={personas.move}
            addLabel="Add persona"
            render={(persona, index) => (
              <>
                <div className="v3fs-stu-grid3">
                  <TextField label="Persona (a role, not a person)" value={asText(persona.name)} onChange={(next) => personas.set(index, { name: next })} />
                  <SelectField label="Kind" value={asText(persona.kind) || "internal"} options={["internal", "external"]}
                    onChange={(next) => personas.set(index, { kind: next })} />
                  <TextField label="Part in the workflow" value={asText(persona.partInWorkflow)} onChange={(next) => personas.set(index, { partInWorkflow: next })} />
                </div>
                <ChipsField label="Spoken for by (interviewees)" values={asStrings(persona.spokenForBy)}
                  onChange={(next) => personas.set(index, { spokenForBy: next, unrepresented: next.length === 0 && persona.unrepresented === true })} />
              </>
            )}
          />
        </div>
      </details>
      <details className="v3fs-disc v3fs-disc-sm">
        <summary><span className="v3fs-disc-l">Gaps<em>{asStrings(doc.gaps).length}</em></span><span className="v3fs-disc-hint">flow into follow-up scripts automatically</span><span className="v3fs-disc-c" aria-hidden="true" /></summary>
        <div className="v3fs-disc-b">
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </div>
      </details>
    </>
  );
}

/* ── Listen ───────────────────────────────────────────────────────────────── */

function AtlasStudio({ doc, onChange, onOpenArtifact, program, gapRoutes, onRouteGap }: StudioProps) {
  const patch = patchOf(doc, onChange);
  // The diagram's focus (the registers now live INSIDE the workflow studio's
  // combined card) still filters the gaps and open questions below. Filtered
  // views are READ-ONLY on purpose — editing a filtered table would silently
  // drop the hidden rows — so "Show all & edit" opens the full editor.
  const [focus, setFocus] = React.useState<AtlasFocus | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const handleFocus = React.useCallback((next: AtlasFocus | null) => {
    setFocus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);
  const filtering = !!focus && !showAll;
  const filterBar = (shown: number, total: number) => (
    <div className="v3fs-atlas-fltbar">
      <span>{shown} of {total} for <b>{focus?.label}</b></span>
      <button type="button" className="v3fs-a" onClick={() => setShowAll(true)}>Show all &amp; edit</button>
    </div>
  );
  const refocusBar = focus && showAll ? (
    <div className="v3fs-atlas-fltbar">
      <button type="button" className="v3fs-a" onClick={() => setShowAll(false)}>Filter to {focus.label}</button>
    </div>
  ) : null;
  return (
    <>
      <Section label="Workflows — the diagram" hint="each step: who does what, in which system; entity chips open the ontology">
        <WorkflowStudio doc={doc} onChange={onChange} onOpenArtifact={onOpenArtifact} program={program} onFocus={handleFocus} />
      </Section>
      {/* Open questions and gaps follow the diagram's focus too — items that
          MENTION the focused workflow/step's terms (its name, actors,
          systems, entities, events). Same read-only-when-filtered rule. */}
      {([
        { label: "Open questions", hint: "redirect each to the stakeholder or role who can answer it", key: "openQuestions", addLabel: "Add question", placeholder: "the open question", empty: "No open questions." },
        { label: "Gaps", hint: "redirect each gap to the stakeholder or role who can close it", key: "gaps", addLabel: "Add gap", placeholder: undefined, empty: "No gaps." },
      ] as const).map((section) => {
        const values = asStrings(doc[section.key]);
        const terms = focus?.terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 4) ?? [];
        const filtered = filtering && terms.length
          ? values.filter((value) => { const t = value.toLowerCase(); return terms.some((term) => t.includes(term)); })
          : null;
        return (
          <Section key={section.key} label={section.label} hint={section.hint}>
            {filtered ? (
              <>
                {filterBar(filtered.length, values.length)}
                {filtered.length ? filtered.map((value, i) => (
                  <div key={i} className="v3fs-atlas-flt-row"><span>{value}</span></div>
                )) : <div className="v3fs-stu-empty">Nothing here mentions this selection.</div>}
              </>
            ) : (
              <>
                {refocusBar}
                <GapRoutingEditor values={values} onChange={(next) => patch({ [section.key]: next })} program={program}
                  movementId="listen" gapRoutes={gapRoutes} onRoute={onRouteGap} addLabel={section.addLabel}
                  {...(section.placeholder ? { placeholder: section.placeholder } : {})} emptyHint={section.empty} />
              </>
            )}
          </Section>
        );
      })}
    </>
  );
}

/* ── Envision ─────────────────────────────────────────────────────────────── */

const SCORE_KEYS = ["fitToWorkflows", "timeToFirstDemo", "operability", "cost"] as const;

function StrategyStudio({ doc, onChange }: StudioProps) {
  const locked = useStudioLocked();
  const patch = patchOf(doc, onChange);
  const candidates = useListOps(doc, onChange, "candidates");
  const recommendation = asRecord(doc.recommendation);
  const gaps = asStrings(doc.gaps);
  const tradedAway = asText(recommendation.tradedAway);

  // READ-ONLY (derived) view — the decision board already presents every
  // candidate with its scores, strengths, risks and the crowned recommendation,
  // so the verbose candidate/recommendation EDIT forms below just repeat it. Here
  // we show only the board, the trade-off it accepted, and any open questions.
  if (locked) {
    return (
      <>
        <Section label="The decision — candidates side by side" hint="scores, strengths, risks; the recommendation is crowned">
          <StrategyBoard doc={doc} onChange={onChange} />
        </Section>
        {tradedAway ? (
          <Section label="Traded away" hint="what the chosen direction gives up">
            <p className="v3fs-strat-traded">{tradedAway}</p>
          </Section>
        ) : null}
        {gaps.length ? (
          <Section label="Open questions" hint="still unresolved on this direction">
            <ul className="v3fs-strat-gaps">{gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
          </Section>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Section label="The decision — candidates side by side" hint="scores, strengths, risks; crown the recommendation">
        <StrategyBoard doc={doc} onChange={onChange} />
      </Section>
      <Section label="Candidates" hint="2–3 shapes the system could take">
        <CardList
          items={candidates.items}
          itemLabel={(c) => `${asText(c.name) || "Candidate"} · ${asText(c.shape) || "shape"}`}
          onAdd={() => candidates.add({ name: "", shape: "orchestrator", description: "", strengths: [], risks: [], scores: {} })}
          onRemove={candidates.remove}
          addLabel="Add candidate"
          render={(candidate, index) => (
            <>
              <div className="v3fs-stu-grid2">
                <TextField label="Name" value={asText(candidate.name)} onChange={(next) => candidates.set(index, { name: next })} />
                <SelectField label="Shape" value={asText(candidate.shape) || "orchestrator"}
                  options={["orchestrator", "crew", "embedded", "other"]}
                  onChange={(next) => candidates.set(index, { shape: next })} />
              </div>
              <TextArea label="Description" rows={2} value={asText(candidate.description)}
                onChange={(next) => candidates.set(index, { description: next })} />
              <TextArea label="Agentic pattern" rows={2} value={asText(candidate.agenticPattern)}
                onChange={(next) => candidates.set(index, { agenticPattern: next })} />
              <div className="v3fs-stu-scores">
                {SCORE_KEYS.map((key) => (
                  <label key={key}>
                    <span>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                    <input inputMode="numeric" value={asText(asRecord(candidate.scores)[key])} disabled={locked}
                      onChange={(e) => candidates.set(index, { scores: { ...asRecord(candidate.scores), [key]: e.target.value.replace(/[^0-9.]/g, "") } })} />
                  </label>
                ))}
              </div>
              <div className="v3fs-stu-grid2">
                <StringListEditor label="Strengths" values={asStrings(candidate.strengths)}
                  onChange={(next) => candidates.set(index, { strengths: next })} addLabel="Add" />
                <StringListEditor label="Risks" values={asStrings(candidate.risks)}
                  onChange={(next) => candidates.set(index, { risks: next })} addLabel="Add" />
              </div>
            </>
          )}
        />
      </Section>
      {/* Recommendation is chosen on the decision board above (the "★ Recommend
          this option" button on a card) — no separate card at the bottom. */}
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

function BlueprintStudio({ doc, onChange, program }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const agents = useListOps(doc, onChange, "agents");
  const orchestration = asRecord(doc.orchestration);
  // Alignment with the Experience Design's agentic DIRECTION: the steps the
  // delivery team marked ⚡ Agentify there are the demand the Blueprint must
  // deliver. Surface them so the two artifacts read as one decision — and so a
  // marked step with no agent shows as a gap to close.
  const agentified = React.useMemo(() => {
    const ed = program ? readArtifactDoc(program, "experienceDesign") : null;
    const marks = ed ? asRecord(ed.agentifyMarks) : {};
    return Object.values(marks).map(asRecord)
      .map((m) => ({ flow: asText(m.workflow) || asText(m.area) || "Workflow", action: asText(m.action) }))
      .filter((m) => m.action);
  }, [program]);
  const agentNames = agents.items.map((a) => asText(a.name).toLowerCase()).filter(Boolean);
  return (
    <>
      {agentified.length ? (
        <div className="v3fs-bp-direction" role="note">
          <div className="v3fs-bp-direction-h">
            <span className="v3fs-bp-direction-i" aria-hidden="true">⚡</span>
            <b>Agentic direction — from Experience Design</b>
            <span className="v3fs-bp-direction-n">{agentified.length} step{agentified.length === 1 ? "" : "s"} to agentify</span>
          </div>
          <p className="v3fs-bp-direction-lead">These are the steps the delivery team marked to agentify. The Blueprint below must field an agent for each — build to this direction.</p>
          <ul className="v3fs-bp-direction-list">
            {agentified.slice(0, 12).map((s, i) => {
              const covered = agentNames.some((n) => n && s.action.toLowerCase().includes(n));
              return (
                <li key={i} className={covered ? "ok" : "open"}>
                  <span className="v3fs-bp-direction-flow">{s.flow}</span>
                  <span className="v3fs-bp-direction-act">{s.action}</span>
                  <span className={`v3fs-bp-direction-tag ${covered ? "ok" : "open"}`}>{covered ? "✓ agent" : "no agent yet"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <CollapsibleCard label="Orchestration map" hint="agents and what flows between them — edges are derived: outputs feeding inputs">
        <BlueprintGraph doc={doc} />
      </CollapsibleCard>
      <CollapsibleCard label="Journeys" hint="the orchestrated experience — stages across, lanes down: customer · user · agent · systems">
        <JourneyGrid doc={doc} onChange={onChange} />
      </CollapsibleCard>
      <CollapsibleCard label="Agents" badge={agents.items.length || undefined} hint="each replaces an Atlas workflow">
        <CardList
          items={agents.items}
          itemLabel={(a) => `${asText(a.name) || "Agent"} · ${asText(a.autonomyLevel) || "autonomy"}`}
          onAdd={() => agents.add({ name: "", purpose: "", tools: [], inputs: [], outputs: [], autonomyLevel: "suggest" })}
          onRemove={agents.remove}
          addLabel="Add agent"
          render={(agent, index) => (
            <>
              <div className="v3fs-stu-grid3">
                <TextField label="Name" value={asText(agent.name)} onChange={(next) => agents.set(index, { name: next })} />
                <SelectField label="Autonomy" value={asText(agent.autonomyLevel) || "suggest"}
                  options={["suggest", "act-with-approval", "act"]}
                  onChange={(next) => agents.set(index, { autonomyLevel: next })} />
                <TextField label="Escalates to" value={asText(agent.escalatesTo)} onChange={(next) => agents.set(index, { escalatesTo: next })} />
              </div>
              <TextArea label="Purpose" rows={2} value={asText(agent.purpose)} onChange={(next) => agents.set(index, { purpose: next })} />
              <TextField label="Replaces workflow" value={asText(agent.replacesWorkflow)} onChange={(next) => agents.set(index, { replacesWorkflow: next })} />
              <ChipsField label="Tools" values={asStrings(agent.tools)} onChange={(next) => agents.set(index, { tools: next })} />
              <div className="v3fs-stu-grid2">
                <ChipsField label="Consumes (entities)" values={asStrings(agent.inputs)} onChange={(next) => agents.set(index, { inputs: next })} />
                <ChipsField label="Produces (entities)" values={asStrings(agent.outputs)} onChange={(next) => agents.set(index, { outputs: next })} />
              </div>
            </>
          )}
        />
      </CollapsibleCard>
      <CollapsibleCard label="Orchestration pattern" defaultOpen={false}>
        <TextField label="Pattern" value={asText(orchestration.pattern)}
          onChange={(next) => patch({ orchestration: { ...orchestration, pattern: next } })} />
        <TextArea label="How work flows" rows={2} value={asText(orchestration.description)}
          onChange={(next) => patch({ orchestration: { ...orchestration, description: next } })} />
        <TextField label="State lives in" value={asText(orchestration.stateManagement)}
          onChange={(next) => patch({ orchestration: { ...orchestration, stateManagement: next } })} />
      </CollapsibleCard>
      <CollapsibleCard label="Data contracts" badge={asArray(doc.dataContracts).length || undefined} defaultOpen={false} hint="ontology entities and their systems of record">
        <TableEditor
          columns={[
            { key: "entity", label: "Entity" },
            { key: "source", label: "Source" },
            { key: "shape", label: "Shape", grow: 2 },
            { key: "sync", label: "Sync", kind: "select", options: ["live", "batch", "manual"] },
          ]}
          rows={asArray(doc.dataContracts).map(asRecord)}
          onChange={(next) => patch({ dataContracts: next })}
          addLabel="Add contract"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Human-in-the-loop points" badge={asArray(doc.hitlPoints).length || undefined} defaultOpen={false}>
        <TableEditor
          columns={[
            { key: "where", label: "Where" },
            { key: "why", label: "Why", grow: 2 },
            { key: "mechanism", label: "Mechanism", kind: "select", options: ["approve", "review", "override"] },
          ]}
          rows={asArray(doc.hitlPoints).map(asRecord)}
          onChange={(next) => patch({ hitlPoints: next })}
          addLabel="Add HITL point"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Eval plan" badge={asArray(doc.evalPlan).length || undefined} defaultOpen={false} hint="what must hold, and its pass bar">
        <TableEditor
          columns={[
            { key: "behaviour", label: "Behaviour", grow: 2 },
            { key: "measure", label: "Measure" },
            { key: "threshold", label: "Threshold" },
          ]}
          rows={asArray(doc.evalPlan).map(asRecord)}
          onChange={(next) => patch({ evalPlan: next })}
          addLabel="Add behaviour"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Build sequence" badge={asStrings(doc.buildSequence).length || undefined} defaultOpen={false} hint="the first slice must be demoable">
        <StringListEditor values={asStrings(doc.buildSequence)} onChange={(next) => patch({ buildSequence: next })} addLabel="Add slice" />
      </CollapsibleCard>
      <CollapsibleCard label="Track plan" badge={asArray(doc.tracks).length || undefined} defaultOpen={false} hint="adopting tracks happens through the Inbox decision — edits here reshape the proposal">
        <TableEditor
          columns={[
            { key: "name", label: "Track" },
            { key: "goal", label: "Goal", grow: 2 },
            { key: "leadStakeholder", label: "Demos to" },
          ]}
          rows={asArray(doc.tracks).map(asRecord)}
          onChange={(next) => patch({ tracks: next })}
          addLabel="Add track"
        />
      </CollapsibleCard>
      {asStrings(doc.gaps).length ? (
        <CollapsibleCard label="Gaps" badge={asStrings(doc.gaps).length} defaultOpen={false}>
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </CollapsibleCard>
      ) : null}
    </>
  );
}

/* ── Show ─────────────────────────────────────────────────────────────────── */

function PrototypePackStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const scaffold = asRecord(doc.scaffold);
  return (
    <>
      <Section label="Scaffold">
        <div className="v3fs-stu-grid2">
          <TextField label="Framework" value={asText(scaffold.framework)}
            onChange={(next) => patch({ scaffold: { ...scaffold, framework: next } })} />
          <TextField label="Runtime" value={asText(scaffold.runtime)}
            onChange={(next) => patch({ scaffold: { ...scaffold, runtime: next } })} />
        </div>
        <ChipsField label="Structure" values={asStrings(scaffold.structure)}
          onChange={(next) => patch({ scaffold: { ...scaffold, structure: next } })} />
        <ChipsField label="Dependencies" values={asStrings(scaffold.dependencies)}
          onChange={(next) => patch({ scaffold: { ...scaffold, dependencies: next } })} />
      </Section>
      <Section label="Build slices" hint="each demonstrates an Atlas workflow">
        <TableEditor
          columns={[
            { key: "slice", label: "Slice", grow: 1.6 },
            { key: "demonstrates", label: "Demonstrates", grow: 1.6 },
            { key: "estimate", label: "Est.", kind: "select", options: ["S", "M", "L"] },
          ]}
          rows={asArray(doc.buildSlices).map(asRecord)}
          onChange={(next) => patch({ buildSlices: next })}
          addLabel="Add slice"
        />
      </Section>
      <Section label="Seed scenarios" hint="seeded from stakeholder transcripts">
        <TableEditor
          columns={[
            { key: "stakeholder", label: "Stakeholder" },
            { key: "scenario", label: "Scenario", grow: 2.4 },
            { key: "data", label: "Seed data", grow: 1.4 },
          ]}
          rows={asArray(doc.seedScenarios).map(asRecord)}
          onChange={(next) => patch({ seedScenarios: next })}
          addLabel="Add scenario"
        />
      </Section>
      <Section label="Stubbing">
        <TableEditor
          columns={[
            { key: "integration", label: "Integration" },
            { key: "approach", label: "Approach", kind: "select", options: ["mock", "fixture", "sandbox"] },
            { key: "notes", label: "Notes", grow: 2 },
          ]}
          rows={asArray(doc.stubbing).map(asRecord)}
          onChange={(next) => patch({ stubbing: next })}
          addLabel="Add integration"
        />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

function DemoScriptsStudio({ doc, onChange, program }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const scripts = useListOps(doc, onChange, "scripts");
  // Area selector (the same indigo deck as every Listen surface): each script
  // files under its stakeholder's KIT area — coverage-matrix assignment
  // first, inference as fallback. Filtering keeps ORIGINAL indices so edits
  // still land on the right script.
  const [areaPick, setAreaPick] = React.useState("");
  const kitAreas = React.useMemo(() => (program ? listenCoverageAreas(program).map((area) => area.label) : []), [program]);
  const coverage = React.useMemo(() => (program ? listenAreaCoverage(program) : []), [program]);
  const entries = scripts.items.map((item, index) => {
    const labels = [asText(item.role), asText(item.stakeholder)].map((label) => label.trim().toLowerCase()).filter(Boolean);
    const covered = coverage.find((row) => row.roles.some((role) => labels.includes(role.trim().toLowerCase())))?.area;
    const area = covered ?? (program ? canonicalFrameArea(kitAreas, stakeholderPrimaryArea(program, asText(item.stakeholder), asText(item.role))) : "");
    return { item, index, area };
  });
  const areasPresent = kitAreas.filter((area) => entries.some((entry) => entry.area === area));
  const shown = areaPick ? entries.filter((entry) => entry.area === areaPick) : entries;
  return (
    <>
      {areasPresent.length > 1 ? (
        <div className="v3fs-wf-filters">
          <label className="v3fs-wf-filter grow">
            <span>Area</span>
            <select value={areaPick} aria-label="Filter scripts by area" onChange={(e) => setAreaPick(e.target.value)}>
              <option value="">All areas ({entries.length})</option>
              {areasPresent.map((area) => (
                <option key={area} value={area}>{area} ({entries.filter((entry) => entry.area === area).length})</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <Section label="Scripts" hint="one per stakeholder, seeded from their own transcript">
        <CardList
          items={shown.map((entry) => entry.item)}
          itemLabel={(s) => `${asText(s.stakeholder) || "Stakeholder"} — ${asText(s.duration) || "10–15 min"}`}
          onAdd={() => scripts.add({ stakeholder: "", role: "", duration: "10–15 min", openingQuote: "", scenario: "", steps: [], watchFor: [], acceptanceAsk: "" })}
          onRemove={(shownIndex) => scripts.remove(shown[shownIndex].index)}
          addLabel="Add script"
          render={(script, shownIndex) => {
            const index = shown[shownIndex].index;
            return (
            <>
              <div className="v3fs-stu-grid3">
                <TextField label="Stakeholder" value={asText(script.stakeholder)} onChange={(next) => scripts.set(index, { stakeholder: next })} />
                <TextField label="Role" value={asText(script.role)} onChange={(next) => scripts.set(index, { role: next })} />
                <TextField label="Duration" value={asText(script.duration)} onChange={(next) => scripts.set(index, { duration: next })} />
              </div>
              <TextArea label="Opening quote — their words" rows={2} value={asText(script.openingQuote)}
                onChange={(next) => scripts.set(index, { openingQuote: next })} />
              <TextArea label="Scenario" rows={2} value={asText(script.scenario)}
                onChange={(next) => scripts.set(index, { scenario: next })} />
              <TableEditor
                columns={[
                  { key: "beat", label: "Beat" },
                  { key: "show", label: "Show", grow: 1.4 },
                  { key: "say", label: "Say", grow: 2 },
                  { key: "callback", label: "Their words answered", grow: 1.4 },
                ]}
                rows={asArray(script.steps).map(asRecord)}
                onChange={(next) => scripts.set(index, { steps: next })}
                addLabel="Add beat"
                emptyHint="No beats yet."
              />
              <ChipsField label="Watch for" values={asStrings(script.watchFor)} onChange={(next) => scripts.set(index, { watchFor: next })} />
              <TextArea label="Acceptance ask" rows={2} value={asText(script.acceptanceAsk)}
                onChange={(next) => scripts.set(index, { acceptanceAsk: next })} />
            </>
            );
          }}
        />
      </Section>
      <Section label="Tour sequence" hint="the recommended demo order">
        <StringListEditor values={asStrings(doc.tourSequence)} onChange={(next) => patch({ tourSequence: next })} addLabel="Add" />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

/* ── Ship ─────────────────────────────────────────────────────────────────── */

function HardeningStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const workstreams = useListOps(doc, onChange, "workstreams");
  const cutover = asRecord(doc.cutoverPlan);
  return (
    <>
      <CollapsibleCard label="Workstreams" badge={workstreams.items.length || undefined}>
        <CardList
          items={workstreams.items}
          itemLabel={(w) => asText(w.area) || "Workstream"}
          onAdd={() => workstreams.add({ area: "guardrails", items: [] })}
          onRemove={workstreams.remove}
          addLabel="Add workstream"
          render={(workstream, index) => (
            <>
              <SelectField label="Area" value={asText(workstream.area) || "guardrails"}
                options={["authnz", "errors", "observability", "guardrails", "data", "performance", "hitl"]}
                onChange={(next) => workstreams.set(index, { area: next })} />
              <TableEditor
                columns={[
                  { key: "item", label: "Item", grow: 2 },
                  { key: "why", label: "Why", grow: 2 },
                  { key: "priority", label: "Priority", kind: "select", options: ["must", "should"] },
                  { key: "effort", label: "Effort", kind: "select", options: ["S", "M", "L"] },
                ]}
                rows={asArray(workstream.items).map(asRecord)}
                onChange={(next) => workstreams.set(index, { items: next })}
                addLabel="Add item"
                emptyHint="No items yet."
              />
            </>
          )}
        />
      </CollapsibleCard>
      <CollapsibleCard label="Guardrails" badge={asArray(doc.guardrails).length || undefined} defaultOpen={false}>
        <TableEditor
          columns={[
            { key: "risk", label: "Risk", grow: 1.6 },
            { key: "guardrail", label: "Guardrail", grow: 1.6 },
            { key: "mechanism", label: "Mechanism", grow: 1.2 },
          ]}
          rows={asArray(doc.guardrails).map(asRecord)}
          onChange={(next) => patch({ guardrails: next })}
          addLabel="Add guardrail"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Cutover plan" defaultOpen={false}>
        <SelectField label="Approach" value={asText(cutover.approach) || "parallel-run"}
          options={["big-bang", "parallel-run", "phased"]}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, approach: next } })} />
        <StringListEditor label="Steps" values={asStrings(cutover.steps)}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, steps: next } })} addLabel="Add step" />
        <TextArea label="Rollback" rows={2} value={asText(cutover.rollback)}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, rollback: next } })} />
      </CollapsibleCard>
      <CollapsibleCard label="Runbook seeds" badge={asStrings(doc.runbookSeeds).length || undefined} defaultOpen={false}>
        <StringListEditor values={asStrings(doc.runbookSeeds)} onChange={(next) => patch({ runbookSeeds: next })} addLabel="Add" />
      </CollapsibleCard>
      {asStrings(doc.gaps).length ? (
        <CollapsibleCard label="Gaps" badge={asStrings(doc.gaps).length} defaultOpen={false}>
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </CollapsibleCard>
      ) : null}
    </>
  );
}

function EvalSuiteStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  return (
    <>
      <CollapsibleCard label="Eval cases" badge={asArray(doc.evalCases).length || undefined} hint="behaviour, inputs, pass bar">
        <TableEditor
          columns={[
            { key: "id", label: "ID", grow: 0.5 },
            { key: "behaviour", label: "Behaviour", grow: 2 },
            { key: "given", label: "Given", grow: 1.4 },
            { key: "expect", label: "Expect", grow: 1.4 },
            { key: "kind", label: "Kind", kind: "select", options: ["capability", "guardrail", "regression", "latency"] },
            { key: "threshold", label: "Threshold" },
          ]}
          rows={asArray(doc.evalCases).map(asRecord)}
          onChange={(next) => patch({ evalCases: next })}
          addLabel="Add case"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Guardrail probes" badge={asArray(doc.guardrailProbes).length || undefined} defaultOpen={false} hint="what must never happen">
        <TableEditor
          columns={[
            { key: "probe", label: "Probe", grow: 2 },
            { key: "mustNot", label: "Must not", grow: 2 },
          ]}
          rows={asArray(doc.guardrailProbes).map(asRecord)}
          onChange={(next) => patch({ guardrailProbes: next })}
          addLabel="Add probe"
        />
      </CollapsibleCard>
      {asStrings(doc.gaps).length ? (
        <CollapsibleCard label="Gaps" badge={asStrings(doc.gaps).length} defaultOpen={false}>
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </CollapsibleCard>
      ) : null}
    </>
  );
}

const SEVERITY_OPTIONS = ["critical", "high", "medium"];

function RunbookStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const incidents = useListOps(doc, onChange, "incidentResponse");
  return (
    <>
      <CollapsibleCard label="Routine operations" badge={asArray(doc.routineOperations).length || undefined}>
        <TableEditor
          columns={[
            { key: "task", label: "Task", grow: 1.4 },
            { key: "frequency", label: "Frequency" },
            { key: "owner", label: "Owner" },
            { key: "procedure", label: "Procedure", grow: 2 },
          ]}
          rows={asArray(doc.routineOperations).map(asRecord)}
          onChange={(next) => patch({ routineOperations: next })}
          addLabel="Add task"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Monitoring" badge={asArray(doc.monitoring).length || undefined} defaultOpen={false}>
        <TableEditor
          columns={[
            { key: "signal", label: "Signal", grow: 1.4 },
            { key: "threshold", label: "Threshold" },
            { key: "action", label: "Action", grow: 1.6 },
          ]}
          rows={asArray(doc.monitoring).map(asRecord)}
          onChange={(next) => patch({ monitoring: next })}
          addLabel="Add signal"
        />
      </CollapsibleCard>
      <CollapsibleCard label="Incident response" badge={incidents.items.length || undefined} defaultOpen={false}>
        <CardList
          items={incidents.items}
          itemLabel={(i) => `${asText(i.scenario) || "Scenario"} · ${asText(i.severity) || "severity"}`}
          onAdd={() => incidents.add({ scenario: "", severity: "high", steps: [], escalateTo: "" })}
          onRemove={incidents.remove}
          addLabel="Add scenario"
          render={(incident, index) => (
            <>
              <div className="v3fs-stu-grid3">
                <TextField label="Scenario" value={asText(incident.scenario)} onChange={(next) => incidents.set(index, { scenario: next })} />
                <SelectField label="Severity" value={asText(incident.severity) || "high"} options={SEVERITY_OPTIONS}
                  onChange={(next) => incidents.set(index, { severity: next })} />
                <TextField label="Escalate to" value={asText(incident.escalateTo)} onChange={(next) => incidents.set(index, { escalateTo: next })} />
              </div>
              <StringListEditor label="Steps" values={asStrings(incident.steps)}
                onChange={(next) => incidents.set(index, { steps: next })} addLabel="Add step" />
            </>
          )}
        />
      </CollapsibleCard>
      {asStrings(doc.gaps).length ? (
        <CollapsibleCard label="Gaps" badge={asStrings(doc.gaps).length} defaultOpen={false}>
          <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
        </CollapsibleCard>
      ) : null}
    </>
  );
}

/* ── Evolve ───────────────────────────────────────────────────────────────── */

function BacklogStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  return (
    <>
      <Section label="Backlog" hint="value × effort, sequenced now / next / later">
        <TableEditor
          columns={[
            { key: "id", label: "ID", grow: 0.5 },
            { key: "title", label: "Title", grow: 1.6 },
            { key: "opportunity", label: "Opportunity", grow: 2 },
            { key: "value", label: "Value", kind: "select", options: ["high", "medium", "low"] },
            { key: "effort", label: "Effort", kind: "select", options: ["high", "medium", "low"] },
            { key: "priority", label: "Priority", kind: "select", options: ["now", "next", "later"] },
          ]}
          rows={asArray(doc.items).map(asRecord)}
          onChange={(next) => patch({ items: next })}
          addLabel="Add item"
        />
      </Section>
      <Section label="Themes">
        <StringListEditor values={asStrings(doc.themes)} onChange={(next) => patch({ themes: next })} addLabel="Add theme" />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

/**
 * Generic fallback editor: renders any flat-ish document — strings become
 * text areas, string arrays become lists, object arrays become tables with
 * inferred columns. Carries artifact types with no bespoke studio (e.g. the
 * benefits pulse) without losing editability.
 */
function GenericStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const HIDDEN = new Set(["confidence", "generatedAt", "editedAt", "editedBy", "summary", "title"]);
  const entries = Object.entries(doc).filter(([key]) => !HIDDEN.has(key));
  const labelOf = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return (
    <>
      {entries.map(([key, value]) => {
        if (typeof value === "string") {
          return (
            <Section key={key} label={labelOf(key)}>
              <TextArea value={value} rows={2} onChange={(next) => patch({ [key]: next })} />
            </Section>
          );
        }
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
          return (
            <Section key={key} label={labelOf(key)}>
              <StringListEditor values={value as string[]} onChange={(next) => patch({ [key]: next })} addLabel="Add" />
            </Section>
          );
        }
        if (Array.isArray(value) && value.length && value.every((v) => typeof v === "object" && v !== null)) {
          const keys = [...new Set(value.flatMap((v) => Object.keys(v as object)))]
            .filter((k) => (value as Record<string, unknown>[]).some((row) => typeof row[k] === "string" || typeof row[k] === "number"))
            .slice(0, 5);
          if (!keys.length) return null;
          return (
            <Section key={key} label={labelOf(key)}>
              <TableEditor
                columns={keys.map((k) => ({ key: k, label: labelOf(k) }))}
                rows={(value as Record<string, unknown>[])}
                onChange={(next) => patch({ [key]: next })}
                addLabel="Add row"
              />
            </Section>
          );
        }
        return null;
      })}
    </>
  );
}

/* ── registry ─────────────────────────────────────────────────────────────── */

export interface StudioEntry {
  fieldKey: string;
  Component: React.ComponentType<StudioProps>;
  /** Canonical section order for the document view — jsonb storage
   * alphabetises keys, so the generator's narrative order lives here. */
  docOrder?: string[];
}

const flowFieldKey = (artifactId: string): string => FORMAL_ARTIFACT_FIELD_KEYS[artifactId] ?? "";

export const STUDIO_REGISTRY: Record<string, StudioEntry> = {
  "charter": { fieldKey: flowFieldKey("charter"), docOrder: ["mandate", "sponsor", "businessObjective", "objectives", "inScope", "outOfScope", "successCriteria", "keyRisks", "governanceSummary"], Component: CharterStudio },
  "discovery-kit": { fieldKey: flowFieldKey("discovery-kit"), docOrder: ["personas", "interviews", "coverageMap"], Component: DiscoveryKitStudio },
  "current-state-atlas": { fieldKey: flowFieldKey("current-state-atlas"), docOrder: ["workflows", "events", "painHeatmap", "systemsInventory", "openQuestions", "coverage"], Component: AtlasStudio },
  "domain-ontology": { fieldKey: flowFieldKey("domain-ontology"), docOrder: ["entities", "relations", "standardAlignment", "ambiguities"], Component: OntologyStudio },
  "architecture-strategy": { fieldKey: flowFieldKey("architecture-strategy"), docOrder: ["candidates", "recommendation"], Component: StrategyStudio },
  "agentic-blueprint": { fieldKey: flowFieldKey("agentic-blueprint"), docOrder: ["agents", "journeys", "orchestration", "dataContracts", "hitlPoints", "evalPlan", "buildSequence", "tracks"], Component: BlueprintStudio },
  "experience-design": { fieldKey: flowFieldKey("experience-design"), docOrder: ["designIntent", "theme", "screens", "flows", "workflowMachines"], Component: ExperienceDesignStudio },
  "prototype-pack": { fieldKey: flowFieldKey("prototype-pack"), docOrder: ["scaffold", "buildSlices", "seedScenarios", "stubbing"], Component: PrototypePackStudio },
  "prototype-build": { fieldKey: flowFieldKey("prototype-build"), docOrder: ["screens", "summary"], Component: PrototypeStudio },
  "demo-scripts": { fieldKey: flowFieldKey("demo-scripts"), docOrder: ["scripts", "tourSequence"], Component: DemoScriptsStudio },
  "hardening-plan": { fieldKey: flowFieldKey("hardening-plan"), docOrder: ["workstreams", "guardrails", "hitlImplementation", "cutoverPlan", "runbookSeeds"], Component: HardeningStudio },
  "eval-suite": { fieldKey: flowFieldKey("eval-suite"), docOrder: ["evalCases", "guardrailProbes"], Component: EvalSuiteStudio },
  "runbook": { fieldKey: flowFieldKey("runbook"), docOrder: ["routineOperations", "monitoring", "incidentResponse"], Component: RunbookStudio },
  "optimization-backlog": { fieldKey: flowFieldKey("optimization-backlog"), docOrder: ["items", "themes"], Component: BacklogStudio },
  // The benefits pulse is written by an analysis agent, not a doc generator.
  "benefits-tracker": { fieldKey: "benefitsTracking", Component: GenericStudio },
};
