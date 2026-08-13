/**
 * The operator inbox — the SUBSET of the ledger that needs an operator move (the
 * burn-down goal lives above it). Four sources, each with its verb, plus reassignment
 * (both directions) and the stakeholder's three exits as the operator-capture interim.
 *
 *   1. Unowned, owner exists  → ASSIGN       (buildable now; grouped by element, cascades)
 *   2. Unowned, no one owns it → DECIDE FATE  (buildable now — out-of-scope / escalate)
 *   3. Seams                   → mark for a joint SESSION (buildable now; scheduling gated)
 *   4. Conflicts               → ADJUDICATE    (read-side now; resolution gated)
 *
 * LEGIBILITY: every locus renders as a plain-language QUESTION (its raw id is on hover),
 * derived in `phrasing.ts`. Labels say only what the action does — "mark for joint
 * session" records intent, not a booked calendar event.
 *
 * HEARD BOUNDARY held HARD: only a genuine stakeholder ANSWER through the (gated) system
 * ticks heard. Assign, reassign, decide-fate, mark-session, redirect, release and
 * operator-captured entries never do — none is injected into the store heard reads.
 */
import { useRef, useState, type ReactNode, useMemo } from "react";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import type { OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { slotOf, elementIdOf } from "@/v3/lib/ledger/types";
import { readableName } from "@/v3/lib/ledger/phrasing";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { attributeEvidence } from "@/v3/lib/ledger/derivedTypes";
import { lifecycleEntities } from "@/v3/lib/ledger/lifecycle";
import { ClaimStatus, OwnershipTag, ProvisionalMark, SourceTag } from "@/v3/components/flow/studio/ledgerPrimitives";
import { asksNeedingChase, isSystemOwner, type ArtifactAskMark } from "@/v3/lib/ledger/artifactAsks";
import { operatorQueueCounts, sessionQuestionCount, unfrozenQueues } from "@/v3/lib/ledger/operatorQueue";
import { parseDictionaryCsv, isSpreadsheetName, readDictionaryWorkbook, mergeDictionaryCsv, dictionaryCoverage, SPREADSHEET_EXTENSIONS } from "@/v3/lib/ledger/dictionary";
import TypingGrid, { type TypingRow } from "@/v3/components/flow/TypingGrid";
import { ownerLabelsForCast } from "@/v3/lib/ledger/ownerBinding";
import { unboundOwners, unboundOpenTotal } from "@/v3/lib/ledger/ownedLoad";
import { retractProposal } from "@/v3/lib/ledger/curation";
import { displayPersonLabel } from "@/v3/components/flow/flowStakeholders";

interface Candidate { label: string; role: string }
interface Props {
  ledger: ProgramLedger;
  candidates: Candidate[];
  by: string;
  onCommit: (action: OperatorAction | OperatorAction[]) => Promise<void>;
  /** Record an artifact-ask mark (requested / has-none) — the `_artifactAsks`
   *  underscore-field write, same silent-save channel as operator actions. */
  onAskMark?: (mark: ArtifactAskMark) => void;
  /** Attach the client's data dictionary (CSV text) — the WRITE half of the SoR
   *  ask. Without it the inbox asks for an upload with no door to open. `sor` names
   *  the system this file belongs to; null is the programme-wide dictionary. */
  onDictionary?: (csv: string, sor?: string | null) => void | Promise<void>;
}

const nowISO = () => new Date().toISOString();
const OTHER = "__other__";

/**
 * The SPOKEN form of a label. The programme's own element names carry relationship
 * glyphs — "Opportunity→Quote", "Sales Ops⋈Finance" — which a screen reader reads as
 * "Opportunity rightwards arrow Quote". The glyph is real content (it is part of the
 * client's ontology, not our decoration), so it stays on screen; this renders the same
 * meaning in words for the accessible name only.
 */
const spoken = (text: string) => text
  .replace(/\s*→\s*/g, " to ")
  .replace(/\s*⋈\s*/g, " and ")
  .replace(/\s*·\s*/g, ", ")
  .replace(/\s+/g, " ")
  .trim();

/**
 * SESSIONS — the seam queue, collapsed to ONE line by default.
 *
 * WHY THE SECTION EXISTS AT ALL: a seam locus is JOINTLY owned, and useProgramLedger
 * excludes joint owners from `soloByOwner` (the joint branch pushes to sessionMap and
 * continues), so a seam question appears on NO individual's Discover list. This panel is
 * its only home. It is never deleted and its count never goes dark.
 *
 * WHY IT COLLAPSES: on Laila it rendered 8 pair cards whose single control is "propose a
 * time", and scheduling is GATED — that button records intent and books nothing. Eight
 * cards of a verb that cannot complete out-shouted the sections an operator can actually
 * finish. The problem was presentation only, so presentation is the whole fix; every
 * expanded row below is unchanged.
 *
 * ONE READ, TWO READINGS: `sessionQueue` is the only array here. `seams` is its length,
 * `questions` is `sessionQuestionCount` — the SAME function the Inbox header's sessions
 * stat is computed from, so the two numbers on this screen cannot say different things.
 * (They did: the header read seams under a row-wide "· questions" suffix — "11 awaiting a
 * date · questions" — fifteen lines above this line's "11 seams, 49 questions".)
 * Collapsed, the summary IS the rows added up; expanded, the rows ARE the summary broken
 * out. No second copy of either number is kept anywhere.
 *
 * UNIT IS QUESTIONS: a seam is a container, a question is the work. "8 seams" alone reads
 * like eight small things; "23 questions" is what those eight seams actually owe, and it
 * is the unit the inbox header and the burn-down already speak in.
 *
 * COLLAPSED BY DEFAULT, NOT PERSISTED: a presentation default, not an operator preference
 * — re-collapsing on reload loses nothing, because both numbers stay on the summary line.
 * A real <button> with aria-expanded carries the disclosure, so the keyboard reaches the
 * rows exactly the way the mouse does.
 */
export function SessionsSection({ sessionQueue, plannedPairs, busy, onPropose }: {
  sessionQueue: ProgramLedger["sessionQueue"];
  plannedPairs: ReadonlySet<string>;
  busy: string | null;
  onPropose: (pair: string, abouts: string[]) => void;
}) {
  // EMPTY-STATE: 0 seams → section HIDDEN (by request, 2026-08-10) — rule unchanged.
  if (sessionQueue.length === 0) return null;
  const seams = sessionQueue.length;
  const questions = sessionQuestionCount(sessionQueue);   // === the header's sessions stat
  return (
    <IbSection id="ib-sessions" kind="schedule" verb="Sessions" count={questions} unit="question" defaultOpen={false}
      tag={<OwnershipTag cls="joint" showLabel={false} />}
      badge={<>{seams} seam{seams === 1 ? "" : "s"}, {questions} question{questions === 1 ? "" : "s"}</>}
      /* THE SEAM IS A SIGHT, NOT A BLOCKER. These questions now go out on BOTH
         owners' links like any other (useProgramLedger's loop) — they are not held
         waiting on a room. If the two answer the same, it settles itself; if they
         differ, the contradiction watcher files it and it comes back as something to
         adjudicate. The session is the operator's option for a disagreement they can
         see coming, not the only path through. */
      lead={<>Owned by two functions at once, so both are asked. They settle themselves if
        the answers agree — propose a session only if you would rather they talked first.</>}
      provisional="proposing a session records the intent only — no date is booked, and nothing is waiting on one">
      {/* The per-pair rows, unchanged — pair, joint-question count,
          awaiting-a-date, propose-a-time. Joint ownership is AUTO-SET at seam detection
          (migrate: jointOrOwner), so there is nothing to "mark"; the only pending thing
          is a DATE, which is gated. */}
      <ul id="ib-sessions-rows" className="v3ib-seams">
          {sessionQueue.map(({ pair, abouts }) => {
            const planned = plannedPairs.has(pair);
            return (
              <li key={pair} className={`v3ib-seam${planned ? " planned" : ""}`}>
                <span className="v3ib-seam-h"><span aria-hidden="true">⋈</span> <span className="v3ib-sr">joint seam: </span>{pair}</span>
                <span className="v3ib-seam-n">{abouts.length} joint question{abouts.length === 1 ? "" : "s"} · <span className="v3ib-nodate"><span aria-hidden="true">⏳ </span>awaiting a date</span></span>
                {planned ? (
                  <span className="v3ib-onplan">a session is proposed · no date yet (gated)</span>
                ) : (
                  <button type="button" className="v3ib-btn ghost" disabled={busy === pair}
                    aria-label={spoken(`Propose a time for the ${pair} joint session (${abouts.length} question${abouts.length === 1 ? "" : "s"})`)}
                    onClick={() => onPropose(pair, abouts)}>{busy === pair ? "…" : "propose a time"}</button>
                )}
              </li>
            );
          })}
      </ul>
    </IbSection>
  );
}

/**
 * ONE HEADER FOR EVERY SECTION OF THIS INBOX.
 *
 * Eight sections had grown eight headers. Measured before this existed: five carried
 * an ownership or source tag and three did not; one collapsed and seven could not;
 * seven bolded their count and "Decided" printed a bare number in prose. Nothing was
 * wrong with any one of them, which is exactly why it drifted — a header is written
 * once, beside the section it belongs to, and the next one is written the same way
 * only if somebody remembers.
 *
 * So the contract is structural: a TAG saying whose claim this is, the VERB, the
 * COUNT of what the section holds, the LEAD explaining it, an optional provisional
 * mark, and a disclosure that collapses the body. A section that wants extra controls
 * passes them; it cannot skip the parts every section owes the reader.
 */
/**
 * ONE CARD FOR EVERY BLOCK INSIDE A SECTION, AND TWO KINDS OF BUTTON.
 *
 * Reported: "review 18, confirm the types here, chase crm again, and show 37 all
 * behave differently." They did. All four were `.v3ib-btn ghost sm` — the same
 * control, to look at — while one toggled a grid open, one toggled a different grid,
 * one WROTE to the record on a single click, and one opened a modal. Four verbs
 * wearing one costume, in four containers (`-derivedtypes`, `-ask`, `-answerhere`,
 * `-settled`) that had drifted into four shapes.
 *
 * So a block is a CARD — title, count, note, actions, and an optional body that the
 * card itself expands — and the actions divide into exactly two kinds:
 *
 *   REVEAL   shows more of what is already on the record. Ghost button, `aria-expanded`,
 *            label flips to "hide", and the detail opens INSIDE this card. Never a
 *            modal: a modal for one reveal and an inline panel for the next is the
 *            inconsistency this exists to end.
 *   WRITE    changes the record. Filled button, stated in the imperative, and it is
 *            the only kind that can surprise you — so it never looks like a reveal.
 */
function IbCard({ title, note, reveal, writes, tone, marker, children }: {
  title: ReactNode;
  /** A semantic marker class the card keeps beyond its styling — the badge-equals-page
   *  guard counts the no-SoR residue as one waiting item, and it must stay findable
   *  when the block's presentation changes. */
  marker?: string;
  note?: ReactNode;
  /** The one reveal this card offers, if any: its label, its state, its toggle. */
  reveal?: { label: string; open: boolean; onToggle: () => void; hideLabel?: string };
  /** Buttons that CHANGE the record. Rendered filled, after the reveal. */
  writes?: ReactNode;
  /** `settled` for a finished block, `muted` for one that is waiting on something else. */
  tone?: "settled" | "muted";
  /** The revealed detail — rendered only while `reveal.open`. */
  children?: ReactNode;
}) {
  return (
    <div className={`v3ib-card${tone ? ` is-${tone}` : ""}${marker ? ` ${marker}` : ""}`}>
      <span className="v3ib-card-t">{title}</span>
      {note ? <span className="v3ib-card-m">{note}</span> : null}
      {reveal || writes ? (
        <span className="v3ib-card-a">
          {reveal ? (
            <button type="button" className="v3ib-btn ghost sm" aria-expanded={reveal.open}
              onClick={reveal.onToggle}>
              {reveal.open ? (reveal.hideLabel ?? "hide") : reveal.label}
            </button>
          ) : null}
          {writes}
        </span>
      ) : null}
      {reveal?.open ? <div className="v3ib-card-body">{children}</div> : null}
    </div>
  );
}

function IbSection({ id, className, kind, tag, verb, count, unit, unitPlural, badge, lead, provisional, actions, defaultOpen = true, children }: {
  id?: string;
  /**
   * WHICH OF THE OPERATOR'S FOUR MOVES this section is asking for. It sets a hairline
   * accent down the section's left edge, so the board can be sorted by kind of
   * decision before a word is read — which is what an operator triaging fifty items
   * actually does first. Colour is the only thing it changes; nothing is hidden or
   * reordered by it, and every section still says its verb in words.
   */
  kind?: "assign" | "decide" | "schedule" | "adjudicate";
  /** A section's own marker class, kept: `.v3ib-dict` and `.v3ib-unbound` carry
   *  styling and are what the miss-stays-visible guards look for. The shared header
   *  must not quietly take a section's identity away with its markup. */
  className?: string;
  /** Whose claim the section is about — rendered as the ledger's own tag. */
  tag: ReactNode;
  verb: string;
  count: number;
  /** What the count counts, singular. Pluralised here so no section spells its own —
   *  but only by appending "s", which is wrong for a compound noun: "system of record"
   *  became "0 system of records" on the live board. A unit whose plural is not the
   *  singular plus s states it. */
  unit: string;
  unitPlural?: string;
  /** A section counting TWO things (Sessions: seams AND questions) states both here.
   *  `count` still drives the accessible name, so the badge and the announcement
   *  cannot disagree about the headline number. */
  badge?: ReactNode;
  lead: ReactNode;
  provisional?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = id ? `${id}-body` : undefined;
  return (
    <section id={id} className={`v3ib-src${kind ? ` is-${kind}` : ""}${className ? ` ${className}` : ""}`}>
      <header className="v3ib-h">
        <button type="button" className="v3ib-disc" aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-label={`${open ? "Hide" : "Show"} ${verb} — ${count} ${count === 1 ? unit : unitPlural ?? `${unit}s`}`}
          onClick={() => setOpen((v) => !v)}>
          <span className="v3ib-disc-c" aria-hidden="true">{open ? "▾" : "▸"}</span>
          {tag}
          <span className="v3ib-verb">{verb}</span>
          {/* The unit is VISIBLE, not only announced. A bare "1" beside "Adjudicate"
              makes the reader supply the noun, and every section used to print it
              ("1 conflict", "24 questions") — losing it to an aria-label would have
              been an accessibility win paid for with a legibility loss. */}
          <span className="v3ib-n">{badge ?? <>{count} {count === 1 ? unit : unitPlural ?? `${unit}s`}</>}</span>
        </button>
        <span className="v3ib-lead">{lead}</span>
        {provisional ? <ProvisionalMark what={provisional} /> : null}
        {actions ? <span className="v3ib-h-acts">{actions}</span> : null}
      </header>
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}

export default function OperatorInbox({ ledger, candidates, by, onCommit, onAskMark, onDictionary }: Props) {
  // The dictionary upload — parsed for a HONEST preview before it is committed:
  // the operator sees how many fields parsed and how many open questions this
  // file would actually close, not a promise. ONE hidden input serves every ask;
  // `pendingSor` records which ask opened the dialog, so the file is attached to
  // that system (null = the programme-wide dictionary).
  const dictRef = useRef<HTMLInputElement>(null);
  const pendingSor = useRef<string | null>(null);
  const pendingScope = useRef<string[]>([]);
  const [dictPreview, setDictPreview] = useState<{
    name: string; fields: number; closes: number; csv: string; sor: string | null; scope: number;
    /** sheets that contributed rows, and how many the workbook had */
    used?: string[]; sheets?: number;
    /** the entities this file names, and the open questions inside / outside them */
    covers?: string[]; inScope?: number; outside?: number;
    /** an entity read from the file's own title because no sheet named one */
    entity?: string | null; entityFrom?: string | null;
  } | null>(null);
  /** A file that could not be read at all — reported where the upload was, never swallowed. */
  const [dictError, setDictError] = useState<{ name: string; reason: string; sor: string | null } | null>(null);
  /** The confirmation grid is opened deliberately — it is a pass of work, not a banner. */
  const [showGrid, setShowGrid] = useState(false);
  /** The questions behind a count, opened from the count itself. */
  const [peek, setPeek] = useState<{ sor: string; abouts: string[]; orphan?: boolean } | null>(null);
  const [showDerived, setShowDerived] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [showStages, setShowStages] = useState(false);
  /** Read through the ONE definition — lifecycle.ts — never re-derived here. */
  const lifecyclesWithStages = useMemo(
    () => lifecycleEntities(ledger.store).filter((l) => l.confident && l.stages.length),
    [ledger.store]);
  const [shownUnbound, setShownUnbound] = useState<Record<string, boolean>>({});

  /** The already-written readings, in the grid's own row shape. Source comes from
   *  the same `attributeEvidence` read the open wall uses — one definition. */
  const derivedRows: TypingRow[] = useMemo(() => (ledger.derivedTypes ?? []).map((d) => ({
    about: d.about, entity: d.entity, attribute: d.attribute,
    suggested: d.dataType, confidence: d.confidence,
    source: attributeEvidence(ledger.store, elementIdOf(d.about)),
  })), [ledger.derivedTypes, ledger.store]);

  /**
   * WHICH ENTITIES HAVE NO SYSTEM NAMED — the strip used to say only "41 typing
   * questions on entities with no system of record named / a Frame gap, not an ask",
   * which named neither the entities nor the act that clears it. An operator cannot
   * name a system for a set they cannot see.
   */
  const orphanEntities = useMemo(() => {
    const byId = new Map(ledger.store.elements().map((e) => [e.id, e] as const));
    const counts = new Map<string, number>();
    for (const about of ledger.artifactAsks.unattributed.abouts) {
      const el = byId.get(elementIdOf(about));
      const name = (el?.kind === "attribute" && el.of ? byId.get(el.of)?.name : el?.name) ?? "";
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [ledger.store, ledger.artifactAsks.unattributed.abouts]);

  /**
   * ROLES NOBODY ANSWERS FOR — moved here from Discover (2026-08-12).
   *
   * Its own note told the operator to "name someone for the role in the Discovery
   * Kit, or reassign the questions in the Inbox", and it was printed on the surface
   * for questions aimed at stakeholders. Both of those actions are the operator's,
   * so the miss belongs where it can be acted on.
   *
   * Bound labels come through `ownerLabelsForCast` — the same rule Discover binds a
   * person by, so the two surfaces can never disagree about who is covered.
   */
  const unbound = useMemo(() => {
    // Defensive: a ledger assembled without `soloByOwner` still renders the page.
    if (!ledger.soloByOwner) return [];
    const bound = new Set<string>();
    const rows = candidates.map((c) => ({ label: c.label, role: c.role }));
    for (const labels of ownerLabelsForCast(rows, [...ledger.soloByOwner.keys()]).values()) {
      for (const label of labels) bound.add(label);
    }
    return unboundOwners(ledger, bound);
  }, [candidates, ledger]);
  const unboundOpen = unboundOpenTotal(unbound);
  const readDictionaryFile = async (file: File, sor: string | null, scopeLoci: string[], carry = "", name = "") => {
    // EVERYTHING below can throw: `arrayBuffer()` on an unreadable file, the
    // dynamic `import("xlsx")`, `XLSX.read` on a corrupt or password-protected
    // workbook, `text()` on a binary blob. This function used to have no catch
    // and its one caller invoked it with `void`, so a rejection was discarded by
    // the runtime: the operator attached a file and NOTHING happened — no
    // preview, no error, no console line. A silent failure is the worst possible
    // outcome for an upload, because the operator's next move is to attach it
    // again and watch nothing happen again.
    try {
      return await readDictionaryFileUnsafe(file, sor, scopeLoci, carry, name);
    } catch (err) {
      // One unreadable file among several does not discard the ones already read:
      // the running merge is returned unchanged and the failure is named. Selecting
      // three and losing all three to one corrupt workbook is the behaviour this
      // whole path exists to prevent.
      if (!carry) setDictPreview(null);
      setDictError({ name: file.name, sor, reason: (err as Error)?.message?.slice(0, 140) || "the file could not be read" });
      return carry;
    }
  };
  const readDictionaryFileUnsafe = async (file: File, sor: string | null, scopeLoci: string[], carry = "", name = "") => {
    // EVERY sheet of a workbook is read and merged, then handed to the SAME parser a
    // .csv upload uses — one definition of a dictionary row, whatever the operator
    // exported. A real master workbook splits its dictionary across tabs (fields and
    // types on one, allowed values on another, one row per value), so reading a
    // single "best" sheet loses half the answers whichever one it picks. What was
    // read, what was skipped, and any entity inferred from the file's own title are
    // all carried into the preview and shown BEFORE the operator commits.
    const workbook = isSpreadsheetName(file.name) ? await readDictionaryWorkbook(await file.arrayBuffer(), file.name) : null;
    const own = workbook ? workbook.csv : await file.text();
    // SEVERAL FILES, ONE ASK. A system of record exports one workbook per object,
    // so the operator selects Accounts + Opportunity + Contact together and the
    // preview has to describe the whole selection, not the last file read. Each is
    // merged into the running CSV by the SAME rule the stored field uses, so what
    // the preview counts is what committing will store.
    const csv = mergeDictionaryCsv(carry, own);
    const parsed = parseDictionaryCsv(csv, name);
    // Measured against THIS ask's loci when the upload is for one system; against
    // every open typing locus for the programme-wide one. Same count either way —
    // the loci the file actually names, never an estimate.
    const scope = new Set(scopeLoci.map((about) => elementIdOf(about)));
    // Measured against the entities this file NAMES, not against every open
    // question: an Opportunity-only export is not failing when it says nothing
    // about Lead. `dictLocusId` binds a row by whichever of its two names the
    // ontology modelled, and the count here is the one that lands.
    const cover = dictionaryCoverage(parsed.fields, scope);
    const closes = cover.matched;
    setDictPreview({
      name: parsed.name, fields: parsed.fields.length, closes, csv, sor, scope: scopeLoci.length,
      used: workbook?.used, sheets: workbook?.sheets.length,
      covers: cover.entities, inScope: cover.inScope, outside: cover.outside,
      entity: workbook?.entity ?? null, entityFrom: workbook?.entityFrom ?? null,
    });
    return csv;
  };
  const [sel, setSel] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [fate, setFate] = useState<Record<string, boolean>>({});
  const [fateReason, setFateReason] = useState<Record<string, string>>({});
  const [exit, setExit] = useState<Record<string, "answer" | "redirect" | "release" | null>>({});
  const [f1, setF1] = useState<Record<string, string>>({});
  const [f2, setF2] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const elements = ledger.store.elements();
  const nameOf = new Map(elements.map((e) => [e.id, e.name] as const));
  const elOf = new Map(elements.map((e) => [e.id, e] as const));
  // THE one renderer — full data, qualified names, original casing, no truncation.
  const Q = (about: string) => { const r = renderQuestion(ledger.store, about, "operator"); return { question: r.question, typeTag: r.label, name: r.elementName }; };
  const groupOf = (about: string) => {
    const el = elOf.get(elementIdOf(about));
    if (el?.of) return nameOf.get(el.of) || readableName(undefined, el.of);
    return el?.name || readableName(undefined, elementIdOf(about));
  };

  // ASSIGN = unowned NON-typing questions (phase / decision) — the ones that genuinely need
  // a human owner. Typing (values / type / optionality) is excluded: it routes to the data
  // dictionary, closed by one upload from the system owner, never assigned to a person. So
  // burn-down `unownedOpen` decomposes into assignQueue + the unowned slice of typingLoci —
  // no double-count, no drop (both still open, both still in the 106 burn-down).
  //
  // FROZEN LOCI ARE DRAWN ONCE. A locus held by contradicting live claims belongs to the
  // adjudicate section and to nothing else — it cannot be routed to an owner or taken to a
  // session until it is unfrozen. `unfrozenQueues` is the ONE place that subtraction is
  // written, and the rail badge counts these very lists, so the page and the badge cannot
  // disagree about what is waiting. (Drawing a frozen row here while the badge excluded it
  // is exactly the drift F7 exists to catch.)
  const unfrozen = unfrozenQueues(ledger);
  const unowned = unfrozen.assign;
  // Group unowned questions by their element (the area-cascade shape): one "assign an
  // owner" per group that cascades to the questions under it, not N inbox cards.
  const unownedGroups = new Map<string, typeof unowned>();
  for (const it of unowned) (unownedGroups.get(groupOf(it.about)) ?? unownedGroups.set(groupOf(it.about), []).get(groupOf(it.about))!).push(it);

  // The session queue is the ONE source (ledger.sessionQueue) — seam questions,
  // jointly owned, grouped by function pair. Never recomputed here; only the frozen
  // loci are subtracted, by the same call the badge uses (see `unfrozen` above), so a
  // question awaiting adjudication is not also offered as one to schedule.
  // A "schedule" action = the seam is on the session plan (intent). It carries NO
  // date — scheduling is gated — so the open item on every seam is a DATE. Only the
  // pair is needed downstream (planned or not), so the section takes the set, not the
  // actions: a row shows an intent was recorded, never a time it does not have.

  const run = async (key: string, action: OperatorAction | OperatorAction[]) => {
    setBusy(key); try { await onCommit(action); } finally { setBusy(null); }
  };
  const pickedOwner = (key: string) => (sel[key] === OTHER ? other[key] : sel[key])?.trim();
  const isRoleOwner = (label: string) => { const c = candidates.find((x) => x.label === label); return c ? c.label === c.role : true; };

  const assignAction = (about: string, label: string): OperatorAction =>
    ({ kind: "assign", about, slot: slotOf(about), owner: { label, isRole: isRoleOwner(label) }, by, at: nowISO() });

  /**
   * A DOM id has to be unique and has to be usable in `htmlFor`; the ids these
   * controls were minted with were neither — `asg-grp:Sales Order` carries a space
   * (invalid per HTML) and `re-el:attr:x.y#type` carries a `#`, so the label/field
   * association was one browser quirk away from being no association at all. Slugged
   * here, once, for every control this component mints.
   */
  const domId = (raw: string) => raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-");

  /**
   * There are as many of these selects on the page as there are groups and in-flight
   * questions, and every one of them used to announce the same word: "Owner". The
   * label now carries the placeholder — which names WHICH element or question this
   * control routes — so the twentieth select is distinguishable from the first.
   */
  /**
   * `srLabel` is what a SCREEN READER hears; `placeholder` is what everyone sees.
   *
   * They were one string, so making the accessible name specific enough to tell
   * seven pickers apart ("Assign to… — Which phase of the process does …") also put
   * that whole sentence in the closed select, where it truncated to
   * "Assign to… — Which phase of the proces". The visible text stays short; the
   * distinguishing detail goes where it is needed and nowhere else.
   */
  const cSelect = (key: string, rawId: string, placeholder = "Assign an owner…", srLabel?: string) => {
    const id = domId(rawId);
    return (
      <>
        <label className="v3ib-sr" htmlFor={id}>{spoken(srLabel ?? placeholder)}</label>
        <select id={id} value={sel[key] ?? ""} onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.value }))}>
          <option value="">{placeholder}</option>
          {candidates.map((c) => <option key={c.label} value={c.label}>{displayPersonLabel(c.label)}{c.role && c.role !== c.label ? ` — ${c.role}` : ""}</option>)}
          <option value={OTHER}>Someone else…</option>
        </select>
        {sel[key] === OTHER
          ? <input className="v3ib-other" aria-label={spoken(`${placeholder} — name a person or role not on the list`)}
              placeholder="Name a person or role" value={other[key] ?? ""}
              onChange={(e) => setOther((s) => ({ ...s, [key]: e.target.value }))} />
          : null}
      </>
    );
  };

  // CURATION — loci minted from an ontology-gap kit question. `ledger.proposals` is the
  // ONE source (nothing re-derived here). A proposal is PROVISIONAL and must never read as
  // an element the ontology actually holds, so every question line it makes carries the mark.
  const proposalOf = new Map(ledger.proposals.filter((p) => !p.alreadyModelled).map((p) => [p.about, p] as const));

  const QLine = ({ about, tail }: { about: string; tail?: ReactNode }) => {
    const p = Q(about);
    const proposed = proposalOf.get(about);
    return (
      <span className="v3ib-q" title={about}>
        <span className="v3ib-qtype">{p.typeTag}</span>
        <span className="v3ib-qtext">{p.question}</span>
        {proposed ? (
          <span className="v3ib-prop" title={`PROPOSED — the ontology does not hold this. ${proposed.by} minted it from the kit question "${proposed.fromKit[0]}" on ${proposed.at.slice(0, 10)}. Provisional until someone answers it.`}>
            <span aria-hidden="true">◇</span> proposed
          </span>
        ) : null}
        {tail}
      </span>
    );
  };

  // WHOLE-INBOX empty state: when no section has anything, the inbox itself is
  // hidden (by request, 2026-08-10) — an empty queue is not a thing to read. The
  // burn-down above remains the goal; nothing here is lost, only unshown.
  // The terms are NOT re-added here: operatorQueueCounts is the one place either sum is
  // written, and the rail badge reads the identical function. An item on this page is
  // an item on the badge by construction, not by keeping two expressions in step.
  // `rendered`, not `total`: the decided trace is history the page still shows after the
  // badge has (correctly) gone quiet, so gating on the badge's number would have deleted
  // the record of the ruling that emptied the queue.
  const queue = operatorQueueCounts(ledger);
  // NOTHING TO DECIDE → THE INBOX DRAWS NOTHING, and that is not an oversight: the
  // SHELL already owns this state and draws "Nothing needs you right now", gated on
  // the same `rendered` count, with a documented history of getting that predicate
  // right (FlowShell ~1134). An "Inbox clear" card was added here on 2026-08-13 under
  // the redesign brief's ask for a crafted zero state — it was a SECOND empty state
  // for one condition, which is the thing this codebase exists to avoid, and two
  // standing guards caught it within the minute. Removed; the brief's ask was already
  // satisfied one level up.
  if (queue.rendered === 0) return null;

  // ONE UNIT — QUESTIONS, the same unit the burn-down uses, so no reader reconciles
  // THE HEADER'S STAT ROW went with the header (2026-08-13). Each section states its
  // own count on its own badge now, which is one place for a number instead of two.

  /**
   * THE QUESTION ROWS, one definition.
   *
   * They were written inside the peek modal, so the only way to show a set of
   * questions was to open a dialog — which is why "show the 37" was a modal while
   * "review the 18" beside it expanded in place. Lifted here, the same rows render
   * wherever the questions are asked for.
   */
  /**
   * THE SUBJECT, SAID ONCE.
   *
   * Four questions about one atlas step each restated the whole step:
   *
   *   One step in the process is: "Review pipeline, forecast, and performance
   *   reports; monitor commit, most likely, and stretch buckets." Who does this step?
   *   One step in the process is: "Review pipeline, forecast, and performance
   *   reports; monitor commit, most likely, and stretch buckets." What decides…?
   *
   * — the same forty words, four times, with six words of difference at the end. The
   * operator reads the quote once and then hunts for the tail, which is the part they
   * are actually answering.
   *
   * The shared opening is computed from the questions themselves rather than by
   * reaching back into how they were phrased: whatever prefix a group has in common,
   * up to the last sentence boundary, is the subject. A group of one keeps its
   * question whole, and questions with nothing in common are simply not grouped — so
   * this can shorten a row but never invent a heading that was not already there.
   */
  const sharedOpening = (questions: readonly string[]): string => {
    if (questions.length < 2) return "";
    let i = 0;
    while (i < questions[0].length && questions.every((q) => q[i] === questions[0][i])) i += 1;
    const common = questions[0].slice(0, i);
    // Cut back to a sentence end, so the heading is a sentence and the tails are
    // sentences — never a phrase severed mid-clause.
    const cut = Math.max(common.lastIndexOf(". "), common.lastIndexOf('." '), common.lastIndexOf("? "));
    return cut > 20 ? common.slice(0, cut + (common[cut] === "." ? 1 : 1) + (common[cut + 1] === '"' ? 1 : 0)).trim() : "";
  };

  const QuestionList = ({ abouts, orphan, assignable }: {
    abouts: readonly string[];
    orphan?: boolean;
    /** Each row gets its own owner picker. "Hand over all 7" is the common case and
     *  stays, but seven questions about two different workflows are not always one
     *  person's — the bulk act was the ONLY act, so routing them separately meant
     *  handing them all to somebody and reassigning six afterwards. */
    assignable?: boolean;
  }) => {
    // Grouped by the element the questions are ABOUT, in the order they arrived, so a
    // step's four questions sit together under one statement of the step.
    const groups: Array<{ id: string; abouts: string[] }> = [];
    for (const about of abouts) {
      const id = elementIdOf(about);
      const last = groups[groups.length - 1];
      if (last && last.id === id) last.abouts.push(about);
      else groups.push({ id, abouts: [about] });
    }
    return (
    <ul className="v3ib-qlist">
      {groups.flatMap((group) => {
      const opening = sharedOpening(group.abouts.map((a) => Q(a).question));
      const head = opening ? (
        <li key={`h:${group.id}`} className="v3ib-qsubject">{opening}</li>
      ) : null;
      return [head, ...group.abouts.map((about) => {
        const q = Q(about);
        // WHERE THE FIELD CAME FROM. A question about a field somebody named in an
        // interview and one about a field the model listed while summarising a
        // document read identically until this line existed.
        const src = attributeEvidence(ledger.store, elementIdOf(about));
        return (
          <li key={about} title={about}>
            <span className="v3ib-peek-tag">{q.typeTag}</span>
            <span className="v3ib-peek-q">
              {opening && q.question.startsWith(opening)
                ? q.question.slice(opening.length).trim()
                : q.question}
            </span>
            {src
              ? <span className="v3ib-peek-src" title={src}>from: {src}</span>
              : <span className="v3ib-peek-src none">no source on record</span>}
            {/* THE FOURTH ANSWER: the field should not exist. For a field with NO
                source and NO system of record, the three routes on offer were chase a
                dictionary (from a system nobody named), ask a stakeholder (Discover
                excludes these, rightly), or confirm a type by hand — all three assume
                the field is real. Laila New held "Does every Account need a ANOTHER,
                or is that optional?", an attribute Aura invented while summarising.
                `decide-fate: out-of-scope` is the ledger's own way to say so; it was
                simply not offered where it is the only correct move, and it records
                WHY, so a field ruled out stays ruled out with its reason. */}
            {!src && orphan ? (
              <button type="button" className="v3ib-peek-drop" disabled={busy === about}
                aria-label={spoken(`This field should not exist: ${q.question}`)}
                title="No source, no system — record that the field itself is out of scope"
                onClick={() => void run(about, {
                  kind: "decide-fate", about, slot: slotOf(about), decision: "out-of-scope",
                  reason: "no source on record and no system of record — the field itself is not evidenced",
                  by, at: nowISO(),
                })}>{busy === about ? "Recording…" : "this field shouldn’t exist"}</button>
            ) : null}
            {assignable ? (
              <span className="v3ib-qrow-assign">
                {cSelect(about, `q-${about}`, "Assign to…", `Assign to… — ${q.question}`)}
                <button type="button" className="v3ib-btn ghost sm"
                  disabled={busy === about || !pickedOwner(about)}
                  aria-label={spoken(`Assign to ${pickedOwner(about) || "the chosen person"}: ${q.question}`)}
                  onClick={() => void run(about, assignAction(about, pickedOwner(about)!))}>
                  {busy === about ? "Assigning…" : "assign"}
                </button>
              </span>
            ) : null}
          </li>
        );
      })];
      })}
    </ul>
    );
  };

  return (
    <div className="v3ib" aria-label="Operator inbox">
      {/* THE HEADER STRIP IS GONE (on request, 2026-08-13). It printed the same
          counts the sections print two inches below, plus a sentence describing what
          the Inbox is to someone already looking at it. Every stat was a jump link to
          a section that is on screen anyway, and the counts are now on each section's
          own badge — so nothing was lost except a second place for the same number to
          be right or wrong in. The zero state stays: an empty board still has to say
          which kind of empty it is. */}

      {/* 0a · ROLES NOBODY ANSWERS FOR — an operator decision, so it lives here.
              Every number is `soloByOwner`'s own count for that label: no person is
              invented to fill the gap and no number is invented to describe it. */}
      {unbound.length ? (
        <IbSection className="v3ib-unbound" kind="assign" verb="Nobody to ask" count={unboundOpen} unit="open question"
          tag={<OwnershipTag cls="operator" showLabel={false} />}
          lead={<>
              Owned by {unbound.length} role{unbound.length === 1 ? "" : "s"} with no person behind{" "}
              {unbound.length === 1 ? "it" : "them"} — owned in the ledger, unreachable in practice.
              {" "}Hand them to someone here, or add a person to the Discovery Kit whose role is
              spelt EXACTLY as it appears below — the binding is an exact match on the role, so
              &ldquo;Exec Sponsor&rdquo; does not answer for &ldquo;Executive Sponsor&rdquo;.
          </>}>
          {/* THE ACT, not a description of one. This strip said "reassign them below"
              and then drew a COUNT — the operator was told to do something and given
              nothing to do it with. The reassignment machinery already existed for
              in-flight questions; the only reason it was not here is that
              `unboundOwners` returned counts without the loci they counted.
              One commit per ROLE, because that is the grain of the decision: all seven
              Executive Sponsor questions go to one person, or none of them do. */}
          {/* EACH ROLE IS A CARD, like every other block on this surface. It was a
              one-line strip whose only content was a COUNT — "Executive Sponsor · 7"
              — with no way to see which seven, while every card beside it could be
              opened. The picker also sat on top of the chip at this width, because a
              row of three inline controls has nowhere to go. */}
          {unbound.map((owner) => {
            const key = `unbound:${owner.label}`;
            const picked = pickedOwner(key);
            return (
              <IbCard key={owner.label}
                title={<><b>{owner.label}</b> — {owner.open} open question{owner.open === 1 ? "" : "s"}, and nobody on the roster answers for that role</>}
                reveal={{ label: `show the ${owner.open}`, open: !!shownUnbound[owner.label],
                  onToggle: () => setShownUnbound((m) => ({ ...m, [owner.label]: !m[owner.label] })) }}
                note={<>Hand the whole set to one person below, or open them and route each to
                  whoever actually answers it — they are often two different people.</>}
                writes={<>
                  {cSelect(key, key, `Hand all ${owner.open} ${owner.label} question${owner.open === 1 ? "" : "s"} to…`)}
                  <button type="button" className="v3ib-btn sm"
                    disabled={busy === key || !picked}
                    aria-label={spoken(`Hand all ${owner.open} ${owner.label} questions to ${picked || "the chosen person"}`)}
                    onClick={() => void run(key, owner.abouts.map((about) => assignAction(about, picked!)))}>
                    {busy === key ? "Handing over…" : `hand over all ${owner.open}`}
                  </button>
                </>}>
                <QuestionList abouts={owner.abouts} assignable />
              </IbCard>
            );
          })}
        </IbSection>
      ) : null}

      {/* 0 · ARTIFACT ASKS — the dictionary ask, PREVENTIVE by default: one ask per
          system of record, born at SoR identification (Frame). This inbox shows an ask
          ONLY while unprovided (remedial chase) — self-clearing on import; questions
          minted after an import REOPEN the same ask, never a second one. Ageing is the
          same operator-tracked rule as people. See docs/aura/data-dictionary-import.md. */}
      {(() => {
        const chase = asksNeedingChase(ledger.artifactAsks);
        const unattributed = ledger.artifactAsks.unattributed;
        // SETTLED BY A DECISION, not by the data — "that's the whole dictionary" and
        // "has no dictionary" are things an operator said, and they stay visible with
        // a way back. Settling would otherwise be a one-way door: the ask leaves the
        // chase, taking its own upload control and its own buttons with it, and a
        // mis-click could not be undone from the surface that caused it. `provided`
        // is NOT here — nothing was decided, the questions simply all closed.
        const settled = ledger.artifactAsks.asks.filter((a) => a.state === "complete" || a.state === "has-none");
        // Defensive: a ledger built before this field existed still renders.
        const derived = ledger.derivedTypes ?? [];
        // `derived` is IN the guard. Proposals that left the burn-down without
        // anyone answering them must never be the reason the section is empty —
        // that would be the silent shrink this whole block exists to prevent.
        if (!chase.length && !unattributed.weight && !settled.length && !derived.length) return null;
        const now = Date.now();
        // The systems that actually have a row on screen right now. A preview or
        // an error naming anything else is an ORPHAN and must fall through to the
        // programme-wide row rather than render nowhere.
        const chaseSors = new Set(chase.map((ask) => ask.sor));
        // ONE upload control, rendered per ask (keyed to that SoR) and once for the
        // programme-wide file. `loci` is the scope the preview measures against, so
        // "closes N" means N of THIS system's open questions.
        const uploadRow = (sor: string | null, loci: string[]) => {
          if (!onDictionary) return null;
          // A preview must NEVER be invisible. It rendered only in the row whose
          // `sor` matched, and `pendingSor` is a ref that was never reset — so a
          // stale or null value routed the preview to a row the operator was not
          // looking at, or to none at all. That is the "I attached a file and
          // nothing happened" report. The programme-wide row (rendered last) now
          // also claims any preview whose system is not on screen, so the file
          // always lands somewhere the operator can see it.
          const orphan = dictPreview !== null && dictPreview.sor !== null && !chaseSors.has(dictPreview.sor);
          const active = dictPreview !== null && (dictPreview.sor === sor || (sor === null && orphan));
          const showError = dictError !== null && (dictError.sor === sor
            || (sor === null && dictError.sor !== null && !chaseSors.has(dictError.sor)));
          const key = sor ?? "*";
          return (
            <div className="v3ib-dict-up">
              {active ? (
                <>
                  <span className="v3ib-dict-prev">
                    <b>{dictPreview.name}</b> · {dictPreview.fields} field{dictPreview.fields === 1 ? "" : "s"} parsed ·
                    {" "}<b>{dictPreview.closes}</b> of the {dictPreview.inScope ?? dictPreview.scope} open typing question
                    {(dictPreview.inScope ?? dictPreview.scope) === 1 ? "" : "s"}
                    {dictPreview.covers?.length ? ` on ${dictPreview.covers.slice(0, 3).join(", ")}${dictPreview.covers.length > 3 ? ` +${dictPreview.covers.length - 3} more` : ""}` : sor ? ` on ${sor}` : ""}
                    {" "}match
                    {dictPreview.outside ? ` · ${dictPreview.outside} more are on entities this file does not cover` : ""}
                    {dictPreview.closes === 0 && (dictPreview.inScope ?? 0) > 0
                      ? " — nothing here matches an open locus; check the entity/field columns" : ""}
                    {dictPreview.used?.length && (dictPreview.sheets ?? 1) > 1
                      ? ` · merged ${dictPreview.used.length} of ${dictPreview.sheets} sheets: ${dictPreview.used.join(", ")}`
                      : ""}
                  </span>
                  {/* An entity read from the file's own title is a DERIVATION, not a
                      column the file states per row. It is named, with where it came
                      from, before the operator commits — never folded in silently. */}
                  {dictPreview.entityFrom ? (
                    <span className="v3ib-dict-derived">
                      no sheet named an object, so every row was read as <b>{dictPreview.entity}</b>,
                      {" "}taken from {dictPreview.entityFrom} — discard this if that is wrong
                    </span>
                  ) : null}
                  <button type="button" className="v3ib-btn" disabled={busy === `dict:${key}`}
                    onClick={() => { setBusy(`dict:${key}`); void Promise.resolve(onDictionary(dictPreview.csv, dictPreview.sor)).finally(() => { setBusy(null); setDictPreview(null); pendingSor.current = null; pendingScope.current = []; }); }}>
                    {busy === `dict:${key}` ? "attaching…" : sor ? `attach as the ${sor} dictionary` : "attach this dictionary"}
                  </button>
                  <button type="button" className="v3ib-btn ghost sm" onClick={() => { setDictPreview(null); pendingSor.current = null; pendingScope.current = []; }}>discard</button>
                </>
              ) : (
                <>
                {showError ? (
                  <span className="v3ib-dict-err" role="alert">
                    <b>{dictError!.name}</b> could not be read — {dictError!.reason}. Try exporting it as CSV.
                  </span>
                ) : null}
                <button type="button" className="v3ib-btn ghost"
                  onClick={() => { setDictError(null); pendingSor.current = sor; pendingScope.current = loci; dictRef.current?.click(); }}>
                  <span aria-hidden="true">⬆ </span>upload {sor ? `the ${sor} dictionary` : "a dictionary covering every system"} (CSV/TSV/Excel)
                </button>
                </>
              )}
            </div>
          );
        };
        return (
          <IbSection id="ib-dictionary" className="v3ib-dict" kind="decide" verb="Data dictionary" count={chase.length} unit="system of record"
            unitPlural="systems of record"
            tag={<SourceTag source="code-derived" />}
            lead={<>With an unprovided dictionary — <b>one upload each</b> closes the typing wall, not
              form fields to the domain expert. What a dictionary states is
              <b> the weakest thing on the record</b> — any owner can still say otherwise.</>}>
            {/* A BURN-DOWN THAT SHRANK BECAUSE THE MACHINE GUESSED MUST SAY SO.
                These left the wall without anybody answering them, so the count is
                stated here rather than quietly absorbed. They are the weakest claim
                the ledger holds and lose to any human answer — but an operator who
                is not told will read them as settled. */}
            {/* LIFECYCLE STAGES — the act Discover hands off. Discover finds which
                entities move through stages and states it; confirming the list is an
                operator WRITE at dictionary strength, so it lives here. Same CSV, same
                `onDictionary`, same merge as every other typing answer: a lifecycle a
                person confirmed and one a schema stated are indistinguishable. */}
            {onDictionary && lifecyclesWithStages.length ? (
              <IbCard
                title={<><b>{lifecyclesWithStages.length}</b> entit{lifecyclesWithStages.length === 1 ? "y has" : "ies have"} a lifecycle with stages on the record</>}
                note={<>Confirming records the order as <b>your</b> answer, at the strength an uploaded
                  schema carries. A stakeholder can still say otherwise; a real dictionary still
                  corrects it.</>}
                reveal={{ label: `review the ${lifecyclesWithStages.length}`, open: showStages,
                  onToggle: () => setShowStages((v) => !v) }}>
                <ul className="v3ib-qlist">
                  {lifecyclesWithStages.map((lc) => (
                    <li key={lc.about}>
                      <span className="v3ib-peek-q"><b>{lc.entity}</b> · {lc.attribute}</span>
                      <span className="v3ib-peek-src">{lc.stages.join(" → ")}</span>
                      <button type="button" className="v3ib-btn sm" disabled={busy === lc.about}
                        aria-label={spoken(`Confirm the stages of ${lc.entity}: ${lc.stages.join(", ")}`)}
                        onClick={() => {
                          setBusy(lc.about);
                          // entity,field,values — the three columns a schema export
                          // carries, so the merge cannot tell the two apart.
                          const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
                          const csv = `entity,field,values\n${[lc.entity, lc.attribute, lc.stages.join("; ")].map(cell).join(",")}`;
                          void Promise.resolve(onDictionary(csv, null)).finally(() => setBusy(null));
                        }}>{busy === lc.about ? "Confirming…" : "confirm these stages"}</button>
                    </li>
                  ))}
                </ul>
              </IbCard>
            ) : null}
            {derived.length ? (
              <IbCard
                title={<><b>{derived.length}</b> type{derived.length === 1 ? " was" : "s were"} read from the field names, not answered by anyone</>}
                note={<>{derived.slice(0, 3).map((d) => `${d.entity}.${d.attribute} → ${d.dataType}`).join(" · ")}
                  {derived.length > 3 ? ` · +${derived.length - 3} more` : ""}
                  {" "}— Aura&rsquo;s own reading, and <b>the weakest thing on the record</b>: a dictionary
                  or an owner overrules any of them. A real dictionary is still the better answer.</>}
                reveal={onDictionary ? {
                  label: `review the ${derived.length}`, open: showDerived,
                  onToggle: () => setShowDerived((v) => !v),
                } : undefined}>
                {onDictionary ? (
                  <TypingGrid ledger={ledger} onDictionary={onDictionary} rows={derivedRows}
                    onDone={() => setShowDerived(false)} onClose={() => setShowDerived(false)} />
                ) : null}
              </IbCard>
            ) : null}
            {chase.map((ask) => {
              // owner: the derivation's, else the shared detection over the roster, else TBC — never fabricated
              const fallback = candidates.find((c) => isSystemOwner(c.label, c.role));
              const owner = ask.owner ?? fallback?.label ?? null;
              const ownerRole = ask.ownerRole ?? fallback?.role ?? null;
              const age = ask.requestedAt ? Math.max(0, Math.floor((now - Date.parse(ask.requestedAt)) / 86400000)) : null;
              return (
                <div key={ask.sor} className="v3ib-dict-ask">
                  <span className="v3ib-dict-to">
                    <b>{ask.sor}</b>{" "}
                    {/* A SoR the sponsor named in Frame has no entities yet — say that,
                        rather than print a "0 entities · closes 0 questions" that reads
                        like the ask is worthless. The weight is unknown, not zero. */}
                    <span className="v3ib-unit">
                      {ask.entityCount === 0 ? "(named in Frame — nothing modelled against it yet)" : `(${ask.entityCount} entit${ask.entityCount === 1 ? "y" : "ies"})`}
                    </span>
                    {" "}→ <b>{owner ?? "no one named yet"}</b>{owner && ownerRole && ownerRole !== owner ? ` · ${ownerRole}` : ""}
                    {ask.entityCount === 0 ? null : (
                      <>{" "}·{" "}
                      {/* THE COUNT IS A DOOR. "closes 10 open questions" is a claim
                          about work nobody could see: an operator deciding whether
                          to chase a dictionary should be able to read the ten
                          questions it would close, without leaving the page. */}
                      <button type="button" className="v3ib-peek"
                        aria-label={spoken(`Show the ${ask.weight} open questions the ${ask.sor} dictionary would close`)}
                        onClick={() => setPeek({ sor: ask.sor, abouts: ask.abouts })}>
                        <b>closes {ask.weight}</b> open question{ask.weight === 1 ? "" : "s"}
                      </button></>
                    )}
                  </span>
                  <span className="v3ib-dict-msg">
                    {ask.state === "unclassified" ? (
                      <><b>not classified</b> — is this system being <b>replaced</b>, or do we <b>integrate</b> with it?
                      {" "}A dictionary is the ask for a system whose schema we are migrating; for one we merely
                      exchange fields with, nobody writes a dictionary and its schema was never the client&rsquo;s
                      to produce. Either way the {ask.weight} open typing question{ask.weight === 1 ? "" : "s"} stay open.</>
                    ) : ask.state === "integration" ? (
                      <><b>integrated with, not replaced</b> — no dictionary is owed. Its {ask.weight} typing
                      question{ask.weight === 1 ? "" : "s"} stay open and counted; they are answered where fields are
                      typed, not by chasing a document nobody wrote.</>
                    ) : ask.state === "reopened" ? (
                      <><b>reopened</b> — {ask.weight} typing question{ask.weight === 1 ? "" : "s"} since the import attach to this same ask (never a second one). If the upload was all this system has, settle it — the questions stay open and counted, they just stop waiting on a file.</>
                    ) : ask.state === "requested" ? (
                      <>requested · <span className={`v3ln-age${age !== null && age >= 21 ? " hot" : age !== null && age >= 9 ? " warm" : ""}`}>awaiting {age !== null ? `· ${age}d` : ""} · operator-tracked</span></>
                    ) : (
                      <><b>not yet requested</b> — an incomplete Frame item until requested, provided, or marked has-none.</>
                    )}
                    {" "}<ProvisionalMark what="freeform-document parsing is model-gated; CSV/XLSX dictionaries parse now" />
                  </span>
                  {onAskMark ? (
                    <span className="v3ib-dict-actions">
                      {/* THE CLASSIFYING QUESTION, asked once and before anything
                          else — the right ask depends entirely on the answer. */}
                      {ask.state === "unclassified" || ask.state === "integration" ? (
                        <button type="button" className="v3ib-btn ghost sm"
                          aria-label={spoken(`Record that ${ask.sor} is being replaced`)}
                          onClick={() => onAskMark({ sor: ask.sor, disposition: "replace", by, at: nowISO() })}>we&rsquo;re replacing it</button>
                      ) : null}
                      {ask.state === "unclassified" ? (
                        <button type="button" className="v3ib-btn ghost sm"
                          aria-label={spoken(`Record that we integrate with ${ask.sor}`)}
                          onClick={() => onAskMark({ sor: ask.sor, disposition: "integrate", by, at: nowISO() })}>we integrate with it</button>
                      ) : null}
                      {ask.state === "unrequested" || ask.state === "reopened" ? (
                        <button type="button" className="v3ib-btn ghost sm" aria-label={spoken(`Mark the ${ask.sor} dictionary as requested`)} onClick={() => onAskMark({ sor: ask.sor, mark: "requested", by, at: nowISO() })}>mark requested</button>
                      ) : null}
                      {/* A DICTIONARY IS ON FILE AND IT IS ALL THERE IS.
                          Until now the only way to stop a reopened ask chasing was
                          "has no dictionary" — which is false once one has been
                          uploaded, and would have put a wrong fact on the record to
                          quiet a card. This says the true thing instead: what
                          arrived is everything the system has, so no further upload
                          is coming. Only offered where it is meaningful — an ask
                          with no dictionary has nothing to call complete. */}
                      {ask.state === "reopened" ? (
                        <button type="button" className="v3ib-btn ghost sm"
                          aria-label={spoken(`Record that the ${ask.sor} dictionary on file is all there is`)}
                          onClick={() => onAskMark({ sor: ask.sor, mark: "complete", by, at: nowISO() })}>that&rsquo;s the whole dictionary</button>
                      ) : null}
                      {ask.state !== "has-none" && ask.state !== "unclassified" && ask.state !== "integration" ? (
                        <button type="button" className="v3ib-btn ghost sm" aria-label={spoken(`Record that ${ask.sor} has no data dictionary`)} onClick={() => onAskMark({ sor: ask.sor, mark: "has-none", by, at: nowISO() })}>has no dictionary</button>
                      ) : null}
                    </span>
                  ) : null}
                  {/* EACH ask takes its OWN dictionary — a CRM export answers nothing
                      about the finance system, so the upload is keyed to this SoR.
                      Offered only once somebody has said a dictionary IS the right
                      ask: prompting before that is what put four unanswerable
                      "upload the HubSpot dictionary" buttons on the board. */}
                  {ask.state === "unclassified" || ask.state === "integration" ? null : uploadRow(ask.sor, ask.abouts)}
                </div>
              );
            })}
            {/* ANSWER THEM HERE INSTEAD. The asks above chase a document, which is
                the better answer and often weeks away. This is the other road: the
                same questions, pre-answered from the field names, confirmable in
                one pass. It sits under the asks because a real dictionary still
                beats it — and it is only offered when there is something to
                confirm. */}
            {onDictionary && ledger.typingLoci.length ? (
              // NOT `.v3ib-dict-ask`: that class IS the chase row, counted one per SoR
              // by the badge-equals-page guard. This is a door into a pass of work, not
              // another thing being chased, and counting it as one would have made the
              // rail badge disagree with the page by exactly one.
              <IbCard
                title={<><b>{ledger.typingLoci.length}</b> typing question{ledger.typingLoci.length === 1 ? "" : "s"} are still open</>}
                note={<>A dictionary is the better answer. If one is not coming, answer them here — Aura
                  has read most of them from the field names already and sets them as the answer, so it
                  is a pass of confirmations rather than {ledger.typingLoci.length} questions.</>}
                reveal={{ label: "confirm the types here", open: showGrid, onToggle: () => setShowGrid((v) => !v) }}>
                <TypingGrid ledger={ledger} onDictionary={onDictionary}
                  onDone={() => setShowGrid(false)} onClose={() => setShowGrid(false)} />
              </IbCard>
            ) : null}
            {settled.length ? (
              <IbCard tone="settled"
                title={<><b>{settled.length}</b> settled by you</>}
                note={settled.map((a) => `${a.sor} (${a.state === "complete" ? "whole dictionary on file" : "has none"})`).join(" · ")}
                writes={onAskMark ? settled.map((a) => (
                  <button key={a.sor} type="button" className="v3ib-btn sm"
                    aria-label={spoken(`Chase the ${a.sor} dictionary again`)}
                    onClick={() => onAskMark({ sor: a.sor, mark: "requested", by, at: nowISO() })}>
                    chase {a.sor} again
                  </button>
                )) : undefined} />
            ) : null}
            {unattributed.weight ? (
              <IbCard tone="muted" marker="v3ib-dict-residue"
                title={<><b>{unattributed.weight}</b> typing question{unattributed.weight === 1 ? "" : "s"} on{" "}
                  {orphanEntities.length ? (
                    <>
                      <b>{orphanEntities.slice(0, 3).map(([n]) => n).join(", ")}</b>
                      {orphanEntities.length > 3 ? <> and {orphanEntities.length - 3} more</> : null}
                      {" "}— <b>no system of record named</b>
                    </>
                  ) : <>entities with <b>no system of record named</b></>}</>}
                /* WHAT IT IS AND WHAT CLEARS IT. "a Frame gap, not an ask" is the
                   ledger's own vocabulary and told the operator nothing they could act
                   on: no dictionary can be requested for a system nobody has named, so
                   this bucket is deliberately NOT an ask — it waits on the Frame answer
                   that turns it into one. */
                /* WHAT ACTUALLY ATTACHES THEM. This said "name the system on the Frame —
                   in systems of record — and these attach to its ask", which is FALSE:
                   attachment runs through `sorOfElement`, which reads the ENTITY's own
                   system of record. A Frame declaration mints a new ask and attaches
                   nothing. The real question — "which system holds Product?" — did not
                   exist for a single one of these entities until it was born
                   (`systemOfRecordQuestionOverlay`), so it is now on somebody's list
                   and this card says whose. */
                note={<>Nothing to chase yet: a dictionary is requested from a system, and these
                  {" "}{orphanEntities.length === 1 ? "entity holds" : "entities hold"} no system name.
                  {" "}Each one now carries its own <b>&ldquo;which system holds this?&rdquo;</b> question — answer
                  that and its typing questions join that system&rsquo;s dictionary ask. They stay open
                  and counted meanwhile.</>}
                /* IN THE CARD, NOT A MODAL. This one reveal opened a dialog while the two
                   above expanded in place — the same act, three interactions. Every
                   reveal in this Inbox now opens where it was asked for. */
                reveal={{ label: `show the ${unattributed.weight}`, open: showOrphans,
                  onToggle: () => setShowOrphans((v) => !v) }}>
                <QuestionList abouts={unattributed.abouts} orphan />
              </IbCard>
            ) : null}
            {/* THE UPLOAD — the write half of the ask. Parsed first so the operator
                sees what this file actually closes before committing it. Per-SoR
                uploads sit on their own ask above; this is the one file that covers
                every system (the shape a programme that never keys keeps). */}
            {onDictionary ? (
              <>
                {/* Visually clipped and PROXIED by the labelled buttons above: it is
                    taken out of the tab order and out of the accessibility tree, so a
                    keyboard user is not dropped onto an unnamed "choose file" control
                    that no sighted user can see. `.click()` still opens the dialog. */}
                <input ref={dictRef} type="file" multiple accept={[".csv", ".tsv", ".txt", ...SPREADSHEET_EXTENSIONS].join(",")} className="v3ib-sr"
                  tabIndex={-1} aria-hidden="true"
                  onChange={(e) => {
                    // SEVERAL AT ONCE. One system exports one workbook per object, so
                    // Accounts + Opportunity + Contact are one ask, not three. Read in
                    // the order selected and merged as they go, so the preview counts
                    // the whole selection and one commit stores all of it.
                    const files = [...(e.target.files ?? [])]; e.target.value = "";
                    if (!files.length) return;
                    void (async () => {
                      let carry = "";
                      for (const f of files) {
                        const before = carry;
                        carry = await readDictionaryFile(f, pendingSor.current, pendingScope.current, carry,
                          files.length === 1 ? f.name.replace(/\.[^.]+$/, "") : `${files.length} files`);
                        if (carry === before && files.length === 1) return;   // it failed; the error is shown
                      }
                    })();
                  }} />
                {uploadRow(null, ledger.typingLoci.map((i) => i.about))}
              </>
            ) : null}
          </IbSection>
        );
      })()}

      {/* 1 · UNOWNED → ASSIGN (grouped, cascades) / DECIDE FATE */}
      {/* EMPTY-STATE: a 0 section is HIDDEN (by request, 2026-08-10) — the inbox shows
          only what needs acting on; the header stats carry the summary. */}
      {unowned.length === 0 ? null : (
      <IbSection id="ib-assign" kind="assign" verb="Need an owner" count={unowned.length} unit="question"
        tag={<OwnershipTag cls="operator" showLabel={false} />}
        lead={<><span className="v3ib-unit">(phase · decision)</span> across{" "}
          <b>{unownedGroups.size}</b> <span className="v3ib-unit">element{unownedGroups.size === 1 ? "" : "s"}</span>
          {" "}— route each element&rsquo;s questions to an owner. Not an answer; heard-count untouched.</>}>
          <ul className="v3ib-list">
            {[...unownedGroups.entries()].map(([group, items]) => {
              const key = `grp:${group}`;
              const owner = pickedOwner(key);
              return (
                <li key={group} className="v3ib-grp">
                  <span className="v3ib-grp-h">
                    <span className="v3ib-grp-n">{group}</span>
                    <span className="v3ib-grp-c">{items.length} question{items.length === 1 ? "" : "s"} unowned</span>
                    <span className="v3ib-controls">
                      {cSelect(key, `asg-${key}`, `Assign owner to ${group}…`)}
                      <button type="button" className="v3ib-btn" disabled={busy === key || !owner}
                        onClick={() => void run(key, items.map((it) => assignAction(it.about, owner!)))}>
                        {busy === key ? "…" : <><span aria-hidden="true">→ </span>{`assign all ${items.length}`}</>}</button>
                    </span>
                  </span>
                  <ul className="v3ib-grp-qs">
                    {items.map((it) => (
                      <li key={it.about} className="v3ib-grp-q">
                        <ClaimStatus state={it.status} showLabel={false} />
                        <QLine about={it.about} tail={it.status === "blocked" ? <span className="v3ib-blk" title="Blocked (e.g. an unresolved reference) — still ownerless; assigning an owner is valid, it just can't be answered until unblocked">blocked</span> : undefined} />
                        <button type="button" className="v3ib-btn ghost sm" aria-expanded={!!fate[it.about]}
                          aria-label={spoken(`Nobody owns this — rule on: ${Q(it.about).question}`)}
                          onClick={() => setFate((s) => ({ ...s, [it.about]: !s[it.about] }))}>no owner?</button>
                        {/* REVERSIBLE curation: a proposal minted from a kit question can be
                            retracted, which removes the element AND its question from the read
                            model exactly as if it had never been minted. */}
                        {proposalOf.has(it.about) ? (
                          <button type="button" className="v3ib-btn ghost sm" disabled={busy === it.about}
                            title="Retract this proposal — removes the proposed element and its question; the mint stays in the action log as a trace"
                            onClick={() => { const r = retractProposal(proposalOf.get(it.about)!.elementId, by, nowISO()); if (r) void run(it.about, r); }}>
                            retract proposal</button>
                        ) : null}
                        {fate[it.about] ? (
                          <span className="v3ib-fate">
                            <input className="v3ib-reason" aria-label={spoken(`Reason for ruling on: ${Q(it.about).question}`)} placeholder="Reason (recorded)…" value={fateReason[it.about] ?? ""} onChange={(e) => setFateReason((s) => ({ ...s, [it.about]: e.target.value }))} />
                            <button type="button" className="v3ib-btn ghost sm" disabled={busy === it.about || !fateReason[it.about]?.trim()} aria-label={spoken(`Rule out-of-scope: ${Q(it.about).question}`)} onClick={() => void run(it.about, { kind: "decide-fate", about: it.about, slot: it.slot, decision: "out-of-scope", reason: fateReason[it.about].trim(), by, at: nowISO() })}>out-of-scope</button>
                            <button type="button" className="v3ib-btn ghost sm" disabled={busy === it.about || !fateReason[it.about]?.trim()} aria-label={spoken(`Escalate: ${Q(it.about).question}`)} onClick={() => void run(it.about, { kind: "decide-fate", about: it.about, slot: it.slot, decision: "escalate", reason: fateReason[it.about].trim(), by, at: nowISO() })}>escalate</button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
      </IbSection>
      )}

      {/* 2 · SEAMS → the session queue. One summary line, expandable (see SessionsSection). */}
      {/* THE SESSIONS SECTION IS GONE (on request, 2026-08-13). A jointly-owned
          question now goes out on BOTH owners' links, so there is nothing here for
          an operator to decide — the section's only act was "propose a time", which
          booked nothing and was the last remnant of the routing that held those
          questions back until a meeting existed. The seam is still visible where it
          is useful: Discover shows which pairs share questions. */}

      {/* 3 · CONFLICTS → ADJUDICATE (read-side; resolution gated) */}
      {/* EMPTY-STATE: 0 conflicts → section HIDDEN (by request, 2026-08-10; the earlier
          "passed check" band retired with it). */}
      {ledger.conflicts.length === 0 ? null : (
      <IbSection id="ib-adjudicate" kind="adjudicate" verb="Adjudicate" count={ledger.conflicts.length} unit="conflict"
        tag={<OwnershipTag cls="operator" showLabel={false} />}
        lead={<>Two live claims on one locus; the element <b>freezes</b>, no auto-winner.</>}
        provisional="resolution completion is a write — gated; read-side only for now">
        <ul className="v3ib-list">
          {ledger.conflicts.map((c) => (
            <li key={c.about} className="v3ib-row is-frozen">
              <span className="v3ib-row-h"><ClaimStatus state="conflict" showLabel={false} /><QLine about={c.about} tail={<span className="v3ib-frozen-tag"><span aria-hidden="true">🔒 </span>frozen · {c.count} live claims</span>} /></span>
              <span className="v3ib-awaiting"><span className="v3ib-awaiting-l">awaiting operator adjudication — capture the resolution via the team</span><ProvisionalMark what="the resolving write is gated; no auto-winner" /></span>
            </li>
          ))}
        </ul>
      </IbSection>
      )}

      {/* 4 · PINNED IN FLIGHT → the routing DECISION. A link was sent carrying these
          questions, so they are pinned to whoever received them. A later derivation (or
          a bulk assign) now wants a different owner — and it does NOT get to move them.
          The pin holds; the operator decides, one locus at a time:
            · keep    → the recipient still answers what they were sent (pin stands)
            · release → the pin is lifted and the standing owner takes over
          There is no automatic sweep, and no silent re-attribution of a sent question.
          EMPTY-STATE: 0 → section hidden, like every other section here. */}
      {ledger.pinConflicts.length === 0 ? null : (
            <IbSection id="ib-pinned" kind="decide" verb="Pinned — in flight" count={ledger.pinConflicts.length} unit="question"
        tag={<OwnershipTag cls="operator" showLabel={false} />}
        lead={<>Already <b>sent on a link</b> that a fresh derivation would re-route. The link&rsquo;s
          recipient <b>keeps</b> them until you say otherwise — decide each one.</>}>
        <ul className="v3ib-list">
          {ledger.pinConflicts.map((c) => {
            const sent = c.pin.sentAt ? c.pin.sentAt.slice(0, 10) : null;
            return (
              <li key={c.about} className="v3ib-row">
                <span className="v3ib-row-h">
                  <ClaimStatus state="open" showLabel={false} />
                  <QLine about={c.about} tail={<span className="v3ib-owner"><span aria-hidden="true">📌 </span>pinned to {displayPersonLabel(c.pinned)}{sent ? ` · link sent ${sent}` : ""}</span>} />
                </span>
                <span className="v3ib-exits">
                  <span className="v3ib-exits-l">re-derivation routes this to <b>{displayPersonLabel(c.derived)}</b> — nothing moved:</span>
                  <button type="button" className="v3ib-btn ghost sm" disabled={busy === `pin:${c.about}`}
                    onClick={() => void run(`pin:${c.about}`, { kind: "pin-resolve", about: c.about, decision: "keep", against: c.derived, by, at: nowISO() })}>
                    keep with {displayPersonLabel(c.pinned)}
                  </button>
                  <button type="button" className="v3ib-btn ghost sm" disabled={busy === `pin:${c.about}`}
                    onClick={() => void run(`pin:${c.about}`, { kind: "pin-resolve", about: c.about, decision: "release", against: c.derived, by, at: nowISO() })}>
                    release<span aria-hidden="true"> → </span>move to {displayPersonLabel(c.derived)}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </IbSection>
      )}

      {/* OWNED & IN-FLIGHT → reassign / unassign + the stakeholder's three exits */}
      {/* EMPTY-STATE: 0 in-flight → section HIDDEN (by request, 2026-08-10). */}
      {ledger.assignments.length === 0 ? null : (
      <IbSection id="ib-inflight" className="is-gated" kind="assign" verb="Owned &amp; in-flight" count={ledger.assignments.length} unit="question"
        tag={<OwnershipTag cls="stakeholder" showLabel={false} />}
        lead={<>Reassign if you routed wrong, or record the holder&rsquo;s exit. Operator-entered
          captures: <b>{ledger.captures.length}</b> — <b>not</b> counted as heard.</>}
        provisional="only a stakeholder ANSWER through the system ticks heard — gated">
          <ul className="v3ib-list">
            {ledger.assignments.map((a) => {
              const cap = ledger.captures.find((c) => c.about === a.about);
              const ref = ledger.redirects.find((r) => r.about === a.about && r.toOwner !== a.owner.label);
              const openExit = exit[a.about] ?? null;
              // A locus already on a SENT link is pinned to its recipient — that pin,
              // not this assignment, is who currently holds the question. Say so rather
              // than printing an owner the fold doesn't honour.
              const pin = ledger.pins.find((p) => p.about === a.about);
              return (
                <li key={a.about} className="v3ib-row">
                  <span className="v3ib-row-h">
                    <ClaimStatus state="open" showLabel={false} />
                    <QLine about={a.about} tail={pin
                      ? <span className="v3ib-owner"><span aria-hidden="true">📌 </span>pinned to {displayPersonLabel(pin.owner.label)} <span className="v3ib-unit">(on a sent link — pinned)</span></span>
                      : <span className="v3ib-owner"><span aria-hidden="true">→ </span>owner: {a.owner.label}</span>} />
                    <span className="v3ib-reassign">
                      {cSelect(a.about, `re-${a.about}`, `Reassign to… — ${Q(a.about).question}`)}
                      <button type="button" className="v3ib-btn ghost sm" disabled={busy === a.about || !pickedOwner(a.about)} aria-label={spoken(`Reassign: ${Q(a.about).question}`)} onClick={() => void run(a.about, assignAction(a.about, pickedOwner(a.about)!))}>reassign</button>
                      <button type="button" className="v3ib-btn ghost sm" disabled={busy === a.about} aria-label={spoken(`Unassign ${a.owner.label} from: ${Q(a.about).question}`)} onClick={() => void run(a.about, { kind: "unassign", about: a.about, reason: "operator", by, at: nowISO() })}>unassign</button>
                    </span>
                  </span>
                  {cap ? (
                    <span className="v3ib-captured"><span className="v3ib-captured-tag"><span aria-hidden="true">▧</span> answer captured via team</span><span className="v3ib-captured-body">&ldquo;{cap.answer}&rdquo; — {cap.saidByName}{cap.saidByRole ? `, ${cap.saidByRole}` : ""}</span><ProvisionalMark what="operator-entered, not a stakeholder assertion; not counted as heard" /></span>
                  ) : ref ? (
                    <span className="v3ib-referral"><span className="v3ib-referral-l"><span aria-hidden="true">↪ </span>referral: {ref.saidByName} said ask <b>{ref.toOwner}</b> instead</span>
                      <button type="button" className="v3ib-btn" disabled={busy === a.about} onClick={() => void run(a.about, assignAction(a.about, ref.toOwner))}>confirm<span aria-hidden="true"> → </span>reassign to {ref.toOwner}</button></span>
                  ) : (
                    <span className="v3ib-exits">
                      <span className="v3ib-exits-l">awaiting {a.owner.label} — their exits, captured via the team for now:</span>
                      {/* One set of these per in-flight question, and the visible word
                          ("answer") is the same on all of them — so the accessible name
                          names the QUESTION and the holder as well, or a screen-reader
                          user hears "answer button" twenty times with no way to tell
                          which question they are about to record against. */}
                      {(["answer", "redirect", "release"] as const).map((k) => (
                        <button key={k} type="button" className="v3ib-tab" aria-pressed={openExit === k}
                          aria-label={spoken(`Record ${a.owner.label}'s ${k} for: ${Q(a.about).question}`)}
                          onClick={() => setExit((s) => ({ ...s, [a.about]: openExit === k ? null : k }))}>{k}</button>
                      ))}
                    </span>
                  )}
                  {!cap && !ref && openExit === "answer" ? (
                    <span className="v3ib-form">
                      <textarea rows={2} aria-label={spoken(`What ${a.owner.label} said, captured out-of-band, about: ${Q(a.about).question}`)} placeholder="What they said (captured out-of-band)…" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                      <span className="v3ib-form-r">
                        <input aria-label={spoken(`Name of the person who said it, for: ${Q(a.about).question}`)} placeholder="Said by (name)" value={f2[a.about] ?? ""} onChange={(e) => setF2((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about || !f1[a.about]?.trim() || !f2[a.about]?.trim()} onClick={() => void run(a.about, { kind: "capture", about: a.about, slot: slotOf(a.about), answer: f1[a.about].trim(), saidByName: f2[a.about].trim(), saidByRole: "", by, at: nowISO() })} aria-label={spoken(`Record the answer to: ${Q(a.about).question}`)}>record answer</button>
                      </span>
                      <span className="v3ib-form-note">Operator-entered · attributed to who said it · <b>not</b> counted as heard.</span>
                    </span>
                  ) : null}
                  {!cap && !ref && openExit === "redirect" ? (
                    <span className="v3ib-form">
                      <span className="v3ib-form-r">
                        <input aria-label={spoken(`Who ${a.owner.label} said to ask instead`)} placeholder="They said, ask… (target owner)" value={f2[a.about] ?? ""} onChange={(e) => setF2((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <input aria-label={spoken(`Name of the person who gave the referral, for: ${Q(a.about).question}`)} placeholder="Said by (name)" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about || !f2[a.about]?.trim() || !f1[a.about]?.trim()} onClick={() => void run(a.about, { kind: "redirect", about: a.about, slot: slotOf(a.about), toOwner: f2[a.about].trim(), saidByName: f1[a.about].trim(), by, at: nowISO() })} aria-label={spoken(`Record the redirect for: ${Q(a.about).question}`)}>record redirect</button>
                      </span>
                      <span className="v3ib-form-note">A referral, not an answer. You confirm it with one tap. Not counted as heard.</span>
                    </span>
                  ) : null}
                  {!cap && !ref && openExit === "release" ? (
                    <span className="v3ib-form">
                      <span className="v3ib-form-r">
                        <input aria-label={spoken(`Name of the person releasing: ${Q(a.about).question}`)} placeholder="Released by (name)" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about} onClick={() => void run(a.about, { kind: "unassign", about: a.about, reason: "release", saidByName: f1[a.about]?.trim() || undefined, by, at: nowISO() })} aria-label={spoken(`Record the release of: ${Q(a.about).question} — back to unowned`)}>record release<span aria-hidden="true"> → </span>back to unowned</button>
                      </span>
                      <span className="v3ib-form-note">&ldquo;Not mine&rdquo; — returns to the unowned queue. The honest signal routing was wrong. Not counted as heard.</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
      </IbSection>
      )}

      {/* DECIDED trace */}
      {ledger.decideFates.length ? (
        <IbSection id="ib-decided" kind="decide" verb="Decided" count={ledger.decideFates.length} unit="unknown"
          tag={<SourceTag source="dispositioned" />}
          lead={<>Questions the operator ruled on rather than answered — an honest trace, kept
            because a thing ruled out of scope must not read as a thing nobody got to.</>}>
          <ul className="v3ib-list">
            {ledger.decideFates.map((d) => (
              <li key={d.about} className="v3ib-row is-decided">
                <span className="v3ib-row-h"><SourceTag source="dispositioned" /><QLine about={d.about} tail={<><span className={`v3ib-fate-tag ${d.decision === "escalate" ? "esc" : "oos"}`}>{d.decision === "escalate" ? <><span aria-hidden="true">↥ </span>escalated</> : <><span aria-hidden="true">⊘ </span>out-of-scope</>}</span><span className="v3ib-fate-reason">{d.reason}</span></>} />
                  {/* THE ONE ACT A RULING OWES. This trace listed what the operator had
                      ruled on and offered nothing — the only way back from a mistaken
                      "out-of-scope" was editing the blob. Reopening is a WRITE, so it is
                      drawn as one. */}
                  <button type="button" className="v3ib-btn sm" disabled={busy === d.about}
                    aria-label={spoken(`Reopen: ${Q(d.about).question}`)}
                    onClick={() => void run(d.about, {
                      kind: "decide-fate", about: d.about, slot: slotOf(d.about),
                      decision: "reopen", reason: "reopened by the operator", by, at: nowISO(),
                    })}>{busy === d.about ? "Reopening…" : "reopen"}</button>
                </span>
              </li>
            ))}
          </ul>
        </IbSection>
      ) : null}

      {/* THE QUESTIONS BEHIND A COUNT. Read-only and dismissible: it exists so the
          operator can SEE what "closes 10 open questions" means before deciding to
          chase a document for it. Rendered through the one question renderer, so
          the wording here is the wording the stakeholder would be sent. */}
      {peek ? (
        <>
          <div className="v3ib-peek-backdrop" onClick={() => setPeek(null)} aria-hidden="true" />
          <div className="v3ib-peek-panel" role="dialog" aria-modal="true"
            aria-label={peek.orphan ? "Open questions with no system of record named" : `Open questions on ${peek.sor}`}>
            <header className="v3ib-peek-h">
              <span className="v3ib-peek-t">
                <b>{peek.abouts.length}</b> open question{peek.abouts.length === 1 ? "" : "s"}{" "}
                {peek.orphan ? <>with <b>no system of record named</b></> : <>on <b>{peek.sor}</b></>}
              </span>
              <button type="button" className="v3ib-btn ghost sm" onClick={() => setPeek(null)}>close</button>
            </header>
            <span className="v3ib-peek-m">
              {/* NO DICTIONARY IS PROMISED HERE. The SoR-keyed copy says what a named
                  system's dictionary would close; for this bucket there is no system
                  to name one, and saying otherwise would promise a document nobody
                  can be asked for. */}
              {peek.orphan
                ? <>Their entities carry no system of record, so no dictionary can be requested for them yet.</>
                : <>These are what a {peek.sor} dictionary would close.</>} They stay open and counted until
              something answers them — a dictionary, or the types confirmed by hand.
              {" "}Each says where its field came from; <b>no source on record</b> means the ontology
              named the field without saying who or what named it, which is worth knowing before
              anyone is asked about it.
            </span>
            <QuestionList abouts={peek.abouts} orphan={peek.orphan} />
          </div>
        </>
      ) : null}
    </div>
  );
}
