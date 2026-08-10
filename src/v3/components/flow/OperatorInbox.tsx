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
import { useState, type ReactNode } from "react";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import type { OperatorAction } from "@/v3/lib/ledger/operatorActions";
import { slotOf, elementIdOf } from "@/v3/lib/ledger/types";
import { questionForLocus, readableName, makeNameOf } from "@/v3/lib/ledger/phrasing";
import { ClaimStatus, OwnershipTag, ProvisionalMark, SourceTag } from "@/v3/components/flow/studio/ledgerPrimitives";

interface Candidate { label: string; role: string }
interface Props {
  ledger: ProgramLedger;
  candidates: Candidate[];
  by: string;
  onCommit: (action: OperatorAction | OperatorAction[]) => Promise<void>;
}

const nowISO = () => new Date().toISOString();
const OTHER = "__other__";

export default function OperatorInbox({ ledger, candidates, by, onCommit }: Props) {
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
  // Qualified names — "Appointment.status", not a bare "status" — so every question is
  // self-descriptive and two same-slot rows on different elements never look identical.
  const qualifiedName = makeNameOf(elements);
  const Q = (about: string) => questionForLocus(about, qualifiedName);
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
        {candidates.map((c) => <option key={c.label} value={c.label}>{c.label}{c.role && c.role !== c.label ? ` — ${c.role}` : ""}</option>)}
        <option value={OTHER}>Someone else…</option>
      </select>
      {sel[key] === OTHER ? <input className="v3ib-other" placeholder="Name a person or role" value={other[key] ?? ""} onChange={(e) => setOther((s) => ({ ...s, [key]: e.target.value }))} /> : null}
    </>
  );

  const QLine = ({ about, tail }: { about: string; tail?: ReactNode }) => {
    const p = Q(about);
    return (
      <span className="v3ib-q" title={about}>
        <span className="v3ib-qtype">{p.typeTag}</span>
        <span className="v3ib-qtext">{p.question}</span>
        {tail}
      </span>
    );
  };

  return (
    <div className="v3ib" aria-label="Operator inbox">
      <header className="v3ib-top">
        <span className="v3ib-title">Inbox</span>
        {/* ONE UNIT — QUESTIONS, the same unit the burn-down uses (18 unowned, 106 open),
            so no reader reconciles "12" against "18". "Need an owner" is unowned QUESTIONS
            (= burn-down = the Assign section), NOT the 12 elements those route through.
            Each count sums exactly the section below it and clicks through to it. */}
        <span className="v3ib-count">
          {/* A 0 section is hidden below (by request, 2026-08-10) — so its 0 stat hides
              here too; a count button must always jump to a section that exists. */}
          {(() => {
            const stats = ([
              ["ib-assign", unowned.length, "need an owner"],
              ["ib-sessions", sessionQueue.length, "awaiting a date"],
              ["ib-adjudicate", ledger.conflicts.length, "to adjudicate"],
              ["ib-inflight", ledger.assignments.length, "in flight"],
            ] as const).filter(([, n]) => n > 0);
            if (!stats.length) return <span className="v3ib-unit">nothing needs the operator right now</span>;
            return (<>
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
            </>);
          })()}
        </span>
        <span className="v3ib-of">the operator-decision queue — four sources, each a section below. The burn-down above is the goal.</span>
      </header>

      {/* 0 · THE TYPING WALL → one dictionary upload to the SYSTEM OWNER (not N questions
          to the domain expert). "What type is X?" (dataType/valueSet/optionality) is answered
          by the client's data dictionary, imported as code-derived · weak. See
          docs/aura/data-dictionary-import.md. */}
      {ledger.dictionaryName || ledger.typingLoci.length > 0 ? (() => {
        const systemOwner = candidates.find((c) => /\b(it|ehr|system|systems|admin|data|platform|technolog|salesforce)\b/i.test(`${c.label} ${c.role}`));
        return (
          <section className="v3ib-src v3ib-dict">
            <header className="v3ib-h">
              <SourceTag source="code-derived" />
              <span className="v3ib-verb">Data dictionary</span>
              {ledger.dictionaryName ? (
                <span className="v3ib-lead">Typing questions closed from <b>{ledger.dictionaryName}</b> — <b>{ledger.typingLoci.length}</b> typing unknown{ledger.typingLoci.length === 1 ? "" : "s"} left (the genuinely-contested residue). Dictionary claims are <b>code-derived · weak</b> — any owner can still deviate.</span>
              ) : (
                <span className="v3ib-lead"><b>{ledger.typingLoci.length}</b> &ldquo;what type is X?&rdquo; question{ledger.typingLoci.length === 1 ? "" : "s"} (types · value sets · optionality) — <b>one upload</b> of the data dictionary closes the wall, not {ledger.typingLoci.length} form fields to the domain expert.</span>
              )}
            </header>
            {!ledger.dictionaryName && ledger.typingLoci.length > 0 ? (
              <div className="v3ib-dict-ask">
                <span className="v3ib-dict-to">→ <b>{systemOwner ? systemOwner.label : "the system owner (IT/EHR Lead, Salesforce admin)"}</b>{systemOwner && systemOwner.role !== systemOwner.label ? ` · ${systemOwner.role}` : ""}</span>
                <span className="v3ib-dict-msg">&ldquo;Upload your current data dictionary&rdquo; — one ask, routed to the system owner, not the domain expert. <ProvisionalMark what="freeform-document parsing is model-gated; CSV/XLSX dictionaries parse now" /></span>
              </div>
            ) : null}
          </section>
        );
      })() : null}

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
              return (
                <li key={a.about} className="v3ib-row">
                  <span className="v3ib-row-h">
                    <ClaimStatus state="open" showLabel={false} />
                    <QLine about={a.about} tail={<span className="v3ib-owner">→ {a.owner.label}</span>} />
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
