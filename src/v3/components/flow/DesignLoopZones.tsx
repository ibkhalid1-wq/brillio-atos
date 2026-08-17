/**
 * The Design Loop as a LEDGER SURFACE — the operator's board for one question:
 * WHAT DO I DO NOW.
 *
 * The ledger encodes who-does-what by SOURCE CLASS, and this surface reads it rather
 * than inventing a taxonomy. It used to draw that reading as THREE standing zones and
 * eight blocks, of which two carried live state; the rest were paragraphs explaining
 * things that were not there. It now draws:
 *
 *   · Operator builds it   — the four decided-with-basis artifacts in dependency order
 *     (Architecture → Experience Design → Blueprint → Prototype). Experience Design
 *     joined them: it is BUILT here and only its DEVIATIONS are joint, so a standing
 *     "joint" zone that hosted no work was the wrong home for its open-link.
 *   · Stakeholders approve it — the design review round, STAGED to the loop's own
 *     sequence (build → ask → collect → approve). One stage is drawn at a time; the
 *     rest recede.
 *   · Deviations to settle — drawn ONLY when there are deviations to adjudicate. It is
 *     a place you go when there is something there, not a permanent explanation of a
 *     precedence rule.
 *
 * THREE RULES THIS FILE NOW OBEYS
 *
 *  (1) ONE VOICE PER FACT. `designRoundGate` is the band's single status line. The
 *      round's own hand-written "No design review round has been opened…" paragraph
 *      said the same thing one line below the gate's own empty state, in a second
 *      voice that could drift from the model. The gate won: it is derived, tone-coded,
 *      and carries the next action.
 *
 *  (2) A ZERO-COUNT SECTION IS HIDDEN (the 2026-08-10 empty-state decision the Inbox
 *      follows). The deviation register, the asserted-intent count and the prototype-
 *      refinement count are drawn when there is something in them and not otherwise.
 *      What is NOT drawn is named once, quietly, at the foot of the band — so a blank
 *      space reads as "nothing on record yet" and never as "this surface is broken".
 *      EMPTY ≠ UNKNOWN there: 0 deviations is a real zero, while 0 stakeholder
 *      assertions is the gated write path and says so.
 *
 *  (3) RULES ARE NOT STATUS. "An asserted refinement wins over the operator's re-gen"
 *      is true on every render and worth reading once, so it lives behind a real
 *      disclosure button per zone instead of competing with the state beside it.
 *
 * AND ONE THING MOVED OUT. "N open unknowns owned by a role · blocking · answerable"
 * is Listen's burn-down, not the design round's; hosting it inside the approval zone
 * gave that zone two unrelated jobs. It is one line at the foot of the band now, and
 * the line's button lands on Discover, where the questions are actually worked.
 *
 * HONESTY: read-only in-browser migrate. Stakeholder `asserted` closures arrive
 * through the store write path, not wired here — so stakeholder assertions read 0
 * today. That 0 is marked provisional and named as UNKNOWN, never dressed up as
 * convergence the ledger does not have.
 */
import { generatedStamp } from "@/v3/lib/whenGenerated";
import { prototypeBaselineOfProgram } from "@shared/prototypeRefine.ts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProgramSummary } from "@/new/types";
import type { LineBand, LineStation } from "@/v3/lib/lineModel";
import type { ArtifactCardModel } from "@/v3/components/flow/flowShellData";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import {
  DESIGN_LOOP_MOVEMENT_IDS, designRoundGate, designRoundReviewInput, readDesignVersion,
  type DesignParticipantState, type DesignRoundPerson, type DesignRoundRollup,
  type DesignVersion,
} from "@/v3/components/flow/flowDesignRound";
import {
  OwnershipTag, ClaimStatus, SourceTag, DeviationMarker,
} from "@/v3/components/flow/studio/ledgerPrimitives";

/**
 * The design review round's write verbs, as ONE handler — the same shape declared at
 * every hop (FlowShell → TheLine → here), in the `onMintReview` idiom, so no module
 * has to import a type from this one (`designLoopZonesProps.test.ts` pins TheLine as
 * the only importer). Every branch lands on `flowDesignRound.ts`'s own function; this
 * surface computes nothing the model can answer.
 */
export type DesignRoundOp =
  | { op: "open"; roster: Array<{ name: string; role?: string; email?: string }>; note?: string }
  | { op: "link"; roundId: string }
  | { op: "verdict"; roundId: string; who: string; verdict?: "approved" | "changes"; attestation: "self" | "operator"; text?: string; source?: string }
  | { op: "waive"; roundId: string; who: string; reason: string }
  | { op: "delegate"; roundId: string; who: string; to: { name: string; role?: string; email?: string }; reason: string }
  | { op: "close"; roundId: string };

interface Props {
  band: LineBand;
  /** The programme itself — the round, its rollup and its gate are READ from here.
   *  Nothing on this surface re-derives a number `designRoundRollup` already states. */
  program: ProgramSummary;
  ledger: ProgramLedger;
  /** Who can be asked to approve the design — TheLine's own cast, passed in rather
   *  than re-resolved, so the round roster and Discover read one list. */
  roster: Array<{ name: string; role: string; isRole: boolean; email?: string }>;
  onOpen: (card: ArtifactCardModel, section?: string) => void;
  onRegen?: (card: ArtifactCardModel) => void;
  onGenerate?: (card: ArtifactCardModel) => void;
  /** THE existing mint — a round link is the same durable review link every other
   *  share uses. Never a second mint; see `designRoundReviewInput`. */
  onMintReview?: (input: { movementId: string; who: string; role: string; captureField: string; reviewKind: string; review: unknown; questions: string[]; intro: string; unnamed?: boolean; loci?: string[]; designRoundId?: string }) => Promise<string | null>;
  /** Open / link / record / waive / delegate / close. Omitted ⇒ the round reads
   *  read-only, which is what a lens without write rights should see. */
  onDesignRound?: (op: DesignRoundOp) => Promise<void>;
  /** Go to Discover — where role-owned open questions are actually worked (links
   *  minted, per person). The band states the count and hands the work over; it does
   *  not run Listen's burn-down from inside the design-approval zone. */
  regenBusy: Record<string, boolean>;
  genBusy: Record<string, boolean>;
  /* NO `onQuestion`. A stakeholder QUESTIONS an operator decision, and a stakeholder is
   * not who is standing here: this is the operator's own board. The prop existed, took a
   * `(station, owningRole)` callback and drew a "? question → {role}" button — and
   * TheLine, its only caller, never passed it, so the button could not be reached in the
   * running app and the branch below always fell to the note. The capture genuinely lives
   * on the stakeholder's link (FlowRespond); routing one from here would need an operator
   * write the read-only migrate does not have. So the tile states the routing as FACT —
   * "questionable → routes to {role}" — which is true, instead of offering a verb this
   * surface cannot perform. Guarded by designLoopZonesProps.test.ts. */
}

/**
 * Which zone each loop station belongs to, the role a question about it routes to, and
 * the ownership class its tile wears.
 *
 * EXPERIENCE DESIGN sits in the build zone now, with a JOINT tag. It is rendered by the
 * operator like the other three and it lands in the same dependency chain
 * (Architecture → Experience Design → Blueprint → Prototype); what is joint about it is
 * the gap between stakeholder-asserted intent and that render, and a gap is a thing you
 * adjudicate when it exists — the deviation section below — not a permanent zone.
 */
const ZONE_OF: Record<string, { zone: "operator" | "stakeholder"; role?: string; owned?: "operator" | "joint" }> = {
  "architecture-strategy": { zone: "operator", role: "Architect", owned: "operator" },
  "experience-design": { zone: "operator", role: "Design team", owned: "joint" },
  "agentic-blueprint": { zone: "operator", role: "Architect", owned: "operator" },
  prototype: { zone: "operator", role: "Design team", owned: "operator" },
  validation: { zone: "stakeholder" },
};

/**
 * A RULE, behind a real button. Teaching copy is true on every render and is therefore
 * not status; a zone that prints it beside its state makes the reader separate the two
 * every time. `aria-expanded` on a genuine <button> — the a11y suites reach this band.
 */
function ZoneHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="v3dl-help" aria-expanded={open}
        onClick={() => setOpen((on) => !on)}>{label}</button>
      {open ? <div className="v3dl-helpbody">{children}</div> : null}
    </>
  );
}

/** One operator-built artifact: decided-with-basis, not a refreshable blob. No
 *  "needs refresh" — its state reads as present/draft + ownership, and a
 *  stakeholder may question it (routes, never edits). */
function OperatorTile({ station, role, owned, onOpen, onRegen, onGenerate, regenerating, generating }: {
  station: LineStation; role: string; owned: "operator" | "joint";
  onOpen: Props["onOpen"]; onRegen?: Props["onRegen"]; onGenerate?: Props["onGenerate"];
  regenerating: boolean; generating: boolean;
}) {
  const present = !!station.card?.present;
  const canGen = !present && !!station.canGenerate && !!station.card && !!onGenerate;
  const evidenceMoved = present && station.needsRefresh; // was "needs refresh"
  const stamp = present ? generatedStamp(station.card?.generatedAt) : null;
  return (
    <div className={`v3dl-tile${present ? " present" : ""}`}>
      <button type="button" className="v3dl-tile-open" disabled={!present && !canGen}
        title={present ? `Open ${station.title}` : canGen ? `Generate ${station.title} — its inputs are ready` : `${station.title} — not built yet`}
        onClick={() => { if (present && station.card) onOpen(station.card); else if (canGen && !generating) onGenerate!(station.card!); }}>
        <span className="v3dl-tile-h">
          <span className="v3dl-tile-n">{station.title}</span>
          <OwnershipTag cls={owned} showLabel={false} />
        </span>
        <span className="v3dl-tile-sub">{station.subtitle}</span>
        {/* claim state replaces "needs refresh": present decisions read decided;
            an unbuilt tile reads its readiness; a moved-evidence tile names what
            actually changed (the claims under it), never "refresh". */}
        <span className="v3dl-tile-state">
          {present ? (
            evidenceMoved ? (
              <span className="v3dl-moved" title="the claims this decision rests on have moved — rebuild to re-derive it">
                <ClaimStatus state="weak" /> evidence moved underneath
              </span>
            ) : (
              <span className="v3dl-decided"><ClaimStatus state="closed" showLabel={false} /> decided, on record</span>
            )
          ) : canGen ? (
            <span className="v3dl-ready"><ClaimStatus state="open" showLabel={false} /> inputs ready — generate</span>
          ) : (
            <span className="v3dl-notseeded"><ClaimStatus state="open" showLabel={false} /> upstream not ready</span>
          )}
        </span>
        {station.sections?.length ? (
          <span className="v3dl-secs">{station.sections.map((s) => <span key={s.key} className="v3dl-sec">{s.label}</span>)}</span>
        ) : null}
        {/* HOW OLD IS WHAT I AM LOOKING AT — the question an operator asks
            before any other, and the one the board could not answer. Distinct
            from "evidence moved": that says the inputs shifted, this says when
            this document was last written. Absent when the record does not say;
            the exact instant rides the tooltip. */}
        {stamp ? <span className="v3dl-tile-when" title={stamp.title}>{stamp.label}</span> : null}
      </button>
      <div className="v3dl-tile-foot">
        {present && onRegen && station.card ? (
          <button type="button" className="v3dl-mini" disabled={regenerating}
            onClick={() => onRegen!(station.card!)}
            aria-label={`Rebuild ${station.title} from the current claims`}
            title="Rebuild this from the current claims (a decision is re-derived from the claims, not a blob refreshed)">
            {regenerating ? "rebuilding…" : <><span aria-hidden="true">↻ </span>rebuild from claims</>}
          </button>
        ) : null}
        {/* stakeholders question-but-don't-edit. A STATEMENT, not a control: the person
            who may question this is the stakeholder, on their own link — see Props. */}
        <span className="v3dl-question" title={`A stakeholder can question this decision — it routes to ${role} as a proposal, and never edits the artifact. The capture lives on their link.`}>
          <span className="v3dl-question-note">questionable<span aria-hidden="true"> → </span>routes to {role}</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * THE PROTOTYPE — a screen, not a tile
 * ------------------------------------------------------------------ */

/**
 * THE ONE ARTIFACT YOU CAN LOOK AT, SHOWN.
 *
 * The prototype sat as the fourth tile in a row of four: same size, same
 * treatment, same "decided, on record" line as three documents you read. But it
 * is not a document — it is the running application the other three exist to
 * produce, and it is what everybody in the room actually points at. A tile
 * saying "decided" tells you the file is present; only the screen tells you
 * whether the thing is any good.
 *
 * So it gets its own band, and the band draws the build. `prototypeBaselineOfProgram`
 * is the same function the studio previews with and the edge assembles its refine
 * baseline from, so the screen here IS the one behind the tile — carrying the
 * accepted screen spec and the approved skin — and cannot drift into a third
 * rendering of the same programme.
 */
/** The viewport the stage DRAWS at, before it is scaled to the board's column —
 *  a real desktop, so the preview shows the proportions the design was made for. */
const STAGE_W = 1280;
const STAGE_H = 680;

function PrototypeStage({ station, program, onOpen, onRegen, onGenerate, regenerating, generating }: {
  station: LineStation; program: ProgramSummary;
  onOpen: Props["onOpen"]; onRegen?: Props["onRegen"]; onGenerate?: Props["onGenerate"];
  regenerating: boolean; generating: boolean;
}) {
  const present = !!station.card?.present;
  const canGen = !present && !!station.canGenerate && !!station.card && !!onGenerate;
  const evidenceMoved = present && station.needsRefresh;
  const stamp = present ? generatedStamp(station.card?.generatedAt) : null;

  // The live assembly, off the programme's own record. Not the stored build:
  // the stored one is a snapshot, and a board is where you come to see where
  // things STAND. The studio's toggle is where the two are compared.
  const html = useMemo(() => {
    try {
      const raw = (program.rawData ?? {}) as Record<string, unknown>;
      const inner = (typeof raw.data === "object" && raw.data !== null ? raw.data : raw) as Record<string, unknown>;
      return prototypeBaselineOfProgram(inner)?.html ?? null;
    } catch { return null; }
  }, [program]);

  // THE SCALE, MEASURED. The stage draws the build at a real desktop viewport
  // (STAGE_W) and shrinks it to the board's column, so the preview shows the
  // proportions a stakeholder will see rather than the responsive fallback a
  // ~600px column triggers. It cannot be done in CSS alone: `100cqw / 1280` is a
  // length, and `scale()` takes a number — the first attempt silently drew the
  // frame at native size, overflowing its own container. So the width is
  // observed and the ratio applied to the frame.
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = screenRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => setScale(Math.min(1, (el.clientWidth || STAGE_W) / STAGE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);

  return (
    <section className="v3dl-stage" aria-label="The prototype">
      <header className="v3dl-stage-h">
        <span className="v3dl-stage-t">{station.title}</span>
        <span className="v3dl-stage-sub">{station.subtitle}</span>
        <span className="v3dl-stage-state">
          {present ? (
            evidenceMoved ? (
              <span className="v3dl-moved" title="the claims this build rests on have moved — rebuild to re-derive it">
                <ClaimStatus state="weak" /> evidence moved underneath
              </span>
            ) : (
              <span className="v3dl-decided"><ClaimStatus state="closed" showLabel={false} /> decided, on record</span>
            )
          ) : canGen ? (
            <span className="v3dl-ready"><ClaimStatus state="open" showLabel={false} /> inputs ready — generate</span>
          ) : (
            <span className="v3dl-notseeded"><ClaimStatus state="open" showLabel={false} /> upstream not ready</span>
          )}
          {stamp ? <span className="v3dl-stage-when" title={stamp.title}>{stamp.label}</span> : null}
        </span>
      </header>

      {/* DRAWN ONLY WHEN THERE IS A BUILD ON THE RECORD. The assembly succeeds
          from the ontology and atlas alone, so a programme whose prototype was
          never generated would otherwise show a complete application under the
          words "upstream not ready" — a picture that contradicts the state line
          beside it, and the more persuasive of the two. What the stage shows is
          the live re-assembly of a build that EXISTS, never a speculative one. */}
      {html && present ? (
        // Inert on the board. A prototype you can CLICK is a prototype you can
        // get lost inside two levels deep on a page that is about the state of
        // the programme; the studio and the browser tab are where it is walked.
        // Inert by pointer-events and tab order, NOT by withholding scripts:
        // the build draws its records from a JSON island through its own client
        // renderer, so `sandbox=""` gave a stage showing the chrome of an
        // application with every table empty — the exact "it is a screenshot"
        // failure the refine post-condition exists to catch, staged by us.
        // `allow-scripts` without `allow-same-origin` keeps the frame on an
        // opaque origin, so it can run its renderer and reach nothing here.
        <div className="v3dl-stage-screen" ref={screenRef}
          style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
          <iframe className="v3dl-stage-frame" sandbox="allow-scripts" srcDoc={html}
            title={`${station.title} — first screen`} tabIndex={-1}
            style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }} />
          <button type="button" className="v3dl-stage-veil" disabled={!present && !canGen}
            title={present ? "Open the prototype — walk it, refine it, share it" : "Not built yet"}
            onClick={() => { if (present && station.card) onOpen(station.card); else if (canGen && !generating) onGenerate!(station.card!); }}>
            <span className="v3dl-stage-veil-l">{present ? "open the prototype" : generating ? "generating…" : "generate it"}</span>
          </button>
        </div>
      ) : (
        <div className="v3dl-stage-none">
          <p>
            {canGen
              ? "Its inputs are ready — generate it and the application assembles from the ontology, the atlas and the design."
              : "The prototype assembles from the ontology, the atlas and the Experience Design. It appears here as soon as they are on the record."}
          </p>
          {canGen && station.card ? (
            <button type="button" className="v3dl-mini" disabled={generating}
              onClick={() => onGenerate!(station.card!)}>{generating ? "generating…" : "generate the prototype"}</button>
          ) : null}
        </div>
      )}

      <div className="v3dl-stage-foot">
        {present && station.card ? (
          <button type="button" className="v3dl-mini" onClick={() => onOpen(station.card!)}
            title="Open the Prototype studio — run it, refine it in plain language, export it">
            <span aria-hidden="true">▶ </span>open &amp; refine
          </button>
        ) : null}
        {present && onRegen && station.card ? (
          <button type="button" className="v3dl-mini" disabled={regenerating}
            onClick={() => onRegen!(station.card!)}
            aria-label={`Rebuild ${station.title} from the current claims`}
            title="Rebuild this from the current claims (a decision is re-derived from the claims, not a blob refreshed)">
            {regenerating ? "rebuilding…" : <><span aria-hidden="true">↻ </span>rebuild from claims</>}
          </button>
        ) : null}
        <span className="v3dl-question" title="A stakeholder can question this decision — it routes to the Design team as a proposal, and never edits the artifact. The capture lives on their link.">
          <span className="v3dl-question-note">questionable<span aria-hidden="true"> → </span>routes to Design team</span>
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The DESIGN REVIEW ROUND — zone 2's whole content, STAGED
 * ------------------------------------------------------------------ */

/** One word per participant state, in the operator's language. The rollup decides
 *  the state; this only spells it. */
const STATE_WORD: Record<DesignParticipantState, string> = {
  asked: "asked — nothing back yet",
  responded: "feedback in, no verdict",
  accepted: "approved",
  objected: "asked for changes",
  waived: "waived",
  delegated: "delegated",
};

/**
 * WHERE THE LOOP STANDS — build → ask → collect → approve, and the one detour
 * (changes requested) that sends you back to build.
 *
 * Derived from the model's own two readers and NOTHING else: `readDesignVersion` says
 * whether there is a design to review, `designRoundRollup` says where the round got to.
 * The stage decides what the zone draws, so the zone answers "what do I do now" instead
 * of listing everything that could ever be true.
 */
type LoopStage = "build" | "ask" | "collect" | "changes" | "approved";

function loopStage(design: DesignVersion, rollup: DesignRoundRollup): LoopStage {
  if (!design.hasPrototype) return "build";
  if (!rollup.round) return "ask";
  if (rollup.state === "objections") return "changes";
  if (rollup.state === "in-flight") return "collect";
  return "approved";
}

/** The four steps a reader sees. "changes" is not a fifth step — it is the collect
 *  step going wrong, and the gate beside the rail names who asked for what. */
const RAIL = [
  { id: "build", word: "Build" },
  { id: "ask", word: "Ask" },
  { id: "collect", word: "Collect" },
  { id: "approved", word: "Approve" },
] as const;
const RAIL_STEP: Record<LoopStage, (typeof RAIL)[number]["id"]> = {
  build: "build", ask: "ask", collect: "collect", changes: "collect", approved: "approved",
};

/** Whose row the operator is actually looking for at this stage. Ordering only — every
 *  participant is still drawn, so nothing is hidden behind the stage. */
const STAGE_FOCUS: Record<LoopStage, DesignParticipantState[]> = {
  build: [], ask: [],
  collect: ["asked", "responded"],
  changes: ["objected"],
  approved: [],
};

function StageRail({ stage }: { stage: LoopStage }) {
  const nowAt = RAIL.findIndex((s) => s.id === RAIL_STEP[stage]);
  return (
    <ol className="v3dl-rail" aria-label="Where this design loop stands">
      {RAIL.map((step, i) => (
        <li key={step.id} aria-current={i === nowAt ? "step" : undefined}
          className={`v3dl-railstep${i === nowAt ? " is-now" : i < nowAt ? " is-done" : ""}`}>
          {step.word}
        </li>
      ))}
    </ol>
  );
}

/**
 * WHO SAID IT, on screen. Invariant (a) of `flowDesignRound.ts` is only worth
 * anything if the two are impossible to confuse at a glance, so they are drawn
 * differently (solid vs dashed, positive vs amber) AND worded differently — a
 * self-attested row says the person's own name owns it; an operator capture says,
 * in words, that it is not their word.
 */
function AttestationMark({ person }: { person: DesignRoundPerson }) {
  if (!person.attestation) return null;
  if (person.attestation === "self") {
    return (
      <span className="v3dr-att is-self">
        {person.name}&rsquo;s own word — answered on their link
      </span>
    );
  }
  return (
    <span className="v3dr-att is-operator">
      recorded by the operator — not {person.name}&rsquo;s own word
    </span>
  );
}

function DesignRoundZone({ program, roster, locked, onMintReview, onDesignRound }: {
  program: ProgramSummary;
  roster: Props["roster"];
  locked: boolean;
  onMintReview?: Props["onMintReview"];
  onDesignRound?: Props["onDesignRound"];
}) {
  const gate = designRoundGate(program);
  const rollup = gate.rollup;                // ONE read: the gate carries its own rollup
  const round = rollup.round;
  // What is built RIGHT NOW — the model's own reader, so "there is nothing to review"
  // is the same fact here and inside `openDesignRound`.
  const design = readDesignVersion(program);
  const stage = loopStage(design, rollup);
  // A superseded or closed round takes no more answers — the model refuses them, so
  // the surface must not offer them either.
  const live = !!round && !round.closedAt && !round.supersededBy;
  const canWrite = !!onDesignRound && !locked;

  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [meeting, setMeeting] = useState(false);
  const [openFor, setOpenFor] = useState<Record<string, boolean>>({});
  const [verdictPick, setVerdictPick] = useState<Record<string, "approved" | "changes">>({});
  const [basis, setBasis] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [delegateTo, setDelegateTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  // NAMED PEOPLE FIRST. A round is people approving a design; an unfilled ROLE can
  // be asked (its link greets nobody by name) but it cannot approve anything, so it
  // sorts below and says what it is rather than repeating its own title twice.
  const rosterChoices = useMemo(
    () => roster.filter((person) => person.name.trim())
      .slice()
      .sort((a, b) => Number(a.isRole) - Number(b.isRole)),
    [roster],
  );
  const chosen = rosterChoices.filter((person) => picked[person.name]);

  // The stage decides WHOSE ROW YOU ARE LOOKING FOR. A stable sort, so within the
  // focused group the round's own order survives and nobody is dropped.
  const people = useMemo(() => {
    const focus = STAGE_FOCUS[stage];
    if (!focus.length) return rollup.people;
    return [...rollup.people].sort((a, b) => Number(focus.includes(b.state)) - Number(focus.includes(a.state)));
  }, [rollup.people, stage]);

  const run = async (op: DesignRoundOp, told: string) => {
    if (!onDesignRound || busy) return;
    setBusy(true);
    try { await onDesignRound(op); setSaid(told); }
    finally { setBusy(false); }
  };

  /** MINT — through the existing review-pack path, one participant at a time, with
   *  the round's own input. Then the round records which pack carries whose ask. */
  const share = async (names: string[]) => {
    if (!onMintReview || !onDesignRound || !round || busy) return;
    setBusy(true);
    try {
      let out = 0;
      for (const who of names) {
        const input = designRoundReviewInput(program, round.id, who);
        if (!input) continue;
        await onMintReview(input);
        out += 1;
      }
      await onDesignRound({ op: "link", roundId: round.id });
      setSaid(out ? `${out} round link${out === 1 ? "" : "s"} out.` : "No link to mint.");
    } finally { setBusy(false); }
  };

  const unlinked = rollup.people.filter((p) => !p.linked && !p.resolution).map((p) => p.name);
  const panelOpen = (person: DesignRoundPerson) =>
    !!openFor[person.name] || (meeting && (person.state === "asked" || person.state === "responded"));

  return (
    <div className={`v3dr stage-${stage}`}>
      <StageRail stage={stage} />

      {/* THE GATE, in the band, and the ONLY sentence about where the round stands.
          Tone, label and detail come from designRoundGate — there is deliberately no
          second paragraph restating it underneath in the surface's own words. */}
      <div className={`v3dr-gate tone-${gate.tone}`} role="note" aria-label="Design review round gate">
        <span className="v3dr-gate-dot" aria-hidden="true" />
        <span className="v3dr-gate-l">{gate.label}</span>
        {gate.detail ? <span className="v3dr-gate-d">{gate.detail}</span> : null}
      </div>

      {/* STAGE 1 · NOTHING BUILT — the gate has already said "build the prototype
          first". A roster picker for a design that does not exist is a control the
          model would refuse, so the stage draws nothing else at all. */}
      {stage === "build" ? null : !round ? (
        /* STAGE 2 · BUILT, NO ROUND — the roster picker and one verb. */
        <div className="v3dr-ask">
          {locked ? (
            <p className="v3dr-note">This movement&rsquo;s gate is recorded, so the round is frozen — reopen the gate to ask anybody.</p>
          ) : !canWrite ? null : !rosterChoices.length ? (
            <p className="v3dr-note">No named stakeholder on the roster yet — cast the Discovery Kit first.</p>
          ) : (
            <>
              <button type="button" className="v3dl-mini" aria-expanded={picking}
                onClick={() => setPicking((on) => !on)}
                title="Pick who reviews the design, then open the round">
                open a design review round
              </button>
              {picking ? (
                <div className="v3dr-pick">
                  <ul className="v3dr-picklist" aria-label="Who to ask to approve the design">
                    {rosterChoices.map((person) => (
                      <li key={person.name}>
                        <label className="v3dr-pickrow">
                          <input type="checkbox" checked={!!picked[person.name]}
                            aria-label={`Ask ${person.name}${person.role && person.role !== person.name ? `, ${person.role},` : ""} to approve the design${person.isRole ? " — a role with nobody named to it yet" : ""}`}
                            onChange={(e) => setPicked((prev) => ({ ...prev, [person.name]: e.target.checked }))} />
                          <span className="v3dr-name">{person.name}</span>
                          {person.role && person.role !== person.name ? <span className="v3dr-role">{person.role}</span> : null}
                          {person.isRole ? <span className="v3dr-role is-slot">a role — nobody named to it yet</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <label className="v3dr-field">
                    <span>A note for the round — optional</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button type="button" className="v3dl-mini" disabled={busy || !chosen.length}
                    title={chosen.length ? `Open the round and ask ${chosen.length} stakeholder${chosen.length === 1 ? "" : "s"} at once` : "Pick at least one stakeholder"}
                    onClick={() => void run({
                      op: "open",
                      roster: chosen.map((person) => ({ name: person.name, role: person.role, email: person.email })),
                      note: note.trim() || undefined,
                    }, "Round opened.")}>
                    open the round with {chosen.length} stakeholder{chosen.length === 1 ? "" : "s"}
                  </button>
                </div>
              ) : null}
              {said ? <span className="v3dr-said" role="status">{said}</span> : null}
            </>
          )}
        </div>
      ) : (
        /* STAGES 3-5 · A ROUND EXISTS — the rollup, per person, by name. */
        <>
          <div className="v3dr-counts">
            <span className="v3dr-count"><b>{rollup.asked}</b> asked</span>
            <span className="v3dr-count"><b>{rollup.accepted}</b> approved</span>
            {/* The split is printed BESIDE the total, never merged into it. */}
            <span className="v3dr-split">
              {rollup.acceptedSelfAttested} self-attested<span aria-hidden="true"> · </span>
              {rollup.acceptedOperatorAttested} recorded by the operator
            </span>
            <span className="v3dr-count"><b>{rollup.objected}</b> asked for changes</span>
            <span className="v3dr-count"><b>{rollup.waived}</b> waived</span>
            <span className="v3dr-count"><b>{rollup.delegated}</b> delegated</span>
            <span className="v3dr-count"><b>{rollup.outstanding}</b> outstanding</span>
          </div>

          <div className="v3dr-bar">
            {onMintReview && canWrite && live && unlinked.length ? (
              <button type="button" className="v3dl-mini" disabled={busy}
                onClick={() => void share(unlinked)}
                title="Mint each unlinked participant's durable review link for this round — the same link every other share uses">
                share the round link with {unlinked.length} not yet linked
              </button>
            ) : null}
            {canWrite && live ? (
              <button type="button" className={`v3dl-mini${meeting ? " on" : ""}`} aria-pressed={meeting}
                onClick={() => setMeeting((on) => !on)}
                title="Reviewing jointly: record each person's verdict in one sitting. Everything recorded here is attested by YOU, not by them, and each one needs a stated basis.">
                meeting mode — record verdicts in one sitting
              </button>
            ) : null}
            {canWrite && live && gate.done ? (
              <button type="button" className="v3dl-mini" disabled={busy}
                onClick={() => void run({ op: "close", roundId: round.id }, `Round ${rollup.ordinal} closed.`)}
                title="Close the round — records the fact the rollup already states; it cannot create one">
                close round {rollup.ordinal}
              </button>
            ) : null}
            {said ? <span className="v3dr-said" role="status">{said}</span> : null}
          </div>

          {meeting ? (
            <p className="v3dr-meetnote">
              Joint review. Every verdict you record below is <b>attested by you</b>, not by the person
              named — the record keeps them apart permanently — and each one needs you to say what
              they said and where.
            </p>
          ) : null}

          <ul className="v3dr-people"
            aria-label={stage === "changes" ? `Round ${rollup.ordinal} — everyone asked, the changes to act on first`
              : stage === "collect" ? `Round ${rollup.ordinal} — everyone asked, those still to answer first`
                : `Round ${rollup.ordinal} — every stakeholder asked`}>
            {people.map((person) => {
              const answeredThemselves = person.attestation === "self";
              const canRecord = canWrite && live && !person.resolution && !answeredThemselves;
              const open = panelOpen(person);
              return (
                <li key={person.name} className={`v3dr-person is-${person.state}`}>
                  <div className="v3dr-person-h">
                    <span className="v3dr-name">{person.name}</span>
                    {person.role ? <span className="v3dr-role">{person.role}</span> : null}
                    <span className={`v3dr-state is-${person.state}`}>{STATE_WORD[person.state]}</span>
                    <AttestationMark person={person} />
                    {person.linked ? <span className="v3dr-link">link out</span>
                      : <span className="v3dr-link is-none">no link yet</span>}
                    {person.versionStale ? <span className="v3dr-stale">answered an earlier version of the design</span> : null}
                    {person.delegatedFrom ? <span className="v3dr-from">answering in place of {person.delegatedFrom}</span> : null}
                  </div>
                  {person.text ? <p className="v3dr-said-text">&ldquo;{person.text}&rdquo;</p> : null}
                  {person.capture && person.capture !== "typed" ? (
                    // Said as a note ABOUT the words, not inside them. A transcript is
                    // a machine's reading of somebody's speech, and quoting it with no
                    // mark reads as their writing — which overstates it.
                    <p className="v3dr-capture">
                      {person.capture === "mixed"
                        ? "spoken, then corrected by them before sending"
                        : "spoken, not written — transcribed by the browser"}
                    </p>
                  ) : null}
                  {person.recordingRef ? <p className="v3dr-rec">recording on file: {person.recordingRef}</p> : null}
                  {person.resolution ? (
                    <p className="v3dr-res">
                      {person.resolution.kind === "waived" ? "Waived" : `Delegated to ${person.resolution.to?.name ?? "someone else"}`}
                      {" by "}{person.resolution.by} — &ldquo;{person.resolution.reason}&rdquo;
                    </p>
                  ) : null}
                  {answeredThemselves && live ? (
                    <p className="v3dr-guard">
                      {person.name} answered on their own link. An operator note cannot be recorded over
                      their own word.
                    </p>
                  ) : null}
                  {canRecord ? (
                    <>
                      <button type="button" className="v3dr-disc" aria-expanded={open}
                        onClick={() => setOpenFor((prev) => ({ ...prev, [person.name]: !open }))}
                        title={`Record what ${person.name} said, or waive/delegate their review`}>
                        record, waive or delegate — {person.name}
                      </button>
                      {open ? (
                        <div className="v3dr-panel">
                          <div className="v3dr-verdicts" role="group" aria-label={`What ${person.name} said about the design`}>
                            {(["approved", "changes"] as const).map((value) => (
                              <button key={value} type="button"
                                className={`v3dr-vbtn${verdictPick[person.name] === value ? " on" : ""}`}
                                aria-pressed={verdictPick[person.name] === value}
                                onClick={() => setVerdictPick((prev) => ({ ...prev, [person.name]: value }))}>
                                {value === "approved" ? "approved the design" : "asked for changes"}
                                <span className="v3dr-vwho"> — {person.name}</span>
                              </button>
                            ))}
                          </div>
                          {/* The model REFUSES an operator capture with no basis. The UI
                              collects it rather than discovering the refusal. */}
                          <label className="v3dr-field">
                            <span>What {person.name} said, and where — required, you are attesting to it</span>
                            <textarea rows={2} value={basis[person.name] ?? ""}
                              onChange={(e) => setBasis((prev) => ({ ...prev, [person.name]: e.target.value }))} />
                          </label>
                          <button type="button" className="v3dl-mini"
                            disabled={busy || !(basis[person.name] ?? "").trim() || !verdictPick[person.name]}
                            title={!(basis[person.name] ?? "").trim()
                              ? `Say what ${person.name} said — an operator capture with no basis is not evidence`
                              : `Record ${person.name}'s verdict under your own attestation`}
                            onClick={() => void run({
                              op: "verdict", roundId: round.id, who: person.name,
                              verdict: verdictPick[person.name], attestation: "operator",
                              text: (basis[person.name] ?? "").trim(),
                              source: meeting ? "meeting" : undefined,
                            }, `Recorded ${person.name}'s verdict — attested by you.`)}>
                            record {person.name}&rsquo;s verdict as the operator
                          </button>
                          <label className="v3dr-field">
                            <span>Why {person.name} will not answer — required for a waiver or a delegation</span>
                            <input value={reason[person.name] ?? ""}
                              onChange={(e) => setReason((prev) => ({ ...prev, [person.name]: e.target.value }))} />
                          </label>
                          <div className="v3dr-escape">
                            <button type="button" className="v3dl-mini"
                              disabled={busy || (reason[person.name] ?? "").trim().length < 4}
                              title={`Close the round without ${person.name}'s word — the reason stays on the record and it is never counted as an approval`}
                              onClick={() => void run({
                                op: "waive", roundId: round.id, who: person.name,
                                reason: (reason[person.name] ?? "").trim(),
                              }, `Waived ${person.name} — on the record.`)}>
                              waive {person.name}
                            </button>
                            <label className="v3dr-field inline">
                              <span>Who answers in place of {person.name}</span>
                              <input value={delegateTo[person.name] ?? ""}
                                onChange={(e) => setDelegateTo((prev) => ({ ...prev, [person.name]: e.target.value }))} />
                            </label>
                            <button type="button" className="v3dl-mini"
                              disabled={busy || (reason[person.name] ?? "").trim().length < 4 || !(delegateTo[person.name] ?? "").trim()}
                              title={`Hand ${person.name}'s review to a named other, who joins the roster and answers in their place`}
                              onClick={() => void run({
                                op: "delegate", roundId: round.id, who: person.name,
                                to: { name: (delegateTo[person.name] ?? "").trim() },
                                reason: (reason[person.name] ?? "").trim(),
                              }, `${person.name}'s review delegated.`)}>
                              delegate {person.name}&rsquo;s review
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function DesignLoopZones({ band, program, ledger, roster, onOpen, onRegen, onGenerate, onMintReview, onDesignRound, regenBusy, genBusy }: Props) {
  const stationOf = (id: string) => band.stations.find((s) => s.id === id);
  // The prototype is an operator artifact and stays in the operator zone — but
  // it is the RUNNING APPLICATION, not a document, so it gets the band's own
  // stage below the documents rather than a fourth identical tile beside them.
  const opStations = band.stations.filter((s) => ZONE_OF[s.id]?.zone === "operator" && s.id !== "prototype");
  const prototype = stationOf("prototype");
  const validation = stationOf("validation");

  // stakeholder queue: open unknowns owned by a role (not unowned/blocked) — Listen's
  // burn-down, stated here as ONE line with a way to the surface that works it.
  // Assertions on record = the honest heard-count (0 stakeholder asserts in the
  // read-only model, which is UNKNOWN rather than none — see the foot).
  const stakeholderAsserts = ledger.ownership.stakeholder; // 0 in-browser (write path gated)
  // A movement whose gate is recorded has its inputs frozen — the same rule the Kit
  // matrix reads. A locked Design Loop opens no round and records no verdict.
  const locked = DESIGN_LOOP_MOVEMENT_IDS.some((id) => program.gateReviews?.[id]?.status === "approved");

  return (
    <div className="v3dl">
      {/* CONVERGENCE AND HEARD ARE NOT DRAWN HERE. They are PROGRAMME-wide numbers,
          and this is one band among several on the Work board — a programme number
          in a band-scoped position reads as that band's progress, which it never
          was. They were also printed identically ~570px above, in TheLine's Work
          strip, where the Heard figure is a button that jumps to Discovery. One
          number, one home, and the home is the one you can act from. */}

      {/* ZONE 1 — operator builds it, in dependency order */}
      <section className="v3dl-zone is-operator" aria-label="Operator builds it">
        {/* NO OWNERSHIP CHIP BESIDE A HEADING THAT SAYS THE SAME WORD (operator
            direction). "operator · Operator builds it" spends a badge on a fact
            the sentence next to it already states; the zone's own left border
            still carries the class. The chip stays where it ADDS something —
            the deviations band below, whose heading does not say "joint", and
            each tile, where it distinguishes joint work from operator work. */}
        <header className="v3dl-zone-h">
          <span className="v3dl-zone-t">Operator builds it</span>
          <ZoneHelp label="how the build zone works">
            <p>
              Each of these is <b>decided with basis</b> — a decision re-derived from the claims under
              it, not a blob that goes stale and gets refreshed. A stakeholder may <b>question</b> one:
              it routes to the owning role as a proposal and never edits the artifact, and the capture
              lives on their own link.
            </p>
            <p>
              Experience Design is <b>joint</b>. Stakeholders assert what the experience must do; this
              document is what actually renders. Where the two disagree the gap is a deviation, and the
              deviation section appears below as soon as there is one to settle.
            </p>
            <p>
              A stakeholder&rsquo;s <SourceTag source="asserted" /> refinement wins over the
              operator&rsquo;s <SourceTag source="generated" /> regeneration — the ledger keeps the
              assertion, never the re-gen.
            </p>
          </ZoneHelp>
        </header>
        <div className="v3dl-tiles">
          {opStations.map((s) => (
            <OperatorTile key={s.id} station={s} role={ZONE_OF[s.id]?.role ?? "Design team"}
              owned={ZONE_OF[s.id]?.owned ?? "operator"}
              onOpen={onOpen} onRegen={onRegen} onGenerate={onGenerate}
              regenerating={!!(s.card && regenBusy[s.card.id])} generating={!!(s.card && genBusy[s.card.id])} />
          ))}
        </div>
        {/* …and what those three documents are FOR. */}
        {prototype ? (
          <PrototypeStage station={prototype} program={program} onOpen={onOpen} onRegen={onRegen} onGenerate={onGenerate}
            regenerating={!!(prototype.card && regenBusy[prototype.card.id])}
            generating={!!(prototype.card && genBusy[prototype.card.id])} />
        ) : null}
      </section>

      {/* ZONE 2 — stakeholders APPROVE it. The round is the zone: N stakeholders
          reviewing the same design at once, and the loop closes when every one of
          them has approved or is resolved on the record. */}
      <section className="v3dl-zone is-stakeholder" aria-label="Stakeholders approve it — the design review round">
        <header className="v3dl-zone-h">
          <span className="v3dl-zone-t">Stakeholders approve it</span>
          {validation?.card ? (
            <button type="button" className="v3dl-goal-open" onClick={() => onOpen(validation.card!)}
              title="Open the demo script — what each stakeholder is walked through, their verdict, and sign-off">
              demo script
            </button>
          ) : null}
          <ZoneHelp label="how the review round works">
            <p>
              The prototype and each stakeholder&rsquo;s demo script go out — jointly in a meeting or
              each on their own link — and the loop closes when every stakeholder in the round has
              approved, or is waived or delegated on the record.
            </p>
            <p>
              A verdict you record is <b>attested by you</b> and is kept apart from the person&rsquo;s own
              word permanently. Waive and delegate are the only ways past someone who will not answer,
              and both need a reason that stays on the record.
            </p>
          </ZoneHelp>
        </header>
        <DesignRoundZone program={program} roster={roster} locked={locked}
          onMintReview={onMintReview} onDesignRound={onDesignRound} />
      </section>

      {/* ZONE 3 — DEVIATIONS, and only when there are some. A precedence rule is not a
          place you go; an as-is → to-be gap between asserted intent and the rendered
          design is. With none on record this section does not draw, and the foot below
          says so by name. */}
      {ledger.devs.length ? (
        <section className="v3dl-zone is-joint" aria-label="Deviations to settle — asserted intent against the rendered design">
          <header className="v3dl-zone-h">
            <OwnershipTag cls="joint" />
            <span className="v3dl-zone-t">Deviations to settle</span>
            <span className="v3dl-zone-d">
              {ledger.devs.length} on record{stakeholderAsserts ? ` · ${stakeholderAsserts} asserted intent${stakeholderAsserts === 1 ? "" : "s"}` : ""}
            </span>
            <ZoneHelp label="how a deviation is settled">
              <p>
                What stakeholders asserted the experience must do is <b>intent</b>; what the Experience
                Design document renders is the <b>design</b>. Asserted intent wins over a render that
                drifts from it, and every gap between the two is listed here until it is settled.
              </p>
            </ZoneHelp>
          </header>
          <div className="v3dl-devreg">
            <span className="v3dl-devreg-t">recorded deviations</span>
            <ul className="v3dl-devlist">
              {ledger.devs.slice(0, 5).map((d) => (
                <li key={d.about}>
                  <code>{d.about.replace(/^el:/, "")}</code>
                  <span className="v3dl-devvals">{d.asIs} <span aria-hidden="true">→</span> <span className="v3lc-sr">becomes </span>{d.toBe}</span>
                  <DeviationMarker classification={d.classification} stillReferenced={d.stillReferenced} />
                </li>
              ))}
              {ledger.devs.length > 5 ? <li className="v3dl-devmore">+{ledger.devs.length - 5} more on the Experience Design document</li> : null}
            </ul>
          </div>
        </section>
      ) : null}

      {/* THE FOOT — two quiet lines, and each one earns its place.
          (1) WHAT IS NOT DRAWN, named. A hidden zero-count section is the house rule,
              but a blank space with no account of itself is indistinguishable from a
              broken surface. This says which sections are absent and why, and it keeps
              EMPTY apart from UNKNOWN: no deviations is a real zero; no stakeholder
              assertion is a write path that is not wired.
          (2) WHERE THE OTHER LOOP IS. Role-owned open questions are Listen's burn-down.
              One line, one number, one way there — not a second copy of Discover's own
              split, and not a second job for the approval zone above. */}
      {/* THE FOOT IS GONE (on request, 2026-08-13). Two blocks lived here and
          neither survived its own reason for existing:

          · "Not drawn — nothing on record" reported ABSENCES — no deviation on this
            programme, and a stakeholder write path that is gated. Both are true, and
            neither is something the operator does anything about; a design round is
            not the place to be told what a different, unbuilt path would carry.

          · The "N open questions are owned by someone" line pointed at Listen's work
            from inside the design round. It was already the wrong number twice over
            (it counted the dictionary bucket and called itself the burn-down, both
            fixed earlier today) — and the questions it names are on the person cards
            in Discover, one click away, where they can actually be sent. */}
    </div>
  );
}
