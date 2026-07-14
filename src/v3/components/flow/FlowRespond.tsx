import { useEffect, useMemo, useState } from "react";
import { ScreenCard } from "@/v3/components/flow/studio/ExperienceDesignStudio";
import FlowReviewSurface from "@/v3/components/flow/FlowReviewSurface";
import type { ReviewPayload } from "@/v3/components/flow/flowReviews";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";

/**
 * The public async-interview page — what a stakeholder sees when they open a
 * response link (?flowRespond=programId.secret). No sign-in: the token IS the
 * access, served by the flow-portal edge function, and everything submitted
 * here lands in a quarantined inbox for the operator to review — never
 * directly in evidence. Styled with the same Paper & Flow tokens as the shell.
 */

type PackState =
  | { phase: "loading" }
  | { phase: "invalid"; reason?: string }
  | { phase: "ready"; pack: Pack }
  | { phase: "sent" };

interface Pack {
  kind?: "interview" | "demo";
  programme: string;
  stakeholder: string;
  role: string;
  intro: string;
  questions: string[];
  /** The programme's cast — lets the respondent defer a question to the
   * person who actually owns the answer. */
  roster?: Array<{ name: string; role: string }>;
  responded: boolean;
  /** Demo invites only. */
  openingQuote?: string;
  scenario?: string;
  steps?: string[];
  acceptanceAsk?: string;
  demoUrl?: string;
  /** The interpretive prototype: Experience Design flows + their screens —
   * lets the stakeholder walk their workflow as wireframes before a
   * deployed build exists. Flows arrive persona-first for this holder. */
  design?: { flows: Array<Record<string, unknown>>; screens: Array<Record<string, unknown>> };
  /** THEIR demo script — narrates the walk: opening quote, scenario,
   * per-beat talk track and callbacks, closing acceptance ask. */
  script?: { openingQuote?: string; scenario?: string; acceptanceAsk?: string; steps?: Array<{ beat?: string; say?: string; callback?: string }> };
  /** A projected REVIEW surface — workflow-agentify or ontology+atlas. When
   * present, the page renders the visual review instead of the plain form; its
   * composed response still submits through the interview `answers` path. */
  review?: ReviewPayload;
}

type DemoVerdict = "accepted" | "accepted-with-changes" | "rework";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

/** A stakeholder's in-progress answers, kept on THEIR device so they can close
 * the link and come back without losing work. Keyed by the link token, cleared
 * once they submit. Answers never leave the browser until they press send. */
interface RespondDraft {
  answers?: Record<number, string>;
  deferrals?: Record<number, string>;
  extra?: string;
  verdict?: DemoVerdict | null;
  comment?: string;
  phaseComments?: Record<string, string>;
}
function readRespondDraft(key: string): RespondDraft {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as RespondDraft : {}; } catch { return {}; }
}

export default function FlowRespond({ token }: { token: string }) {
  const draftKey = `atos.respond.${token}`;
  const draft0 = readRespondDraft(draftKey);
  const [state, setState] = useState<PackState>({ phase: "loading" });
  const [answers, setAnswers] = useState<Record<number, string>>(draft0.answers ?? {});
  // Per-question deferral: "not me — this is for <name>". A deferred question
  // counts as handled here and is routed to that person's card on ingest.
  const [deferrals, setDeferrals] = useState<Record<number, string>>(draft0.deferrals ?? {});
  const [attachments, setAttachments] = useState<Record<number, Array<{ name: string; sourceKey?: string }>>>({});
  const [attachBusy, setAttachBusy] = useState<number | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [extra, setExtra] = useState(draft0.extra ?? "");
  const [verdict, setVerdict] = useState<DemoVerdict | null>(draft0.verdict ?? null);
  const [comment, setComment] = useState(draft0.comment ?? "");
  // Per-phase demo comments, keyed by flow · step — folded into the verdict.
  const [phaseComments, setPhaseComments] = useState<Record<string, string>>(draft0.phaseComments ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist the draft as they type; clear it once the link is submitted or spent.
  const hasDraft = !!(Object.keys(answers).length || extra.trim() || Object.keys(deferrals).length
    || verdict || comment.trim() || Object.keys(phaseComments).length);
  useEffect(() => {
    try {
      if (state.phase === "sent") {
        // Clear the plain-form draft AND every review-surface sub-key (draftKey.*).
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const k = localStorage.key(i);
          if (k && (k === draftKey || k.startsWith(`${draftKey}.`))) localStorage.removeItem(k);
        }
        return;
      }
      if (hasDraft) localStorage.setItem(draftKey, JSON.stringify({ answers, deferrals, extra, verdict, comment, phaseComments }));
    } catch { /* private mode / quota — draft-save is best-effort */ }
  }, [draftKey, state.phase, hasDraft, answers, deferrals, extra, verdict, comment, phaseComments]);

  useEffect(() => {
    let alive = true;
    fetch(`${FUNCTIONS_BASE}/flow-portal?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : "invalid");
        return body as Pack;
      })
      .then((pack: Pack) => { if (alive) setState({ phase: "ready", pack }); })
      .catch((err: unknown) => {
        if (alive) setState({ phase: "invalid", reason: err instanceof Error && err.message !== "invalid" ? err.message : undefined });
      });
    return () => { alive = false; };
  }, [token]);

  const attachFile = async (index: number, file: File) => {
    setAttachBusy(index);
    setAttachNote(null);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, extract: { file: btoa(binary), mime: file.type || "", filename: file.name, question: (state.phase === "ready" ? state.pack.questions?.[index] : "") || "" } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.text !== "string") {
        setAttachNote(typeof body.error === "string" ? body.error : "Could not read that file.");
        return;
      }
      // The extracted content goes straight into the answer field — visible
      // and editable — so the respondent can see and trust what will be sent.
      // The original file rides along as a downloadable reference; its text is
      // NOT re-sent, so the record holds one copy (their answer).
      const heading = `From "${file.name}"${body.refined === true ? " (the relevant part)" : ""}:`;
      setAnswers((current) => {
        const existing = (current[index] ?? "").trimEnd();
        const insert = `${heading}\n${body.text}`;
        return { ...current, [index]: existing ? `${existing}\n\n${insert}` : insert };
      });
      setAttachments((current) => ({ ...current, [index]: [...(current[index] ?? []), {
        name: file.name,
        sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : undefined,
      }] }));
    } catch {
      setAttachNote("Could not read that file.");
    } finally {
      setAttachBusy(null);
    }
  };

  const composed = useMemo(() => {
    if (state.phase !== "ready") return "";
    // Demo packs carry no questions — this memo only serves the interview view.
    const blocks = (state.pack.questions ?? [])
      .map((question, index) => {
        if (deferrals[index]) return ""; // deferred — routed, not answered here
        const answer = (answers[index] ?? "").trim();
        return answer ? `Q: ${question}\nA: ${answer}` : "";
      })
      .filter(Boolean);
    if (extra.trim()) blocks.push(`Anything else:\n${extra.trim()}`);
    return blocks.join("\n\n");
  }, [state, answers, extra, deferrals]);

  const answeredCount = useMemo(() => {
    if (state.phase !== "ready" || state.pack.kind === "demo") return 0;
    return (state.pack.questions ?? []).reduce((count, _q, index) =>
      count + (((answers[index] ?? "").trim() || (attachments[index] ?? []).length || deferrals[index]) ? 1 : 0), 0);
  }, [state, answers, attachments, deferrals]);

  const submit = async (payload: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not send that.");
      setState({ phase: "sent" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="v3-shell v3fs-shell">
      <div className="v3fs-app">
        <div className="v3fs-wrap v3fs-portal">
          {state.phase === "loading" ? (
            <div className="v3fs-quiet"><h2>One moment…</h2></div>
          ) : state.phase === "invalid" ? (
            <div className="v3fs-quiet">
              <h2>This link isn&rsquo;t valid.</h2>
              <p>{state.reason ?? "It may have been replaced — ask the person who sent it for a fresh one."}</p>
            </div>
          ) : state.phase === "sent" ? (
            <div className="v3fs-quiet">
              <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
              <h2>Thank you — your answers are in.</h2>
              <p>The team reviews everything before it enters the record. This link is now closed — if more detail occurs to you later, the team can send a fresh one.</p>
            </div>
          ) : state.pack.responded ? (
            <div className="v3fs-quiet">
              <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
              <h2>This link has done its job.</h2>
              <p>
                Your {state.pack.kind === "demo" ? "verdict" : "answers"} are on the record — each link takes
                one response, so nothing gets sent twice. If more detail comes to mind, ask the programme
                team for a fresh link.
              </p>
            </div>
          ) : state.pack.review ? (
            <FlowReviewSurface review={state.pack.review} stakeholder={state.pack.stakeholder}
              submitting={submitting} error={error} draftKey={draftKey}
              onSubmit={(answers) => void submit({ answers })} />
          ) : state.pack.kind === "demo" ? (
            <>
              <header className="v3fs-hero">
                <h1 className="v3fs-hero-title">
                  <span className="v3fs-hero-brand">ATOS Flow</span> · {state.pack.programme}
                </h1>
                <p className="v3fs-how">
                  {state.pack.stakeholder ? `${state.pack.stakeholder} — ` : ""}this is your demonstration: your own
                  workflow, running. Watch it, then record your verdict below.
                </p>
                {state.pack.openingQuote ? <blockquote className="v3fs-portal-quote">{state.pack.openingQuote}</blockquote> : null}
                {state.pack.scenario ? <p className="v3fs-portal-intro">{state.pack.scenario}</p> : null}
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.demoUrl ? (
                  <a className="v3fs-btn pri v3fs-portal-send" href={state.pack.demoUrl} target="_blank" rel="noreferrer">
                    ▶ Open the prototype
                  </a>
                ) : null}
                {state.pack.design ? <DemoWalker design={state.pack.design} script={state.pack.script}
                  phaseComments={phaseComments}
                  onPhaseComment={(key, value) => setPhaseComments((prev) => ({ ...prev, [key]: value }))} /> : null}
                {state.pack.steps?.length ? (
                  <div className="v3fs-portal-steps">
                    {state.pack.steps.map((step, index) => (
                      <div key={index} className="v3fs-portal-step"><b>{index + 1}</b><span>{step}</span></div>
                    ))}
                  </div>
                ) : null}
                <div className="v3fs-portal-q">
                  <span>{state.pack.acceptanceAsk || "Does this run your workflow the way you need it to?"}</span>
                  <div className="v3fs-portal-verdicts" role="radiogroup" aria-label="Your verdict">
                    {([["accepted", "✓ Accepted — this runs my workflow"],
                       ["accepted-with-changes", "Accepted, with changes I list below"],
                       ["rework", "Not yet — it needs rework"]] as const).map(([value, label]) => (
                      <button key={value} type="button" role="radio" aria-checked={verdict === value}
                        className={`v3fs-portal-verdict${verdict === value ? " on" : ""}`}
                        onClick={() => setVerdict(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="v3fs-portal-q">
                  <span>{verdict === "accepted" ? "Anything worth noting on the whole workflow? (optional)" : "What should change overall?"}</span>
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3}
                    placeholder="Add your comment — type, or speak it." />
                  <DictationButton onText={(spoken) => setComment((current) => joinDictation(current, spoken))} />
                </label>
                {error ? <div className="v3fs-portal-err">{error}</div> : null}
                <button type="button" className="v3fs-btn pri v3fs-portal-send"
                  disabled={submitting || !verdict}
                  onClick={() => {
                    // Fold the per-phase notes into the verdict comment so the
                    // operator reads phase-by-phase feedback beside the overall.
                    const phaseLines = Object.entries(phaseComments)
                      .filter(([, value]) => value.trim())
                      .map(([key, value]) => `• ${key}: ${value.trim()}`);
                    const full = [comment.trim(), phaseLines.length ? `Phase-by-phase:\n${phaseLines.join("\n")}` : ""]
                      .filter(Boolean).join("\n\n");
                    void submit({ verdict, comment: full });
                  }}>
                  {submitting ? "Sending…" : "Record my verdict"}
                </button>
                <p className="v3fs-portal-foot">Your verdict goes to the programme team for review before it enters the record.{hasDraft ? " Your progress is saved on this device — you can close this and come back." : ""}</p>
              </div>
            </>
          ) : (
            <>
              <header className="v3fs-portal-head">
                <div className="v3fs-hero-eyebrow">{state.pack.programme} <span>· ATOS Flow</span></div>
                <h1 className="v3fs-portal-title">Hello{state.pack.stakeholder ? ` ${state.pack.stakeholder.split(" ")[0]}` : ""} — your perspective shapes what gets built.</h1>
                <p className="v3fs-portal-sub">
                  These questions replace a scheduled discovery call. Answer in your own words, whenever suits you — skip anything that doesn&rsquo;t apply.
                </p>
                <div className="v3fs-portal-meta">
                  <span>✎ {state.pack.questions.length} questions — answer any</span>
                  <span>⏱ ~{Math.max(5, Math.round(state.pack.questions.length * 1.5))} minutes</span>
                  <span>⛨ Reviewed by the team before anything enters the record</span>
                </div>
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.design ? (
                  // A Show follow-up asks for demo feedback — the wireframe
                  // walkthrough, narrated by their demo script, sits right
                  // above the questions it informs.
                  <DemoWalker design={state.pack.design} script={state.pack.script} />
                ) : null}
                {state.pack.questions.map((question, index) => (
                  <label key={index} className={`v3fs-portal-card${((answers[index] ?? "").trim() || (attachments[index] ?? []).length || deferrals[index]) ? " done" : ""}${deferrals[index] ? " deferred" : ""}`}>
                    <span className="v3fs-portal-qn"><b>{index + 1}</b><em aria-hidden="true">{deferrals[index] ? "→" : "✓"}</em></span>
                    <span className="v3fs-portal-qt">{question}</span>
                    {deferrals[index] ? (
                      <div className="v3fs-portal-defer-note">
                        Routed to <b>{deferrals[index]}</b> — they&rsquo;ll be asked directly.
                        <button type="button" className="v3fs-a" onClick={() =>
                          setDeferrals((current) => { const next = { ...current }; delete next[index]; return next; })
                        }>I&rsquo;ll answer it myself</button>
                      </div>
                    ) : (
                    <textarea
                      value={answers[index] ?? ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                      rows={3}
                      maxLength={20000}
                      placeholder="In your own words — type, or speak it."
                    />
                    )}
                    {!deferrals[index] && (state.pack.roster?.length ?? 0) > 0 ? (
                      <div className="v3fs-portal-defer">
                        <span>Not yours to answer?</span>
                        <select value="" aria-label={`Defer question ${index + 1} to someone else`}
                          onChange={(event) => {
                            const to = event.target.value;
                            if (to) setDeferrals((current) => ({ ...current, [index]: to }));
                          }}>
                          <option value="">this is for someone else…</option>
                          {(state.pack.roster ?? []).map((person) => (
                            <option key={person.name} value={person.name}>{person.name}{person.role ? ` — ${person.role}` : ""}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <DictationButton onText={(spoken) => setAnswers((current) => ({ ...current, [index]: joinDictation(current[index] ?? "", spoken) }))} />
                    <div className="v3fs-portal-att">
                      {(attachments[index] ?? []).map((doc, docIndex) => (
                        <span key={docIndex} className="v3fs-portal-att-chip">
                          {doc.name}
                          <button type="button" aria-label={`Remove ${doc.name}`} onClick={() =>
                            setAttachments((current) => ({ ...current, [index]: (current[index] ?? []).filter((_, i) => i !== docIndex) }))
                          }>×</button>
                        </span>
                      ))}
                      <label className="v3fs-portal-att-add">
                        {attachBusy === index ? "Reading…" : "⌲ Attach a document"}
                        <input type="file" hidden disabled={attachBusy !== null}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void attachFile(index, file);
                          }} />
                      </label>
                      {(attachments[index] ?? []).length ? (
                        <span className="v3fs-portal-att-hint">added to your answer above — edit it freely</span>
                      ) : null}
                    </div>
                  </label>
                ))}
                {attachNote ? <div className="v3fs-portal-err">{attachNote}</div> : null}
                <label className={`v3fs-portal-card extra${extra.trim() ? " done" : ""}`}>
                  <span className="v3fs-portal-qn"><b>＋</b><em aria-hidden="true">✓</em></span>
                  <span className="v3fs-portal-qt">Anything we didn&rsquo;t ask about that we should know?</span>
                  <textarea value={extra} onChange={(event) => setExtra(event.target.value)} rows={3} maxLength={20000} placeholder="Optional — type, or speak it." />
                  <DictationButton onText={(spoken) => setExtra((current) => joinDictation(current, spoken))} />
                </label>
                {error ? <div className="v3fs-portal-err">{error}</div> : null}
              </div>
              <div className="v3fs-portal-bar">
                <div className="v3fs-portal-progress">
                  <span>{answeredCount} of {state.pack.questions.length} answered</span>
                  <div className="v3fs-portal-track" aria-hidden="true">
                    <div style={{ width: `${state.pack.questions.length ? Math.round((answeredCount / state.pack.questions.length) * 100) : 0}%` }} />
                  </div>
                  {hasDraft ? <span className="v3fs-portal-saved">✓ Saved on this device — you can close this and come back</span> : null}
                </div>
                <button type="button" className="v3fs-btn pri v3fs-portal-send"
                  disabled={submitting || (composed.trim().length < 20 && Object.values(attachments).every((docs) => !docs.length) && !Object.keys(deferrals).length)}
                  onClick={() => void submit({
                    answers: composed,
                    documents: Object.entries(attachments).flatMap(([qIndex, docs]) =>
                      docs.filter((doc) => doc.sourceKey).map((doc) => ({ name: doc.name, question: Number(qIndex) + 1, sourceKey: doc.sourceKey }))),
                    deferrals: Object.entries(deferrals).map(([qIndex, to]) => ({
                      question: state.pack.questions[Number(qIndex)] ?? "", to,
                    })).filter((entry) => entry.question && entry.to),
                  })}>
                  {submitting ? "Sending…" : "Send my answers"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The interpretive prototype — the demo link's built-in walkthrough. When the
 * programme has an Experience Design and (or before) a deployed build, the
 * stakeholder walks their workflow as wireframes: pick a flow, step through
 * it, watch each step's screen light up. Same renderer the design studio
 * uses, so what they walk IS the signed-off design.
 */
function DemoWalker({ design, script, phaseComments, onPhaseComment }: {
  design: NonNullable<Pack["design"]>; script?: Pack["script"];
  phaseComments?: Record<string, string>; onPhaseComment?: (key: string, value: string) => void;
}) {
  const [flowIndex, setFlowIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const flows = design.flows ?? [];
  const screens = design.screens ?? [];
  const flow = flows[flowIndex];
  // Their demo script narrates the FIRST flow (persona-first ordering puts
  // theirs there): beat-by-beat talk track + the callback to their own words.
  const narration = flowIndex === 0 ? script?.steps?.[stepIndex] : undefined;
  const steps = Array.isArray(flow?.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
  const step = steps[stepIndex];
  const screenId = String(step?.screen ?? "").toLowerCase();
  const screen = screens.find((s) =>
    String(s.id ?? "").toLowerCase() === screenId || String(s.name ?? "").toLowerCase() === screenId);
  if (!flows.length || !screens.length) return null;
  return (
    <div className="v3fs-demo-walk">
      {script?.openingQuote && flowIndex === 0 ? (
        <blockquote className="v3fs-wf-pain">“{script.openingQuote}”</blockquote>
      ) : null}
      {script?.scenario && flowIndex === 0 ? (
        <p className="v3fs-demo-scenario">{script.scenario}</p>
      ) : null}
      <div className="v3fs-demo-walk-h">
        <b>Walk it as wireframes</b>
        {flows.length > 1 ? (
          <select value={flowIndex} aria-label="Choose a flow"
            onChange={(event) => { setFlowIndex(Number(event.target.value)); setStepIndex(0); }}>
            {flows.map((f, i) => <option key={i} value={i}>{String(f.name ?? `Flow ${i + 1}`)}</option>)}
          </select>
        ) : <span>{String(flow?.name ?? "")}</span>}
      </div>
      <div className="v3fs-wf-walk">
        {steps.map((s, i) => (
          <button key={i} type="button" className={`v3fs-wf-step${i === stepIndex ? " on" : ""}`}
            onClick={() => setStepIndex(i)}>
            <b>{i + 1}</b>
            <span>{String(s.action ?? "")}</span>
            {String(s.hitl ?? "") ? <em title={String(s.hitl)}>⛨ approval</em> : null}
          </button>
        ))}
      </div>
      {screen ? <ScreenCard screen={screen} active onClick={() => { /* focused already */ }} /> : null}
      {step && String(step.outcome ?? "") ? <div className="v3fs-wf-outcome">→ {String(step.outcome)}</div> : null}
      {onPhaseComment ? (() => {
        const key = `${String(flow?.name ?? "Flow")} · step ${stepIndex + 1}${step?.action ? ` (${String(step.action)})` : ""}`;
        return (
          <label className="v3fs-demo-phasec">
            <span>Comment on this phase (optional)</span>
            <textarea rows={2} value={phaseComments?.[key] ?? ""}
              onChange={(event) => onPhaseComment(key, event.target.value)}
              placeholder="Does this phase run the way you need it to?" />
          </label>
        );
      })() : null}
      {narration && (narration.say || narration.callback) ? (
        <div className="v3fs-demo-say">
          {narration.say ? <p>{narration.say}</p> : null}
          {narration.callback ? <em>↩ {narration.callback}</em> : null}
        </div>
      ) : null}
      {flowIndex === 0 && stepIndex >= steps.length - 1 && script?.acceptanceAsk ? (
        <div className="v3fs-demo-ask">{script.acceptanceAsk}</div>
      ) : null}
      <div className="v3fs-wf-walknav">
        <button type="button" className="v3fs-btn" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>← Back</button>
        <span>{stepIndex + 1} of {steps.length}</span>
        <button type="button" className="v3fs-btn pri" disabled={stepIndex >= steps.length - 1} onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}>Next →</button>
      </div>
    </div>
  );
}
