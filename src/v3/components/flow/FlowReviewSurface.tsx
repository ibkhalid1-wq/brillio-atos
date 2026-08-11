/**
 * The shareable REVIEW surfaces a stakeholder sees on a response link, both
 * feeding LISTEN (Envision is the delivery team's build studio — no client
 * review is minted there):
 *  - listen-workflow — walk your own current-state workflow; fix/add steps and
 *                      flag which you'd most want automated (automation appetite).
 *  - ontology-atlas  — read the domain's terms and mapped workflows; say where
 *                      each is wrong or missing.
 *
 * Pure presentation + local state; on submit it composes an attributed evidence
 * block (composeListenWorkflow/composeOntologyAtlasAnswers) and hands it up as
 * the interview `answers` text — the same quarantine → evidence path as a script.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  composeOntologyAtlasAnswers, composeListenWorkflowAnswers,
  type OntologyAtlasReview, type ListenWorkflowReview, type ReviewPayload,
} from "@/v3/components/flow/flowReviews";
import { WorkflowFlow, OntologyMap, type FlowNode } from "@/v3/components/flow/FlowReviewVisuals";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";
import PortalQuestions from "@/v3/components/flow/PortalQuestions";
import {
  composeLocusAnswers, answeredLocusCount, type PortalQuestionModel,
} from "@/v3/components/flow/portalQuestionModel";
import type { LedgerStore } from "@/v3/lib/ledger/store";
import { displayPersonLabel, UNNAMED_SUFFIX_RE } from "@/v3/components/flow/flowStakeholders";

/**
 * Words that only ever belong to a ROLE or a title, never to a personal name.
 *
 * The direction of the failure is chosen deliberately. A surname this list
 * happens to contain is greeted by its FULL label ("Hi Priya Lead,") — clumsy,
 * and visibly the person's own words. A role NOT in the list is truncated to its
 * first word ("Hi Head,"), which is the defect. So the list errs wide, and the
 * fallback for anything it can't place is "print what we were given", never
 * "invent a first name out of it".
 */
const ROLE_WORDS: ReadonlySet<string> = new Set([
  "head", "chief", "vp", "svp", "evp", "avp", "director", "manager", "lead", "leader",
  "officer", "president", "owner", "analyst", "engineer", "architect", "specialist",
  "coordinator", "administrator", "admin", "consultant", "partner", "executive",
  "supervisor", "team", "staff", "advisor", "adviser", "controller", "counsel",
  "secretary", "treasurer", "principal", "associate", "assistant", "intern", "founder",
  "sme", "rep", "representative", "sponsor", "stakeholder", "approver", "reviewer",
  "operations", "ops", "sales", "marketing", "finance", "legal", "hr", "it",
  "procurement", "delivery", "product", "programme", "program", "project", "portfolio",
  "service", "services", "support", "success", "account", "accounts", "regional",
  "global", "national", "senior", "junior", "deputy", "acting", "interim", "manager's",
  "ceo", "cto", "cfo", "coo", "cio", "cmo", "ciso", "chro", "cdo", "cro",
]);

/** Connectives and punctuation that mark a label as a description of a SLOT
 *  rather than a person: "Head of Sales", "Sales / Alliances", "Lead (Asha)". */
const ROLE_SHAPE_RE = /(^|\s)(of|the|and|for|at|to|in|&)(\s|$)|[0-9(){}[\]/|,:]/i;

/** Is this label a PERSON's name (so a first name can be taken from it), or the
 *  description of a role (which must never be truncated)? */
export function isPersonLabel(label: string | null | undefined): boolean {
  const raw = String(label ?? "").trim();
  if (!raw) return false;
  if (UNNAMED_SUFFIX_RE.test(raw)) return false;          // "<Domain> SME — TBC" placeholder
  if (ROLE_SHAPE_RE.test(raw)) return false;
  const words = raw.split(/\s+/);
  if (words.length > 4) return false;                     // nobody is greeted by a sentence
  return !words.some((w) => ROLE_WORDS.has(w.toLowerCase().replace(/[.,'’]/g, "")));
}

/**
 * The name a client-facing greeting may use — the ONE place that decides it.
 *
 * `stakeholder.split(/\s+/)[0]` greeted an executive with "Hi Head," on the most
 * client-facing page in the product, because a durable link's recipient is
 * frequently a ROLE ("Head of Sales") rather than a person. A first name is only
 * taken when the label actually IS a person's name; a role is greeted whole, and
 * an unfilled placeholder is not greeted at all — there is no one to greet yet,
 * and inventing one is exactly the fabrication this codebase forbids.
 *
 * `displayPersonLabel` (the single existing definition, in `flowStakeholders`) is
 * applied first so the stored machine token "— TBC" can never reach the page.
 * Idempotent on its own output, so a surface may apply it defensively.
 */
export function greetingName(label: string | null | undefined): string {
  const shown = displayPersonLabel(label);
  if (!shown) return "";
  if (UNNAMED_SUFFIX_RE.test(String(label ?? "").trim())) return "";
  return isPersonLabel(shown) ? shown.split(/\s+/)[0] : shown;
}

/**
 * What a review surface sends alongside its composed answer text.
 *
 * `final` is the terminal "I'm done" — the ONE thing that closes a durable
 * per-stakeholder link. Its absence means "here's what I have so far", and the
 * link stays usable for the questions this person hasn't reached yet.
 * `answered` names the loci this send covers so they aren't asked again.
 */
export interface PortalSendExtras {
  suggestedVoices?: Array<{ name: string; role: string; note: string }>;
  final?: boolean;
  answered?: string[];
}

/** Paper-clip renderer supplied by the page (FlowRespond) so every review
 * input shares the one attach pipeline: the file's extracted text lands IN
 * the field, and the composed submission carries it like typed text. */
type ClipFn = (key: string, context: string, append: (text: string) => void) => React.ReactNode;
const appendText = (current: string | undefined, text: string): string => {
  const base = (current ?? "").trimEnd();
  return base ? `${base}\n\n${text}` : text;
};

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

/** The distinct areas across a set of items, General last. */
function areasOf(items: Array<{ area?: string }>): string[] {
  const set = new Set<string>();
  for (const it of items) if (it.area) set.add(it.area);
  return [...set].sort((a, b) => a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b));
}

/** Does this collection actually hold anything in the selected area? Used to
 *  filter GRACEFULLY — a stakeholder scoped to "Alliances" whose workflows we
 *  mapped under other areas still sees them, rather than an empty page. */
const hasArea = (items: Array<{ area?: string }>, area: string): boolean =>
  !!area && items.some((it) => it.area === area);

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

/** The linked page's opening: a subtle Brillio·AURA mark, the programme name,
 * a warm greeting, a one-line "what we're building + why", then plainly what we
 * need from this person and how to respond. Shared by every review surface. */
function ReviewHeader({ stakeholder, programme, objective, intro, areaLabel, returning }: {
  stakeholder: string; programme?: string; objective?: string; intro: string;
  /** The area(s) this review covers — a stakeholder can own more than one. */
  areaLabel?: string;
  /** They've responded before and are returning to a follow-up — warm the greeting. */
  returning?: boolean;
}) {
  // NOT `split(" ")[0]`. The recipient of a durable link is as often a ROLE as a
  // person, and truncating one produced "Hi Head," for "Head of Sales".
  const greeting = greetingName(stakeholder);
  // Just the core goal for the opener — drop measurement/timeline clauses (they
  // sit after an em-dash: "…satisfaction — measured against baselines — within
  // 12 months"). A stakeholder wants the "why", not the KPI framing.
  const coreGoal = objective ? objective.split(/\s+[—–]\s+/)[0].trim().replace(/[.\s]+$/, "") : "";
  return (
    <header className="v3fs-rvw-top">
      <div className="v3fs-rvw-brandline"><img src="/brillio-logo.png" alt="Brillio" className="v3fs-portal-brandimg" /> · AURA</div>
      {programme ? <div className="v3fs-rvw-prog">{programme}</div> : null}
      {/* On a return visit the FollowUpBanner above carries the "Welcome back"
          greeting — don't say it twice; a first visit greets here. */}
      {greeting && !returning ? <h1 className="v3fs-rvw-hi">Hi {greeting},</h1> : null}
      <p className="v3fs-rvw-lede">
        We&rsquo;re building <b>{programme || "this programme"}</b> — an agentic solution{coreGoal ? <> built to {coreGoal.charAt(0).toLowerCase() + coreGoal.slice(1)}</> : ""}.
      </p>
      {intro ? <p className="v3fs-rvw-sub">{intro}</p> : null}
      {areaLabel ? <p className="v3fs-rvw-scoped"><b>This covers {areaLabel}</b> — the workflows and terms in your world.</p> : null}
      <div className="v3fs-rvw-ask">
        Walk through your workflow below — <b>confirm what&rsquo;s right, fix what&rsquo;s not, add what we missed</b>. It saves as you go; nothing is final until the team reviews it.
      </div>
    </header>
  );
}

/** Questions the visual workflow + ontology already answer — once a stakeholder
 * can edit their process directly above, asking them to "walk through a typical
 * sales cycle" is redundant. Drop these from the questions list. */
function coveredByModel(q: string): boolean {
  const s = q.toLowerCase();
  return /\bwalk (me |us )?through\b/.test(s)
    || /\btalk (me|us) through\b/.test(s)
    || /\bstep[- ]by[- ]step\b/.test(s)
    || (/\btypical\b/.test(s) && /\b(cycle|process|workflow|work flow|journey|flow)\b/.test(s))
    || (/\bdescribe (the|your)\b/.test(s) && /\b(process|workflow|work flow|cycle|flow|steps)\b/.test(s))
    || (/\bhow (does|do)\b/.test(s) && /\b(work|flow|run|operate)\b/.test(s))
    || (/\bmap (out|the)\b/.test(s) && /\b(process|workflow|flow|cycle)\b/.test(s));
}

/** The area(s) a review covers — from its workflows/terms plus the recipient's
 * stamped area — as a readable list, since a stakeholder can own more than one
 * ("Sales", "Sales and Marketing", "Sales, Marketing, and Delivery"). */
function coverageLabel(review: ReviewPayload): string {
  const set = new Set<string>();
  const wf = (review as { workflows?: Array<{ area?: string }> }).workflows;
  const tm = (review as { terms?: Array<{ area?: string }> }).terms;
  wf?.forEach((w) => w.area && set.add(w.area));
  tm?.forEach((t) => t.area && set.add(t.area));
  if (review.recipientArea) set.add(review.recipientArea);
  const arr = [...set].sort((a, b) => (a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b)));
  if (arr.length <= 1) return arr[0] ?? "";
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

function OntologyAtlasSurface({ review, stakeholder, programme, objective, submitting, error, onSubmit, draftKey, returning, afterIntro, clip }: {
  review: OntologyAtlasReview; stakeholder: string; programme?: string; objective?: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string, extras?: PortalSendExtras) => void; draftKey?: string; returning?: boolean; afterIntro?: React.ReactNode; clip?: ClipFn;
}) {
  const [termComments, setTermComments] = usePersistentState<Record<string, string>>(draftKey, "oaTerms", {});
  const [workflowComments, setWorkflowComments] = usePersistentState<Record<string, string>>(draftKey, "oaWf", {});
  const [overall, setOverall] = usePersistentState(draftKey, "oaOverall", "");
  const [whoElse, setWhoElse] = usePersistentState(draftKey, "oaWhoElse", "");
  const [area, setArea] = useState(review.recipientArea ?? "");
  const areas = areasOf([...review.terms, ...review.workflows]);
  const touched = useMemo(() =>
    Object.values(termComments).some((v) => v.trim())
    || Object.values(workflowComments).some((v) => v.trim())
    || overall.trim().length > 0,
    [termComments, workflowComments, overall]);
  const shownTerms = area && hasArea(review.terms, area) ? review.terms.filter((t) => t.area === area) : review.terms;
  const shownWorkflows = area && hasArea(review.workflows, area) ? review.workflows.filter((w) => w.area === area) : review.workflows;
  /** This surface carries no locus questions, so it reports no `answered` keys —
   *  only whether the person is finished. */
  const atlasExtras = (final: boolean): PortalSendExtras => ({
    ...(whoElse.trim() ? { suggestedVoices: [{ name: whoElse.trim(), role: "", note: "" }] } : {}),
    ...(final ? { final: true } : {}),
  });

  return (
    <>
      <ReviewHeader stakeholder={stakeholder} programme={programme} objective={objective} intro={review.intro} areaLabel={coverageLabel(review)} returning={returning} />
      {afterIntro}
      <AreaChips areas={areas} active={area} onPick={setArea} />
      <div className="v3fs-rvw">
        {shownTerms.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The terms we heard</b><span className="v3fs-rvw-trigger">Your world, in your words</span></div>
            <div className="v3fs-rvw-terms">
              {review.terms.map((term, i) => area && hasArea(review.terms, area) && term.area !== area ? null : (
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
                  {clip?.(`rv-term:${i}`, term.name, (text) => setTermComments((p) => ({ ...p, [String(i)]: appendText(p[String(i)], text) })))}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {shownWorkflows.length ? (
          <section className="v3fs-rvw-wf">
            <div className="v3fs-rvw-wf-h"><b>The workflows we mapped</b><span className="v3fs-rvw-trigger">Does this match how it really runs?</span></div>
            <div className="v3fs-rvw-terms">
              {review.workflows.map((workflow, i) => area && hasArea(review.workflows, area) && workflow.area !== area ? null : (
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
                  {clip?.(`rv-wf:${i}`, workflow.name, (text) => setWorkflowComments((p) => ({ ...p, [String(i)]: appendText(p[String(i)], text) })))}
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
          {clip?.("rv-overall", "Anything else", (text) => setOverall((cur) => appendText(cur, text)))}
        </section>
      </div>
      <label className="v3fs-rvw-whoelse">Someone else we should ask?
        <input value={whoElse} onChange={(e) => setWhoElse(e.target.value)} placeholder="Name or role (optional)" /></label>
      <div className="v3fs-rvw-foot">
        {draftKey && touched ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        {/* Same two sends as the workflow surface: the primary files what they
            have and keeps the durable link open; only "finish" closes it. */}
        <div className="v3fs-portal-sendgroup">
          <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || (!touched && !whoElse.trim())}
            onClick={() => onSubmit(composeOntologyAtlasAnswers(review, termComments, workflowComments, overall), atlasExtras(false))}>
            {submitting ? "Sending…" : "Send my comments"}
          </button>
          <button type="button" className="v3fs-a v3fs-portal-finish" disabled={submitting || (!touched && !whoElse.trim())}
            onClick={() => onSubmit(composeOntologyAtlasAnswers(review, termComments, workflowComments, overall), atlasExtras(true))}>
            Send &amp; finish — I have nothing more to add
          </button>
          <p className="v3fs-portal-foot">
            Sending keeps this link open — come back any time to add more. Only &ldquo;Send &amp; finish&rdquo; closes it.
          </p>
        </div>
      </div>
    </>
  );
}

function ListenWorkflowSurface({ review, stakeholder, programme, objective, submitting, error, onSubmit, draftKey, returning, afterIntro, clip, questionModel, store, roster }: {
  review: ListenWorkflowReview; stakeholder: string; programme?: string; objective?: string; submitting: boolean; error: string | null;
  onSubmit: (answers: string, extras?: PortalSendExtras) => void; draftKey?: string; returning?: boolean; afterIntro?: React.ReactNode; clip?: ClipFn;
  questionModel?: PortalQuestionModel; store?: LedgerStore; roster?: Array<{ name: string; role: string }>;
}) {
  const [wfSteps, setWfSteps] = usePersistentState<FlowNode[][]>(draftKey, "lwSteps",
    review.workflows.map((w) => w.steps.map((s) => ({
      action: s.action, original: s.action, actor: s.actor, originalActor: s.actor, system: s.system, originalSystem: s.system, entities: s.entities,
    }))));
  const [narration, setNarration] = usePersistentState(draftKey, "lwNarr", "");
  const [whoElse, setWhoElse] = usePersistentState(draftKey, "lwWhoElse", "");
  const [termNotes, setTermNotes] = usePersistentState<Record<string, string>>(draftKey, "lwTerms", {});
  const [answers, setAnswers] = usePersistentState<Record<string, string>>(draftKey, "lwAns", {});
  const [addedTerms, setAddedTerms] = usePersistentState<Array<{ name: string; note: string }>>(draftKey, "lwAdd", []);
  // A free-text comment per workflow phase/step, keyed `${wi}.${si}` (text + voice).
  const [stepNotes, setStepNotes] = usePersistentState<Record<string, string>>(draftKey, "lwStepNotes", {});
  // Optional "why does it work this way?" per step, same key — captured as context.
  const [stepWhy, setStepWhy] = usePersistentState<Record<string, string>>(draftKey, "lwStepWhy", {});
  // Tap-to-validate: steps + terms the stakeholder actively confirmed are right.
  // Confirmation is signal — it turns silence into a validated model, not "maybe".
  const [stepConfirmed, setStepConfirmed] = usePersistentState<Record<string, boolean>>(draftKey, "lwStepOk", {});
  const [termConfirmed, setTermConfirmed] = usePersistentState<Record<string, boolean>>(draftKey, "lwTermOk", {});
  // The key data elements (fields) the stakeholder tracks about each term.
  const [termData, setTermData] = usePersistentState<Record<string, string>>(draftKey, "lwTermData", {});
  // Locus-backed answers, keyed by LOCUS — the same identity the operator queue
  // uses, so a draft survives a re-render of the question text.
  const [locusAnswers, setLocusAnswers] = usePersistentState<Record<string, string>>(draftKey, "lwLocus", {});
  const [locusWhys, setLocusWhys] = usePersistentState<Record<string, string>>(draftKey, "lwLocusWhy", {});

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
  // Undo just THIS stakeholder's own edit on a row — an added row is dropped;
  // an edited original is restored to what we showed (action/actor/system). Their
  // delta only; nothing else on the row is touched.
  const revertStep = (wi: number, si: number) => setWfSteps((prev) =>
    prev.map((steps, i) => {
      if (i !== wi) return steps;
      const step = steps[si];
      if (step.added) return steps.filter((_, j) => j !== si);
      return steps.map((s, j) => j !== si ? s : {
        ...s, action: s.original ?? s.action, removed: false,
        actor: s.originalActor ?? s.actor, system: s.originalSystem ?? s.system,
      });
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
    const noted = new Set([...Object.entries(stepNotes), ...Object.entries(stepWhy)]
      .filter(([, v]) => v.trim()).map(([k]) => k)).size;
    const confirmedSteps = Object.values(stepConfirmed).filter(Boolean).length;
    const confirmedTerms = Object.values(termConfirmed).filter(Boolean).length;
    const dataTerms = Object.values(termData).filter((v) => v.trim()).length;
    // Locus-backed answers count as questions answered, in the same unit.
    const answeredLoci = answeredLocusCount(questionModel?.rows ?? [], locusAnswers);
    const count = workflows.reduce((n, w) => n + w.changes.length + (w.reordered ? 1 : 0), 0)
      + (narration.trim() ? 1 : 0) + notedTerms.length + newTerms.length + answered.length + noted
      + confirmedSteps + confirmedTerms + dataTerms + answeredLoci;
    return { workflows, notedTerms, newTerms, answered, answeredLoci, confirmedSteps, confirmedTerms, dataTerms, count };
  }, [review, wfSteps, narration, termNotes, answers, addedTerms, stepNotes, stepWhy, stepConfirmed, termConfirmed, termData, questionModel, locusAnswers]);

  const [area, setArea] = useState(review.recipientArea ?? "");
  const areas = areasOf(review.workflows);

  const compose = () => {
    // Fold each step's "why does it work this way?" into the same attributed note
    // channel so it reaches the record as context, never a silently-dropped field.
    const mergedNotes: Record<string, string> = { ...stepNotes };
    for (const [k, why] of Object.entries(stepWhy)) {
      if (!why.trim()) continue;
      mergedNotes[k] = [mergedNotes[k]?.trim(), `Why it works this way: ${why.trim()}`].filter(Boolean).join(" — ");
    }
    const base = composeListenWorkflowAnswers(review, {
      workflows: review.workflows.map((w, wi) => ({ name: w.name, steps: wfSteps[wi] ?? [], stepNotes: mergedNotes, workflowIndex: wi })),
      narration, termNotes, answers, addedTerms,
    });
    // Fold the tap-to-validate confirmations into the same attributed evidence
    // block — a confirmed step/term is a positive fact ("they said this is right"),
    // not just the absence of a complaint.
    const okSteps = review.workflows.flatMap((w, wi) =>
      (wfSteps[wi] ?? []).map((s, si) => stepConfirmed[`${wi}.${si}`] ? `${w.name}: ${s.action}`.trim() : "").filter(Boolean));
    const okTerms = review.terms.map((t, i) => termConfirmed[String(i)] ? t.name : "").filter(Boolean);
    // Key data elements the stakeholder tracks per term — the attributes that
    // matter to them, straight into the record as requirements evidence.
    const dataLines = review.terms.map((t, i) => (termData[String(i)] ?? "").trim() ? `${t.name}: ${termData[String(i)].trim()}` : "").filter(Boolean);
    const lines: string[] = [];
    if (okSteps.length) lines.push(`Confirmed accurate — workflow steps: ${okSteps.join("; ")}`);
    if (okTerms.length) lines.push(`Confirmed accurate — terms: ${okTerms.join(", ")}`);
    if (dataLines.length) lines.push(`Key data elements they track — ${dataLines.join("; ")}`);
    // Locus-backed answers ride the SAME attributed block, each naming the exact
    // point in the model it answers, so the operator's ingest can attribute it.
    const locusBlock = composeLocusAnswers(questionModel?.rows ?? [], locusAnswers, locusWhys);
    return [base, lines.join("\n"), locusBlock].filter(Boolean).join("\n\n");
  };

  /** What rides beside the composed text. `final` closes the durable link and is
   *  only ever true when the person pressed the finish action; `answered` names
   *  the loci this send covers, so a return visit isn't asked them again. */
  const sendExtras = (final: boolean) => ({
    ...(whoElse.trim() ? { suggestedVoices: [{ name: whoElse.trim(), role: "", note: "" }] } : {}),
    ...(final ? { final: true } : {}),
    answered: (questionModel?.rows ?? [])
      .filter((row) => (locusAnswers[row.about] ?? "").trim())
      .map((row) => row.about),
  });

  return (
    <>
      <ReviewHeader stakeholder={stakeholder} programme={programme} objective={objective} intro={review.intro} areaLabel={coverageLabel(review)} returning={returning} />
      {afterIntro}
      <AreaChips areas={areas} active={area} onPick={setArea} />
      <div className="v3fs-rvw">
        <div className="v3fs-rvw-section-h"><span className="v3fs-rvw-step-ic" aria-hidden="true">⇄</span>Your workflow — fix it, add steps, or mark what doesn&rsquo;t happen</div>
        {review.workflows.map((wf, wi) => area && hasArea(review.workflows, area) && wf.area !== area ? null : (
          <section key={wi} id={`rvw-wf-${wi}`} className="v3fs-rvw-wf plain">
            <WorkflowFlow name={wf.name} trigger={wf.trigger} steps={wfSteps[wi] ?? []}
              onEdit={(si, action) => editStep(wi, si, action)}
              onEditMeta={(si, field, value) => editMeta(wi, si, field, value)}
              onToggleRemove={(si) => toggleRemove(wi, si)}
              onRevert={(si) => revertStep(wi, si)}
              onAdd={(at) => addStep(wi, at)}
              onReorder={(from, to) => reorderStep(wi, from, to)}
              stepComment={(si) => stepNotes[`${wi}.${si}`] ?? ""}
              onStepComment={(si, v) => setStepNotes((p) => ({ ...p, [`${wi}.${si}`]: v }))}
              stepWhy={(si) => stepWhy[`${wi}.${si}`] ?? ""}
              onStepWhy={(si, v) => setStepWhy((p) => ({ ...p, [`${wi}.${si}`]: v }))}
              stepConfirmed={(si) => !!stepConfirmed[`${wi}.${si}`]}
              onToggleStepConfirm={(si) => setStepConfirmed((p) => ({ ...p, [`${wi}.${si}`]: !p[`${wi}.${si}`] }))} />
          </section>
        ))}

        {review.terms.length ? (
          <>
            <div className="v3fs-rvw-section-h"><span className="v3fs-rvw-step-ic" aria-hidden="true">◉</span>The terms in your world — tap one to flag it</div>
            <section className="v3fs-rvw-wf plain">
              <OntologyMap terms={review.terms} relations={review.relations}
                comments={termNotes} onComment={(i, v) => setTermNotes((p) => ({ ...p, [String(i)]: v }))}
                confirmed={termConfirmed}
                onToggleConfirm={(i) => setTermConfirmed((p) => ({ ...p, [String(i)]: !p[String(i)] }))}
                dataElements={termData}
                onDataElements={(i, v) => setTermData((p) => ({ ...p, [String(i)]: v }))} />
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

        {/* The pack's LOCUS-BACKED questions — rendered through the ONE renderer
            with their kind's affordance, grouped per element, right after the
            workflow they're about. A pack with no loci renders nothing here and
            the plain list below is exactly what it always was. */}
        {questionModel && store ? (
          <PortalQuestions store={store} model={questionModel}
            heading="Open points in your process"
            answers={locusAnswers} whys={locusWhys}
            onAnswer={(about, value) => setLocusAnswers((p) => ({ ...p, [about]: value }))}
            onWhy={(about, value) => setLocusWhys((p) => ({ ...p, [about]: value }))}
            roster={roster} />
        ) : null}

        {(() => {
          // Only the questions the workflow + terms above DON'T already cover.
          const shown = review.questions.map((q, i) => ({ q, i })).filter(({ q }) => !coveredByModel(q));
          return shown.length ? (
            <section className="v3fs-rvw-wf">
              <div className="v3fs-rvw-wf-h"><b>A few things that shape the work</b><span className="v3fs-rvw-trigger">These don&rsquo;t change the steps — just good to know</span></div>
              <div className="v3fs-rvw-belowqs">
                {shown.map(({ q, i }) => (
                  <label key={i} className="v3fs-rvw-bq">
                    <span>{q}</span>
                    <div className="v3fs-rvw-field">
                      <textarea rows={2} value={answers[String(i)] ?? ""} onChange={(e) => setAnswers((p) => ({ ...p, [String(i)]: e.target.value }))} />
                      <DictationButton compact label="Speak this answer" onText={(spoken) => setAnswers((p) => ({ ...p, [String(i)]: joinDictation(p[String(i)] ?? "", spoken) }))} />
                      {clip?.(`rv-q:${i}`, q, (text) => setAnswers((p) => ({ ...p, [String(i)]: appendText(p[String(i)], text) })))}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          ) : null;
        })()}

        {/* Free-text catch-all sits LAST — after they've walked the model, so it
            captures what the taps and questions didn't, not vague up-front input. */}
        <section className="v3fs-rvw-wf">
          <div className="v3fs-rvw-wf-h"><b>Anything we missed?</b><span className="v3fs-rvw-trigger">In your own words — optional</span></div>
          <textarea className="v3fs-rvw-overall" rows={3} value={narration} onChange={(e) => setNarration(e.target.value)}
            placeholder="e.g. Legal actually reviews the quote twice — once before pricing and again before it goes out." />
          <DictationButton label="Speak it" onText={(spoken) => setNarration((cur) => joinDictation(cur, spoken))} />
          {clip?.("rv-narration", "Anything we missed", (text) => setNarration((cur) => appendText(cur, text)))}
        </section>
      </div>

      {/* Live preview — what the record will show once you send. */}
      <aside className={`v3fs-rvw-live${proposal.count ? " on" : ""}`} aria-live="polite">
        <div className="v3fs-rvw-live-h">Your changes {proposal.count ? <span>{proposal.count}</span> : null}</div>
        {proposal.count ? (
          <div className="v3fs-rvw-live-body">
            {proposal.workflows.map((w) => {
              // Index entry — clicking scrolls to the workflow it changed, so a long
              // list of changes stays navigable back to the row it came from.
              const wi = review.workflows.findIndex((rw) => rw.name === w.name);
              return (
                <button key={w.name} type="button" className="v3fs-rvw-live-wf"
                  onClick={() => document.getElementById(`rvw-wf-${wi}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                  <b>{w.name}</b>
                  <ul>
                    {w.changes.map((s, j) => (
                      <li key={j} className={s.added ? "add" : s.removed ? "del" : "chg"}>
                        {s.added ? `Added: ${s.action}` : s.removed ? `Removed: ${s.original ?? s.action}` : `Changed: ${s.action}`}
                      </li>
                    ))}
                    {w.reordered ? <li className="chg">Steps reordered</li> : null}
                  </ul>
                </button>
              );
            })}
            {narration.trim() ? <p className="v3fs-rvw-live-note">“{narration.trim()}”</p> : null}
            {proposal.newTerms.length ? <p className="v3fs-rvw-live-note add">{proposal.newTerms.length} new term{proposal.newTerms.length === 1 ? "" : "s"}</p> : null}
            {proposal.notedTerms.length ? <p className="v3fs-rvw-live-note">{proposal.notedTerms.length} term note{proposal.notedTerms.length === 1 ? "" : "s"}</p> : null}
            {proposal.dataTerms ? <p className="v3fs-rvw-live-note add">key fields on {proposal.dataTerms} term{proposal.dataTerms === 1 ? "" : "s"}</p> : null}
            {proposal.answered.length ? <p className="v3fs-rvw-live-note">{proposal.answered.length} note{proposal.answered.length === 1 ? "" : "s"} on constraints</p> : null}
          </div>
        ) : <p className="v3fs-rvw-live-empty">Edit a step, add one, or describe a change — it appears here.</p>}
      </aside>

      <label className="v3fs-rvw-whoelse">Someone else we should ask?
        <input value={whoElse} onChange={(e) => setWhoElse(e.target.value)} placeholder="Name or role (optional)" /></label>
      <div className="v3fs-rvw-foot">
        {draftKey && proposal.count ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        {/* Sending files what they have and LEAVES THE DURABLE LINK OPEN — a
            person who fixed one step out of eight must be able to come back for
            the rest. Only the quieter "finish" says they're done. */}
        <div className="v3fs-portal-sendgroup">
          <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || (!proposal.count && !whoElse.trim())}
            onClick={() => onSubmit(compose(), sendExtras(false))}>{submitting ? "Sending…" : "Send my changes"}</button>
          <button type="button" className="v3fs-a v3fs-portal-finish" disabled={submitting || (!proposal.count && !whoElse.trim())}
            onClick={() => onSubmit(compose(), sendExtras(true))}>Send &amp; finish — I have nothing more to add</button>
          <p className="v3fs-portal-foot">
            Sending keeps this link open — come back any time to add more. Only &ldquo;Send &amp; finish&rdquo; closes it.
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The DESIGN REVIEW ROUND's page — the stakeholder's half of the loop
 * ------------------------------------------------------------------ */

/** The round stamp a design-round link carries (`designRoundReviewInput`). Read
 *  only for what it says on the page; the round itself is the operator's record. */
export interface DesignRoundReviewStamp {
  kind: string;
  roundId?: string;
  ordinal?: number;
  designVersion?: string;
  prototypeTitle?: string;
  hasDemoScripts?: boolean;
}

/** The verdict vocabulary the QUARANTINE already speaks. `accepted` and `rework` are
 *  the words the operator's inbox stores and `inboxItemRoundAttribution` maps onto
 *  the round's own `approved`/`changes` — so this page invents no third spelling of
 *  "yes". "Accepted with changes" is deliberately absent: the round has two answers,
 *  and a maybe that reads as a yes is what the gate exists to prevent. */
export type DesignRoundVerdict = "accepted" | "rework";

/**
 * HOW THE WORDS WERE PRODUCED — the stakeholder typed them, spoke them, or spoke
 * them and then corrected the transcript. Carried alongside the feedback because a
 * transcript is a machine's reading of what someone said, and evidence that reads
 * as their writing when it is a machine's reading of their speech overstates itself.
 * Lockstepped with `CAPTURE_MODES` in `supabase/functions/flow-portal/index.ts`,
 * which is the only place the value is allowed to land on the record.
 */
export type CaptureMode = "typed" | "dictated" | "mixed";

/**
 * THE REVIEW PAGE for one stakeholder in a design review round: the prototype they
 * are being asked about, the demo script cut for their workflow, and the two things
 * the round needs back — approve, or ask for changes, plus what they actually think.
 *
 * It WRITES NOTHING to the round. The send goes through the same portal channel as
 * every other response and lands in the operator's quarantine inbox; the round only
 * hears about it when the operator ingests it. That is the whole quarantine
 * discipline, and a client-facing page is exactly where it must not be shortcut.
 */
export function DesignRoundReviewSurface({
  stamp, stakeholder, programme, objective, prototype, script, scriptGap, submitting, error, onSubmit, draftKey, afterIntro,
}: {
  stamp: DesignRoundReviewStamp;
  stakeholder: string;
  programme?: string;
  objective?: string;
  /** The built prototype (or the honest gap saying why there isn't one), rendered by
   *  the page that owns the pilot frame — never a second copy of it here. */
  prototype?: React.ReactNode;
  /** THEIR demo script — the walk narrated for their workflow. `matchedBy` says
   *  whether the edge resolved it from their NAME or from their ROLE. */
  script?: { openingQuote?: string; scenario?: string; acceptanceAsk?: string; matchedBy?: string; steps?: Array<{ beat?: string; say?: string; callback?: string }> };
  /** No script resolved — the edge's sentence saying so. Rendered INSTEAD of the
   *  script section, never alongside an empty one. */
  scriptGap?: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (verdict: DesignRoundVerdict, text: string, capture?: CaptureMode) => void;
  draftKey?: string;
  afterIntro?: React.ReactNode;
}) {
  const [verdict, setVerdict] = usePersistentState<DesignRoundVerdict | "">(draftKey, "drVerdict", "");
  const [text, setText] = usePersistentState(draftKey, "drText", "");
  // Where the words in the box came from, tracked as it happens rather than guessed
  // at send time. Dictation writes through `setText` and never fires the field's
  // onChange, so "they spoke it" and "they touched it themselves" stay independent —
  // and speaking then editing reads as `mixed`, which is the transcript being
  // CORRECTED by its author and the strongest form of the evidence.
  const [spoke, setSpoke] = usePersistentState(draftKey, "drSpoke", false);
  const [edited, setEdited] = usePersistentState(draftKey, "drEdited", false);
  const capture: CaptureMode = spoke ? (edited ? "mixed" : "dictated") : "typed";
  const greeting = greetingName(stakeholder);
  const coreGoal = objective ? objective.split(/\s+[—–]\s+/)[0].trim().replace(/[.\s]+$/, "") : "";
  const round = Number(stamp.ordinal) || 0;
  const scriptShown = !!script && !!(script.openingQuote || script.scenario || script.steps?.length);
  // Asking for changes without saying what to change is not a review — the operator
  // would have a red light and nothing to act on. An approval may stand on its own.
  const ready = verdict === "accepted" || (verdict === "rework" && text.trim().length > 0);

  return (
    <>
      <header className="v3fs-rvw-top">
        <div className="v3fs-rvw-brandline"><img src="/brillio-logo.png" alt="Brillio" className="v3fs-portal-brandimg" /> · AURA</div>
        {programme ? <div className="v3fs-rvw-prog">{programme}</div> : null}
        {greeting ? <h1 className="v3fs-rvw-hi">Hi {greeting},</h1> : null}
        <p className="v3fs-rvw-lede">
          We&rsquo;re building <b>{programme || "this programme"}</b> — an agentic solution{coreGoal ? <> built to {coreGoal.charAt(0).toLowerCase() + coreGoal.slice(1)}</> : ""}.
        </p>
        <p className="v3fs-rvw-sub">
          This is <b>{stamp.prototypeTitle || "the prototype"}</b>{round ? <> — round {round} of the design review</> : null}.
          Have a look, then tell us whether you approve this design as the one we build on.
        </p>
        <div className="v3fs-rvw-ask">
          We need one of two answers from you: <b>approve it</b>, or <b>tell us what to change</b>. The
          design isn&rsquo;t finished until everyone we asked has answered.
        </div>
      </header>
      {afterIntro}

      {prototype ? <div className="v3fs-dr-proto">{prototype}</div> : null}

      {script && scriptShown ? (
        <section className="v3fs-rvw-wf plain v3fs-dr-script">
          <div className="v3fs-rvw-wf-h">
            <b>Your demo script</b>
            {/* The page says WHICH claim matched. A walk written for the role is not
                the same promise as one written for the person, and reading it as the
                latter is how a stakeholder concludes we misunderstood their job. */}
            <span className="v3fs-rvw-trigger">{script?.matchedBy === "role"
              ? "The walk we cut for your role"
              : "The walk we cut for your workflow"}</span>
          </div>
          {script.openingQuote ? <blockquote className="v3fs-portal-quote">{script.openingQuote}</blockquote> : null}
          {script.scenario ? <p className="v3fs-dr-scenario">{script.scenario}</p> : null}
          {script.steps?.length ? (
            <ol className="v3fs-dr-beats">
              {script.steps.map((step, i) => (
                <li key={i}>
                  {step.beat ? <b>{step.beat}</b> : null}
                  {step.say ? <span className="v3fs-dr-say">{step.say}</span> : null}
                  {step.callback ? <span className="v3fs-dr-callback">{step.callback}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : (
        /* NO SCRIPT — said out loud, never left blank. A stakeholder looking at an
           empty space cannot tell "nobody wrote me a walkthrough" from "this page
           failed to load", and they are being asked to approve a design on what
           they can see. The absence is stated with what to do instead, and the
           heading stays so the missing thing has a name. */
        <section className="v3fs-rvw-wf plain v3fs-dr-script v3fs-dr-scriptgap">
          <div className="v3fs-rvw-wf-h">
            <b>Your demo script</b>
            <span className="v3fs-rvw-trigger">Not written for you</span>
          </div>
          <p className="v3fs-dr-scriptgap-note">{scriptGap
            || "No walkthrough was written for you, so there is no script to follow here. Take the prototype in whatever order makes sense for your work — your answer counts the same."}</p>
        </section>
      )}

      <section className="v3fs-rvw-wf v3fs-dr-verdict">
        <div className="v3fs-rvw-wf-h">
          <b>{script?.acceptanceAsk || "Do you approve this design as the one we build on?"}</b>
        </div>
        <div className="v3fs-portal-verdicts" role="radiogroup" aria-label="Your answer on this design">
          <button type="button" role="radio" aria-checked={verdict === "accepted"}
            className={`v3fs-portal-verdict${verdict === "accepted" ? " on" : ""}`}
            onClick={() => setVerdict("accepted")}>
            I approve this design
          </button>
          <button type="button" role="radio" aria-checked={verdict === "rework"}
            className={`v3fs-portal-verdict${verdict === "rework" ? " on" : ""}`}
            onClick={() => setVerdict("rework")}>
            Not yet — I&rsquo;m asking for changes
          </button>
        </div>
        <label className="v3fs-rvw-bq">
          <span>{verdict === "rework"
            ? "What needs to change? — required, so the team knows what to fix"
            : "Anything you want the team to know — optional"}</span>
          <div className="v3fs-rvw-field">
            {/* The transcript lands HERE, in the same editable box — nothing is sent
                from the microphone. Same rule as a Discover attachment: what a
                machine extracted is not evidence until the person confirms it. */}
            <textarea rows={4} value={text}
              onChange={(e) => { setEdited(true); setText(e.target.value); }} />
            <DictationButton label="Speak your feedback"
              onText={(spoken) => { setSpoke(true); setText((cur) => joinDictation(cur, spoken)); }} />
          </div>
        </label>
        {spoke ? (
          <p className="v3fs-rvw-dictnote">
            Dictated — read it back and correct anything before you send. It goes on the record as
            {capture === "mixed" ? " dictated and corrected by you" : " dictated"}, not as your writing.
          </p>
        ) : null}
        {draftKey && (verdict || text.trim()) ? <p className="v3fs-rvw-saved">✓ Saved on this device — you can close this and come back</p> : null}
        {error ? <p className="v3fs-portal-err">{error}</p> : null}
        <div className="v3fs-portal-sendgroup">
          <button type="button" className="v3fs-btn pri v3fs-rvw-send" disabled={submitting || !ready}
            title={ready ? undefined : verdict === "rework" ? "Say what needs to change" : "Choose approve or ask for changes"}
            onClick={() => { if (ready && verdict) onSubmit(verdict, text.trim(), text.trim() ? capture : undefined); }}>
            {submitting ? "Sending…" : verdict === "rework" ? "Send my changes" : "Send my answer"}
          </button>
          <p className="v3fs-portal-foot">
            Your answer goes to the programme team, who record it against this review round.
            Nothing enters the record until they have read it.
          </p>
        </div>
      </section>
    </>
  );
}

export default function FlowReviewSurface({ review, stakeholder, submitting, error, onSubmit, draftKey, programme, objective, returning, afterIntro, clip, questionModel, store, roster }: {
  review: ReviewPayload; stakeholder: string; submitting: boolean; error: string | null;
  /** The pack's LOCUS-BACKED questions, rendered through the ONE renderer with
   *  their affordances. Optional: a pack without loci renders exactly as before. */
  questionModel?: PortalQuestionModel;
  store?: LedgerStore;
  /** The cast — the role picker and "not mine, ask X" read it. */
  roster?: Array<{ name: string; role: string }>;
  /** Paper-clip renderer for input fields — see ClipFn. */
  clip?: ClipFn;
  onSubmit: (answers: string, extras?: PortalSendExtras) => void;
  /** Persist the respondent's edits to their device under this key so they can
   * close a long review and return. FlowRespond clears it on submit. */
  draftKey?: string;
  /** The programme name + plain-language objective, for the branded opener. */
  programme?: string;
  objective?: string;
  /** They've responded before — the opener says "Welcome back" instead of "Hi". */
  returning?: boolean;
  /** Rendered right after the greeting/intro — e.g. the "request a meeting"
   * offer, which belongs below "what we need from you", not above the greeting. */
  afterIntro?: React.ReactNode;
}) {
  if (review.kind === "listen-workflow") {
    return <ListenWorkflowSurface review={review} stakeholder={stakeholder} programme={programme} objective={objective} submitting={submitting} error={error} onSubmit={onSubmit} draftKey={draftKey} returning={returning} afterIntro={afterIntro} clip={clip} questionModel={questionModel} store={store} roster={roster} />;
  }
  return <OntologyAtlasSurface review={review} stakeholder={stakeholder} programme={programme} objective={objective} submitting={submitting} error={error} onSubmit={onSubmit} draftKey={draftKey} returning={returning} afterIntro={afterIntro} clip={clip} />;
}
