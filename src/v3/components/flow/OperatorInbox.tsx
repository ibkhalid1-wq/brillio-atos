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
import { useRef, useState, type ReactNode } from "react";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import type { OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { slotOf, elementIdOf } from "@/v3/lib/ledger/types";
import { readableName } from "@/v3/lib/ledger/phrasing";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { ClaimStatus, OwnershipTag, ProvisionalMark, SourceTag } from "@/v3/components/flow/studio/ledgerPrimitives";
import { asksNeedingChase, isSystemOwner, type ArtifactAskMark } from "@/v3/lib/ledger/artifactAsks";
import { operatorQueueCounts } from "@/v3/lib/ledger/operatorQueue";
import { parseDictionaryCsv } from "@/v3/lib/ledger/dictionary";
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

export default function OperatorInbox({ ledger, candidates, by, onCommit, onAskMark, onDictionary }: Props) {
  // The dictionary upload — parsed for a HONEST preview before it is committed:
  // the operator sees how many fields parsed and how many open questions this
  // file would actually close, not a promise. ONE hidden input serves every ask;
  // `pendingSor` records which ask opened the dialog, so the file is attached to
  // that system (null = the programme-wide dictionary).
  const dictRef = useRef<HTMLInputElement>(null);
  const pendingSor = useRef<string | null>(null);
  const pendingScope = useRef<string[]>([]);
  const [dictPreview, setDictPreview] = useState<{ name: string; fields: number; closes: number; csv: string; sor: string | null; scope: number } | null>(null);
  const readDictionaryFile = async (file: File, sor: string | null, scopeLoci: string[]) => {
    const csv = await file.text();
    const parsed = parseDictionaryCsv(csv, file.name.replace(/\.[^.]+$/, ""));
    // Measured against THIS ask's loci when the upload is for one system; against
    // every open typing locus for the programme-wide one. Same count either way —
    // the loci the file actually names, never an estimate.
    const scope = new Set(scopeLoci.map((about) => elementIdOf(about)));
    const closes = parsed.fields.reduce((n, f) => {
      const id = `el:attr:${f.entity.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${f.field.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return n + (scope.has(id) ? 1 : 0);
    }, 0);
    setDictPreview({ name: parsed.name, fields: parsed.fields.length, closes, csv, sor, scope: scopeLoci.length });
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
  const unowned = ledger.assignQueue;
  // Group unowned questions by their element (the area-cascade shape): one "assign an
  // owner" per group that cascades to the questions under it, not N inbox cards.
  const unownedGroups = new Map<string, typeof unowned>();
  for (const it of unowned) (unownedGroups.get(groupOf(it.about)) ?? unownedGroups.set(groupOf(it.about), []).get(groupOf(it.about))!).push(it);

  // The session queue is the ONE source (ledger.sessionQueue) — seam questions,
  // jointly owned, grouped by function pair. Never recomputed here.
  const sessionQueue = ledger.sessionQueue;
  // A "schedule" action = the seam is on the session plan (intent). It carries NO
  // date — scheduling is gated — so the open item on every seam is a DATE.
  const onPlan = new Map(ledger.schedules.map((s) => [s.pair, s] as const));

  const run = async (key: string, action: OperatorAction | OperatorAction[]) => {
    setBusy(key); try { await onCommit(action); } finally { setBusy(null); }
  };
  const pickedOwner = (key: string) => (sel[key] === OTHER ? other[key] : sel[key])?.trim();
  const isRoleOwner = (label: string) => { const c = candidates.find((x) => x.label === label); return c ? c.label === c.role : true; };

  const assignAction = (about: string, label: string): OperatorAction =>
    ({ kind: "assign", about, slot: slotOf(about), owner: { label, isRole: isRoleOwner(label) }, by, at: nowISO() });

  const cSelect = (key: string, id: string, placeholder = "Assign an owner…") => (
    <>
      <label className="v3ib-sr" htmlFor={id}>Owner</label>
      <select id={id} value={sel[key] ?? ""} onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.value }))}>
        <option value="">{placeholder}</option>
        {candidates.map((c) => <option key={c.label} value={c.label}>{displayPersonLabel(c.label)}{c.role && c.role !== c.label ? ` — ${c.role}` : ""}</option>)}
        <option value={OTHER}>Someone else…</option>
      </select>
      {sel[key] === OTHER ? <input className="v3ib-other" placeholder="Name a person or role" value={other[key] ?? ""} onChange={(e) => setOther((s) => ({ ...s, [key]: e.target.value }))} /> : null}
    </>
  );

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
  // The terms are NOT re-added here: operatorQueueCounts is the one place that sum is
  // written, and the rail badge reads the identical function. An item on this page is
  // an item on the badge by construction, not by keeping two expressions in step.
  const queue = operatorQueueCounts(ledger);
  if (queue.total === 0) return null;

  // ONE UNIT — QUESTIONS, the same unit the burn-down uses, so no reader reconciles
  // "12" against "18". A 0 section is hidden below (by request), so its 0 stat hides
  // here too — a count button must always jump to a section that exists. When NOTHING
  // is countable the whole header goes with it: a bare "INBOX — the operator-decision
  // queue…" caption is chrome describing an empty thing, not information.
  const stats = ([
    ["ib-assign", queue.assign, "need an owner"],
    ["ib-sessions", queue.sessions, "awaiting a date"],
    ["ib-adjudicate", queue.adjudicate, "to adjudicate"],
    // A DIFFERENT unit of decision from "in flight": these are pinned questions a
    // re-derivation wants to move. Counted separately so neither number restates
    // the other — the pin holds until the operator says otherwise.
    ["ib-pinned", queue.pinned, "pinned — routing to decide"],
    ["ib-inflight", queue.inFlight, "in flight"],
  ] as const).filter(([, n]) => n > 0);

  return (
    <div className="v3ib" aria-label="Operator inbox">
      {stats.length ? (
      <header className="v3ib-top">
        <span className="v3ib-title">Inbox</span>
        <span className="v3ib-count">
          {stats.map(([id, n, label], i) => (
            <span key={id}>
              {i > 0 ? " · " : ""}
              <button type="button" className="v3ib-countbtn" title={`Jump to ${label}`}
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                <b>{n}</b> {label}
              </button>
            </span>
          ))}
          <span className="v3ib-unit"> · questions</span>
        </span>
        <span className="v3ib-of">the operator-decision queue — four sources, each a section below. The burn-down above is the goal.</span>
      </header>
      ) : null}

      {/* 0 · ARTIFACT ASKS — the dictionary ask, PREVENTIVE by default: one ask per
          system of record, born at SoR identification (Frame). This inbox shows an ask
          ONLY while unprovided (remedial chase) — self-clearing on import; questions
          minted after an import REOPEN the same ask, never a second one. Ageing is the
          same operator-tracked rule as people. See docs/aura/data-dictionary-import.md. */}
      {(() => {
        const chase = asksNeedingChase(ledger.artifactAsks);
        const unattributed = ledger.artifactAsks.unattributed;
        if (!chase.length && !unattributed.weight) return null;   // self-cleared → hidden
        const now = Date.now();
        // ONE upload control, rendered per ask (keyed to that SoR) and once for the
        // programme-wide file. `loci` is the scope the preview measures against, so
        // "closes N" means N of THIS system's open questions.
        const uploadRow = (sor: string | null, loci: string[]) => {
          if (!onDictionary) return null;
          const active = dictPreview && dictPreview.sor === sor;
          const key = sor ?? "*";
          return (
            <div className="v3ib-dict-up">
              {active ? (
                <>
                  <span className="v3ib-dict-prev">
                    <b>{dictPreview.name}</b> · {dictPreview.fields} field{dictPreview.fields === 1 ? "" : "s"} parsed ·
                    {" "}<b>{dictPreview.closes}</b> of the {dictPreview.scope} open typing question{dictPreview.scope === 1 ? "" : "s"}
                    {sor ? ` on ${sor}` : ""} match
                    {dictPreview.closes === 0 ? " — nothing here matches an open locus; check the entity/field columns" : ""}
                  </span>
                  <button type="button" className="v3ib-btn" disabled={busy === `dict:${key}`}
                    onClick={() => { setBusy(`dict:${key}`); void Promise.resolve(onDictionary(dictPreview.csv, dictPreview.sor)).finally(() => { setBusy(null); setDictPreview(null); }); }}>
                    {busy === `dict:${key}` ? "attaching…" : sor ? `attach as the ${sor} dictionary` : "attach this dictionary"}
                  </button>
                  <button type="button" className="v3ib-btn ghost sm" onClick={() => setDictPreview(null)}>discard</button>
                </>
              ) : (
                <button type="button" className="v3ib-btn ghost"
                  onClick={() => { pendingSor.current = sor; pendingScope.current = loci; dictRef.current?.click(); }}>
                  ⬆ upload {sor ? `the ${sor} dictionary` : "a dictionary covering every system"} (CSV/TSV)
                </button>
              )}
            </div>
          );
        };
        return (
          <section className="v3ib-src v3ib-dict">
            <header className="v3ib-h">
              <SourceTag source="code-derived" />
              <span className="v3ib-verb">Data dictionary</span>
              <span className="v3ib-lead"><b>{chase.length}</b> system{chase.length === 1 ? "" : "s"} of record with an unprovided dictionary — <b>one upload each</b> closes the typing wall, not form fields to the domain expert. Dictionary claims land <b>code-derived · weak</b> — any owner can still deviate.</span>
            </header>
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
                    {ask.entityCount === 0 ? null : <>{" "}· <b>closes {ask.weight}</b> open question{ask.weight === 1 ? "" : "s"}</>}
                  </span>
                  <span className="v3ib-dict-msg">
                    {ask.state === "reopened" ? (
                      <><b>reopened</b> — {ask.weight} typing question{ask.weight === 1 ? "" : "s"} since the import attach to this same ask (never a second one).</>
                    ) : ask.state === "requested" ? (
                      <>requested · <span className={`v3ln-age${age !== null && age >= 21 ? " hot" : age !== null && age >= 9 ? " warm" : ""}`}>awaiting {age !== null ? `· ${age}d` : ""} · operator-tracked</span></>
                    ) : (
                      <><b>not yet requested</b> — an incomplete Frame item until requested, provided, or marked has-none.</>
                    )}
                    {" "}<ProvisionalMark what="freeform-document parsing is model-gated; CSV/XLSX dictionaries parse now" />
                  </span>
                  {onAskMark ? (
                    <span className="v3ib-dict-actions">
                      {ask.state === "unrequested" || ask.state === "reopened" ? (
                        <button type="button" className="v3ib-btn ghost sm" onClick={() => onAskMark({ sor: ask.sor, mark: "requested", by, at: nowISO() })}>mark requested</button>
                      ) : null}
                      {ask.state !== "has-none" ? (
                        <button type="button" className="v3ib-btn ghost sm" onClick={() => onAskMark({ sor: ask.sor, mark: "has-none", by, at: nowISO() })}>has no dictionary</button>
                      ) : null}
                    </span>
                  ) : null}
                  {/* EACH ask takes its OWN dictionary — a CRM export answers nothing
                      about the finance system, so the upload is keyed to this SoR. */}
                  {uploadRow(ask.sor, ask.abouts)}
                </div>
              );
            })}
            {unattributed.weight ? (
              <div className="v3ib-dict-ask">
                <span className="v3ib-dict-to"><b>{unattributed.weight}</b> typing question{unattributed.weight === 1 ? "" : "s"} on entities with <b>no system of record named</b></span>
                <span className="v3ib-dict-msg">a Frame gap, not an ask — name the SoR and these attach to its ask.</span>
              </div>
            ) : null}
            {/* THE UPLOAD — the write half of the ask. Parsed first so the operator
                sees what this file actually closes before committing it. Per-SoR
                uploads sit on their own ask above; this is the one file that covers
                every system (the shape a programme that never keys keeps). */}
            {onDictionary ? (
              <>
                <input ref={dictRef} type="file" accept=".csv,.tsv,.txt" className="v3ib-sr"
                  onChange={(e) => {
                    const f = e.target.files?.[0]; e.target.value = "";
                    if (f) void readDictionaryFile(f, pendingSor.current, pendingScope.current);
                  }} />
                {uploadRow(null, ledger.typingLoci.map((i) => i.about))}
              </>
            ) : null}
          </section>
        );
      })()}

      {/* 1 · UNOWNED → ASSIGN (grouped, cascades) / DECIDE FATE */}
      {/* EMPTY-STATE: a 0 section is HIDDEN (by request, 2026-08-10) — the inbox shows
          only what needs acting on; the header stats carry the summary. */}
      {unowned.length === 0 ? null : (
      <section id="ib-assign" className="v3ib-src">
        <header className="v3ib-h">
          <OwnershipTag cls="operator" showLabel={false} />
          <span className="v3ib-verb">Need an owner</span>
          {/* QUESTIONS is the unit (same as the burn-down); the 12 is ELEMENTS, labelled. Only
              PHASE / DECISION questions are here — value-set/type questions route to the
              dictionary, so each row is a genuine ownership decision, not a typing chore. */}
          <span className="v3ib-lead"><b>{unowned.length}</b> question{unowned.length === 1 ? "" : "s"} <span className="v3ib-unit">(phase · decision)</span> across <b>{unownedGroups.size}</b> <span className="v3ib-unit">element{unownedGroups.size === 1 ? "" : "s"}</span> — route each element&apos;s questions to an owner. Not an answer; heard-count untouched.</span>
        </header>
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
                        {busy === key ? "…" : `→ assign all ${items.length}`}</button>
                    </span>
                  </span>
                  <ul className="v3ib-grp-qs">
                    {items.map((it) => (
                      <li key={it.about} className="v3ib-grp-q">
                        <ClaimStatus state={it.status} showLabel={false} />
                        <QLine about={it.about} tail={it.status === "blocked" ? <span className="v3ib-blk" title="Blocked (e.g. an unresolved reference) — still ownerless; assigning an owner is valid, it just can't be answered until unblocked">blocked</span> : undefined} />
                        <button type="button" className="v3ib-btn ghost sm" onClick={() => setFate((s) => ({ ...s, [it.about]: !s[it.about] }))}>no owner?</button>
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
                            <input className="v3ib-reason" placeholder="Reason (recorded)…" value={fateReason[it.about] ?? ""} onChange={(e) => setFateReason((s) => ({ ...s, [it.about]: e.target.value }))} />
                            <button type="button" className="v3ib-btn ghost sm" disabled={busy === it.about || !fateReason[it.about]?.trim()} onClick={() => void run(it.about, { kind: "decide-fate", about: it.about, slot: it.slot, decision: "out-of-scope", reason: fateReason[it.about].trim(), by, at: nowISO() })}>out-of-scope</button>
                            <button type="button" className="v3ib-btn ghost sm" disabled={busy === it.about || !fateReason[it.about]?.trim()} onClick={() => void run(it.about, { kind: "decide-fate", about: it.about, slot: it.slot, decision: "escalate", reason: fateReason[it.about].trim(), by, at: nowISO() })}>escalate</button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
      </section>
      )}

      {/* 2 · SEAMS → the session queue. Joint ownership is AUTO-SET at seam detection
          (migrate: jointOrOwner), so there is nothing to "mark" — the seam is already
          jointly owned and its questions grouped. The only pending thing is a DATE, which
          is gated. So a seam is either AWAITING-A-DATE or (once scheduling lands) BOOKED —
          no no-op "marked" state that confirms a thing already true. */}
      {/* EMPTY-STATE: 0 seams → section HIDDEN (by request, 2026-08-10). */}
      {sessionQueue.length === 0 ? null : (
      <section id="ib-sessions" className="v3ib-src">
        <>
          <header className="v3ib-h">
            <OwnershipTag cls="joint" showLabel={false} />
            <span className="v3ib-verb">Sessions</span>
            <span className="v3ib-lead"><b>{sessionQueue.length}</b> seam{sessionQueue.length === 1 ? "" : "s"} — <b>already jointly owned</b> (auto-set at detection). Each is a joint session; the open item is a <b>date</b>, which is gated.</span>
            <ProvisionalMark what="scheduling a real date is a gated write — 'propose a time' records the intent only" />
          </header>
          <ul className="v3ib-seams">
            {sessionQueue.map(({ pair, abouts }) => {
              const planned = onPlan.get(pair);
              return (
                <li key={pair} className={`v3ib-seam${planned ? " planned" : ""}`}>
                  <span className="v3ib-seam-h"><span aria-hidden="true">⋈</span> {pair}</span>
                  <span className="v3ib-seam-n">{abouts.length} joint question{abouts.length === 1 ? "" : "s"} · <span className="v3ib-nodate">⏳ awaiting a date</span></span>
                  {planned ? (
                    <span className="v3ib-onplan">on the session plan · no date yet (gated)</span>
                  ) : (
                    <button type="button" className="v3ib-btn ghost" disabled={busy === pair}
                      onClick={() => void run(pair, { kind: "schedule", pair, parties: pair.split("⋈").map((s) => s.trim()) as [string, string], abouts, by, at: nowISO() })}>{busy === pair ? "…" : "propose a time"}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      </section>
      )}

      {/* 3 · CONFLICTS → ADJUDICATE (read-side; resolution gated) */}
      {/* EMPTY-STATE: 0 conflicts → section HIDDEN (by request, 2026-08-10; the earlier
          "passed check" band retired with it). */}
      {ledger.conflicts.length === 0 ? null : (
      <section id="ib-adjudicate" className="v3ib-src">
        <header className="v3ib-h">
          <span className="v3ib-verb">Adjudicate</span>
          <span className="v3ib-lead"><b>{ledger.conflicts.length}</b> conflict{ledger.conflicts.length === 1 ? "" : "s"} — two live claims on one locus; the element <b>freezes</b>, no auto-winner.</span>
          <ProvisionalMark what="resolution completion is a write — gated; read-side only for now" />
        </header>
        <ul className="v3ib-list">
          {ledger.conflicts.map((c) => (
            <li key={c.about} className="v3ib-row is-frozen">
              <span className="v3ib-row-h"><ClaimStatus state="conflict" showLabel={false} /><QLine about={c.about} tail={<span className="v3ib-frozen-tag">🔒 frozen · {c.count} live claims</span>} /></span>
              <span className="v3ib-awaiting"><span className="v3ib-awaiting-l">awaiting operator adjudication — capture the resolution via the team</span><ProvisionalMark what="the resolving write is gated; no auto-winner" /></span>
            </li>
          ))}
        </ul>
      </section>
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
      <section id="ib-pinned" className="v3ib-src">
        <header className="v3ib-h">
          <OwnershipTag cls="operator" showLabel={false} />
          <span className="v3ib-verb">Pinned — in flight</span>
          <span className="v3ib-lead">
            <b>{ledger.pinConflicts.length}</b> question{ledger.pinConflicts.length === 1 ? "" : "s"} already <b>sent on a link</b> that a
            fresh derivation would re-route. The link&apos;s recipient <b>keeps</b> them until you say otherwise — decide each one.
          </span>
        </header>
        <ul className="v3ib-list">
          {ledger.pinConflicts.map((c) => {
            const sent = c.pin.sentAt ? c.pin.sentAt.slice(0, 10) : null;
            return (
              <li key={c.about} className="v3ib-row">
                <span className="v3ib-row-h">
                  <ClaimStatus state="open" showLabel={false} />
                  <QLine about={c.about} tail={<span className="v3ib-owner">📌 {displayPersonLabel(c.pinned)}{sent ? ` · link sent ${sent}` : ""}</span>} />
                </span>
                <span className="v3ib-exits">
                  <span className="v3ib-exits-l">re-derivation routes this to <b>{displayPersonLabel(c.derived)}</b> — nothing moved:</span>
                  <button type="button" className="v3ib-btn ghost sm" disabled={busy === `pin:${c.about}`}
                    onClick={() => void run(`pin:${c.about}`, { kind: "pin-resolve", about: c.about, decision: "keep", against: c.derived, by, at: nowISO() })}>
                    keep with {displayPersonLabel(c.pinned)}
                  </button>
                  <button type="button" className="v3ib-btn ghost sm" disabled={busy === `pin:${c.about}`}
                    onClick={() => void run(`pin:${c.about}`, { kind: "pin-resolve", about: c.about, decision: "release", against: c.derived, by, at: nowISO() })}>
                    release → move to {displayPersonLabel(c.derived)}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      )}

      {/* OWNED & IN-FLIGHT → reassign / unassign + the stakeholder's three exits */}
      {/* EMPTY-STATE: 0 in-flight → section HIDDEN (by request, 2026-08-10). */}
      {ledger.assignments.length === 0 ? null : (
      <section id="ib-inflight" className="v3ib-src is-gated">
        <>
          <header className="v3ib-h">
            <OwnershipTag cls="stakeholder" showLabel={false} />
            <span className="v3ib-verb">Owned &amp; in-flight</span>
            <span className="v3ib-lead">Reassign if you routed wrong; or record the holder&apos;s exit. Operator-entered captures: <b>{ledger.captures.length}</b> — <b>not</b> counted as heard.</span>
            <ProvisionalMark what="only a stakeholder ANSWER through the system ticks heard — gated" />
          </header>
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
                      ? <span className="v3ib-owner">📌 {displayPersonLabel(pin.owner.label)} <span className="v3ib-unit">(on a sent link — pinned)</span></span>
                      : <span className="v3ib-owner">→ {a.owner.label}</span>} />
                    <span className="v3ib-reassign">
                      {cSelect(a.about, `re-${a.about}`, "Reassign to…")}
                      <button type="button" className="v3ib-btn ghost sm" disabled={busy === a.about || !pickedOwner(a.about)} onClick={() => void run(a.about, assignAction(a.about, pickedOwner(a.about)!))}>reassign</button>
                      <button type="button" className="v3ib-btn ghost sm" disabled={busy === a.about} onClick={() => void run(a.about, { kind: "unassign", about: a.about, reason: "operator", by, at: nowISO() })}>unassign</button>
                    </span>
                  </span>
                  {cap ? (
                    <span className="v3ib-captured"><span className="v3ib-captured-tag"><span aria-hidden="true">▧</span> answer captured via team</span><span className="v3ib-captured-body">&ldquo;{cap.answer}&rdquo; — {cap.saidByName}{cap.saidByRole ? `, ${cap.saidByRole}` : ""}</span><ProvisionalMark what="operator-entered, not a stakeholder assertion; not counted as heard" /></span>
                  ) : ref ? (
                    <span className="v3ib-referral"><span className="v3ib-referral-l">↪ referral: {ref.saidByName} said ask <b>{ref.toOwner}</b> instead</span>
                      <button type="button" className="v3ib-btn" disabled={busy === a.about} onClick={() => void run(a.about, assignAction(a.about, ref.toOwner))}>confirm → reassign to {ref.toOwner}</button></span>
                  ) : (
                    <span className="v3ib-exits">
                      <span className="v3ib-exits-l">awaiting {a.owner.label} — their exits, captured via the team for now:</span>
                      {(["answer", "redirect", "release"] as const).map((k) => (
                        <button key={k} type="button" className="v3ib-tab" aria-pressed={openExit === k} onClick={() => setExit((s) => ({ ...s, [a.about]: openExit === k ? null : k }))}>{k}</button>
                      ))}
                    </span>
                  )}
                  {!cap && !ref && openExit === "answer" ? (
                    <span className="v3ib-form">
                      <textarea rows={2} placeholder="What they said (captured out-of-band)…" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                      <span className="v3ib-form-r">
                        <input placeholder="Said by (name)" value={f2[a.about] ?? ""} onChange={(e) => setF2((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about || !f1[a.about]?.trim() || !f2[a.about]?.trim()} onClick={() => void run(a.about, { kind: "capture", about: a.about, slot: slotOf(a.about), answer: f1[a.about].trim(), saidByName: f2[a.about].trim(), saidByRole: "", by, at: nowISO() })}>record answer</button>
                      </span>
                      <span className="v3ib-form-note">Operator-entered · attributed to who said it · <b>not</b> counted as heard.</span>
                    </span>
                  ) : null}
                  {!cap && !ref && openExit === "redirect" ? (
                    <span className="v3ib-form">
                      <span className="v3ib-form-r">
                        <input placeholder="They said, ask… (target owner)" value={f2[a.about] ?? ""} onChange={(e) => setF2((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <input placeholder="Said by (name)" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about || !f2[a.about]?.trim() || !f1[a.about]?.trim()} onClick={() => void run(a.about, { kind: "redirect", about: a.about, slot: slotOf(a.about), toOwner: f2[a.about].trim(), saidByName: f1[a.about].trim(), by, at: nowISO() })}>record redirect</button>
                      </span>
                      <span className="v3ib-form-note">A referral, not an answer. You confirm it with one tap. Not counted as heard.</span>
                    </span>
                  ) : null}
                  {!cap && !ref && openExit === "release" ? (
                    <span className="v3ib-form">
                      <span className="v3ib-form-r">
                        <input placeholder="Released by (name)" value={f1[a.about] ?? ""} onChange={(e) => setF1((s) => ({ ...s, [a.about]: e.target.value }))} />
                        <button type="button" className="v3ib-btn" disabled={busy === a.about} onClick={() => void run(a.about, { kind: "unassign", about: a.about, reason: "release", saidByName: f1[a.about]?.trim() || undefined, by, at: nowISO() })}>record release → back to unowned</button>
                      </span>
                      <span className="v3ib-form-note">&ldquo;Not mine&rdquo; — returns to the unowned queue. The honest signal routing was wrong. Not counted as heard.</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      </section>
      )}

      {/* DECIDED trace */}
      {ledger.decideFates.length ? (
        <section className="v3ib-src">
          <header className="v3ib-h"><span className="v3ib-verb">Decided</span><span className="v3ib-lead">{ledger.decideFates.length} unknown{ledger.decideFates.length === 1 ? "" : "s"} the operator ruled on — an honest trace.</span></header>
          <ul className="v3ib-list">
            {ledger.decideFates.map((d) => (
              <li key={d.about} className="v3ib-row is-decided">
                <span className="v3ib-row-h"><SourceTag source="dispositioned" /><QLine about={d.about} tail={<><span className={`v3ib-fate-tag ${d.decision === "escalate" ? "esc" : "oos"}`}>{d.decision === "escalate" ? "↥ escalated" : "⊘ out-of-scope"}</span><span className="v3ib-fate-reason">{d.reason}</span></>} /></span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
