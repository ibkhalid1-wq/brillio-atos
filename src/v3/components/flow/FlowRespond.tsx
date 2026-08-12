import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenCard } from "@/v3/components/flow/studio/ExperienceDesignStudio";
import FlowReviewSurface, {
  greetingName, DesignRoundReviewSurface,
  type DesignRoundReviewStamp, type DesignRoundVerdict,
} from "@/v3/components/flow/FlowReviewSurface";
// TYPE + CONSTANT only: the review-kind string a design-round link is stamped with.
// The round itself is the operator's record; this page never touches it.
import { DESIGN_ROUND_REVIEW_KIND } from "@/v3/components/flow/flowDesignRound";
import { projectStakeholderReview, reviewDiff, type ReviewPayload } from "@/v3/components/flow/flowReviews";
import {
  parseFixtures, fixturesForEntities, screenEntities, stepMetric, transitionForStep, isAgentActor, foldBeatRecords,
  type DemoBeatRecord, type DemoFixture,
} from "@/v3/components/flow/flowDemoRun";
import { stakeholderPrimaryArea, hasMultipleAreas } from "@/v3/components/flow/flowAreas";
import type { ProgramSummary } from "@/new/types";
import { MAX_ANSWER_CHARS } from "@/v3/lib/blobGuard";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";
import { usePortalAttach, AttachClip } from "@/v3/components/flow/PortalAttach";
import PilotApp from "@/v3/components/flow/PilotApp";
import PortalQuestions from "@/v3/components/flow/PortalQuestions";
import {
  portalQuestionModel, composeLocusAnswers, answeredLocusCount, type PortalQuestionModel,
} from "@/v3/components/flow/portalQuestionModel";
import { useProgramLedger } from "@/v3/lib/ledger/useProgramLedger";

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
  /** `final` distinguishes "I'm done" from "here's what I have so far" — the
   *  second leaves the durable link open and the confirmation must say so. */
  | { phase: "sent"; final: boolean };

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
  /** The LEDGER LOCI behind `questions`, index-aligned (`questionLoci[i]` is the
   * `about` that `questions[i]` closes). When present — and when the live
   * artifacts let this page rebuild a store — every question is re-rendered
   * through `renderQuestion(store, about, "stakeholder")`, the SAME producer the
   * operator queue reads, with its kind-specific affordance. Absent (every pack
   * minted before this existed) ⇒ the stored strings render exactly as before. */
  questionLoci?: string[];
  /** The programme's cast — lets the respondent defer a question to the
   * person who actually owns the answer. */
  roster?: Array<{ name: string; role: string }>;
  /** True only when the person has FINISHED (said "I'm done", or an operator
   * closed the link) AND nothing new is outstanding — the page then shows a
   * read-only recap. A partial send does NOT set this: the durable link keeps
   * carrying the questions they haven't reached. Derived by the ONE shared
   * definition in `@shared/portalLinkState`. */
  responded: boolean;
  /** The durable link's recap: every response this person has already sent.
   * `final` marks the send where they declared themselves done. */
  submissions?: Array<{ ts: string; movementId?: string; kind: string; preview: string; final?: boolean; answered?: string[] }>;
  /** They've responded at least once on this link. */
  answered?: boolean;
  /** The link is finished — by the stakeholder or by an operator. */
  closed?: boolean;
  /** Asks already on the record (stored question strings and/or their loci).
   * These are shown as answered rather than asked again as if nothing was sent. */
  answeredAsks?: string[];
  /** A new ask has been posted SINCE their last answer — they're returning to a
   * genuine follow-up, so the surface renders with a "welcome back" framing. */
  followUp?: boolean;
  /** The link belongs to a ROLE PLACEHOLDER (no person bound yet) — every
   * greeting skips the name; "Solution Architect" is never a first name. */
  unnamed?: boolean;
  /** This ask is the generated kit SCRIPT, not the ledger's open unknowns: at
   * mint the ledger owned no loci for this person, so every question carries
   * `about: ""` and the page falls to `mode: "strings"`. Rendered alone that is
   * indistinguishable from a locus-backed page, while no answer on it can be
   * filed against a point in the model. The page SAYS SO instead. Absent on
   * packs minted before the flag existed — then nothing extra is claimed. */
  scripted?: boolean;
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
   * per-beat talk track and callbacks, closing acceptance ask. `matchedBy` says
   * whether the edge resolved it from their NAME or from their ROLE. */
  script?: { openingQuote?: string; scenario?: string; acceptanceAsk?: string; matchedBy?: string; steps?: Array<{ beat?: string; say?: string; callback?: string }> };
  /** No script resolved for this recipient — the edge's sentence saying so, shown
   * in place of the script. An empty script block is indistinguishable from a
   * broken page, and this page asks people to approve what they can see. */
  scriptGap?: string;
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
   * of the interpreted walk. Assembled deterministically from the committed
   * ontology + atlas by the edge (`_shared/prototypeAssembly.ts`) — the same
   * module the operator's studio renders. */
  pilotHtml?: string;
  /** Provenance of `pilotHtml`. "assembled" = derived from the record, zero model
   * tokens for structure. Stated on the page so the claim is checkable. */
  pilotSource?: "assembled";
  /** Why there is NO prototype on a link that would otherwise carry one. Shown
   * verbatim: the gap is the honest answer when the record can't produce an
   * assembly. Never a stand-in for model-authored HTML. */
  pilotGap?: string;
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
 * Falls back (null) to the frozen `pack.review` for old/edge-less packs.
 *
 * `locusStrings` carries the loci-mode contract: null ⇒ legacy, the pack's own
 * stored question strings ARE the question list (unchanged behaviour). A list ⇒
 * the locus-backed questions render through the ONE renderer in their own
 * section, so this list is only the leftovers (asks whose locus this store can't
 * resolve) added to the review's own non-structural questions. Either way no ask
 * is dropped and none is asked twice. */
function reprojectFromPack(pack: Pack, locusStrings: string[] | null): ReviewPayload | null {
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
  if (fresh.kind === "listen-workflow") {
    if (locusStrings === null) {
      if (Array.isArray(pack.questions) && pack.questions.length) fresh.questions = pack.questions;
    } else {
      // Loci mode: the projection's own non-structural prompts (appetite,
      // compliance, constraints) stay, plus any ask this store couldn't render
      // from its locus. The locus-backed ones live in their own section.
      fresh.questions = [...fresh.questions, ...locusStrings];
    }
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

/**
 * Drop the asks this person has ALREADY answered on this durable link.
 *
 * A partial send files what they had and leaves the link open. On the return
 * visit the questions they answered must not be presented as if they had said
 * nothing — their answer is on the record and the operator is reviewing it. This
 * removes them from the form and hands back their text so the page can SAY they
 * are on record rather than silently shrinking the list.
 *
 * `answeredAsks` is the edge's sanitised union (stored question strings and/or
 * the loci behind them), so a row matches on either identity. Pure; the model is
 * rebuilt, never mutated.
 */
export function withoutAnsweredAsks(
  model: PortalQuestionModel,
  answeredAsks: readonly string[] | undefined,
): { model: PortalQuestionModel; onRecord: string[] } {
  const done = new Set((answeredAsks ?? []).map((a) => String(a).trim()).filter(Boolean));
  if (!done.size) return { model, onRecord: [] };
  const onRecord: string[] = [];
  const groups = model.groups
    .map((group) => {
      const rows = group.rows.filter((row) => {
        if (!done.has(row.about) && !done.has(row.stored.trim())) return true;
        onRecord.push(row.rendered.question);
        return false;
      });
      return { ...group, rows, count: rows.length };
    })
    .filter((group) => group.rows.length > 0);
  const rows = groups.flatMap((group) => group.rows);
  const strings = model.strings.filter((entry) => {
    if (!done.has(entry.question.trim())) return true;
    onRecord.push(entry.question);
    return false;
  });
  if (model.mode === "strings") {
    return { model: { ...model, strings, count: strings.length }, onRecord };
  }
  return { model: { ...model, groups, rows, strings, count: rows.length, unbacked: strings.length }, onRecord };
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
  /** Locus-keyed answers (loci-mode packs) — the locus is the stable identity, so
   *  a draft survives a re-render of the question text. */
  locusAnswers?: Record<string, string>;
  locusWhys?: Record<string, string>;
  locusDeferrals?: Record<string, string>;
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
  // The name greetings use — a first name only when the recipient IS a person,
  // the whole label when it's a role ("Head of Sales", never "Head"), and BLANK
  // for a role-placeholder link, so every surface (opener, banners, recap, demo)
  // skips the greeting cleanly. `unnamed` is stamped at mint; `greetingName`
  // catches the packs minted before that flag existed, so the stored "— TBC"
  // machine token can never reach this page.
  const greetName = state.phase === "ready" && !state.pack.unnamed
    ? greetingName(state.pack.stakeholder) : "";
  // ── the ledger, rebuilt on THIS page from the live artifacts the edge already
  // ships (ontology + atlas). Read-only, the ONE read path (useProgramLedger) —
  // no second migration, no second projection. It exists here for exactly one
  // reason: to render this pack's LOCI through the ONE question renderer, so the
  // stakeholder and the operator read one set in two voices.
  const portalProgram = useMemo<ProgramSummary | undefined>(() => {
    if (state.phase !== "ready" || !state.pack.liveArtifacts) return undefined;
    if (!state.pack.questionLoci?.length) return undefined;   // nothing to resolve — don't migrate
    return { rawData: { data: state.pack.liveArtifacts } } as unknown as ProgramSummary;
  }, [state]);
  const portalLedger = useProgramLedger(portalProgram);
  const packQuestionModel = useMemo<PortalQuestionModel>(
    () => portalQuestionModel(
      state.phase === "ready" ? state.pack : {},
      portalProgram ? portalLedger.store : null,
    ),
    [state, portalProgram, portalLedger.store],
  );
  // What is STILL OPEN on this durable link. A partial send leaves the link
  // usable; the asks it already carried an answer for are on the record and are
  // shown as such (`asksOnRecord`) rather than asked again as if unanswered.
  const { model: questionModel, onRecord: asksOnRecord } = useMemo(
    () => withoutAnsweredAsks(packQuestionModel, state.phase === "ready" ? state.pack.answeredAsks : undefined),
    [packQuestionModel, state],
  );
  const lociMode = questionModel.mode === "loci";
  // THE DESIGN REVIEW ROUND. The link's `reviewKind` is what says so — the same stamp
  // `designRoundReviewInput` puts on the mint, passed through by the edge — with the
  // frozen `review` object as the fallback for a pack the edge served before it echoed
  // the kind. Nothing here is guessed from the movement or the questions.
  const roundStamp = useMemo<DesignRoundReviewStamp | null>(() => {
    if (state.phase !== "ready") return null;
    const frozen = state.pack.review as { kind?: string } | undefined;
    if (state.pack.reviewKind !== DESIGN_ROUND_REVIEW_KIND && frozen?.kind !== DESIGN_ROUND_REVIEW_KIND) return null;
    return (frozen?.kind === DESIGN_ROUND_REVIEW_KIND
      ? frozen as DesignRoundReviewStamp
      : { kind: DESIGN_ROUND_REVIEW_KIND });
  }, [state]);
  // The review shown — rebuilt LIVE from the current artifacts the edge shipped,
  // falling back to the pack's frozen snapshot. Memoised so the surface's draft
  // key is stable within a load.
  const shownReview = useMemo<ReviewPayload | null>(
    // Old Envision packs may carry a frozen "agentify" review — that surface is
    // retired (Envision no longer mints client reviews), so such links degrade to
    // question-only rather than rendering the wrong surface.
    () => {
      if (state.phase !== "ready") return null;
      // A DESIGN-ROUND link is not one of the input surfaces: it asks for a verdict on
      // a built design, and its `review` carries the round stamp rather than workflows
      // or terms. Routed to its own page below; letting it fall through here would
      // hand the ontology surface an object with no `terms` to read.
      if (roundStamp) return null;
      const chosen = reprojectFromPack(state.pack, lociMode ? questionModel.strings.map((s) => s.question) : null)
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
    [state, lociMode, questionModel, roundStamp],
  );
  // A regeneration can reshape the review while a draft is saved on-device; fold
  // a structural signature into the review draft key so a changed structure
  // starts fresh (a stale draft's step indices would misalign) — best-effort.
  const reviewDraftKey = shownReview ? `${draftKey}.${reviewSignature(shownReview)}` : draftKey;
  const [answers, setAnswers] = useState<Record<number, string>>(draft0.answers ?? {});
  // Per-question deferral: "not me — this is for <name>". A deferred question
  // counts as handled here and is routed to that person's card on ingest.
  const [deferrals, setDeferrals] = useState<Record<number, string>>(draft0.deferrals ?? {});
  // Loci-mode answers, keyed by LOCUS (not by index): a chip tap, a picker
  // choice, a sentence — plus the optional "why" that turns a tap into a
  // reasoned answer, and the same "not mine, ask X" routing the string list has.
  const [locusAnswers, setLocusAnswers] = useState<Record<string, string>>(draft0.locusAnswers ?? {});
  const [locusWhys, setLocusWhys] = useState<Record<string, string>>(draft0.locusWhys ?? {});
  const [locusDeferrals, setLocusDeferrals] = useState<Record<string, string>>(draft0.locusDeferrals ?? {});
  // Paper-clip attachments — ONE shared mechanism for every input field on
  // the page (question answers, the demo comment, "anything else", phase
  // notes, review fields): extract the file's text into the field, keep the
  // original as a reference. Keyed per field.
  const { busyKey: attachBusyKey, note: attachNote, docs: attachments, attach, removeDoc } = usePortalAttach(token);
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
    || Object.keys(locusAnswers).length || Object.keys(locusWhys).length || Object.keys(locusDeferrals).length
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
      if (hasDraft) localStorage.setItem(draftKey, JSON.stringify({ answers, deferrals, locusAnswers, locusWhys, locusDeferrals, extra, suggestedVoices, verdict, comment, phaseComments, beatVerdicts, demoRunRecords, demoFieldFlags }));
    } catch { /* private mode / quota — draft-save is best-effort */ }
  }, [draftKey, state.phase, hasDraft, answers, deferrals, locusAnswers, locusWhys, locusDeferrals, extra, suggestedVoices, verdict, comment, phaseComments, beatVerdicts, demoRunRecords, demoFieldFlags]);

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

  // The extracted content goes straight into the field the clip sits on —
  // visible and editable — so the respondent can see and trust what will be
  // sent. The original file rides along as a downloadable reference on
  // submissions that carry documents; its text is NOT re-sent.
  const appendTo = (setter: (fn: (current: string) => string) => void) => (text: string) =>
    setter((current) => (current.trimEnd() ? `${current.trimEnd()}\n\n${text}` : text));
  // A paper-clip bound to a sub-surface field (DemoWalker phase notes, review
  // surface comments) — the sub-surface names the key/context/append, the
  // page supplies the one shared attach pipeline.
  const fieldClip = (key: string, context: string, append: (text: string) => void): ReactNode => (
    <AttachClip fieldKey={key} context={context} busyKey={attachBusyKey}
      docs={attachments[key]} onRemove={(i) => removeDoc(key, i)}
      onFile={(file) => void attach(key, file, context, append)} />
  );

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
    // In loci mode the string list holds only the asks with no renderable locus;
    // the locus-backed answers compose separately, each naming what it answers.
    // `questionModel.strings` is the whole stored list in strings mode and the
    // leftovers in loci mode — and in BOTH it is already stripped of the asks
    // this person answered on an earlier partial send, so a returning visit
    // cannot re-submit an answer to something already on the record.
    const blocks = questionModel.strings
      .map(({ question, index }) => {
        if (deferrals[index]) return ""; // deferred — routed, not answered here
        const answer = (answers[index] ?? "").trim();
        return answer ? `Q: ${question}\nA: ${answer}` : "";
      })
      .filter(Boolean);
    const locusBlock = composeLocusAnswers(questionModel.rows, locusAnswers, locusWhys, locusDeferrals);
    if (locusBlock) blocks.unshift(locusBlock);
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
  }, [state, answers, extra, deferrals, beatVerdicts, phaseComments, demoRunBlock, questionModel, locusAnswers, locusWhys, locusDeferrals]);

  const answeredCount = useMemo(() => {
    if (state.phase !== "ready" || state.pack.kind === "demo") return 0;
    const strings = questionModel.strings.reduce((count, { index }) =>
      count + (((answers[index] ?? "").trim() || (attachments[index] ?? []).length || deferrals[index]) ? 1 : 0), 0);
    return strings + answeredLocusCount(questionModel.rows, locusAnswers, locusDeferrals);
  }, [state, answers, attachments, deferrals, questionModel, locusAnswers, locusDeferrals]);

  // Which asks THIS send covers, named the way the pack stores them (a locus for
  // a locus-backed row, the stored question string otherwise) so the edge can
  // validate each against the pack's own list. It rides the submission, and a
  // return visit reads it back as "already on the record" instead of re-asking.
  const answeredAskKeys = useMemo(() => {
    if (state.phase !== "ready" || state.pack.kind === "demo") return [];
    const keys: string[] = [];
    for (const row of questionModel.rows) {
      if ((locusAnswers[row.about] ?? "").trim() || locusDeferrals[row.about]) keys.push(row.about);
    }
    for (const { index } of questionModel.strings) {
      if (!((answers[index] ?? "").trim() || (attachments[index] ?? []).length || deferrals[index])) continue;
      const stored = state.pack.questions?.[index];
      if (stored) keys.push(stored);
    }
    return keys;
  }, [state, questionModel, answers, attachments, deferrals, locusAnswers, locusDeferrals]);

  const canSend = composed.trim().length >= 20
    || Object.values(attachments).some((docs) => docs.length > 0)
    || Object.keys(deferrals).length > 0 || Object.keys(locusDeferrals).length > 0
    || filledVoices.length > 0;

  /** The plain question form's submission. `final` is the ONLY thing that closes
   *  the durable link — everything else is "here's what I have so far". */
  const sendPayload = (final: boolean): Record<string, unknown> => ({
    answers: composed,
    final,
    answered: answeredAskKeys,
    documents: Object.entries(attachments).flatMap(([key, list]) =>
      list.filter((doc) => doc.sourceKey).map((doc) => ({
        name: doc.name,
        // Question-keyed attachments carry their question number; field-keyed
        // ones ("extra", review fields) ride unnumbered.
        ...(Number.isFinite(Number(key)) ? { question: Number(key) + 1 } : {}),
        sourceKey: doc.sourceKey,
      }))),
    // A deferral names the question AS THE PACK STORED IT — the edge validates
    // routing against the pack's own list, so a locus-mode deferral sends the
    // stored string, not the freshly-rendered one.
    deferrals: [
      ...Object.entries(deferrals).map(([qIndex, to]) => ({
        question: (state.phase === "ready" ? state.pack.questions[Number(qIndex)] : "") ?? "", to,
      })),
      ...questionModel.rows
        .filter((row) => locusDeferrals[row.about])
        .map((row) => ({ question: row.stored, to: locusDeferrals[row.about] })),
    ].filter((entry) => entry.question && entry.to),
    suggestedVoices: filledVoices.map((voice) => ({
      name: voice.name.trim(), role: voice.role.trim(), note: voice.note.trim(),
    })),
  });

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
      // "Sent" is not "spent". Only an explicit `final` finishes the durable
      // link; the confirmation has to tell the truth about which one happened.
      setState({ phase: "sent", final: payload.final === true });
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
          {/* …and NOT on a round link: its own header carries the objective in the
              lede, so this aside printed the same sentence twice, above the greeting. */}
          {state.phase === "ready" && state.pack.kind !== "demo" && !state.pack.responded && !shownReview && !roundStamp && state.pack.objective ? (
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
              {/* The link only closes when THEY said they were done. Saying
                  "closed" after a partial send was the defect: it stranded every
                  question the person hadn't reached yet behind an operator
                  noticing and re-minting. */}
              {state.final ? (
                <p>The team reviews everything before it enters the record. You told us you&rsquo;re done, so this link is now closed — if more detail occurs to you later, the team can send a fresh one.</p>
              ) : (
                <p>
                  The team reviews everything before it enters the record. <b>This link stays open</b> — reopen it
                  whenever you like to answer the rest; what you&rsquo;ve already sent won&rsquo;t be asked again.
                </p>
              )}
            </div>
          ) : state.pack.responded ? (
            <RespondRecap stakeholder={greetName} submissions={state.pack.submissions ?? []}
              kind={state.pack.kind} />
          ) : roundStamp ? (
            /* THE DESIGN REVIEW ROUND: the prototype, their demo script, and the one
               answer the round is waiting for. The pilot frame is the SAME one the
               demo invite renders — the built app when the record can assemble one,
               the honest gap (and the external URL) when it cannot. */
            <DesignRoundReviewSurface stamp={roundStamp} stakeholder={greetName}
              programme={state.pack.programme} objective={state.pack.objective}
              script={state.pack.script} scriptGap={state.pack.scriptGap}
              submitting={submitting} error={error} draftKey={draftKey}
              afterIntro={<MeetingRequestBar kind="prototype" sent={meetingSent} submitting={submitting}
                onRequest={(pref) => void requestMeeting(pref, "prototype")} />}
              prototype={state.pack.pilotHtml
                ? <PilotFrame pilotHtml={state.pack.pilotHtml} pilotSource={state.pack.pilotSource} />
                : (
                  <>
                    <PilotGap gap={state.pack.pilotGap} />
                    {state.pack.demoUrl ? (
                      <a className="v3fs-btn pri v3fs-portal-send" href={state.pack.demoUrl} target="_blank" rel="noreferrer">
                        Open the prototype
                      </a>
                    ) : null}
                    {state.pack.design ? <DemoWalker design={state.pack.design} script={state.pack.script}
                      recipientArea={state.pack.recipientArea}
                      beatVerdicts={beatVerdicts}
                      onBeatVerdict={(key, value) => setBeatVerdicts((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }))}
                      machines={state.pack.machines} fixtures={state.pack.fixtures} seedScenario={state.pack.seedScenario}
                      onBeatRecord={(record) => setDemoRunRecords((prev) => [...prev, record])}
                      fieldFlags={demoFieldFlags} onToggleFieldFlag={toggleFieldFlag} /> : null}
                  </>
                )}
              onSubmit={(verdict: DesignRoundVerdict, feedback, capture) => void submit({
                // The QUARANTINE path, unchanged: this is an ordinary portal response
                // that happens to carry a verdict. It lands in the operator's inbox
                // and reaches the round only when they ingest it.
                answers: [
                  verdict === "accepted"
                    ? "Design review round — I approve this design as the one we build on."
                    : "Design review round — not yet; I am asking for changes.",
                  feedback,
                  // How the words were produced is NOT written into the words. It
                  // rides as the structured `capture` below, which now survives the
                  // hop into the round's own DesignRoundResponse and is drawn beside
                  // the quote. It used to be appended here as an English sentence
                  // because the model had no field for it, which made the stakeholder
                  // appear to have written a remark about their own dictation.
                  demoRunBlock,
                ].filter(Boolean).join("\n\n"),
                // The word the inbox already stores for a demo verdict, so the round's
                // own attribution maps it without a second vocabulary.
                verdict,
                ...(capture ? { capture } : {}),
              })} />
          ) : shownReview ? (
            <>
              {/* A RETURN VISIT is any second look at an open link — a new ask
                  posted since (`followUp`) or a partial send they're resuming.
                  Both must be greeted as a return; only the first is "new". */}
              {state.pack.answered ? <FollowUpBanner stakeholder={greetName}
                submissions={state.pack.submissions ?? []}
                resuming={!state.pack.followUp}
                changes={state.pack.priorReview ? reviewDiff(state.pack.priorReview, shownReview) : undefined} /> : null}
              <FlowReviewSurface review={shownReview} stakeholder={greetName} clip={fieldClip}
                programme={state.pack.programme} objective={state.pack.objective}
                returning={!!state.pack.answered}
                // The SAME locus questions the plain page renders — the review
                // surface hosts them beside the workflow they belong to, through
                // the same component and the same ONE renderer.
                questionModel={questionModel.mode === "loci" ? questionModel : undefined}
                store={questionModel.mode === "loci" ? portalLedger.store : undefined}
                roster={state.pack.roster}
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
                  <span className="v3fs-hero-brand"><img src="/brillio-logo.png" alt="Brillio" className="v3fs-portal-brandimg" /> AURA</span> · {state.pack.programme}
                </h1>
                <p className="v3fs-how">
                  {greetName ? `${greetName} — ` : ""}this is the prototype we&rsquo;re building
                  for you. Use it as you would the real thing, then tell us below whether it works.
                </p>
                {state.pack.openingQuote ? <blockquote className="v3fs-portal-quote">{state.pack.openingQuote}</blockquote> : null}
                {state.pack.scenario ? <p className="v3fs-portal-intro">{state.pack.scenario}</p> : null}
              </header>
              <div className="v3fs-portal-qs">
                {state.pack.pilotHtml ? (
                  // The built prototype IS the experience — use it, then give a
                  // verdict. No walk, no explorer: as close to production as we can
                  // get you before we ship it.
                  <PilotFrame pilotHtml={state.pack.pilotHtml} pilotSource={state.pack.pilotSource} />
                ) : (
                  <>
                    <PilotGap gap={state.pack.pilotGap} />
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
                      runLive={state.pack.liveDemo ? runLiveBeat : undefined} clip={fieldClip} /> : null}
                    {state.pack.steps?.length ? (
                      <div className="v3fs-portal-steps">
                        {state.pack.steps.map((step, index) => (
                          <div key={index} className="v3fs-portal-step"><b>{index + 1}</b><span>{step}</span></div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
                <MeetingRequestBar kind="prototype" sent={meetingSent} submitting={submitting}
                  onRequest={(pref) => void requestMeeting(pref, "prototype")} />
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
                    <AttachClip fieldKey="demo" context="What should change overall?" busyKey={attachBusyKey}
                      docs={attachments["demo"]} onRemove={(i) => removeDoc("demo", i)}
                      onFile={(file) => void attach("demo", file, "What should change overall?", appendTo(setComment))} />
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
              {/* "…they're below" — so this is a count of what is RENDERED, both
                  the locus-backed rows and the unbacked leftovers. It is not the
                  actionability figure; that one stays split in the header. */}
              {state.pack.answered ? <FollowUpBanner stakeholder={greetName}
                submissions={state.pack.submissions ?? []}
                resuming={!state.pack.followUp}
                newCount={questionModel.count + questionModel.unbacked} /> : null}
              <header className="v3fs-portal-head">
                <div className="v3fs-hero-eyebrow">{state.pack.programme} <span>· <img src="/brillio-logo.png" alt="Brillio" className="v3fs-portal-brandimg sm" /> AURA</span></div>
                {/* On a return visit the banner above already greets and frames it
                    — the header stays lean so a returning voice isn't
                    re-onboarded ("replaces a discovery call" is a first-time line). */}
                {state.pack.answered ? (
                  <p className="v3fs-portal-sub">
                    Same as before — answer in your own words, whenever suits you. Skip anything that doesn&rsquo;t apply.
                  </p>
                ) : (
                  <>
                    <h1 className="v3fs-portal-title">{greetName
                      ? `Hello ${greetName} — your perspective shapes what gets built.`
                      : "Your perspective shapes what gets built."}</h1>
                    <p className="v3fs-portal-sub">
                      These questions replace a scheduled discovery call. Answer in your own words, whenever suits you — skip anything that doesn&rsquo;t apply.
                    </p>
                  </>
                )}
                {/* TWO figures, never one. `count` is the questions tied to a point
                    in the model — an answer to one names the point it settles.
                    `unbacked` is the ones the pack carried with no such point;
                    answering those attributes to nothing. Presenting the sum as a
                    single total implied all of them were actionable, which is the
                    fabrication this codebase exists to prevent. The time estimate
                    spans both, because both cost the reader time. */}
                <div className="v3fs-portal-meta">
                  <span>✎ {questionModel.count} {state.pack.followUp ? (questionModel.count === 1 ? "new question" : "new questions") : "questions"} — answer any</span>
                  {questionModel.unbacked ? (
                    <span>✎ + {questionModel.unbacked} carried over, not tied to a point in the model</span>
                  ) : null}
                  <span>⏱ ~{Math.max(5, Math.round((questionModel.count + questionModel.unbacked) * 1.5))} minutes</span>
                  <span>⛨ Reviewed by the team before anything enters the record</span>
                </div>
                {/* SCRIPTED ASK. The model holds no open point owned by this person,
                    so these are the prepared interview questions rather than gaps in
                    the record. Everything else on this page reads the same either
                    way, which is precisely why it has to be said. */}
                {state.pack.scripted ? (
                  <p className="v3fs-portal-sub">
                    These are our <b>prepared questions</b> for your role — the model doesn&rsquo;t yet hold a specific open point
                    against your name, so your answers are read by the programme team rather than filed against a particular
                    point in it. That makes them no less useful: they are how those points get opened.
                  </p>
                ) : null}
                {/* ALREADY ON THE RECORD. These asks were answered on an earlier
                    partial send from this same link, so they are not in the form
                    below — but they are NOT silently dropped either: a question
                    that vanished without explanation reads as a question the team
                    lost. It is named, and said to be with the team. */}
                {asksOnRecord.length ? (
                  <div className="v3fs-portal-onrecord">
                    <b>{asksOnRecord.length} {asksOnRecord.length === 1 ? "question you already answered" : "questions you already answered"}</b> —
                    with the team, not asked again:
                    <ul>{asksOnRecord.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </div>
                ) : null}
              </header>
              <div className="v3fs-portal-qs">
                {/* No prototype where one was expected: say why, above whatever
                    fallback follows. Never silently nothing, never a substitute. */}
                {state.pack.pilotHtml ? null : <PilotGap gap={state.pack.pilotGap} />}
                {state.pack.pilotHtml ? (
                  // A Show follow-up: the built prototype itself, above the
                  // questions it informs — use it, then answer.
                  <PilotFrame pilotHtml={state.pack.pilotHtml} pilotSource={state.pack.pilotSource} />
                ) : state.pack.demoUrl ? (
                  // Externally-built prototype — link out to it (external hosts
                  // commonly can't be iframed), then answer below.
                  <a className="v3fs-btn pri v3fs-portal-send" href={state.pack.demoUrl} target="_blank" rel="noreferrer">▶ Open the prototype</a>
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
                    runLive={state.pack.liveDemo ? runLiveBeat : undefined} clip={fieldClip} />
                ) : null}
                {/* Locus-backed questions render through the ONE renderer with
                    their kind's affordance, grouped per element. Anything the
                    pack carried without a resolvable locus falls through to the
                    plain list below — nothing is dropped, nothing asked twice. */}
                {questionModel.mode === "loci" ? (
                  <PortalQuestions store={portalLedger.store} model={questionModel}
                    answers={locusAnswers} whys={locusWhys} deferrals={locusDeferrals}
                    onAnswer={(about, value) => setLocusAnswers((current) => ({ ...current, [about]: value }))}
                    onWhy={(about, value) => setLocusWhys((current) => ({ ...current, [about]: value }))}
                    onDefer={(about, to) => setLocusDeferrals((current) => {
                      if (!to) { const next = { ...current }; delete next[about]; return next; }
                      return { ...current, [about]: to };
                    })}
                    roster={state.pack.roster} />
                ) : null}
                {/* The leftovers get their OWN heading rather than trailing the
                    locus cards under the header's one count. They are asked as
                    they were stored, and an answer to one arrives as a bare
                    `Q:/A:` block with no `[locus: …]` tag — so it is read by a
                    person, not attributed to a point. Saying that is the whole
                    fix: the miss stays visible instead of being counted as if it
                    were actionable. */}
                {questionModel.mode === "loci" && questionModel.unbacked ? (
                  <div className="v3fs-rvw-wf-h">
                    <b>Carried over from an earlier version of the model</b>
                    <span className="v3fs-rvw-trigger">
                      {questionModel.unbacked} {questionModel.unbacked === 1 ? "question" : "questions"} — the part of the model {questionModel.unbacked === 1 ? "it points" : "they point"} at has since changed, so {questionModel.unbacked === 1 ? "this one is" : "these are"} read by the team rather than filed against a specific point
                    </span>
                  </div>
                ) : null}
                {questionModel.strings.map(({ question, index }) => (
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
                      maxLength={MAX_ANSWER_CHARS}
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
                      <AttachClip fieldKey={String(index)} context={question} busyKey={attachBusyKey}
                        docs={attachments[index]} onRemove={(i) => removeDoc(String(index), i)}
                        label="⌲ Attach a document"
                        onFile={(file) => void attach(String(index), file, question,
                          (text) => setAnswers((current) => {
                            const existing = (current[index] ?? "").trimEnd();
                            return { ...current, [index]: existing ? `${existing}\n\n${text}` : text };
                          }))} />
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
                  <textarea value={extra} onChange={(event) => setExtra(event.target.value)} rows={3} maxLength={MAX_ANSWER_CHARS} placeholder="Optional — type, or speak it." />
                  <DictationButton onText={(spoken) => setExtra((current) => joinDictation(current, spoken))} />
                  <AttachClip fieldKey="extra" context="Anything we didn't ask about" busyKey={attachBusyKey}
                    docs={attachments["extra"]} onRemove={(i) => removeDoc("extra", i)}
                    onFile={(file) => void attach("extra", file, "Anything we didn't ask about that we should know?", appendTo(setExtra))} />
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
                {/* `answeredCount` counts BOTH the locus rows and the unbacked
                    strings, so the denominator has to span both or the bar reads
                    "3 of 2". This is a progress figure over what is on the page,
                    not the header's actionability claim. */}
                <div className="v3fs-portal-progress">
                  <span>{answeredCount} of {questionModel.count + questionModel.unbacked} answered</span>
                  <div className="v3fs-portal-track" aria-hidden="true">
                    <div style={{ width: `${questionModel.count + questionModel.unbacked ? Math.round((answeredCount / (questionModel.count + questionModel.unbacked)) * 100) : 0}%` }} />
                  </div>
                  {hasDraft ? <span className="v3fs-portal-saved">✓ Saved on this device — you can close this and come back</span> : null}
                </div>
                {/* TWO sends, because they are two different things. The primary
                    files what they have and LEAVES THE LINK OPEN — answering one
                    of eight questions must not strand the other seven. "I have
                    nothing more" is the terminal one, and only the person (or the
                    operator) gets to say it. */}
                <div className="v3fs-portal-sendgroup">
                  <button type="button" className="v3fs-btn pri v3fs-portal-send"
                    disabled={submitting || !canSend}
                    onClick={() => void submit(sendPayload(false))}>
                    {submitting ? "Sending…" : "Send my answers"}
                  </button>
                  <button type="button" className="v3fs-a v3fs-portal-finish"
                    disabled={submitting || !canSend}
                    onClick={() => void submit(sendPayload(true))}>
                    Send &amp; finish — I have nothing more to add
                  </button>
                  <p className="v3fs-portal-foot">
                    Sending keeps this link open — come back any time to answer the rest. Only
                    &ldquo;Send &amp; finish&rdquo; closes it.
                  </p>
                </div>
              </div>
            </>
          )}
          {state.phase === "ready" && !state.pack.responded ? (
            <AskTheRecord token={token} />
          ) : null}
          {state.phase !== "loading" ? (
            <footer className="v3fs-portal-brandfoot">
              <span className="mark"><img src="/brillio-logo.png" alt="Brillio" className="v3fs-portal-brandimg" /> AURA</span>
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
  const first = greetingName(stakeholder);
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
function FollowUpBanner({ stakeholder, submissions, changes, newCount, resuming }: {
  stakeholder: string; submissions: Submission[];
  /** Structural "what changed since your last visit" phrases — from reviewDiff. */
  changes?: string[];
  /** How many questions are still open below (new asks, or the ones they
   *  haven't reached yet after a partial send). */
  newCount?: number;
  /** They are picking up a PARTIAL send on the same link rather than answering a
   *  newly-posted ask — the questions below are the ones they hadn't reached, not
   *  new ones, and calling them "new" would be a small lie. */
  resuming?: boolean;
}) {
  const first = greetingName(stakeholder);
  const last = submissions.length ? submissions[submissions.length - 1] : null;
  const when = last ? fmtWhen(last.ts) : "";
  // Name what's actually new so the return feels purposeful, not a vague "we've
  // changed things". Discovery knows the count; reviews list the changes below.
  const whatsNew = resuming
    ? (newCount && newCount > 0
      ? `${newCount} ${newCount === 1 ? "question is" : "questions are"} still open below — pick up where you left off.`
      : "There's nothing else outstanding, but this link is still yours — add anything you like.")
    : newCount && newCount > 0
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
function PilotFrame({ pilotHtml, pilotSource }: { pilotHtml: string; pilotSource?: "assembled" }) {
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
        {/* Provenance, stated to the person being asked to validate it — scoped to
            what is actually derived. Screens/fields/navigation come straight from the
            ontology + atlas; how a single value is PRESENTED is partly a name-pattern
            guess (semanticRoles tags each role derived vs heuristic), so the copy says
            so rather than overclaiming. Register row 17. */}
        {pilotSource === "assembled" ? (
          <p className="v3fs-portal-pilotlink-prov">
            Every screen, field and menu item here comes from the domain model and process
            map we agreed with you — one screen per thing your business tracks, one field
            per detail it records. How an individual value is <em>presented</em> is partly
            inferred from its name. All the records you see are synthetic samples.
          </p>
        ) : null}
      </div>
      <button type="button" className="v3fs-btn pri v3fs-portal-send" onClick={openPilot}>
        ↗ Open the prototype
      </button>
    </div>
  );
}

/** THE GAP, SHOWN. The prototype is assembled from the committed ontology + atlas;
 * when the record can't produce one there is nothing honest to display, so the page
 * says which piece is missing. It does NOT quietly fall back to the model-authored
 * build stored on the record — that would hand a stakeholder model-written HTML
 * while everyone believes they are looking at the record. A visible gap is the
 * answer; the interpreted walk, if there is one, still renders below it. */
function PilotGap({ gap }: { gap?: string }) {
  if (!gap) return null;
  return (
    <div className="v3fs-portal-pilotgap" role="status">
      <span className="v3fs-portal-pilotgap-i" aria-hidden="true">◇</span>
      <div>
        <b>No prototype to show you yet</b>
        <p>{gap}</p>
      </div>
    </div>
  );
}

function DemoWalker({ design, script, recipientArea, phaseComments, onPhaseComment, beatVerdicts, onBeatVerdict, machines, fixtures, seedScenario, onBeatRecord, fieldFlags, onToggleFieldFlag, runLive, clip }: {
  design: NonNullable<Pack["design"]>; script?: Pack["script"]; recipientArea?: string;
  phaseComments?: Record<string, string>; onPhaseComment?: (key: string, value: string) => void;
  /** Paper-clip renderer for a phase-comment field — supplied by the page so
   * every input shares the one attach pipeline. */
  clip?: (key: string, context: string, append: (text: string) => void) => ReactNode;
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
                {clip ? clip(`phase:${key}`, `Comment on ${key}`, (text) => {
                  const cur = (phaseComments?.[key] ?? "").trimEnd();
                  onPhaseComment(key, cur ? `${cur}\n\n${text}` : text);
                }) : null}
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
