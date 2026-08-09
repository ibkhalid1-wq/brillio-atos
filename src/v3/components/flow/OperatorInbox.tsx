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
import { questionForLocus, readableName } from "@/v3/lib/ledger/phrasing";
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
  const Q = (about: string) => questionForLocus(about, (id) => nameOf.get(id));
  const groupOf = (about: string) => {
    const el = elOf.get(elementIdOf(about));
    if (el?.of) return nameOf.get(el.of) || readableName(undefined, el.of);
    return el?.name || readableName(undefined, elementIdOf(about));
  };

  const unowned = ledger.queue.unowned;
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
        <span className="v3ib-count">
          <b>{unownedGroups.size}</b> need an owner · <b>{sessionQueue.length}</b> awaiting a date{ledger.conflicts.length ? <> · <b>{ledger.conflicts.length}</b> to adjudicate</> : null}
        </span>
        <span className="v3ib-of">the small operator-action subset — the burn-down above is the goal.</span>
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
      <section className="v3ib-src">
        <header className="v3ib-h">
          <OwnershipTag cls="operator" showLabel={false} />
          <span className="v3ib-verb">Assign</span>
          <span className="v3ib-lead"><b>{unowned.length}</b> unowned question{unowned.length === 1 ? "" : "s"} across <b>{unownedGroups.size}</b> element{unownedGroups.size === 1 ? "" : "s"} — route each element&apos;s questions to an owner. Not an answer; heard-count untouched.</span>
        </header>
        {unowned.length === 0 ? <p className="v3ib-empty">Nothing unowned — every open question has an owner.</p> : (
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
        )}
      </section>

      {/* 2 · SEAMS → the session queue. Joint ownership is AUTO-SET at seam detection
          (migrate: jointOrOwner), so there is nothing to "mark" — the seam is already
          jointly owned and its questions grouped. The only pending thing is a DATE, which
          is gated. So a seam is either AWAITING-A-DATE or (once scheduling lands) BOOKED —
          no no-op "marked" state that confirms a thing already true. */}
      <section className="v3ib-src">
        <header className="v3ib-h">
          <OwnershipTag cls="joint" showLabel={false} />
          <span className="v3ib-verb">Sessions</span>
          <span className="v3ib-lead"><b>{sessionQueue.length}</b> seam{sessionQueue.length === 1 ? "" : "s"} — <b>already jointly owned</b> (auto-set at detection). Each is a joint session; the open item is a <b>date</b>, which is gated.</span>
          <ProvisionalMark what="scheduling a real date is a gated write — 'propose a time' records the intent only" />
        </header>
        {sessionQueue.length === 0 ? <p className="v3ib-empty">No seams.</p> : (
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
        )}
      </section>

      {/* 3 · CONFLICTS → ADJUDICATE (read-side; resolution gated) */}
      <section className="v3ib-src">
        <header className="v3ib-h">
          <span className="v3ib-verb">Adjudicate</span>
          <span className="v3ib-lead"><b>{ledger.conflicts.length}</b> conflict{ledger.conflicts.length === 1 ? "" : "s"} — two live claims on one locus; the element <b>freezes</b>, no auto-winner.</span>
          <ProvisionalMark what="resolution completion is a write — gated; read-side only for now" />
        </header>
        {ledger.conflicts.length === 0 ? (
          // A PASSED check, not an empty slot — adjudication exists and is currently
          // clear. Quiet, present, not alarm. And honest that 0-now ≠ 0-forever:
          // conflicts appear once stakeholders assert competing answers, and with 0
          // stakeholder assertions yet, "0 conflicts" partly means "no one's answered".
          <p className="v3ib-passed" role="note">
            <span className="v3ib-passed-tick" aria-hidden="true">✓</span>
            <span className="v3ib-passed-body">
              <b>0 conflicts</b> — precedence resolved every contested locus cleanly.
              <span className="v3ib-passed-sub">Conflicts surface once stakeholders assert competing answers; with <b>{ledger.ownership.stakeholder}</b> stakeholder assertions so far, this also reads &ldquo;no one&rsquo;s answered yet.&rdquo;</span>
            </span>
            <ProvisionalMark what="0-now, not 0-forever — stakeholder assertions are the gated write" />
          </p>
        ) : (
          <ul className="v3ib-list">
            {ledger.conflicts.map((c) => (
              <li key={c.about} className="v3ib-row is-frozen">
                <span className="v3ib-row-h"><ClaimStatus state="conflict" showLabel={false} /><QLine about={c.about} tail={<span className="v3ib-frozen-tag">🔒 frozen · {c.count} live claims</span>} /></span>
                <span className="v3ib-awaiting"><span className="v3ib-awaiting-l">awaiting operator adjudication — capture the resolution via the team</span><ProvisionalMark what="the resolving write is gated; no auto-winner" /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* OWNED & IN-FLIGHT → reassign / unassign + the stakeholder's three exits */}
      <section className="v3ib-src is-gated">
        <header className="v3ib-h">
          <OwnershipTag cls="stakeholder" showLabel={false} />
          <span className="v3ib-verb">Owned &amp; in-flight</span>
          <span className="v3ib-lead">Reassign if you routed wrong; or record the holder&apos;s exit. Operator-entered captures: <b>{ledger.captures.length}</b> — <b>not</b> counted as heard.</span>
          <ProvisionalMark what="only a stakeholder ANSWER through the system ticks heard — gated" />
        </header>
        {ledger.assignments.length === 0 ? <p className="v3ib-empty">Assign an unowned question above and it lands here — awaiting its owner&apos;s response.</p> : (
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
        )}
      </section>

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
