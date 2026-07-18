import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenCard } from "@/v3/components/flow/studio/ExperienceDesignStudio";
import FlowReviewSurface from "@/v3/components/flow/FlowReviewSurface";
import { projectStakeholderReview, reviewDiff, type ReviewPayload } from "@/v3/components/flow/flowReviews";
import {
  parseFixtures, fixturesForEntities, screenEntities, stepMetric, transitionForStep, isAgentActor, foldBeatRecords,
  type DemoBeatRecord, type DemoFixture,
} from "@/v3/components/flow/flowDemoRun";
import { stakeholderPrimaryArea, hasMultipleAreas } from "@/v3/components/flow/flowAreas";
import type { ProgramSummary } from "@/new/types";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";
import PilotApp from "@/v3/components/flow/PilotApp";

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
  /** A plain-language programme objective (from the charter) — framing so the
   * stakeholder knows WHAT the programme is for before they answer. */
  objective?: string;
  questions: string[];
  /** The programme's cast — lets the respondent defer a question to the
   * person who actually owns the answer. */
  roster?: Array<{ name: string; role: string }>;
  /** True only when the person has answered AND nothing new is outstanding — the
   * page shows a read-only recap rather than a dead end or a fresh form. */
  responded: boolean;
  /** The durable link's recap: every response this person has already sent. */
  submissions?: Array<{ ts: string; movementId?: string; kind: string; preview: string }>;
  /** They've responded at least once on this link. */
  answered?: boolean;
  /** A new ask has been posted SINCE their last answer — they're returning to a
   * genuine follow-up, so the surface renders with a "welcome back" framing. */
  followUp?: boolean;
  /** The link belongs to a ROLE PLACEHOLDER (no person bound yet) — every
   * greeting skips the name; "Solution Architect" is never a first name. */
  unnamed?: boolean;
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
  /** The recipient's business area — the demo walker opens on their own area's
   * flow and names it, the Show parallel to the Listen reviews' area scoping. */
  recipientArea?: string;
  /** The FUNCTIONAL demo slice: the experience design's state machines (what
   * the scenario runner executes), the prototype pack's seeded fixtures (the
   * rows the screens display), and THEIR seed scenario. */
  machines?: Array<Record<string, unknown>>;
  fixtures?: unknown[];
  seedScenario?: { scenario?: string; sourceQuote?: string; data?: string };
  /** Operator opt-in: agent beats run as LIVE agent calls, not simulations. */
  liveDemo?: boolean;
  /** The BUILT prototype — the generated clickable app. When present it IS the
   * pilot the stakeholder validates (closest to production); it renders in place
   * of the interpreted walk. */
  pilotHtml?: string;
  /** A projected REVIEW surface — workflow-agentify or ontology+atlas. When
   * present, the page renders the visual review instead of the plain form; its
   * composed response still submits through the interview `answers` path.
   * FALLBACK only — a fresh review re-projected from `liveArtifacts` wins. */
  review?: ReviewPayload;
  /** The review as it stood when this person LAST answered — the baseline for
   * the "what changed since your last visit" band on a follow-up. */
  priorReview?: ReviewPayload;
  /** DYNAMIC LINKS: re-projection inputs. The edge ships the CURRENT artifact
   * slices; the page rebuilds the review from them so a regeneration never
   * orphans the link. reviewKind + movementId pick the projection. */
  reviewKind?: string;
  movementId?: string;
  liveArtifacts?: Record<string, unknown>;
  /** The recipient's real role — with their name, lets the page compute their
   * primary AREA from the live artifacts to scope the review to their world. */
  recipientRole?: string;
}

/** Rebuild the review from the CURRENT artifacts the edge shipped, so a link
 * opened after a regeneration shows the latest workflows/ontology/blueprint.
 * Falls back (null) to the frozen `pack.review` for old/edge-less packs. */
function reprojectFromPack(pack: Pack): ReviewPayload | null {
  if (!pack.liveArtifacts || !pack.movementId) return null;
  // Only the kinds projectStakeholderReview produces can be rebuilt live.
  if (pack.reviewKind !== "listen-workflow") return null;
  const program = { rawData: { data: pack.liveArtifacts } } as unknown as ProgramSummary;
  // Scope to the recipient's AREA: prefer the value stored on the pack, else
  // compute it from the live artifacts (atlas workflows + ontology entities) the
  // same way the collect board does, so the link's workflows/ontology/questions
  // narrow to their world even when no area was stamped at mint.
  const area = (pack.recipientArea && pack.recipientArea.trim())
    || stakeholderPrimaryArea(program, pack.stakeholder, pack.recipientRole);
  let fresh: ReviewPayload | null = null;
  try { fresh = projectStakeholderReview(program, pack.movementId, pack.stakeholder, area, []); }
  catch { return null; }
  if (!fresh) return null;
  // Keep the person's own question list (their gap script, minted once) — only
  // the structural content is refreshed.
  if (fresh.kind === "listen-workflow" && Array.isArray(pack.questions) && pack.questions.length) {
    fresh.questions = pack.questions;
  }
  return fresh;
}

/** A short structural signature of a review — names + step counts of what the
 * respondent edits. Changes when a regeneration reshapes the content, so an
 * on-device draft keyed by it is abandoned rather than misaligned. */
function reviewSignature(review: ReviewPayload): string {
  const parts: string[] = [review.kind];
  const r = review as {
    workflows?: Array<{ name?: string; steps?: unknown[] }>;
    terms?: Array<{ name?: string }>;
    architecture?: { candidates?: Array<{ name?: string }> };
    blueprint?: { agents?: Array<{ name?: string }> };
  };
  for (const w of r.workflows ?? []) parts.push(`${w.name ?? ""}:${Array.isArray(w.steps) ? w.steps.length : 0}`);
  for (const t of r.terms ?? []) parts.push(t.name ?? "");
  for (const c of r.architecture?.candidates ?? []) parts.push(c.name ?? "");
  for (const a of r.blueprint?.agents ?? []) parts.push(a.name ?? "");
  const text = parts.join("|");
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

type DemoVerdict = "accepted" | "accepted-with-changes" | "rework";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

/** A stakeholder's in-progress answers, kept on THEIR device so they can close
 * the link and come back without losing work. Keyed by the link token, cleared
 * once they submit. Answers never leave the browser until they press send. */
interface SuggestedVoice { name: string; role: string; note: string }
interface RespondDraft {
  answers?: Record<number, string>;
  deferrals?: Record<number, string>;
  extra?: string;
  suggestedVoices?: SuggestedVoice[];
  verdict?: DemoVerdict | null;
  comment?: string;
  phaseComments?: Record<string, string>;
  beatVerdicts?: Record<string, string>;
  demoRunRecords?: DemoBeatRecord[];
  demoFieldFlags?: Record<string, string>;
}
function readRespondDraft(key: string): RespondDraft {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as RespondDraft : {}; } catch { return {}; }
}

export default function FlowRespond({ token }: { token: string }) {
  const draftKey = `atos.respond.${token}`;
  const draft0 = readRespondDraft(draftKey);
  const [state, setState] = useState<PackState>({ phase: "loading" });
  // The name greetings use — BLANK for a role-placeholder link, so every
  // surface (opener, banners, recap, demo) skips the greeting cleanly.
  const greetName = state.phase === "ready" && !state.pack.unnamed ? state.pack.stakeholder : "";
  // The review shown — rebuilt LIVE from the current artifacts the edge shipped,
  // falling back to the pack's frozen snapshot. Memoised so the surface's draft
  // key is stable within a load.
  const shownReview = useMemo<ReviewPayload | null>(
    // Old Envision packs may carry a frozen "agentify" review — that surface is
    // retired (Envision no longer mints client reviews), so such links degrade to
    // question-only rather than rendering the wrong surface.
    () => {
      if (state.phase !== "ready") return null;
      const chosen = reprojectFromPack(state.pack)
        ?? ((state.pack.review as { kind?: string } | undefined)?.kind === "agentify" ? null : state.pack.review)
        ?? null;
      if (!chosen) return null;
      // Blanket-review guard: a listen-workflow review is meant to be scoped to
      // THIS recipient's business area — projectStakeholderReview stamps
      // `recipientArea` only when it actually narrows to one. When the person
      // can't be filed under a single area (a person-named stakeholder vs
      // role-named actors, a General fallback, or a compound area label that
      // doesn't match a workflow tag), no narrowing happens, recipientArea stays
      // blank, and the surface falls open to the WHOLE model — so on a multi-area
      // programme every unplaceable stakeholder sees the identical everything
      // review. Detect that and fall back to their stored, per-person questions,
      // which were scoped at mint and remain distinct.
      // The review's true scope is the set of areas its workflows AND terms span.
      // projectStakeholderReview stamps recipientArea even when it can't actually
      // filter (e.g. the person's area label — "Alliances" — matches no workflow
      // tag like "Sales / Alliances"), so recipientArea alone lies. When the
      // content still spans more than one area on a multi-area programme, this
      // recipient wasn't scoped — every unplaceable stakeholder gets the same
      // everything-review — so fall back to their stored, per-person questions.
      const rv = chosen as { workflows?: Array<{ area?: string }>; terms?: Array<{ area?: string }> };
      if (state.pack.liveArtifacts) {
        const areaSpan = new Set(
          [...(rv.workflows ?? []), ...(rv.terms ?? [])].map((x) => String(x.area ?? "").trim()).filter(Boolean),
        );
        if (areaSpan.size > 1) {
          const program = { rawData: { data: state.pack.liveArtifacts } } as unknown as ProgramSummary;
          if (hasMultipleAreas(program)) return null;
        }
      }
      return chosen;
    },
    [state],
  );
  // A regeneration can reshape the review while a draft is saved on-device; fold
  // a structural signature into the review draft key so a changed structure
  // starts fresh (a stale draft's step indices would misalign) — best-effort.
  const reviewDraftKey = shownReview ? `${draftKey}.${reviewSignature(shownReview)}` : draftKey;
  const [answers, setAnswers] = useState<Record<number, string>>(draft0.answers ?? {});
  // Per-question deferral: "not me — this is for <name>". A deferred question
  // counts as handled here and is routed to that person's card on ingest.
  const [deferrals, setDeferrals] = useState<Record<number, string>>(draft0.deferrals ?? {});
  const [attachments, setAttachments] = useState<Record<number, Array<{ name: string; sourceKey?: string }>>>({});
  const [attachBusy, setAttachBusy] = useState<number | null>(null);
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [extra, setExtra] = useState(draft0.extra ?? "");
  // "Who else should we speak with?" — the respondent can name people the tour
  // is missing. Named voices route to the operator to add, closing the gap where
  // a stakeholder knew who owned an answer but had no way to say so.
  const [suggestedVoices, setSuggestedVoices] = useState<SuggestedVoice[]>(
    draft0.suggestedVoices?.length ? draft0.suggestedVoices : [{ name: "", role: "", note: "" }]);
  const setVoice = (index: number, patch: Partial<SuggestedVoice>) =>
    setSuggestedVoices((current) => current.map((voice, i) => (i === index ? { ...voice, ...patch } : voice)));
  const filledVoices = suggestedVoices.filter((voice) => voice.name.trim());
  const [verdict, setVerdict] = useState<DemoVerdict | null>(draft0.verdict ?? null);
  const [comment, setComment] = useState(draft0.comment ?? "");
  const [demoWhoElse, setDemoWhoElse] = useState("");
  // Per-phase demo comments, keyed by flow · step — folded into the verdict.
  const [phaseComments, setPhaseComments] = useState<Record<string, string>>(draft0.phaseComments ?? {});
  // Per-beat acceptance taps (✓ runs my workflow / ✗ not quite) — granular
  // signal folded into the verdict, so acceptance isn't one button at the end.
  const [beatVerdicts, setBeatVerdicts] = useState<Record<string, string>>(draft0.beatVerdicts ?? {});
  // The scenario run's REPLAYABLE beat records — (transition, executor,
  // outcome) per step watched — plus field-level flags raised on the seeded
  // screens. Both fold into the answer; the records travel structured too.
  const [demoRunRecords, setDemoRunRecords] = useState<DemoBeatRecord[]>(draft0.demoRunRecords ?? []);
  const [demoFieldFlags, setDemoFieldFlags] = useState<Record<string, string>>(draft0.demoFieldFlags ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist the draft as they type; clear it once the link is submitted or spent.
  const hasDraft = !!(Object.keys(answers).length || extra.trim() || Object.keys(deferrals).length
    || filledVoices.length || verdict || comment.trim() || Object.keys(phaseComments).length
    || Object.keys(beatVerdicts).length || demoRunRecords.length || Object.keys(demoFieldFlags).length);
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
      if (hasDraft) localStorage.setItem(draftKey, JSON.stringify({ answers, deferrals, extra, suggestedVoices, verdict, comment, phaseComments, beatVerdicts, demoRunRecords, demoFieldFlags }));
    } catch { /* private mode / quota — draft-save is best-effort */ }
  }, [draftKey, state.phase, hasDraft, answers, deferrals, extra, suggestedVoices, verdict, comment, phaseComments, beatVerdicts, demoRunRecords, demoFieldFlags]);

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

  // Engagement telemetry — lightweight, anonymous-to-content pings so the
  // operator sees where a demo loses people: opened, and the furthest beat
  // reached. Never carries answer content; best-effort.
  const progressRef = useRef(-1);
  useEffect(() => {
    if (state.phase !== "ready" || state.pack.responded) return;
    const maxStep = demoRunRecords.reduce((max, r) => Math.max(max, r.step + 1), 0);
    if (maxStep <= progressRef.current) return;
    progressRef.current = Math.max(0, maxStep);
    const firstFlowSteps = state.pack.design?.flows?.[0]?.steps;
    const totalSteps = Array.isArray(firstFlowSteps) ? firstFlowSteps.length : 0;
    void fetch(`${FUNCTIONS_BASE}/flow-portal`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, progress: { maxStep, totalSteps } }),
    }).catch(() => { /* telemetry never blocks the page */ });
  }, [state, demoRunRecords, token]);

  // Toggle a field-level flag on a seeded screen ("this field is wrong").
  const toggleFieldFlag = (key: string) => setDemoFieldFlags((prev) => {
    const next = { ...prev };
    if (key in next) delete next[key]; else next[key] = "";
    return next;
  });

  // LIVE agent execution for a demo beat — only offered when the operator
  // opted in (pack.liveDemo). The edge runs ONE blueprint agent against the
  // seed data and returns the outcome; any failure falls back to simulation.
  const runLiveBeat = async (input: { flow: string; step: number; action: string; actor: string }): Promise<{ outcome: string } | null> => {
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, demoRun: input }),
      });
      const body = await response.json().catch(() => ({}));
      return response.ok && typeof body.outcome === "string" ? { outcome: body.outcome.slice(0, 240) } : null;
    } catch { return null; }
  };

  // The scenario run distilled for the record: readable beat lines with the
  // stakeholder's verdicts attached, the structured trail between sentinels,
  // and any field-level flags raised on the seeded screens.
  const demoRunBlock = useMemo(() => {
    const blocks: string[] = [];
    if (demoRunRecords.length) {
      const withVerdicts = demoRunRecords.map((r) => {
        const key = `${r.flow} · step ${r.step + 1}${r.action ? ` (${r.action})` : ""}`;
        const v = beatVerdicts[key];
        return v === "ok" || v === "not" ? { ...r, verdict: v as "ok" | "not" } : r;
      });
      blocks.push(foldBeatRecords(withVerdicts));
    }
    const flags = Object.entries(demoFieldFlags);
    if (flags.length) blocks.push(`Screen data flagged:\n${flags.map(([k, note]) => `• ${k}${note ? ` — ${note}` : ""}`).join("\n")}`);
    return blocks.join("\n\n");
  }, [demoRunRecords, beatVerdicts, demoFieldFlags]);

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
    // Demo-walkthrough signal from a Show follow-up: beat-by-beat acceptance
    // taps and per-phase notes fold into the same attributed answer block.
    const beatLines = Object.entries(beatVerdicts)
      .filter(([, value]) => value === "ok" || value === "not")
      .map(([key, value]) => `${value === "ok" ? "✓ Runs my workflow" : "✗ Not quite"} — ${key}`);
    if (beatLines.length) blocks.push(`Demo walkthrough, beat by beat:\n${beatLines.join("\n")}`);
    const phaseLines = Object.entries(phaseComments)
      .filter(([, value]) => value.trim())
      .map(([key, value]) => `• ${key}: ${value.trim()}`);
    if (phaseLines.length) blocks.push(`Demo walkthrough, phase notes:\n${phaseLines.join("\n")}`);
    if (demoRunBlock) blocks.push(demoRunBlock);
    return blocks.join("\n\n");
  }, [state, answers, extra, deferrals, beatVerdicts, phaseComments, demoRunBlock]);

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

  // "Request a meeting instead" — the stakeholder can skip the form and ask for
  // a live session. It posts through the same flow-portal channel as a response
  // note (so the operator sees the ask in the record) but keeps the link open,
  // so they can still answer below if they change their mind.
  const [meetingSent, setMeetingSent] = useState(false);
  const requestMeeting = async (preferred: string, kind: "listen" | "prototype") => {
    setSubmitting(true);
    setError(null);
    try {
      const note = kind === "prototype"
        ? `⧉ Requested a live walkthrough of the prototype instead of self-serving — preferred time: ${preferred}. Please demo it live and capture my feedback.`
        : `⧉ Requested a meeting instead of the form — preferred time: ${preferred}. Please schedule a short call and turn the conversation into my input.`;
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, answers: note, meetingRequested: true, meetingPreferred: preferred }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not send that request.");
      setMeetingSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="v3-shell v3fs-shell">
      <div className="v3fs-app">
        <div className="v3fs-wrap v3fs-portal">
          {state.phase === "ready" && state.pack.kind !== "demo" && !state.pack.responded && !shownReview && state.pack.objective ? (
            <aside className="v3fs-portal-objective">
              <span className="lbl">About this programme</span>
              <p>{state.pack.objective}</p>
            </aside>
          ) : null}
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
            <RespondRecap stakeholder={greetName} submissions={state.pack.submissions ?? []}
              kind={state.pack.kind} />
          ) : shownReview ? (
            <>
              {state.pack.followUp ? <FollowUpBanner stakeholder={greetName}
                submissions={state.pack.submissions ?? []}
                changes={state.pack.priorReview ? reviewDiff(state.pack.priorReview, shownReview) : undefined} /> : null}
              <FlowReviewSurface review={shownReview} stakeholder={greetName}
                programme={state.pack.programme} objective={state.pack.objective}
                returning={!!state.pack.followUp}
                submitting={submitting} error={error} draftKey={reviewDraftKey}
                afterIntro={<MeetingRequestBar kind="listen" sent={meetingSent} submitting={submitting}
                  onRequest={(pref) => void requestMeeting(pref, "listen")} />}
                onSubmit={(answers, extras) => void submit({ answers: [answers, demoRunBlock].filter(Boolean).join("\n\n"), ...(extras ?? {}) })} />
              {/* ENVISION carries the STORYBOARD: once an experience design
                  exists, the transformation review is followed by a walk of
                  what we intend to build — validated here, while it's still
                  cheap to change. Show then demonstrates it running. */}
              {state.pack.design && state.pack.movementId === "envision" ? (
                <section className="v3fs-rvw-wf plain v3fs-envision-story">
                  <div className="v3fs-rvw-wf-h">
                    <b>The storyboard — what we intend to build</b>
                    <span className="v3fs-rvw-trigger">Walk it; flag anything that&rsquo;s off before we build it</span>
                  </div>
                  <DemoWalker design={state.pack.design} script={state.pack.script}
                    recipientArea={state.pack.recipientArea}
                    beatVerdicts={beatVerdicts}
                    onBeatVerdict={(key, value) => setBeatVerdicts((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))}
                    machines={state.pack.machines} fixtures={state.pack.fixtures} seedScenario={state.pack.seedScenario}
                    onBeatRecord={(record) => setDemoRunRecords((prev) => [...prev, record])}
                    fieldFlags={demoFieldFlags} onToggleFieldFlag={toggleFieldFlag} />
                </section>
              ) : null}
            </>
          ) : state.pack.kind === "demo" ? (
            <>
              <header className="v3fs-hero">
                <h1 className="v3fs-hero-title">
                  <span className="v3fs-hero-brand">ATOS Flow</span> · {state.pack.programme}
                </h1>
                <p className="v3fs-how">
                  {greetName ? `${greetName} — ` : ""}this is the prototype we&rsquo;re building
                  for you. Use it as you would the real thing, then tell us below whether it works.
                </p>
                {state.pack.openingQuote ? <blockquote className="v3fs-portal-quote">{state.pack.openingQuote}</blockquote> : null}
                {state.pack.scenario ? <p className="v3fs-portal-intro">{state.pack.scenario}</p> : null}
              </header>
              <MeetingRequestBar kind="prototype" sent={meetingSent} submitting={submitting}
                onRequest={(pref) => void requestMeeting(pref, "prototype")} />
              <div className="v3fs-portal-qs">
                {state.pack.pilotHtml ? (
                  // The built prototype IS the experience — use it, then give a
                  // verdict. No walk, no explorer: as close to production as we can
                  // get you before we ship it.
                  <PilotFrame pilotHtml={state.pack.pilotHtml} />
                ) : (
                  <>
                    {state.pack.demoUrl ? (
                      <a className="v3fs-btn pri v3fs-portal-send" href={state.pack.demoUrl} target="_blank" rel="noreferrer">
                        ▶ Open the prototype
                      </a>
                    ) : null}
                    {state.pack.design ? <DemoWalker design={state.pack.design} script={state.pack.script}
                      recipientArea={state.pack.recipientArea}
                      phaseComments={phaseComments}
                      onPhaseComment={(key, value) => setPhaseComments((prev) => ({ ...prev, [key]: value }))}
                      beatVerdicts={beatVerdicts}
                      onBeatVerdict={(key, value) => setBeatVerdicts((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))}
                      machines={state.pack.machines} fixtures={state.pack.fixtures} seedScenario={state.pack.seedScenario}
                      onBeatRecord={(record) => setDemoRunRecords((prev) => [...prev, record])}
                      fieldFlags={demoFieldFlags} onToggleFieldFlag={toggleFieldFlag}
                      runLive={state.pack.liveDemo ? runLiveBeat : undefined} /> : null}
                    {state.pack.steps?.length ? (
                      <div className="v3fs-portal-steps">
                        {state.pack.steps.map((step, index) => (
                          <div key={index} className="v3fs-portal-step"><b>{index + 1}</b><span>{step}</span></div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
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
                {verdict && verdict !== "accepted" ? (
                  <label className="v3fs-portal-q">
                    <span>What should change overall?</span>
                    <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3}
                      placeholder="Add your comment — type, or speak it." />
                    <DictationButton onText={(spoken) => setComment((current) => joinDictation(current, spoken))} />
                  </label>
                ) : null}
                <label className="v3fs-portal-q v3fs-portal-whoelse">
                  <span>Anyone else who should try it? (optional)</span>
                  <input value={demoWhoElse} onChange={(event) => setDemoWhoElse(event.target.value)} placeholder="Name or role" />
                </label>
                {error ? <div className="v3fs-portal-err">{error}</div> : null}
                <button type="button" className="v3fs-btn pri v3fs-portal-send"
                  disabled={submitting || !verdict}
                  onClick={() => {
                    // Fold the per-phase notes AND per-beat acceptance taps into
                    // the verdict comment so the operator reads granular signal
                    // beside the overall — a ✓ beat is a positive fact.
                    const phaseLines = Object.entries(phaseComments)
                      .filter(([, value]) => value.trim())
                      .map(([key, value]) => `• ${key}: ${value.trim()}`);
                    const beatLines = Object.entries(beatVerdicts)
                      .filter(([, value]) => value === "ok" || value === "not")
                      .map(([key, value]) => `${value === "ok" ? "✓ Runs my workflow" : "✗ Not quite"} — ${key}`);
                    const full = [comment.trim(),
                      beatLines.length ? `Beat-by-beat:\n${beatLines.join("\n")}` : "",
                      phaseLines.length ? `Phase-by-phase:\n${phaseLines.join("\n")}` : "",
                      demoRunBlock]
                      .filter(Boolean).join("\n\n");
                    void submit({ verdict, comment: full, ...(demoWhoElse.trim() ? { suggestedVoices: [{ name: demoWhoElse.trim(), role: "", note: "" }] } : {}) });
                  }}>
                  {submitting ? "Sending…" : "Record my verdict"}
                </button>
                <p className="v3fs-portal-foot">Your verdict goes to the programme team for review before it enters the record.{hasDraft ? " Your progress is saved on this device — you can close this and come back." : ""}</p>
              </div>
            </>
          ) : (
            <>
              {state.pack.followUp ? <FollowUpBanner stakeholder={greetName}
                submissions={state.pack.submissions ?? []} newCount={state.pack.questions.length} /> : null}
              <header className="v3fs-portal-head">
                <div className="v3fs-hero-eyebrow">{state.pack.programme} <span>· ATOS Flow</span></div>
                {/* On a follow-up the banner above already greets and frames the
                    visit — the header stays lean so a returning voice isn't
                    re-onboarded ("replaces a discovery call" is a first-time line). */}
                {state.pack.followUp ? (
                  <p className="v3fs-portal-sub">
                    Same as before — answer in your own words, whenever suits you. Skip anything that doesn&rsquo;t apply.
                  </p>
                ) : (
                  <>
                    <h1 className="v3fs-portal-title">{greetName
                      ? `Hello ${greetName.split(" ")[0]} — your perspective shapes what gets built.`
                      : "Your perspective shapes what gets built."}</h1>
                    <p className="v3fs-portal-sub">
                      These questions replace a scheduled discovery call. Answer in your own words, whenever suits you — skip anything that doesn&rsquo;t apply.
                    </p>
                  </>
                )}
                <div className="v3fs-portal-meta">
                  <span>✎ {state.pack.questions.length} {state.pack.followUp ? (state.pack.questions.length === 1 ? "new question" : "new questions") : "questions"} — answer any</span>
                  <span>⏱ ~{Math.max(5, Math.round(state.pack.questions.length * 1.5))} minutes</span>
                  <span>⛨ Reviewed by the team before anything enters the record</span>
                </div>
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.pilotHtml ? (
                  // A Show follow-up: the built prototype itself, above the
                  // questions it informs — use it, then answer.
                  <PilotFrame pilotHtml={state.pack.pilotHtml} />
                ) : state.pack.design ? (
                  <DemoWalker design={state.pack.design} script={state.pack.script}
                    recipientArea={state.pack.recipientArea}
                    phaseComments={phaseComments}
                    onPhaseComment={(key, value) => setPhaseComments((prev) => ({ ...prev, [key]: value }))}
                    beatVerdicts={beatVerdicts}
                    onBeatVerdict={(key, value) => setBeatVerdicts((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))}
                    machines={state.pack.machines} fixtures={state.pack.fixtures} seedScenario={state.pack.seedScenario}
                    onBeatRecord={(record) => setDemoRunRecords((prev) => [...prev, record])}
                    fieldFlags={demoFieldFlags} onToggleFieldFlag={toggleFieldFlag}
                    runLive={state.pack.liveDemo ? runLiveBeat : undefined} />
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
                          {(state.pack.roster ?? []).map((person, i) => (
                            <option key={`${person.name}-${i}`} value={person.name}>{person.name}{person.role ? ` — ${person.role}` : ""}</option>
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
                <div className={`v3fs-portal-card whoelse${filledVoices.length ? " done" : ""}`}>
                  <span className="v3fs-portal-qn"><b aria-hidden="true">☎</b><em aria-hidden="true">✓</em></span>
                  <span className="v3fs-portal-qt">Who else should we speak with?</span>
                  <p className="v3fs-portal-cardhint">If someone else owns a part of this — name them and we&rsquo;ll reach out. Nothing happens automatically; the team decides who to invite.</p>
                  <div className="v3fs-portal-voices">
                    {suggestedVoices.map((voice, index) => (
                      <div key={index} className="v3fs-portal-voice">
                        <input value={voice.name} aria-label={`Person ${index + 1} name`} placeholder="Name"
                          onChange={(event) => setVoice(index, { name: event.target.value })} />
                        <input value={voice.role} aria-label={`Person ${index + 1} role or team`} placeholder="Role or team"
                          onChange={(event) => setVoice(index, { role: event.target.value })} />
                        <input value={voice.note} aria-label={`Person ${index + 1} why`} placeholder="Why them? (optional)"
                          onChange={(event) => setVoice(index, { note: event.target.value })} />
                        {suggestedVoices.length > 1 ? (
                          <button type="button" className="v3fs-portal-voice-rm" aria-label={`Remove person ${index + 1}`}
                            onClick={() => setSuggestedVoices((current) => current.filter((_, i) => i !== index))}>×</button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <button type="button" className="v3fs-a v3fs-portal-voice-add"
                    onClick={() => setSuggestedVoices((current) => [...current, { name: "", role: "", note: "" }])}>
                    ＋ add another person
                  </button>
                </div>
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
                  disabled={submitting || (composed.trim().length < 20 && Object.values(attachments).every((docs) => !docs.length) && !Object.keys(deferrals).length && !filledVoices.length)}
                  onClick={() => void submit({
                    answers: composed,
                    documents: Object.entries(attachments).flatMap(([qIndex, docs]) =>
                      docs.filter((doc) => doc.sourceKey).map((doc) => ({ name: doc.name, question: Number(qIndex) + 1, sourceKey: doc.sourceKey }))),
                    deferrals: Object.entries(deferrals).map(([qIndex, to]) => ({
                      question: state.pack.questions[Number(qIndex)] ?? "", to,
                    })).filter((entry) => entry.question && entry.to),
                    suggestedVoices: filledVoices.map((voice) => ({
                      name: voice.name.trim(), role: voice.role.trim(), note: voice.note.trim(),
                    })),
                  })}>
                  {submitting ? "Sending…" : "Send my answers"}
                </button>
              </div>
            </>
          )}
          {state.phase === "ready" && !state.pack.responded ? (
            <AskTheRecord token={token} />
          ) : null}
          {state.phase !== "loading" ? (
            <footer className="v3fs-portal-brandfoot">
              <span className="mark"><i aria-hidden="true">◆</i> Brillio ATOS</span>
              <small>⛨ Your response is private to the programme team.</small>
            </footer>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface AskCitation { id: string; who: string; when: string; quote: string; }
interface AskTurn {
  q: string;
  a: string;
  topic?: "design" | "other";
  citations?: AskCitation[];
  feedbackPrompt?: string;
  /** Design turns invite feedback — tracked per turn. */
  feedback?: string;
  feedbackSent?: boolean;
}

/**
 * Ask the record — a stakeholder asks a question on their link and the app
 * TRIAGES it. A DESIGN question is answered here and now, grounded in the
 * Experience Design and the discovery evidence (who said what, when, shown as
 * chips), and invites their feedback so the question becomes a validation
 * signal. Anything else is passed to the delivery team's inbox. Objections get
 * answered the moment they form instead of festering until demo day.
 */
function AskTheRecord({ token }: { token: string }) {
  const [q, setQ] = useState("");
  const [thread, setThread] = useState<AskTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [openCite, setOpenCite] = useState<string | null>(null);

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ask: question }),
      });
      const body = await response.json().catch(() => ({}));
      let turn: AskTurn;
      if (response.ok && body.topic === "design" && typeof body.answer === "string") {
        turn = {
          q: question, a: body.answer, topic: "design",
          citations: Array.isArray(body.citations) ? body.citations.filter((c: unknown): c is AskCitation => !!c && typeof c === "object") : [],
          feedbackPrompt: typeof body.feedbackPrompt === "string" ? body.feedbackPrompt : undefined,
        };
      } else if (response.ok && body.topic === "other") {
        turn = { q: question, a: typeof body.message === "string" ? body.message : "Thanks — I've passed this to the delivery team, who'll follow up here.", topic: "other" };
      } else {
        turn = { q: question, a: typeof body.error === "string" ? body.error : "Couldn't answer that right now — add it as a comment and the team will follow up." };
      }
      setThread((t) => [...t, turn].slice(-6));
      setQ("");
    } catch {
      setThread((t) => [...t, { q: question, a: "Couldn't answer that right now — add it as a comment and the team will follow up." }].slice(-6));
    } finally { setBusy(false); }
  };

  const sendFeedback = async (idx: number) => {
    const turn = thread[idx];
    const feedback = (turn.feedback ?? "").trim();
    if (!feedback) return;
    try {
      await fetch(`${FUNCTIONS_BASE}/flow-portal`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, designFeedback: { question: turn.q, answer: turn.a, feedback } }),
      });
    } catch { /* best effort — the recap still shows it as sent */ }
    setThread((t) => t.map((e, i) => i === idx ? { ...e, feedbackSent: true } : e));
  };

  return (
    <aside className="v3fs-ask-record">
      <div className="v3fs-ask-h"><span aria-hidden="true">✦</span> Questions? Ask — design answers come with the evidence behind them.</div>
      {thread.map((entry, i) => (
        <div key={i} className="v3fs-ask-turn">
          <p className="v3fs-ask-q">{entry.q}</p>
          <p className="v3fs-ask-a">{entry.a}</p>

          {entry.topic === "design" && entry.citations && entry.citations.length > 0 ? (
            <div className="v3fs-ask-cites">
              <span className="v3fs-ask-cites-l">Grounded in</span>
              <div className="v3fs-ask-chips">
                {entry.citations.map((c) => {
                  const key = `${i}:${c.id}`; const open = openCite === key;
                  return (
                    <button key={c.id} type="button" className={`v3fs-ask-chip${open ? " on" : ""}`}
                      title={c.who} onClick={() => setOpenCite(open ? null : key)}>
                      <b>{c.id}</b> {(c.who || "Source").split(",")[0]}{c.when ? ` · ${c.when.slice(0, 10)}` : ""}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const active = entry.citations.find((c) => `${i}:${c.id}` === openCite);
                return active ? (
                  <blockquote className="v3fs-ask-quote">
                    <b>{active.who}{active.when ? ` · ${active.when}` : ""}</b>
                    <span>&ldquo;{active.quote}&rdquo;</span>
                  </blockquote>
                ) : null;
              })()}
            </div>
          ) : null}

          {entry.topic === "design" ? (
            entry.feedbackSent ? (
              <p className="v3fs-ask-fbdone">✓ Thanks — your feedback is on its way to the delivery team.</p>
            ) : (
              <div className="v3fs-ask-fb">
                {entry.feedbackPrompt ? <label>{entry.feedbackPrompt}</label> : null}
                <div className="v3fs-ask-row">
                  <input value={entry.feedback ?? ""} placeholder="Your feedback on this…" maxLength={2000}
                    onChange={(e) => { const v = e.target.value; setThread((t) => t.map((x, j) => j === i ? { ...x, feedback: v } : x)); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void sendFeedback(i); }} />
                  <button type="button" className="v3fs-btn" disabled={!(entry.feedback ?? "").trim()} onClick={() => void sendFeedback(i)}>Send feedback</button>
                </div>
              </div>
            )
          ) : null}
        </div>
      ))}
      <div className="v3fs-ask-row">
        <input value={q} placeholder="e.g. Why does the denial step stay human?" maxLength={400}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void ask(); }} />
        <DictationButton compact label="Speak your question" onText={(spoken) => setQ((cur) => joinDictation(cur, spoken))} />
        <button type="button" className="v3fs-btn pri" disabled={busy || !q.trim()} onClick={() => void ask()}>
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>
    </aside>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function labelForKind(kind: string): string {
  return kind === "review" ? "Review submitted" : kind === "follow-up" ? "Follow-up answered" : "Answers sent";
}

type Submission = { ts: string; movementId?: string; kind: string; preview: string };

/** What a stakeholder sees when they reopen a link they've fully answered — a
 * warm recap of what they sent, not a dead end. The same durable link stays
 * live, so if the team needs more, a fresh question simply appears here later. */
function RespondRecap({ stakeholder, submissions, kind }: {
  stakeholder: string; submissions: Submission[]; kind?: string;
}) {
  const first = stakeholder ? stakeholder.split(/\s+/)[0] : "";
  return (
    <div className="v3fs-quiet v3fs-recap">
      <div className="v3fs-quiet-mark" aria-hidden="true">✓</div>
      <h2>{first
        ? `Thank you, ${first} — your ${kind === "demo" ? "verdict is" : "responses are"} in.`
        : "Thank you — your responses are in."}</h2>
      <p>
        The programme team reviews everything before it enters the record. There&rsquo;s nothing more to
        do right now — and this link stays yours: if we need anything else, a new question will appear
        right here.
      </p>
      {submissions.length ? (
        <ul className="v3fs-recap-list">
          {submissions.slice().reverse().map((s, i) => (
            <li key={i}>
              {fmtWhen(s.ts) ? <span className="when">{fmtWhen(s.ts)}</span> : null}
              <span className="what">{s.preview || labelForKind(s.kind)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "Request a meeting instead" — an offer atop the form/prototype so a
 * stakeholder who'd rather talk can ask for a live session in two taps. The ask
 * is recorded through the same channel as a response, so the operator sees it;
 * the link stays open, so they can still self-serve if they change their mind. */
function MeetingRequestBar({ kind, sent, submitting, onRequest }: {
  kind: "listen" | "prototype";
  sent: boolean;
  submitting: boolean;
  onRequest: (preferred: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<string>("");
  const SLOTS = ["Tue AM", "Wed PM", "Thu AM", "Just reach out"];
  const proto = kind === "prototype";

  if (sent) {
    return (
      <div className="v3fs-mrq done" role="status">
        <span className="v3fs-mrq-tick" aria-hidden="true">✓</span>
        <p>
          <b>{proto ? "Walkthrough requested." : "Meeting requested."}</b>{" "}
          {proto
            ? "We’ll set up a live demo and capture your feedback — no need to give a verdict here unless you want to."
            : "We’ll be in touch to schedule, and turn the conversation into your input — so you don’t have to write anything. You can still answer below if you like."}
        </p>
      </div>
    );
  }

  return (
    <div className="v3fs-mrq">
      <div className="v3fs-mrq-row">
        <span className="v3fs-mrq-ic" aria-hidden="true">📅</span>
        <div className="v3fs-mrq-t">
          <b>{proto ? "Want to walk through it together?" : "Prefer to talk it through?"}</b>
          <span>{proto ? "Request a short session and we’ll demo it live and capture your feedback." : "Skip the form — request a short call and we’ll capture it for you."}</span>
        </div>
        <button type="button" className="v3fs-mrq-req" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Request a meeting
        </button>
      </div>
      {open ? (
        <div className="v3fs-mrq-panel">
          <div className="v3fs-mrq-hint">When suits you? Pick any — or we’ll reach out to find a time.</div>
          <div className="v3fs-mrq-slots" role="radiogroup" aria-label="Preferred time">
            {SLOTS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={slot === s}
                className={`v3fs-mrq-slot${slot === s ? " on" : ""}`} onClick={() => setSlot(s)}>{s}</button>
            ))}
          </div>
          <button type="button" className="v3fs-mrq-send" disabled={submitting}
            onClick={() => onRequest(slot || "Just reach out")}>
            {submitting ? "Sending…" : proto ? "Request the session" : "Request the meeting"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A calm banner atop a link a stakeholder is RETURNING to — acknowledges what
 * they already sent and frames the page as a short follow-up, not a repeat. */
function FollowUpBanner({ stakeholder, submissions, changes, newCount }: {
  stakeholder: string; submissions: Submission[];
  /** Structural "what changed since your last visit" phrases — from reviewDiff. */
  changes?: string[];
  /** How many NEW questions have appeared since they last answered (discovery). */
  newCount?: number;
}) {
  const first = stakeholder ? stakeholder.split(/\s+/)[0] : "";
  const last = submissions.length ? submissions[submissions.length - 1] : null;
  const when = last ? fmtWhen(last.ts) : "";
  // Name what's actually new so the return feels purposeful, not a vague "we've
  // changed things". Discovery knows the count; reviews list the changes below.
  const whatsNew = newCount && newCount > 0
    ? `${newCount} new ${newCount === 1 ? "question has" : "questions have"} come up since — ${newCount === 1 ? "it’s" : "they’re"} below.`
    : changes?.length
      ? "Here’s exactly what moved since — the rest is unchanged."
      : "There’s a short update below.";
  return (
    <aside className="v3fs-followup">
      <div className="v3fs-followup-h">
        <span className="v3fs-followup-mark" aria-hidden="true">↻</span>
        <b>{first ? `Welcome back, ${first}.` : "Welcome back."}</b>
      </div>
      <p>
        Your earlier {submissions.length > 1 ? "answers are" : "answer is"} safely on the record
        {when ? ` — last sent ${when}` : ""}. {whatsNew} Nothing to repeat; just add what&rsquo;s new.
      </p>
      {changes?.length ? (
        <div className="v3fs-followup-diff">
          <span className="lbl">What changed since your last visit</span>
          <div className="v3fs-followup-chips">
            {changes.map((change, i) => <span key={i} className="v3fs-followup-chip">{change}</span>)}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * The interpretive prototype — the demo link's built-in walkthrough. When the
 * programme has an Experience Design and (or before) a deployed build, the
 * stakeholder walks their workflow as wireframes: pick a flow, step through
 * it, watch each step's screen light up. Same renderer the design studio
 * uses, so what they walk IS the signed-off design.
 */
/** The simplest possible validation surface: the BUILT prototype itself. It
 * used to render INSIDE the page in a sandboxed iframe — cramped, double-
 * scrollbarred, and fragile in the webviews mail clients open links in. The
 * linked page now hands the stakeholder a real link instead: the
 * self-contained HTML gets its own blob URL and opens FULL-SCREEN in a new
 * tab, the way they'd experience the shipped product; the verdict is recorded
 * back on this page. Renders when the generated prototype (pilotHtml) is
 * present. */
function PilotFrame({ pilotHtml }: { pilotHtml: string }) {
  // The blob URL is minted AT CLICK TIME, inside the user gesture — a URL
  // created at render and held in an href goes dead the moment anything
  // revokes it (React StrictMode's simulated unmount did exactly that in dev,
  // yielding "your file could not be accessed"). Click-time creation is the
  // same proven pattern as the studio's "Open in browser"; each click gets a
  // fresh URL, revoked a minute later once the tab has loaded it.
  const openPilot = () => {
    const url = URL.createObjectURL(new Blob([pilotHtml], { type: "text/html" }));
    // Anchor-click, not window.open: with the noopener feature, window.open
    // returns null EVEN ON SUCCESS (per spec), so any "blocked" fallback keyed
    // on the return value double-fires — a new tab AND a same-tab navigation.
    // A synthetic anchor click inside the user gesture opens exactly one tab.
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  return (
    <div className="v3fs-portal-pilotlink">
      <span className="v3fs-portal-pilotlink-i" aria-hidden="true">🖥</span>
      <div className="v3fs-portal-pilotlink-t">
        <b>The prototype is ready for you to try</b>
        <p>It opens full-screen in a new tab — click through it exactly as you would the real product, then come back to this page and record your verdict below.</p>
      </div>
      <button type="button" className="v3fs-btn pri v3fs-portal-send" onClick={openPilot}>
        ↗ Open the prototype
      </button>
    </div>
  );
}

function DemoWalker({ design, script, recipientArea, phaseComments, onPhaseComment, beatVerdicts, onBeatVerdict, machines, fixtures, seedScenario, onBeatRecord, fieldFlags, onToggleFieldFlag, runLive }: {
  design: NonNullable<Pack["design"]>; script?: Pack["script"]; recipientArea?: string;
  phaseComments?: Record<string, string>; onPhaseComment?: (key: string, value: string) => void;
  /** Per-beat acceptance taps — granular signal, so the final verdict is built
   * from what they confirmed beat by beat, not one button at the end. */
  beatVerdicts?: Record<string, string>; onBeatVerdict?: (key: string, value: "ok" | "not") => void;
  /** The functional slice: state machines to execute, seeded fixtures to show. */
  machines?: Array<Record<string, unknown>>; fixtures?: unknown[]; seedScenario?: Pack["seedScenario"];
  /** Replayable beat records flow up as the scenario runs. */
  onBeatRecord?: (record: DemoBeatRecord) => void;
  /** Field-level flags on the seeded screens ("this field is wrong"). */
  fieldFlags?: Record<string, string>; onToggleFieldFlag?: (key: string) => void;
  /** When the operator opted in, agent beats execute as LIVE agent calls. */
  runLive?: (input: { flow: string; step: number; action: string; actor: string }) => Promise<{ outcome: string } | null>;
}) {
  const flows = useMemo(() => design.flows ?? [], [design]);
  const screens = design.screens ?? [];
  const seeded = useMemo<DemoFixture[]>(() => parseFixtures(fixtures), [fixtures]);
  // Scenario RUN state: the machine plays the flow — agent beats animate (or
  // execute live), HITL beats pause until the stakeholder approves. Every beat
  // lands as a replayable record via onBeatRecord.
  const [runState, setRunState] = useState<"idle" | "working" | "approval" | "done">("idle");
  const [runActor, setRunActor] = useState("");
  const [metrics, setMetrics] = useState<string[]>([]);
  const [explore, setExplore] = useState(false);
  // PILOT mode: the design runs as a working app — seeded queues, real forms,
  // agents working records forward, HITL chips on the records that wait for you.
  const [pilotMode, setPilotMode] = useState(false);
  const runRef = useRef(0);
  // The recipient's OWN flow — the one tagged with their area (alliances,
  // delivery, …). The served flows already arrive persona-first, so this is
  // normally index 0; area matching keeps the default on their world even when
  // persona affinity was ambiguous. Falls back to the first flow when nothing
  // carries their area — a graceful no-op for a single-area programme.
  const ownFlowIndex = useMemo(() => {
    if (!recipientArea) return 0;
    const i = flows.findIndex((f) => String(f.area ?? "") === recipientArea);
    return i >= 0 ? i : 0;
  }, [flows, recipientArea]);
  const [flowIndex, setFlowIndex] = useState(ownFlowIndex);
  const [stepIndex, setStepIndex] = useState(0);
  const flow = flows[flowIndex];
  // Their demo script narrates their OWN flow: beat-by-beat talk track + the
  // callback to their own words. The opening quote / scenario / acceptance ask
  // also frame that flow, not whichever one they browse to next.
  const onOwnFlow = flowIndex === ownFlowIndex;
  const narration = onOwnFlow ? script?.steps?.[stepIndex] : undefined;
  const scopedToArea = !!recipientArea && flows.some((f) => String(f.area ?? "") === recipientArea);
  const steps = Array.isArray(flow?.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
  const step = steps[stepIndex];
  const screenId = String(step?.screen ?? "").toLowerCase();
  const screen = screens.find((s) =>
    String(s.id ?? "").toLowerCase() === screenId || String(s.name ?? "").toLowerCase() === screenId);

  // ── The scenario engine ────────────────────────────────────────────────────
  // Plays the flow beat by beat: agent transitions animate with honest labels
  // (or execute LIVE when the operator opted in); HITL transitions pause until
  // the stakeholder clicks Approve — they perform the judgement moment the
  // design reserves for them. Every beat lands as a replayable record.
  const reducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const runBeat = async (i: number, token: number) => {
    if (token !== runRef.current) return;
    const list = Array.isArray(flow?.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
    if (i >= list.length) { setRunState("done"); return; }
    setStepIndex(i);
    const s = list[i] ?? {};
    const action = String(s.action ?? "");
    const hitl = String(s.hitl ?? "");
    const t = transitionForStep(machines ?? [], action);
    const actor = t?.actor && isAgentActor(t.actor) ? t.actor : (t?.actor || "The agent");
    if (hitl) {
      setRunActor(hitl);
      setRunState("approval");
      return; // the Approve button records the human beat and continues
    }
    setRunActor(actor);
    setRunState("working");
    let executor: DemoBeatRecord["executor"] = "simulated";
    let outcome = String(s.outcome ?? t?.to ?? "done");
    if (runLive) {
      const live = await runLive({ flow: String(flow?.name ?? ""), step: i, action, actor });
      if (token !== runRef.current) return;
      if (live?.outcome) { outcome = live.outcome; executor = "live-agent"; }
    } else if (!reducedMotion) {
      await new Promise((r) => setTimeout(r, 1200));
      if (token !== runRef.current) return;
    }
    const narr = onOwnFlow ? script?.steps?.[i] : undefined;
    const metric = stepMetric(`${narr?.say ?? ""} ${narr?.callback ?? ""} ${outcome}`);
    if (metric) setMetrics((m) => (m.includes(metric) ? m : [...m, metric]));
    onBeatRecord?.({ ts: new Date().toISOString(), flow: String(flow?.name ?? "Flow"), step: i, action, executor, actor, outcome, hitl: false });
    void runBeat(i + 1, token);
  };
  const startRun = () => { runRef.current += 1; setExplore(false); setMetrics([]); void runBeat(0, runRef.current); };
  const stopRun = () => { runRef.current += 1; setRunState("idle"); };
  const approveBeat = () => {
    const list = Array.isArray(flow?.steps) ? (flow.steps as Array<Record<string, unknown>>) : [];
    const s = list[stepIndex] ?? {};
    onBeatRecord?.({
      ts: new Date().toISOString(), flow: String(flow?.name ?? "Flow"), step: stepIndex,
      action: String(s.action ?? ""), executor: "human", actor: "you",
      outcome: String(s.outcome ?? "approved"), hitl: true,
    });
    void runBeat(stepIndex + 1, runRef.current);
  };

  if (!flows.length || !screens.length) return null;
  return (
    <div className="v3fs-demo-walk">
      {scopedToArea ? (
        <p className="v3fs-rvw-scoped">This demo covers your area — <b>{recipientArea}</b>.</p>
      ) : null}
      {script?.openingQuote && onOwnFlow ? (
        <blockquote className="v3fs-wf-pain">“{script.openingQuote}”</blockquote>
      ) : null}
      {script?.scenario && onOwnFlow ? (
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
      {seedScenario?.scenario ? (
        <div className="v3fs-demo-scn">
          <span className="lbl">Your scenario</span>
          <p>{seedScenario.scenario}</p>
          {seedScenario.sourceQuote ? <em>↩ “{seedScenario.sourceQuote}”</em> : null}
        </div>
      ) : null}
      <div className="v3fs-demo-runctl">
        <button type="button" className="v3fs-btn pri" disabled={runState === "working" || runState === "approval"}
          onClick={startRun}>{runState === "working" || runState === "approval" ? "Running…" : "▶ Run this scenario"}</button>
        {runState === "working" || runState === "approval" ? (
          <button type="button" className="v3fs-btn quiet" onClick={stopRun}>Stop</button>
        ) : null}
        <button type="button" className={`v3fs-btn${explore ? " pri" : ""}`} onClick={() => { stopRun(); setPilotMode(false); setExplore((e) => !e); }}>
          {explore ? "← Back to the walk" : "⌗ Explore the screens"}
        </button>
        {(machines?.length ?? 0) > 0 && seeded.length > 0 ? (
          <button type="button" className={`v3fs-btn${pilotMode ? " pri" : ""}`} onClick={() => { stopRun(); setExplore(false); setPilotMode((v) => !v); }}
            title="Use the future system on seeded data — file records, watch the agents work, approve what's yours">
            {pilotMode ? "← Back to the walk" : "🖥 Open the pilot"}
          </button>
        ) : null}
      </div>
      {metrics.length ? (
        <div className="v3fs-demo-ticker" aria-live="polite">
          {metrics.map((m, i) => <span key={i} className="v3fs-demo-metric">⏱ {m}</span>)}
        </div>
      ) : null}
      {pilotMode ? (
        <PilotApp screens={screens} fixtures={seeded} machines={machines}
          onBeatRecord={onBeatRecord} fieldFlags={fieldFlags} onToggleFieldFlag={onToggleFieldFlag}
          runLive={runLive} />
      ) : null}
      {explore && !pilotMode ? (
        // App mode: every screen, freely browsable, seeded with their data.
        <div className="v3fs-demo-grid">
          {screens.map((sc, i) => (
            <div key={i} className="v3fs-demo-cell">
              <ScreenCard screen={sc} active={false} onClick={() => setExplore(false)} />
              <SeededData screen={sc} fixtures={seeded} fieldFlags={fieldFlags} onToggleFieldFlag={onToggleFieldFlag} />
            </div>
          ))}
        </div>
      ) : null}
      <div className={explore || pilotMode ? "v3fs-demo-hidden" : undefined}>
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
      {runState === "working" ? (
        <div className="v3fs-demo-live"><span className="v3fs-demo-pulse" aria-hidden="true" />⚙ {runActor}: {String(step?.action ?? "")}…</div>
      ) : null}
      {runState === "approval" ? (
        <div className="v3fs-demo-approvebox">
          <b>⛨ Your approval moment</b>
          <p>{runActor || "This step waits for your judgement — the agent has prepared it."}</p>
          <button type="button" className="v3fs-btn pri" onClick={approveBeat}>✓ Approve &amp; continue</button>
        </div>
      ) : null}
      {runState === "done" ? (
        <div className="v3fs-demo-donebar">✓ Scenario complete — every agent beat ran, every approval was yours.</div>
      ) : null}
      {screen ? <ScreenCard screen={screen} active onClick={() => { /* focused already */ }} /> : null}
      {screen ? <SeededData screen={screen} fixtures={seeded} fieldFlags={fieldFlags} onToggleFieldFlag={onToggleFieldFlag} /> : null}
      {step && String(step.outcome ?? "") ? <div className="v3fs-wf-outcome">→ {String(step.outcome)}</div> : null}
      {(() => {
        const key = `${String(flow?.name ?? "Flow")} · step ${stepIndex + 1}${step?.action ? ` (${String(step.action)})` : ""}`;
        const verdict = beatVerdicts?.[key];
        return (
          <>
            {onBeatVerdict ? (
              <div className="v3fs-demo-beatv" role="radiogroup" aria-label={`Does this beat run your workflow: ${key}`}>
                <button type="button" role="radio" aria-checked={verdict === "ok"}
                  className={`v3fs-beatv-btn ok${verdict === "ok" ? " on" : ""}`}
                  onClick={() => onBeatVerdict(key, "ok")}>✓ Runs my workflow</button>
                <button type="button" role="radio" aria-checked={verdict === "not"}
                  className={`v3fs-beatv-btn no${verdict === "not" ? " on" : ""}`}
                  onClick={() => onBeatVerdict(key, "not")}>✗ Not quite</button>
              </div>
            ) : null}
            {onPhaseComment ? (
              <label className="v3fs-demo-phasec">
                <span>{verdict === "not" ? "What's off in this phase?" : "Comment on this phase (optional)"}</span>
                <textarea rows={2} value={phaseComments?.[key] ?? ""}
                  onChange={(event) => onPhaseComment(key, event.target.value)}
                  placeholder="Does this phase run the way you need it to?" />
              </label>
            ) : null}
          </>
        );
      })()}
      {narration && (narration.say || narration.callback) ? (
        <div className="v3fs-demo-say">
          {narration.say ? <p>{narration.say}</p> : null}
          {narration.callback ? <em>↩ {narration.callback}</em> : null}
        </div>
      ) : null}
      {onOwnFlow && stepIndex >= steps.length - 1 && script?.acceptanceAsk ? (
        <div className="v3fs-demo-ask">{script.acceptanceAsk}</div>
      ) : null}
      <div className="v3fs-wf-walknav">
        <button type="button" className="v3fs-btn" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>← Back</button>
        <span>{stepIndex + 1} of {steps.length}</span>
        <button type="button" className="v3fs-btn pri" disabled={stepIndex >= steps.length - 1} onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}>Next →</button>
      </div>
      </div>
    </div>
  );
}

/**
 * The seeded-data overlay — the rows the future system would show, rendered
 * under the wireframe from the prototype pack's fixtures. Every field chip is
 * TAPPABLE: "this field is wrong / shouldn't be here" lands as a field-level
 * flag on the record, the Show-phase twin of Listen's data-elements capture.
 */
function SeededData({ screen, fixtures, fieldFlags, onToggleFieldFlag }: {
  screen: Record<string, unknown>; fixtures: DemoFixture[];
  fieldFlags?: Record<string, string>; onToggleFieldFlag?: (key: string) => void;
}) {
  const matches = fixturesForEntities(fixtures, screenEntities(screen));
  if (!matches.length) return null;
  return (
    <div className="v3fs-demo-data">
      <span className="lbl">Seeded with your data{onToggleFieldFlag ? " — tap a field if it's wrong" : ""}</span>
      {matches.map((fx) => (
        <div key={fx.entity} className="v3fs-demo-fx">
          <b>{fx.entity}</b>
          {fx.records.map((r, i) => (
            <div key={i} className="v3fs-demo-fxrow">
              <span className="v3fs-demo-fxlabel">{r.label}</span>
              {Object.keys(r.values).length ? (
                <span className="v3fs-demo-fxfields">
                  {Object.entries(r.values).slice(0, 6).map(([k, v]) => {
                    const key = `${fx.entity}.${k}`;
                    const flagged = !!fieldFlags && key in fieldFlags;
                    return (
                      <button key={k} type="button" className={`v3fs-demo-field${flagged ? " flagged" : ""}`}
                        disabled={!onToggleFieldFlag}
                        title={flagged ? "Flagged — tap to clear" : "Tap if this field is wrong or shouldn't be here"}
                        onClick={() => onToggleFieldFlag?.(key)}>
                        <em>{k}</em> {v}{flagged ? " ✗" : ""}
                      </button>
                    );
                  })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
