/**
 * The shareable REVIEW surfaces a stakeholder sees on a response link:
 *  - agentify        — walk your own workflow; mark each step Keep / Assist /
 *                      Agentify, with a why. Feeds Envision.
 *  - ontology-atlas  — read the domain's terms and mapped workflows; say where
 *                      each is wrong or missing. Feeds Listen.
 *
 * Pure presentation + local state; on submit it composes an attributed evidence
 * block (composeAgentify/composeOntologyAtlasAnswers) and hands it up as the
 * interview `answers` text — the same quarantine → evidence path as a script.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  composeAgentifyAnswers, composeOntologyAtlasAnswers, composeListenWorkflowAnswers,
  type AgentifyReview, type OntologyAtlasReview, type ListenWorkflowReview, type ReviewPayload,
} from "@/v3/components/flow/flowReviews";
import { WorkflowFlow, OntologyMap, type FlowNode } from "@/v3/components/flow/FlowReviewVisuals";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";

/** State that persists to the respondent's own device (keyed by the link token
 * plus a field name), so they can close a long review and return without losing
 * their edits. Best-effort — private mode or a full quota just falls back to
 * ordinary in-memory state. FlowRespond clears every field on submit. */
function usePersistentState<T>(baseKey: string | undefined, field: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key = baseKey ? `${baseKey}.${field}` : "";
  const [value, setValue] = useState<T>(() => {
    if (!key) return initial;
    try { const raw = localStorage.getItem(key); return raw != null ? JSON.parse(raw) as T : initial; } catch { return initial; }
  });
  useEffect(() => {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* best-effort */ }
  }, [key, value]);
  return [value, setValue];
}

const DISPOSITIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "keep", label: "Stays human", hint: "judgement, relationships, the irreducibly human call" },
  { key: "assist", label: "Agent assists", hint: "an agent drafts or prepares; you decide" },
  { key: "agentify", label: "Agentify", hint: "an agent can run this end to end" },
];

/** The distinct areas across a set of items, General last. */
function areasOf(items: Array<{ area?: string }>): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.area) set.add(it.area);
  return [...set].sort((a, b) => a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b));
}

/** Area filter chips — hidden below two areas (nothing to filter). */
function AreaChips({ areas, active, onPick }: { areas: string[]; active: string; onPick: (area: string) => void }) {
  if (areas.length < 2) return null;
  return (
    <div className="v3fs-rvw-areas" role="group" aria-label="Filter by area">
      <button type="button" className={`v3fs-rvw-area${active === "" ? " on" : ""}`} onClick={() => onPick("")}>All areas</button>
      {areas.map((area) => (
        <button key={area} type="button" className={`v3fs-rvw-area${active === area ? " on" : ""}`} onClick={() => onPick(area)}>{area}</button>
      ))}
    </div>
  );
}

function AgentifySurface({ review, stakeholder, submitting, error, onSubmit, draftKey }: {
  review: AgentifyReview; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void; draftKey?: string;
}) {
  const [responses, setResponses] = usePersistentState<Record<string, { disposition?: string; comment?: string }>>(draftKey, "ag", {});
  const [area, setArea] = useState(review.recipientArea ?? "");
  const areas = areasOf(review.workflows);
  const totalSteps = review.workflows.reduce((n, w) => n + w.steps.length, 0);
  const decided = Object.values(responses).filter((r) => r.disposition).length;
  const setDisposition = (key: string, disposition: string) =>
    setResponses((prev) => ({ ...prev, [key]: { ...prev[key], disposition } }));
  const setComment = (key: string, comment: string) =>
    setResponses((prev) => ({ ...prev, [key]: { ...prev[key], comment } }));

  return (
    <>
      <header className="v3fs-hero">
        <h1 className="v3fs-hero-title"><span className="v3fs-hero-brand">ATOS Flow</span></h1>
        <p className="v3fs-how">
          {stakeholder ? `${stakeholder} — ` : ""}{review.intro}
        </p>
      </header>
      <AreaChips areas={areas} active={area} onPick={setArea} />
      {review.recipientArea && area === review.recipientArea ? (
        <p className="v3fs-rvw-scoped">This review covers your area — <b>{review.recipientArea}</b>.</p>
      ) : null}
      <div className="v3fs-rvw">
        {review.workflows.map((workflow, wi) => area && workflow.area !== area ? null : (
          <section key={wi} className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h">
              <b>{workflow.name}</b>
              {workflow.trigger ? <span className="v3fs-rvw-trigger">Starts when: {workflow.trigger}</span> : null}
            </div>
            <ol className="v3fs-rvw-steps">
              {workflow.steps.map((step, si) => {
                const key = `${wi}.${si}`;
                const chosen = responses[key]?.disposition;
                return (
                  <li key={si} className={`v3fs-rvw-step${step.mine ? " mine" : ""}`}>
                    <div className="v3fs-rvw-step-a">
                      <span className="v3fs-rvw-num" aria-hidden="true">{si + 1}</span>
                      <div className="v3fs-rvw-step-body">
                        <span className="v3fs-rvw-action">{step.action}</span>
                        <span className="v3fs-rvw-meta">
                          {step.actor ? <span className={step.mine ? "you" : ""}>{step.mine ? "you" : step.actor}</span> : null}
                          {step.system ? <span>· {step.system}</span> : null}
                        </span>
                      </div>
                    </div>
                    <div className="v3fs-rvw-seg" role="group" aria-label={`How should this step run: ${step.action}`}>
                      {DISPOSITIONS.map((d) => (
                        <button key={d.key} type="button" title={d.hint}
                          className={`v3fs-rvw-opt ${d.key}${chosen === d.key ? " on" : ""}`}
                          onClick={() => setDisposition(key, d.key)}>{d.label}</button>
                      ))}
                    </div>
                    {chosen ? (
                      <input className="v3fs-rvw-comment" value={responses[key]?.comment ?? ""}
                        onChange={(e) => setComment(key, e.target.value)}
                        placeholder={chosen === "keep" ? "Why must this stay human? (optional)" : "What would the agent need to get this right? (optional)"} />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <div className="v3fs-rvw-foot">
        <div className="v3fs-rvw-progress"><span style={{ width: `${totalSteps ? Math.round((decided / totalSteps) * 100) : 0}%` }} /></div>
        <span className="v3fs-rvw-count">{decided} of {totalSteps} steps marked</span>
        {draftKey && decided ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !decided}
          onClick={() => onSubmit(composeAgentifyAnswers(review, responses))}>
          {submitting ? "Sending…" : "Send my review"}
        </button>
      </div>
    </>
  );
}

function OntologyAtlasSurface({ review, stakeholder, submitting, error, onSubmit, draftKey }: {
  review: OntologyAtlasReview; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void; draftKey?: string;
}) {
  const [termComments, setTermComments] = usePersistentState<Record<string, string>>(draftKey, "oaTerms", {});
  const [workflowComments, setWorkflowComments] = usePersistentState<Record<string, string>>(draftKey, "oaWf", {});
  const [overall, setOverall] = usePersistentState(draftKey, "oaOverall", "");
  const [area, setArea] = useState(review.recipientArea ?? "");
  const areas = areasOf([...review.terms, ...review.workflows]);
  const touched = useMemo(() =>
    Object.values(termComments).some((v) => v.trim())
    || Object.values(workflowComments).some((v) => v.trim())
    || overall.trim().length > 0,
    [termComments, workflowComments, overall]);
  const shownTerms = area ? review.terms.filter((t) => t.area === area) : review.terms;
  const shownWorkflows = area ? review.workflows.filter((w) => w.area === area) : review.workflows;

  return (
    <>
      <header className="v3fs-hero">
        <h1 className="v3fs-hero-title"><span className="v3fs-hero-brand">ATOS Flow</span></h1>
        <p className="v3fs-how">{stakeholder ? `${stakeholder} — ` : ""}{review.intro}</p>
      </header>
      <AreaChips areas={areas} active={area} onPick={setArea} />
      {review.recipientArea && area === review.recipientArea ? (
        <p className="v3fs-rvw-scoped">This review covers your area — <b>{review.recipientArea}</b>.</p>
      ) : null}
      <div className="v3fs-rvw">
        {shownTerms.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The terms we heard</b><span className="v3fs-rvw-trigger">Your world, in your words</span></div>
            <div className="v3fs-rvw-terms">
              {review.terms.map((term, i) => area && term.area !== area ? null : (
                <div key={i} className="v3fs-rvw-term">
                  <div className="v3fs-rvw-term-h">
                    <b>{term.name}</b>
                    {term.systemOfRecord ? <span className="v3fs-rvw-sor">{term.systemOfRecord}</span> : null}
                  </div>
                  {term.definition ? <p className="v3fs-rvw-def">{term.definition}</p> : null}
                  {term.aliases && term.aliases.length ? <p className="v3fs-rvw-aka">also called: {term.aliases.join(", ")}</p> : null}
                  <input className="v3fs-rvw-comment" value={termComments[String(i)] ?? ""}
                    onChange={(e) => setTermComments((p) => ({ ...p, [String(i)]: e.target.value }))}
                    placeholder="Wrong, missing, or named differently? (optional)" />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {shownWorkflows.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The workflows we mapped</b><span className="v3fs-rvw-trigger">Does this match how it really runs?</span></div>
            <div className="v3fs-rvw-terms">
              {review.workflows.map((workflow, i) => area && workflow.area !== area ? null : (
                <div key={i} className="v3fs-rvw-term">
                  <div className="v3fs-rvw-term-h">
                    <b>{workflow.name}</b>
                    {workflow.owner ? <span className="v3fs-rvw-sor">{workflow.owner}</span> : null}
                  </div>
                  {workflow.steps.length ? (
                    <ol className="v3fs-rvw-ministeps">{workflow.steps.map((s, si) => <li key={si}>{s}</li>)}</ol>
                  ) : null}
                  <input className="v3fs-rvw-comment" value={workflowComments[String(i)] ?? ""}
                    onChange={(e) => setWorkflowComments((p) => ({ ...p, [String(i)]: e.target.value }))}
                    placeholder="What's different, missing, or out of order? (optional)" />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="v3fs-rvw-wf">
          <div className="v3fs-rvw-wf-h"><b>Anything else</b></div>
          <textarea className="v3fs-rvw-overall" value={overall} rows={3}
            onChange={(e) => setOverall(e.target.value)}
            placeholder="Anything we've misunderstood, or a term or workflow we've missed entirely?" />
        </section>
      </div>
      <div className="v3fs-rvw-foot">
        {draftKey && touched ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !touched}
          onClick={() => onSubmit(composeOntologyAtlasAnswers(review, termComments, workflowComments, overall))}>
          {submitting ? "Sending…" : "Send my comments"}
        </button>
      </div>
    </>
  );
}

function ListenWorkflowSurface({ review, stakeholder, submitting, error, onSubmit, draftKey }: {
  review: ListenWorkflowReview; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void; draftKey?: string;
}) {
  const [wfSteps, setWfSteps] = usePersistentState<FlowNode[][]>(draftKey, "lwSteps",
    review.workflows.map((w) => w.steps.map((s) => ({
      action: s.action, original: s.action, actor: s.actor, originalActor: s.actor, system: s.system, originalSystem: s.system, entities: s.entities,
    }))));
  const [narration, setNarration] = usePersistentState(draftKey, "lwNarr", "");
  const [termNotes, setTermNotes] = usePersistentState<Record<string, string>>(draftKey, "lwTerms", {});
  const [answers, setAnswers] = usePersistentState<Record<string, string>>(draftKey, "lwAns", {});
  const [addedTerms, setAddedTerms] = usePersistentState<Array<{ name: string; note: string }>>(draftKey, "lwAdd", []);

  const editStep = (wi: number, si: number, action: string) => setWfSteps((prev) =>
    prev.map((steps, i) => i !== wi ? steps : steps.map((s, j) => j !== si ? s : { ...s, action })));
  const editMeta = (wi: number, si: number, field: "actor" | "system", value: string) => setWfSteps((prev) =>
    prev.map((steps, i) => i !== wi ? steps : steps.map((s, j) => j !== si ? s : { ...s, [field]: value })));
  const toggleRemove = (wi: number, si: number) => setWfSteps((prev) =>
    prev.map((steps, i) => {
      if (i !== wi) return steps;
      const step = steps[si];
      // A brand-new (added) row is deleted outright; an original is struck through.
      if (step.added) return steps.filter((_, j) => j !== si);
      return steps.map((s, j) => j !== si ? s : { ...s, removed: !s.removed });
    }));
  const addStep = (wi: number, at: number) => setWfSteps((prev) =>
    prev.map((steps, i) => {
      if (i !== wi) return steps;
      const next = [...steps];
      next.splice(at + 1, 0, { action: "", added: true });
      return next;
    }));
  const reorderStep = (wi: number, from: number, to: number) => setWfSteps((prev) =>
    prev.map((steps, i) => {
      if (i !== wi) return steps;
      const next = [...steps];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }));

  // Everything the stakeholder is proposing — the LIVE preview, rebuilt on edit.
  const proposal = useMemo(() => {
    const changed = (s: FlowNode) => s.added ? s.action.trim() : (
      s.removed || (s.original != null && s.original !== s.action)
      || (s.originalActor ?? "") !== (s.actor ?? "") || (s.originalSystem ?? "") !== (s.system ?? ""));
    const workflows = review.workflows.map((w, wi) => {
      const steps = wfSteps[wi] ?? [];
      const reordered = steps.some((s, j) => s.original != null && s.original !== (review.workflows[wi]?.steps[j]?.action ?? s.original));
      const changes = steps.filter(changed);
      return { name: w.name, changes, steps, reordered };
    }).filter((w) => w.changes.length || w.reordered);
    const notedTerms = review.terms.map((t, i) => ({ name: t.name, note: (termNotes[String(i)] ?? "").trim() })).filter((r) => r.note);
    const newTerms = addedTerms.filter((t) => t.name.trim());
    const answered = review.questions.map((q, i) => ({ q, a: (answers[String(i)] ?? "").trim() })).filter((r) => r.a);
    const count = workflows.reduce((n, w) => n + w.changes.length + (w.reordered ? 1 : 0), 0)
      + (narration.trim() ? 1 : 0) + notedTerms.length + newTerms.length + answered.length;
    return { workflows, notedTerms, newTerms, answered, count };
  }, [review, wfSteps, narration, termNotes, answers, addedTerms]);

  const [area, setArea] = useState(review.recipientArea ?? "");
  const areas = areasOf(review.workflows);

  const compose = () => composeListenWorkflowAnswers(review, {
    workflows: review.workflows.map((w, wi) => ({ name: w.name, steps: wfSteps[wi] ?? [] })),
    narration, termNotes, answers, addedTerms,
  });

  return (
    <>
      <header className="v3fs-hero">
        <h1 className="v3fs-hero-title"><span className="v3fs-hero-brand">ATOS Flow</span></h1>
        <p className="v3fs-how">{stakeholder ? `${stakeholder} — ` : ""}{review.intro}</p>
      </header>
      <AreaChips areas={areas} active={area} onPick={setArea} />
      {review.recipientArea && area === review.recipientArea ? (
        <p className="v3fs-rvw-scoped">This review covers your area — <b>{review.recipientArea}</b>.</p>
      ) : null}
      <div className="v3fs-rvw">
        <div className="v3fs-rvw-section-h"><span className="v3fs-rvw-step-ic" aria-hidden="true">⇄</span>Your workflow — fix it, add steps, or mark what doesn&rsquo;t happen</div>
        {review.workflows.map((wf, wi) => area && wf.area !== area ? null : (
          <section key={wi} className="v3fs-rvw-wf plain">
            <WorkflowFlow name={wf.name} trigger={wf.trigger} steps={wfSteps[wi] ?? []}
              onEdit={(si, action) => editStep(wi, si, action)}
              onEditMeta={(si, field, value) => editMeta(wi, si, field, value)}
              onToggleRemove={(si) => toggleRemove(wi, si)}
              onAdd={(at) => addStep(wi, at)}
              onReorder={(from, to) => reorderStep(wi, from, to)} />
          </section>
        ))}

        <section className="v3fs-rvw-wf">
          <div className="v3fs-rvw-wf-h"><b>Describe any change in your own words</b></div>
          <textarea className="v3fs-rvw-overall" rows={3} value={narration} onChange={(e) => setNarration(e.target.value)}
            placeholder="e.g. Legal actually reviews the quote twice — once before pricing and again before it goes out." />
          <DictationButton label="Speak your changes" onText={(spoken) => setNarration((cur) => joinDictation(cur, spoken))} />
        </section>

        {review.terms.length ? (
          <>
            <div className="v3fs-rvw-section-h"><span className="v3fs-rvw-step-ic" aria-hidden="true">◉</span>The terms in your world — tap one to flag it</div>
            <section className="v3fs-rvw-wf plain">
              <OntologyMap terms={review.terms} relations={review.relations}
                comments={termNotes} onComment={(i, v) => setTermNotes((p) => ({ ...p, [String(i)]: v }))} />
              <div className="v3fs-addterm">
                {addedTerms.map((t, i) => (
                  <div key={i} className="v3fs-addterm-row">
                    <input className="v3fs-addterm-name" value={t.name} placeholder="A term we missed"
                      onChange={(e) => setAddedTerms((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <div className="v3fs-rvw-field">
                      <input value={t.note} placeholder="What is it? (optional)"
                        onChange={(e) => setAddedTerms((p) => p.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                      <DictationButton compact label="Speak this"
                        onText={(spoken) => setAddedTerms((p) => p.map((x, j) => j === i ? { ...x, note: joinDictation(x.note, spoken) } : x))} />
                    </div>
                    <button type="button" className="v3fs-addterm-x" title="Remove"
                      onClick={() => setAddedTerms((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                <button type="button" className="v3fs-addterm-add" onClick={() => setAddedTerms((p) => [...p, { name: "", note: "" }])}>＋ Add a term we missed</button>
              </div>
            </section>
          </>
        ) : null}

        <section className="v3fs-rvw-wf">
          <div className="v3fs-rvw-wf-h"><b>A few things that shape the work</b><span className="v3fs-rvw-trigger">These don&rsquo;t change the steps — just good to know</span></div>
          <div className="v3fs-rvw-belowqs">
            {review.questions.map((q, i) => (
              <label key={i} className="v3fs-rvw-bq">
                <span>{q}</span>
                <div className="v3fs-rvw-field">
                  <textarea rows={2} value={answers[String(i)] ?? ""} onChange={(e) => setAnswers((p) => ({ ...p, [String(i)]: e.target.value }))} />
                  <DictationButton compact label="Speak this answer" onText={(spoken) => setAnswers((p) => ({ ...p, [String(i)]: joinDictation(p[String(i)] ?? "", spoken) }))} />
                </div>
              </label>
            ))}
          </div>
        </section>
      </div>

      {/* Live preview — what the record will show once you send. */}
      <aside className={`v3fs-rvw-live${proposal.count ? " on" : ""}`} aria-live="polite">
        <div className="v3fs-rvw-live-h">Your changes {proposal.count ? <span>{proposal.count}</span> : null}</div>
        {proposal.count ? (
          <div className="v3fs-rvw-live-body">
            {proposal.workflows.map((w, i) => (
              <div key={i} className="v3fs-rvw-live-wf">
                <b>{w.name}</b>
                <ul>
                  {w.changes.map((s, j) => (
                    <li key={j} className={s.added ? "add" : s.removed ? "del" : "chg"}>
                      {s.added ? `Added: ${s.action}` : s.removed ? `Removed: ${s.original ?? s.action}` : `Changed: ${s.action}`}
                    </li>
                  ))}
                  {w.reordered ? <li className="chg">Steps reordered</li> : null}
                </ul>
              </div>
            ))}
            {narration.trim() ? <p className="v3fs-rvw-live-note">“{narration.trim()}”</p> : null}
            {proposal.newTerms.length ? <p className="v3fs-rvw-live-note add">{proposal.newTerms.length} new term{proposal.newTerms.length === 1 ? "" : "s"}</p> : null}
            {proposal.notedTerms.length ? <p className="v3fs-rvw-live-note">{proposal.notedTerms.length} term note{proposal.notedTerms.length === 1 ? "" : "s"}</p> : null}
            {proposal.answered.length ? <p className="v3fs-rvw-live-note">{proposal.answered.length} note{proposal.answered.length === 1 ? "" : "s"} on constraints</p> : null}
          </div>
        ) : <p className="v3fs-rvw-live-empty">Edit a step, add one, or describe a change — it appears here.</p>}
      </aside>

      <div className="v3fs-rvw-foot">
        {draftKey && proposal.count ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !proposal.count}
          onClick={() => onSubmit(compose())}>{submitting ? "Sending…" : "Send my changes"}</button>
      </div>
    </>
  );
}

export default function FlowReviewSurface({ review, stakeholder, submitting, error, onSubmit, draftKey }: {
  review: ReviewPayload; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void;
  /** Persist the respondent's edits to their device under this key so they can
   * close a long review and return. FlowRespond clears it on submit. */
  draftKey?: string;
}) {
  if (review.kind === "agentify") {
    return <AgentifySurface review={review} stakeholder={stakeholder} submitting={submitting} error={error} onSubmit={onSubmit} draftKey={draftKey} />;
  }
  if (review.kind === "listen-workflow") {
    return <ListenWorkflowSurface review={review} stakeholder={stakeholder} submitting={submitting} error={error} onSubmit={onSubmit} draftKey={draftKey} />;
  }
  return <OntologyAtlasSurface review={review} stakeholder={stakeholder} submitting={submitting} error={error} onSubmit={onSubmit} draftKey={draftKey} />;
}
