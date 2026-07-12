import { useEffect, useMemo, useRef, useState } from "react";

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

// Voice answers: browser dictation (Web Speech API) types into the same
// field — the respondent reviews and edits before sending, and the submit
// path stays text-through-quarantine either way. Hidden when unsupported.
const SpeechRecognitionCtor: (new () => SpeechRecognitionLike) | undefined = typeof window !== "undefined"
  ? ((window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined
  : undefined;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/** Append a dictated sentence to what's already typed, with sane spacing. */
function joinDictation(existing: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return existing;
  const lead = text.charAt(0).toUpperCase() + text.slice(1);
  return existing.trim() ? `${existing.replace(/\s+$/, "")} ${lead}` : lead;
}

function DictationButton({ onText }: { onText: (spoken: string) => void }) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognizerRef.current?.stop(), []);
  if (!SpeechRecognitionCtor) return null;
  const toggle = () => {
    if (listening) {
      recognizerRef.current?.stop();
      return;
    }
    const recognizer = new SpeechRecognitionCtor();
    recognizer.continuous = true;
    recognizer.interimResults = false;
    recognizer.lang = navigator.language || "en-US";
    recognizer.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) onText(result[0].transcript);
      }
    };
    recognizer.onend = () => setListening(false);
    recognizer.onerror = () => setListening(false);
    recognizerRef.current = recognizer;
    recognizer.start();
    setListening(true);
  };
  return (
    <button
      type="button"
      className={`v3fs-mic${listening ? " on" : ""}`}
      aria-pressed={listening}
      onClick={toggle}
      title={listening ? "Stop — what you said stays in the field" : "Speak instead of typing — you can edit before sending"}
    >
      {listening ? "◉ Listening… tap to stop" : "🎙 Speak your answer"}
    </button>
  );
}

export default function FlowRespond({ token }: { token: string }) {
  const [state, setState] = useState<PackState>({ phase: "loading" });
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [attachments, setAttachments] = useState<Record<number, Array<{ name: string; text: string; sourceKey?: string }>>>({});
  const [attachBusy, setAttachBusy] = useState<number | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
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
      setAttachments((current) => ({ ...current, [index]: [...(current[index] ?? []), {
        name: body.refined === true ? `${file.name} (relevant extract)` : file.name,
        text: body.text,
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
        const answer = (answers[index] ?? "").trim();
        return answer ? `Q: ${question}\nA: ${answer}` : "";
      })
      .filter(Boolean);
    if (extra.trim()) blocks.push(`Anything else:\n${extra.trim()}`);
    return blocks.join("\n\n");
  }, [state, answers, extra]);

  const answeredCount = useMemo(() => {
    if (state.phase !== "ready" || state.pack.kind === "demo") return 0;
    return (state.pack.questions ?? []).reduce((count, _q, index) =>
      count + (((answers[index] ?? "").trim() || (attachments[index] ?? []).length) ? 1 : 0), 0);
  }, [state, answers, attachments]);

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
                    placeholder="Add your comment — type, or speak it." />
                  <DictationButton onText={(spoken) => setComment((current) => joinDictation(current, spoken))} />
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
              <header className="v3fs-portal-head">
                <div className="v3fs-hero-eyebrow">{state.pack.programme} <span>· ATOS Flow</span></div>
                <h1 className="v3fs-portal-title">Hello{state.pack.stakeholder ? ` ${state.pack.stakeholder.split(" ")[0]}` : ""} — your perspective shapes what gets built.</h1>
                <p className="v3fs-portal-sub">
                  These questions replace a scheduled discovery call. Answer in your own words, whenever suits you — skip anything that doesn&rsquo;t apply.
                </p>
                {state.pack.intro ? <p className="v3fs-portal-intro">{state.pack.intro}</p> : null}
                <div className="v3fs-portal-meta">
                  <span>✎ {state.pack.questions.length} questions — answer any</span>
                  <span>⏱ ~{Math.max(5, Math.round(state.pack.questions.length * 1.5))} minutes</span>
                  <span>⛨ Reviewed by the team before anything enters the record</span>
                </div>
                {state.pack.responded ? (
                  <p className="v3fs-portal-again">You&rsquo;ve answered before — anything you send now is added alongside, not overwritten.</p>
                ) : null}
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.questions.map((question, index) => (
                  <label key={index} className={`v3fs-portal-card${((answers[index] ?? "").trim() || (attachments[index] ?? []).length) ? " done" : ""}`}>
                    <span className="v3fs-portal-qn"><b>{index + 1}</b><em aria-hidden="true">✓</em></span>
                    <span className="v3fs-portal-qt">{question}</span>
                    <textarea
                      value={answers[index] ?? ""}
                      onChange={(event) => setAnswers((current) => ({ ...current, [index]: event.target.value }))}
                      rows={3}
                      placeholder="In your own words — type, or speak it."
                    />
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
                    </div>
                  </label>
                ))}
                {attachNote ? <div className="v3fs-portal-err">{attachNote}</div> : null}
                <label className={`v3fs-portal-card extra${extra.trim() ? " done" : ""}`}>
                  <span className="v3fs-portal-qn"><b>＋</b><em aria-hidden="true">✓</em></span>
                  <span className="v3fs-portal-qt">Anything we didn&rsquo;t ask about that we should know?</span>
                  <textarea value={extra} onChange={(event) => setExtra(event.target.value)} rows={3} placeholder="Optional — type, or speak it." />
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
                </div>
                <button type="button" className="v3fs-btn pri v3fs-portal-send"
                  disabled={submitting || (composed.trim().length < 20 && Object.values(attachments).every((docs) => !docs.length))}
                  onClick={() => void submit({
                    answers: composed,
                    documents: Object.entries(attachments).flatMap(([qIndex, docs]) =>
                      docs.map((doc) => ({ name: doc.name, text: doc.text, question: Number(qIndex) + 1, sourceKey: doc.sourceKey }))),
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
