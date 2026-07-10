import React, { useEffect, useMemo, useState } from "react";

/**
 * The public async-interview page — what a stakeholder sees when they open a
 * response link (?flowRespond=programId.secret). No sign-in: the token IS the
 * access, served by the flow-portal edge function, and everything submitted
 * here lands in a quarantined inbox for the operator to review — never
 * directly in evidence. Styled with the same Paper & Flow tokens as the shell.
 */

type PackState =
  | { phase: "loading" }
  | { phase: "invalid" }
  | { phase: "ready"; pack: Pack }
  | { phase: "sent" };

interface Pack {
  kind?: "interview" | "demo";
  programme: string;
  stakeholder: string;
  role: string;
  intro: string;
  questions: string[];
  responded: boolean;
  /** Demo invites only. */
  openingQuote?: string;
  scenario?: string;
  steps?: string[];
  acceptanceAsk?: string;
  demoUrl?: string;
}

type DemoVerdict = "accepted" | "accepted-with-changes" | "rework";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

export default function FlowRespond({ token }: { token: string }) {
  const [state, setState] = useState<PackState>({ phase: "loading" });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [extra, setExtra] = useState("");
  const [verdict, setVerdict] = useState<DemoVerdict | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${FUNCTIONS_BASE}/flow-portal?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("invalid"))))
      .then((pack: Pack) => { if (alive) setState({ phase: "ready", pack }); })
      .catch(() => { if (alive) setState({ phase: "invalid" }); });
    return () => { alive = false; };
  }, [token]);

  const composed = useMemo(() => {
    if (state.phase !== "ready") return "";
    const blocks = state.pack.questions
      .map((question, index) => {
        const answer = (answers[index] ?? "").trim();
        return answer ? `Q: ${question}\nA: ${answer}` : "";
      })
      .filter(Boolean);
    if (extra.trim()) blocks.push(`Anything else:\n${extra.trim()}`);
    return blocks.join("\n\n");
  }, [state, answers, extra]);

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
              <p>It may have been replaced — ask the person who sent it for a fresh one.</p>
            </div>
          ) : state.phase === "sent" ? (
            <div className="v3fs-quiet">
              <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
              <h2>Thank you — your answers are in.</h2>
              <p>The team reviews everything before it enters the record. If more detail occurs to you later, this link stays open.</p>
            </div>
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
                {state.pack.responded ? (
                  <p className="v3fs-portal-again">You&rsquo;ve recorded a verdict before — a new one is added alongside, not overwritten.</p>
                ) : null}
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.demoUrl ? (
                  <a className="v3fs-btn pri v3fs-portal-send" href={state.pack.demoUrl} target="_blank" rel="noreferrer">
                    ▶ Open the prototype
                  </a>
                ) : null}
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
                  <span>{verdict === "accepted" ? "Anything worth noting? (optional)" : "What should change?"}</span>
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3}
                    placeholder="Your words go straight to the build team." />
                </label>
                {error ? <div className="v3fs-portal-err">{error}</div> : null}
                <button type="button" className="v3fs-btn pri v3fs-portal-send"
                  disabled={submitting || !verdict}
                  onClick={() => void submit({ verdict, comment })}>
                  {submitting ? "Sending…" : "Record my verdict"}
                </button>
                <p className="v3fs-portal-foot">Your verdict goes to the programme team for review before it enters the record.</p>
              </div>
            </>
          ) : (
            <>
              <header className="v3fs-hero">
                <h1 className="v3fs-hero-title">
                  <span className="v3fs-hero-brand">ATOS Flow</span> · {state.pack.programme}
                </h1>
                <p className="v3fs-how">
                  Hello{state.pack.stakeholder ? ` ${state.pack.stakeholder}` : ""} — these questions replace a scheduled
                  discovery call. Answer whenever suits you; skip anything that doesn&rsquo;t apply.
                </p>
                {state.pack.intro ? <p className="v3fs-portal-intro">{state.pack.intro}</p> : null}
                {state.pack.responded ? (
                  <p className="v3fs-portal-again">You&rsquo;ve answered before — anything you send now is added alongside, not overwritten.</p>
                ) : null}
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.questions.map((question, index) => (
                  <label key={index} className="v3fs-portal-q">
                    <span>{index + 1}. {question}</span>
                    <textarea
                      value={answers[index] ?? ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                      rows={3}
                      placeholder="In your own words — specifics help most."
                    />
                  </label>
                ))}
                <label className="v3fs-portal-q">
                  <span>Anything we didn&rsquo;t ask about that we should know?</span>
                  <textarea value={extra} onChange={(event) => setExtra(event.target.value)} rows={3} placeholder="Optional." />
                </label>
                {error ? <div className="v3fs-portal-err">{error}</div> : null}
                <button type="button" className="v3fs-btn pri v3fs-portal-send" disabled={submitting || composed.trim().length < 20} onClick={() => void submit({ answers: composed })}>
                  {submitting ? "Sending…" : "Send my answers"}
                </button>
                <p className="v3fs-portal-foot">Your answers go to the programme team for review before anything enters the record.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
