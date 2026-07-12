/**
 * One WYSIWYG editor per generated artifact type. Each edits the SAME
 * structured shape its generator emits — the reading pane, gate criteria,
 * semantics and downstream generators keep working on hand-edited docs.
 * The ontology's graph editor lives in OntologyStudio; everything here is
 * composed from the StudioKit primitives.
 */
import React from "react";
import OntologyStudio from "./OntologyStudio";
import WorkflowStudio from "./WorkflowStudio";
import JourneyGrid from "./JourneyGrid";
import BlueprintGraph from "./BlueprintGraph";
import StrategyBoard from "./StrategyBoard";
import {
  Section, TextField, TextArea, SelectField, ChipsField, StringListEditor, TableEditor,
  asArray, asRecord, asText, asStrings, type StudioProps,
} from "./StudioKit";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";

/* ── shared card-list scaffolding ─────────────────────────────────────────── */

function CardList({ items, render, onAdd, onRemove, addLabel, itemLabel }: {
  items: Record<string, unknown>[];
  render: (item: Record<string, unknown>, index: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  addLabel: string;
  itemLabel: (item: Record<string, unknown>, index: number) => string;
}) {
  return (
    <div className="v3fs-stu-cards">
      {items.map((item, index) => (
        <details key={index} className="v3fs-stu-card" open={items.length <= 2}>
          <summary>
            <span className="v3fs-stu-card-t">{itemLabel(item, index)}</span>
            <button type="button" className="v3fs-stu-x" aria-label="Remove"
              onClick={(e) => { e.preventDefault(); onRemove(index); }}>×</button>
          </summary>
          <div className="v3fs-stu-card-b">{render(item, index)}</div>
        </details>
      ))}
      <button type="button" className="v3fs-a" onClick={onAdd}>＋ {addLabel}</button>
    </div>
  );
}

function useListOps(doc: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void, key: string) {
  const items = asArray(doc[key]).map(asRecord);
  const set = (index: number, changes: Record<string, unknown>) =>
    onChange({ ...doc, [key]: items.map((item, i) => (i === index ? { ...item, ...changes } : item)) });
  const add = (blank: Record<string, unknown>) => onChange({ ...doc, [key]: [...items, blank] });
  const remove = (index: number) => onChange({ ...doc, [key]: items.filter((_, i) => i !== index) });
  return { items, set, add, remove };
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

function DiscoveryKitStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const interviews = useListOps(doc, onChange, "interviews");
  const personas = useListOps(doc, onChange, "personas");
  return (
    <>
      <Section label="Workflow personas" hint="every role in the process — internal and external; each needs a voice who can speak for it">
        <CardList
          items={personas.items}
          itemLabel={(it) => `${asText(it.name) || "Persona"}${asText(it.kind) === "external" ? " · external" : ""}`}
          onAdd={() => personas.add({ name: "", kind: "internal", partInWorkflow: "", spokenForBy: [], unrepresented: false })}
          onRemove={personas.remove}
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
      </Section>
      <Section label="Interviews" hint="a role-aware conversation per stakeholder">
        <CardList
          items={interviews.items}
          itemLabel={(it) => `${asText(it.stakeholder) || "Stakeholder"} — ${asText(it.role) || "role"}`}
          onAdd={() => interviews.add({ stakeholder: "", role: "", email: "", domain: "", durationMinutes: 45, objectives: [], agenda: [], askForArtifacts: [] })}
          onRemove={interviews.remove}
          addLabel="Add interview"
          render={(interview, index) => (
            <>
              <div className="v3fs-stu-grid3">
                <TextField label="Stakeholder" value={asText(interview.stakeholder)} onChange={(next) => interviews.set(index, { stakeholder: next })} />
                <TextField label="Role" value={asText(interview.role)} onChange={(next) => interviews.set(index, { role: next })} />
                <TextField label="Email — response links go here" value={asText(interview.email)} onChange={(next) => interviews.set(index, { email: next })} />
                <TextField label="Domain" value={asText(interview.domain)} onChange={(next) => interviews.set(index, { domain: next })} />
              </div>
              <StringListEditor label="Objectives" values={asStrings(interview.objectives)}
                onChange={(next) => interviews.set(index, { objectives: next })} addLabel="Add objective" />
              {asArray(interview.agenda).map(asRecord).map((block, blockIndex) => (
                <div key={blockIndex} className="v3fs-stu-sub">
                  <div className="v3fs-stu-grid3">
                    <TextField label="Minutes" value={asText(block.minutes)} onChange={(next) => {
                      const agenda = asArray(interview.agenda).map(asRecord).map((b, i) => (i === blockIndex ? { ...b, minutes: next } : b));
                      interviews.set(index, { agenda });
                    }} />
                    <TextField label="Topic" value={asText(block.topic)} onChange={(next) => {
                      const agenda = asArray(interview.agenda).map(asRecord).map((b, i) => (i === blockIndex ? { ...b, topic: next } : b));
                      interviews.set(index, { agenda });
                    }} />
                    <button type="button" className="v3fs-stu-x" aria-label="Remove agenda block" onClick={() => {
                      interviews.set(index, { agenda: asArray(interview.agenda).filter((_, i) => i !== blockIndex) });
                    }}>×</button>
                  </div>
                  <StringListEditor label="Questions" values={asStrings(block.questions)} onChange={(next) => {
                    const agenda = asArray(interview.agenda).map(asRecord).map((b, i) => (i === blockIndex ? { ...b, questions: next } : b));
                    interviews.set(index, { agenda });
                  }} addLabel="Add question" />
                </div>
              ))}
              <button type="button" className="v3fs-a" onClick={() =>
                interviews.set(index, { agenda: [...asArray(interview.agenda), { minutes: 10, topic: "", questions: [] }] })}>
                ＋ Add agenda block
              </button>
              <ChipsField label="Ask them to bring" values={asStrings(interview.askForArtifacts)}
                onChange={(next) => interviews.set(index, { askForArtifacts: next })} />
            </>
          )}
        />
      </Section>
      <Section label="Coverage map" hint="every workflow domain needs a voice">
        <TableEditor
          columns={[{ key: "domain", label: "Domain" }, { key: "coveredBy", label: "Covered by", grow: 1.6 }, { key: "thin", label: "Thin?", kind: "select", options: ["false", "true"] }]}
          rows={asArray(doc.coverageMap).map(asRecord).map((row) => ({ ...row, coveredBy: asStrings(row.coveredBy).join(", "), thin: String(row.thin ?? "false") }))}
          onChange={(next) => patch({ coverageMap: next.map((row) => ({ ...row, coveredBy: asText(row.coveredBy).split(",").map((s) => s.trim()).filter(Boolean), thin: asText(row.thin) === "true" })) })}
          addLabel="Add domain"
        />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

/* ── Listen ───────────────────────────────────────────────────────────────── */

const SEVERITIES = ["high", "medium", "low"];

function AtlasStudio({ doc, onChange, onOpenArtifact }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const pains = useListOps(doc, onChange, "painHeatmap");
  return (
    <>
      <Section label="Workflows — the diagram" hint="each step: who does what, in which system; entity chips open the ontology">
        <WorkflowStudio doc={doc} onChange={onChange} onOpenArtifact={onOpenArtifact} />
      </Section>
      <Section label="Pain heatmap" hint="colour = severity">
        <div className="v3fs-stu-heat">
          {pains.items.map((pain, index) => (
            <div key={index} className={`v3fs-stu-heat-row sev-${asText(pain.severity) || "medium"}`}>
              <select value={asText(pain.severity) || "medium"} aria-label="Severity"
                onChange={(e) => pains.set(index, { severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input value={asText(pain.area)} placeholder="Area" aria-label="Area"
                onChange={(e) => pains.set(index, { area: e.target.value })} />
              <input value={asText(pain.pain)} placeholder="The pain" aria-label="Pain" style={{ flexGrow: 2 }}
                onChange={(e) => pains.set(index, { pain: e.target.value })} />
              <button type="button" className="v3fs-stu-x" aria-label="Remove" onClick={() => pains.remove(index)}>×</button>
            </div>
          ))}
          <button type="button" className="v3fs-a" onClick={() => pains.add({ area: "", pain: "", severity: "medium", voicedBy: [] })}>＋ Add pain</button>
        </div>
      </Section>
      <Section label="Systems inventory">
        <TableEditor
          columns={[{ key: "system", label: "System" }, { key: "usedFor", label: "Used for", grow: 2 }]}
          rows={asArray(doc.systemsInventory).map(asRecord)}
          onChange={(next) => patch({ systemsInventory: next })}
          addLabel="Add system"
          emptyHint="No systems captured."
        />
      </Section>
      <Section label="Open questions">
        <StringListEditor values={asStrings(doc.openQuestions)} onChange={(next) => patch({ openQuestions: next })} addLabel="Add question" />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

/* ── Envision ─────────────────────────────────────────────────────────────── */

const SCORE_KEYS = ["fitToWorkflows", "timeToFirstDemo", "operability", "cost"] as const;

function StrategyStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const candidates = useListOps(doc, onChange, "candidates");
  const recommendation = asRecord(doc.recommendation);
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
                    <input inputMode="numeric" value={asText(asRecord(candidate.scores)[key])}
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
      <Section label="Recommendation" hint="chosen at a demo, recorded here">
        <TextField label="Candidate" value={asText(recommendation.candidate)}
          onChange={(next) => patch({ recommendation: { ...recommendation, candidate: next } })} />
        <TextArea label="Rationale" rows={2} value={asText(recommendation.rationale)}
          onChange={(next) => patch({ recommendation: { ...recommendation, rationale: next } })} />
        <TextArea label="Traded away" rows={2} value={asText(recommendation.tradedAway)}
          onChange={(next) => patch({ recommendation: { ...recommendation, tradedAway: next } })} />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

function BlueprintStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const agents = useListOps(doc, onChange, "agents");
  const orchestration = asRecord(doc.orchestration);
  return (
    <>
      <Section label="The orchestration — agents and what flows between them" hint="edges are derived: outputs feeding inputs; drag to arrange">
        <BlueprintGraph doc={doc} />
      </Section>
      <Section label="Journeys — the orchestrated experience" hint="stages across, lanes down: customer · user · agent · systems">
        <JourneyGrid doc={doc} onChange={onChange} />
      </Section>
      <Section label="Agents" hint="each replaces an Atlas workflow">
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
      </Section>
      <Section label="Orchestration">
        <TextField label="Pattern" value={asText(orchestration.pattern)}
          onChange={(next) => patch({ orchestration: { ...orchestration, pattern: next } })} />
        <TextArea label="How work flows" rows={2} value={asText(orchestration.description)}
          onChange={(next) => patch({ orchestration: { ...orchestration, description: next } })} />
        <TextField label="State lives in" value={asText(orchestration.stateManagement)}
          onChange={(next) => patch({ orchestration: { ...orchestration, stateManagement: next } })} />
      </Section>
      <Section label="Data contracts" hint="ontology entities and their systems of record">
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
      </Section>
      <Section label="Human-in-the-loop points">
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
      </Section>
      <Section label="Eval plan" hint="what must hold, and its pass bar">
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
      </Section>
      <Section label="Build sequence" hint="the first slice must be demoable">
        <StringListEditor values={asStrings(doc.buildSequence)} onChange={(next) => patch({ buildSequence: next })} addLabel="Add slice" />
      </Section>
      <Section label="Track plan" hint="adopting tracks happens through the Inbox decision — edits here reshape the proposal">
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
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
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

function DemoScriptsStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const scripts = useListOps(doc, onChange, "scripts");
  return (
    <>
      <Section label="Scripts" hint="one per stakeholder, seeded from their own transcript">
        <CardList
          items={scripts.items}
          itemLabel={(s) => `${asText(s.stakeholder) || "Stakeholder"} — ${asText(s.duration) || "10–15 min"}`}
          onAdd={() => scripts.add({ stakeholder: "", role: "", duration: "10–15 min", openingQuote: "", scenario: "", steps: [], watchFor: [], acceptanceAsk: "" })}
          onRemove={scripts.remove}
          addLabel="Add script"
          render={(script, index) => (
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
          )}
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
      <Section label="Workstreams">
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
      </Section>
      <Section label="Guardrails">
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
      </Section>
      <Section label="Cutover plan">
        <SelectField label="Approach" value={asText(cutover.approach) || "parallel-run"}
          options={["big-bang", "parallel-run", "phased"]}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, approach: next } })} />
        <StringListEditor label="Steps" values={asStrings(cutover.steps)}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, steps: next } })} addLabel="Add step" />
        <TextArea label="Rollback" rows={2} value={asText(cutover.rollback)}
          onChange={(next) => patch({ cutoverPlan: { ...cutover, rollback: next } })} />
      </Section>
      <Section label="Runbook seeds">
        <StringListEditor values={asStrings(doc.runbookSeeds)} onChange={(next) => patch({ runbookSeeds: next })} addLabel="Add" />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

function EvalSuiteStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  return (
    <>
      <Section label="Eval cases" hint="behaviour, inputs, pass bar">
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
      </Section>
      <Section label="Guardrail probes" hint="what must never happen">
        <TableEditor
          columns={[
            { key: "probe", label: "Probe", grow: 2 },
            { key: "mustNot", label: "Must not", grow: 2 },
          ]}
          rows={asArray(doc.guardrailProbes).map(asRecord)}
          onChange={(next) => patch({ guardrailProbes: next })}
          addLabel="Add probe"
        />
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
    </>
  );
}

const SEVERITY_OPTIONS = ["critical", "high", "medium"];

function RunbookStudio({ doc, onChange }: StudioProps) {
  const patch = patchOf(doc, onChange);
  const incidents = useListOps(doc, onChange, "incidentResponse");
  return (
    <>
      <Section label="Routine operations">
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
      </Section>
      <Section label="Monitoring">
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
      </Section>
      <Section label="Incident response">
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
      </Section>
      <Section label="Gaps">
        <StringListEditor values={asStrings(doc.gaps)} onChange={(next) => patch({ gaps: next })} addLabel="Add gap" />
      </Section>
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
  "current-state-atlas": { fieldKey: flowFieldKey("current-state-atlas"), docOrder: ["workflows", "painHeatmap", "systemsInventory", "openQuestions", "coverage"], Component: AtlasStudio },
  "domain-ontology": { fieldKey: flowFieldKey("domain-ontology"), docOrder: ["entities", "relations", "events", "standardAlignment", "ambiguities"], Component: OntologyStudio },
  "architecture-strategy": { fieldKey: flowFieldKey("architecture-strategy"), docOrder: ["candidates", "recommendation"], Component: StrategyStudio },
  "agentic-blueprint": { fieldKey: flowFieldKey("agentic-blueprint"), docOrder: ["agents", "journeys", "orchestration", "dataContracts", "hitlPoints", "evalPlan", "buildSequence", "tracks"], Component: BlueprintStudio },
  "prototype-pack": { fieldKey: flowFieldKey("prototype-pack"), docOrder: ["scaffold", "buildSlices", "seedScenarios", "stubbing"], Component: PrototypePackStudio },
  "demo-scripts": { fieldKey: flowFieldKey("demo-scripts"), docOrder: ["scripts", "tourSequence"], Component: DemoScriptsStudio },
  "hardening-plan": { fieldKey: flowFieldKey("hardening-plan"), docOrder: ["workstreams", "guardrails", "hitlImplementation", "cutoverPlan", "runbookSeeds"], Component: HardeningStudio },
  "eval-suite": { fieldKey: flowFieldKey("eval-suite"), docOrder: ["evalCases", "guardrailProbes"], Component: EvalSuiteStudio },
  "runbook": { fieldKey: flowFieldKey("runbook"), docOrder: ["routineOperations", "monitoring", "incidentResponse"], Component: RunbookStudio },
  "optimization-backlog": { fieldKey: flowFieldKey("optimization-backlog"), docOrder: ["items", "themes"], Component: BacklogStudio },
  // The benefits pulse is written by an analysis agent, not a doc generator.
  "benefits-tracker": { fieldKey: "benefitsTracking", Component: GenericStudio },
};
