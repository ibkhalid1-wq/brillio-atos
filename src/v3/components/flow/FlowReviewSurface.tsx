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
import { useMemo, useState } from "react";
import {
  composeAgentifyAnswers, composeOntologyAtlasAnswers,
  type AgentifyReview, type OntologyAtlasReview, type ReviewPayload,
} from "@/v3/components/flow/flowReviews";

const DISPOSITIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "keep", label: "Stays human", hint: "judgement, relationships, the irreducibly human call" },
  { key: "assist", label: "Agent assists", hint: "an agent drafts or prepares; you decide" },
  { key: "agentify", label: "Agentify", hint: "an agent can run this end to end" },
];

function AgentifySurface({ review, stakeholder, submitting, error, onSubmit }: {
  review: AgentifyReview; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void;
}) {
  const [responses, setResponses] = useState<Record<string, { disposition?: string; comment?: string }>>({});
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
      <div className="v3fs-rvw">
        {review.workflows.map((workflow, wi) => (
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
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !decided}
          onClick={() => onSubmit(composeAgentifyAnswers(review, responses))}>
          {submitting ? "Sending…" : "Send my review"}
        </button>
      </div>
    </>
  );
}

function OntologyAtlasSurface({ review, stakeholder, submitting, error, onSubmit }: {
  review: OntologyAtlasReview; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void;
}) {
  const [termComments, setTermComments] = useState<Record<string, string>>({});
  const [workflowComments, setWorkflowComments] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState("");
  const touched = useMemo(() =>
    Object.values(termComments).some((v) => v.trim())
    || Object.values(workflowComments).some((v) => v.trim())
    || overall.trim().length > 0,
    [termComments, workflowComments, overall]);

  return (
    <>
      <header className="v3fs-hero">
        <h1 className="v3fs-hero-title"><span className="v3fs-hero-brand">ATOS Flow</span></h1>
        <p className="v3fs-how">{stakeholder ? `${stakeholder} — ` : ""}{review.intro}</p>
      </header>
      <div className="v3fs-rvw">
        {review.terms.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The terms we heard</b><span className="v3fs-rvw-trigger">Your world, in your words</span></div>
            <div className="v3fs-rvw-terms">
              {review.terms.map((term, i) => (
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
        {review.workflows.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The workflows we mapped</b><span className="v3fs-rvw-trigger">Does this match how it really runs?</span></div>
            <div className="v3fs-rvw-terms">
              {review.workflows.map((workflow, i) => (
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
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !touched}
          onClick={() => onSubmit(composeOntologyAtlasAnswers(review, termComments, workflowComments, overall))}>
          {submitting ? "Sending…" : "Send my comments"}
        </button>
      </div>
    </>
  );
}

export default function FlowReviewSurface({ review, stakeholder, submitting, error, onSubmit }: {
  review: ReviewPayload; stakeholder: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string) => void;
}) {
  if (review.kind === "agentify") {
    return <AgentifySurface review={review} stakeholder={stakeholder} submitting={submitting} error={error} onSubmit={onSubmit} />;
  }
  return <OntologyAtlasSurface review={review} stakeholder={stakeholder} submitting={submitting} error={error} onSubmit={onSubmit} />;
}
