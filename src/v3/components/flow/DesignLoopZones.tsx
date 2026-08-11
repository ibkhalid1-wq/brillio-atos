/**
 * The Design Loop as a LEDGER SURFACE — three ownership zones keyed to source
 * class, replacing the old "four artifact cards with needs-refresh buttons over a
 * 0-of-10-converged counter".
 *
 * The ledger already encodes who-does-what by SOURCE CLASS; this surface reads it
 * rather than inventing a taxonomy:
 *   · Operator builds it   — decision/dispositioned (Architecture, Blueprint,
 *     Prototype generation). Decided-with-basis, not refreshable blobs. A
 *     stakeholder can QUESTION a decision (routes as a proposal naming the owning
 *     role) but can't edit.
 *   · Stakeholders shape it — asserted (Validation sign-off = the loop's GOAL
 *     state, promoted out of the footer; answering owned unknowns = the queue).
 *   · Joint                — a locus with both (Experience Design as intent-
 *     asserted vs design-rendered, the deviation register between them; Prototype
 *     refinement, where a stakeholder assertion wins over operator regeneration).
 *
 * HONESTY: read-only in-browser migrate. Stakeholder `asserted` closures arrive
 * through the store write path, not wired here — so the "stakeholders shape it"
 * zone reads 0 assertions today. That 0 is the truth of the read model, marked
 * provisional/gated, NEVER dressed up as convergence the ledger doesn't have.
 */
import { useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import type { LineBand, LineStation } from "@/v3/lib/lineModel";
import type { ArtifactCardModel } from "@/v3/components/flow/flowShellData";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import type { Routing } from "@/v3/lib/ledger/projections";
import {
  DESIGN_LOOP_MOVEMENT_IDS, designRoundGate, designRoundReviewInput, readDesignVersion,
  type DesignParticipantState, type DesignRoundPerson,
} from "@/v3/components/flow/flowDesignRound";
import {
  OwnershipTag, HeardReadout, ConvergenceReadout, ProvisionalMark,
  ClaimStatus, SourceTag, DeviationMarker,
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

/** Which zone each loop station belongs to, and (for the operator zone) the role
 *  a question routes to — the ledger's owner for that class of decision. */
const ZONE_OF: Record<string, { zone: "operator" | "stakeholder" | "joint"; role?: string }> = {
  "architecture-strategy": { zone: "operator", role: "Architect" },
  "agentic-blueprint": { zone: "operator", role: "Architect" },
  prototype: { zone: "operator", role: "Design team" },
  validation: { zone: "stakeholder" },
  "experience-design": { zone: "joint", role: "Design team" },
};

/** One operator-built artifact: decided-with-basis, not a refreshable blob. No
 *  "needs refresh" — its state reads as present/draft + ownership, and a
 *  stakeholder may question it (routes, never edits). */
function OperatorTile({ station, role, onOpen, onRegen, onGenerate, regenerating, generating }: {
  station: LineStation; role: string;
  onOpen: Props["onOpen"]; onRegen?: Props["onRegen"]; onGenerate?: Props["onGenerate"];
  regenerating: boolean; generating: boolean;
}) {
  const present = !!station.card?.present;
  const canGen = !present && !!station.canGenerate && !!station.card && !!onGenerate;
  const evidenceMoved = present && station.needsRefresh; // was "needs refresh"
  return (
    <div className={`v3dl-tile${present ? " present" : ""}`}>
      <button type="button" className="v3dl-tile-open" disabled={!present && !canGen}
        title={present ? `Open ${station.title}` : canGen ? `Generate ${station.title} — its inputs are ready` : `${station.title} — not built yet`}
        onClick={() => { if (present && station.card) onOpen(station.card); else if (canGen && !generating) onGenerate!(station.card!); }}>
        <span className="v3dl-tile-h">
          <span className="v3dl-tile-n">{station.title}</span>
          <OwnershipTag cls="operator" showLabel={false} />
        </span>
        <span className="v3dl-tile-sub">{station.subtitle}</span>
        {/* claim state replaces "needs refresh": present decisions read decided;
            an unbuilt tile reads its readiness; a moved-evidence tile names what
            actually changed (the claims under it), never "refresh". */}
        <span className="v3dl-tile-state">
          {present ? (
            evidenceMoved ? (
              <span className="v3dl-moved" title="the claims this decision rests on have moved — rebuild to re-ground it">
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
 * The DESIGN REVIEW ROUND — zone 2's whole content
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
    <div className="v3dr">
      {/* THE GATE, in the band. Tone, label and detail come from designRoundGate —
          no second sentence about the same fact. */}
      <div className={`v3dr-gate tone-${gate.tone}`} role="note" aria-label="Design review round gate">
        <span className="v3dr-gate-dot" aria-hidden="true" />
        <span className="v3dr-gate-l">{gate.label}</span>
        {gate.detail ? <span className="v3dr-gate-d">{gate.detail}</span> : null}
      </div>

      {round ? (
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

          <ul className="v3dr-people" aria-label={`Round ${rollup.ordinal} — every stakeholder asked`}>
            {rollup.people.map((person) => {
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
      ) : (
        /* NO ROUND — not started. Never a pass, never a count that isn't there. */
        <div className="v3dr-empty">
          <p className="v3dr-empty-t">No design review round has been opened. Nothing is approved and nothing has failed — nobody has been asked.</p>
          {canWrite ? (
            <>
              <button type="button" className="v3dl-mini" aria-expanded={picking}
                disabled={!design.hasPrototype || !rosterChoices.length}
                onClick={() => setPicking((on) => !on)}
                title={!design.hasPrototype
                  ? "Build the prototype first — a round is about a design version"
                  : !rosterChoices.length ? "No named stakeholder on the roster yet"
                    : "Pick who reviews the design, then open the round"}>
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
                  {rosterChoices.length ? null : <p className="v3dr-empty-t">No named stakeholder on the roster yet — cast the Discovery Kit first.</p>}
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
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function DesignLoopZones({ band, program, ledger, roster, onOpen, onRegen, onGenerate, onMintReview, onDesignRound, regenBusy, genBusy }: Props) {
  const stationOf = (id: string) => band.stations.find((s) => s.id === id);
  const opStations = band.stations.filter((s) => ZONE_OF[s.id]?.zone === "operator");
  const validation = stationOf("validation");
  const experience = stationOf("experience-design");
  const proto = stationOf("prototype");

  // stakeholder queue: open unknowns owned by a role (not unowned/blocked) — the
  // discovery-kit questions a stakeholder answers. Assertions on record = the
  // honest heard-count (0 stakeholder asserts in the read-only model).
  const stakeholderOpen = ledger.queue.counts.blocking + ledger.queue.counts["answerable-without-a-meeting"];
  const stakeholderAsserts = ledger.ownership.stakeholder; // 0 in-browser (write path gated)
  // A movement whose gate is recorded has its inputs frozen — the same rule the Kit
  // matrix reads. A locked Design Loop opens no round and records no verdict.
  const locked = DESIGN_LOOP_MOVEMENT_IDS.some((id) => program.gateReviews?.[id]?.status === "approved");

  // ── the stakeholder queue as a WORK QUEUE — each headline number drills through
  // to the questions it counts (not a dead affordance). "owned" = blocking+answerable
  // (the role-owned open set); each segment filters to its routing set. Filtered off
  // the one queue projection, phrased plain-language. ──
  const [drill, setDrill] = useState<null | "owned" | Routing>(null);
  const drillItems = useMemo(() => {
    if (!drill) return [];
    const match = (r: Routing) => drill === "owned" ? (r === "blocking" || r === "answerable-without-a-meeting") : r === drill;
    return ledger.queue.items.filter((i) => match(i.routing) && i.owner.kind === "role")
      .map((i) => { const r = renderQuestion(ledger.store, i.about, "operator"); return { ...i, question: r.question, typeTag: r.label, name: r.elementName }; });
  }, [drill, ledger.queue.items, ledger.store]);
  const DrillBtn = ({ k, n, label }: { k: "owned" | Routing; n: number; label: string }) => (
    <button type="button" className={`v3dl-drillbtn${drill === k ? " on" : ""}`} aria-pressed={drill === k}
      disabled={n === 0}
      title={n === 0 ? `No ${label} questions` : `Show the ${n} ${label} question${n === 1 ? "" : "s"}`}
      onClick={() => setDrill(drill === k ? null : k)}>
      <b>{n}</b> {label}{n > 0 ? <span className="v3dl-drillchev" aria-hidden="true">{drill === k ? " ▴" : " ▾"}</span> : null}
    </button>
  );

  return (
    <div className="v3dl">
      {/* convergence promoted to the header — real closures, not a 0-of-10 counter */}
      <div className="v3dl-head">
        <div className="v3dl-conv">
          <span className="v3dl-conv-lbl">Convergence</span>
          <ConvergenceReadout burnDown={ledger.kit.burnDown} />
        </div>
        <div className="v3dl-conv">
          <span className="v3dl-conv-lbl">Heard</span>
          <HeardReadout heard={ledger.heard} />
        </div>
      </div>

      {/* ZONE 1 — operator builds it */}
      <section className="v3dl-zone is-operator" aria-label="Operator builds it">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="operator" />
          <span className="v3dl-zone-t">Operator builds it</span>
          <span className="v3dl-zone-d">decided with basis — Architecture, Blueprint, Prototype. Questionable, not editable.</span>
        </header>
        <div className="v3dl-tiles">
          {opStations.map((s) => (
            <OperatorTile key={s.id} station={s} role={ZONE_OF[s.id]?.role ?? "Design team"}
              onOpen={onOpen} onRegen={onRegen} onGenerate={onGenerate}
              regenerating={!!(s.card && regenBusy[s.card.id])} generating={!!(s.card && genBusy[s.card.id])} />
          ))}
        </div>
      </section>

      {/* ZONE 2 — stakeholders APPROVE it. The round is the zone: N stakeholders
          reviewing the same design at once, and the loop closes when every one of
          them has approved or is resolved on the record. */}
      <section className="v3dl-zone is-stakeholder" aria-label="Stakeholders approve it — the design review round">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="stakeholder" />
          <span className="v3dl-zone-t">Stakeholders approve it</span>
          {validation?.card ? (
            <button type="button" className="v3dl-goal-open" onClick={() => onOpen(validation.card!)}
              title="Open Validation — per-stakeholder demo verdicts and sign-off">
              open Validation
            </button>
          ) : null}
          <span className="v3dl-zone-d">The prototype and their demo scripts go out — jointly in a meeting or each on their own link — and the loop closes when every stakeholder in the round has approved, or is waived or delegated on the record.</span>
        </header>
        <DesignRoundZone program={program} roster={roster} locked={locked}
          onMintReview={onMintReview} onDesignRound={onDesignRound} />
        <div className="v3dl-shape one">
          <div className="v3dl-queue">
            <span className="v3dl-queue-t">Owned questions awaiting a stakeholder — a work queue, click to drill in</span>
            {/* THE work — each number drills to the questions it counts, filtered by
                that operator action. Not a dead affordance. */}
            <span className="v3dl-queue-n"><DrillBtn k="owned" n={stakeholderOpen} label="open unknowns owned by a role" /></span>
            <span className="v3dl-queue-sub">
              <ClaimStatus state="open" showLabel={false} />
              <DrillBtn k="blocking" n={ledger.queue.counts.blocking} label="blocking — gates the Architect" /> ·
              <DrillBtn k="answerable-without-a-meeting" n={ledger.queue.counts["answerable-without-a-meeting"]} label="answerable — send a link now" /> ·
              <DrillBtn k="blocked" n={ledger.queue.counts.blocked} label="blocked — needs unsticking" />
            </span>
            {drill ? (
              <ul className="v3dl-drilllist" aria-label={`${drill} questions`}>
                {drillItems.slice(0, 24).map((it) => (
                  <li key={it.about} title={it.about}>
                    <span className="v3dl-drill-type">{it.typeTag}</span>
                    <span className="v3dl-drill-q">{it.question}</span>
                    <span className="v3dl-drill-owner"><span aria-hidden="true">→ </span>owner: {it.ownerLabel}</span>
                  </li>
                ))}
                {drillItems.length > 24 ? <li className="v3dl-drill-more">+{drillItems.length - 24} more — work them in the Discover inbox</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {/* ZONE 3 — joint (Experience Design split + Prototype refinement) */}
      <section className="v3dl-zone is-joint" aria-label="Joint — operator and stakeholder">
        <header className="v3dl-zone-h">
          <OwnershipTag cls="joint" />
          <span className="v3dl-zone-t">Joint — designed together</span>
          <span className="v3dl-zone-d">Experience Design as intent vs render, with the deviation register between them.</span>
        </header>
        <div className="v3dl-split">
          <div className="v3dl-split-col">
            <span className="v3dl-split-lbl"><OwnershipTag cls="stakeholder" showLabel={false} /> Intent — asserted</span>
            <p className="v3dl-split-body">What stakeholders said the experience must do. Asserted intent wins over a render that drifts from it.</p>
            <span className="v3dl-split-num"><b>{stakeholderAsserts}</b> asserted intents <ProvisionalMark what="intent assertions arrive on the stakeholder write path (gated)" /></span>
          </div>
          <div className="v3dl-devreg" aria-label="deviation register">
            <span className="v3dl-devreg-t">Deviation register</span>
            {ledger.devs.length ? (
              <ul className="v3dl-devlist">
                {ledger.devs.slice(0, 5).map((d) => (
                  <li key={d.about}>
                    <code>{d.about.replace(/^el:/, "")}</code>
                    <span className="v3dl-devvals">{d.asIs} <span aria-hidden="true">→</span> <span className="v3lc-sr">becomes </span>{d.toBe}</span>
                    <DeviationMarker classification={d.classification} stillReferenced={d.stillReferenced} />
                  </li>
                ))}
              </ul>
            ) : <p className="v3dl-devempty">No as-is → to-be deviations on record for this program.</p>}
          </div>
          <div className="v3dl-split-col">
            <span className="v3dl-split-lbl"><OwnershipTag cls="operator" showLabel={false} /> Render — designed</span>
            <p className="v3dl-split-body">What the Experience Design document actually renders. A render deviating from asserted intent shows up in the register.</p>
            {experience?.card ? (
              <button type="button" className="v3dl-mini" onClick={() => onOpen(experience.card!)}
                title="Open Experience Design">open Experience Design<span aria-hidden="true"> →</span></button>
            ) : <span className="v3dl-split-num"><ClaimStatus state="open" showLabel={false} /> not rendered yet</span>}
          </div>
        </div>
        <div className="v3dl-refine">
          <span className="v3dl-refine-t">Prototype refinement</span>
          <span className="v3dl-refine-body">
            A stakeholder&apos;s <SourceTag source="asserted" /> refinement wins over the operator&apos;s <SourceTag source="generated" /> regeneration —
            the ledger keeps the assertion, never the re-gen.
          </span>
          <span className="v3dl-refine-num">
            <b>{stakeholderAsserts}</b> stakeholder refinements · {proto?.card?.present ? "prototype built (generated)" : "prototype not built"}
            <ProvisionalMark what="refinement is a stakeholder assertion on the gated write path; all prototype content is generated today" />
          </span>
        </div>
      </section>
    </div>
  );
}
