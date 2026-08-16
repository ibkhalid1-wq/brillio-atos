import { useMemo } from "react";
import { DictationButton, joinDictation } from "@/v3/components/flow/FlowDictation";
import { affordanceOptions } from "@/v3/lib/ledger/renderQuestion";
import type { LedgerStore } from "@/v3/lib/ledger/store";
import type { PortalQuestionModel, PortalQuestionRow } from "@/v3/components/flow/portalQuestionModel";

/**
 * The stakeholder's rendering of LEDGER LOCI — one card per element, its open
 * unknowns as sub-questions, each with the kind-specific affordance the ONE
 * renderer carries (chips + optional why · phase picker · role picker + free
 * text · free text + optional why).
 *
 * Two mount points, one implementation: the plain interview page and the Listen
 * review surface both render this, so the linked page can never grow a second
 * question UI (and, with `renderQuestion` as producer-zero, never a second
 * question TEXT either).
 *
 * HONEST ABOUT WHAT A TAP DOES. A chip is a one-tap ANSWER attributed to the
 * exact locus it closes — but a public link has no ledger write path, so it
 * travels the same quarantine channel as every other answer and becomes a
 * closure only when the programme team confirms it. The footer says exactly
 * that; nothing here claims a closure the system has not made.
 */
export default function PortalQuestions({
  store, model, answers, whys, deferrals, onAnswer, onWhy, onDefer, roster, heading, note,
}: {
  store: LedgerStore;
  model: PortalQuestionModel;
  /** Answers keyed by LOCUS (not by index) — a locus is the stable identity. */
  answers: Record<string, string>;
  whys: Record<string, string>;
  /** "Not mine — ask X", keyed by locus. Omit `onDefer` to hide routing. */
  deferrals?: Record<string, string>;
  onAnswer: (about: string, value: string) => void;
  onWhy: (about: string, value: string) => void;
  onDefer?: (about: string, to: string) => void;
  roster?: Array<{ name: string; role: string }>;
  heading?: string;
  note?: string;
}) {
  // Picker menus come from the ledger's OWN live values (never invented). One
  // scan per kind, memoised — the surface reads, it does not re-derive.
  const phaseOptions = useMemo(() => affordanceOptions(store, "phase"), [store]);
  const ledgerRoles = useMemo(() => affordanceOptions(store, "actorRole"), [store]);
  const roleOptions = useMemo(() => {
    const out = new Set<string>(ledgerRoles);
    for (const person of roster ?? []) { if (person.role.trim()) out.add(person.role.trim()); }
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [ledgerRoles, roster]);

  if (!model.groups.length) return null;
  return (
    <section className="v3fs-rvw-wf v3fs-pq">
      <div className="v3fs-rvw-wf-h">
        <b>{heading ?? "Open points in your process"}</b>
        <span className="v3fs-rvw-trigger">
          {model.rows.length} {model.rows.length === 1 ? "question" : "questions"} — each one settles a specific point we&rsquo;re unsure about
        </span>
      </div>
      {note ? <p className="v3fs-pq-note">{note}</p> : null}
      <div className="v3fs-pq-groups">
        {model.groups.map((group) => (
          <div key={group.elementId} className="v3fs-pq-card">
            <div className="v3fs-pq-h">
              <span className="v3fs-pq-el" title={group.elementId}>{group.header}</span>
              <span className="v3fs-pq-n">{group.count} {group.count === 1 ? "question" : "questions"}</span>
            </div>
            {group.rows.map((row) => (
              <QuestionRow key={row.about} row={row}
                answer={answers[row.about] ?? ""} why={whys[row.about] ?? ""}
                deferredTo={deferrals?.[row.about] ?? ""}
                onAnswer={(value) => onAnswer(row.about, value)}
                onWhy={(value) => onWhy(row.about, value)}
                onDefer={onDefer ? (to) => onDefer(row.about, to) : undefined}
                roster={roster} phaseOptions={phaseOptions} roleOptions={roleOptions} />
            ))}
          </div>
        ))}
      </div>
      <p className="v3fs-pq-foot">
        Each answer is filed against the exact point it settles. The programme team reviews it before
        anything changes in the model — nothing here updates the record on its own.
      </p>
    </section>
  );
}

/** One question, rendered with its kind's affordance. */
function QuestionRow({ row, answer, why, deferredTo, onAnswer, onWhy, onDefer, roster, phaseOptions, roleOptions }: {
  row: PortalQuestionRow;
  answer: string;
  why: string;
  deferredTo: string;
  onAnswer: (value: string) => void;
  onWhy: (value: string) => void;
  onDefer?: (to: string) => void;
  roster?: Array<{ name: string; role: string }>;
  phaseOptions: string[];
  roleOptions: string[];
}) {
  // The CARD's header already names the step, so the row asks the question
  // WITHOUT restating it. `question` (the whole thing) stays the accessible
  // label on every control, so a screen reader still hears the full ask.
  const { affordance, question, short, label } = row.rendered;
  const done = !!answer.trim() || !!deferredTo;
  return (
    <div className={`v3fs-pq-q${done ? " done" : ""}${deferredTo ? " deferred" : ""}`}>
      <span className="v3fs-pq-type">{label}</span>
      <span className="v3fs-pq-t" title={question}>{short}</span>
      {deferredTo ? (
        <div className="v3fs-portal-defer-note">
          Routed to <b>{deferredTo}</b> — they&rsquo;ll be asked directly.
          <button type="button" className="v3fs-a" onClick={() => onDefer?.("")}>I&rsquo;ll answer it myself</button>
        </div>
      ) : (
        <>
          {affordance.kind === "chips" ? (
            <div className="v3fs-pq-chips" role="radiogroup" aria-label={question}>
              {affordance.options.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={answer === option}
                  className={`v3fs-pq-chip${answer === option ? " on" : ""}`}
                  onClick={() => onAnswer(answer === option ? "" : option)}>{option}</button>
              ))}
            </div>
          ) : affordance.kind === "phase-picker" && phaseOptions.length ? (
            <Picker value={answer} onChange={onAnswer} options={phaseOptions} placeholder="pick the phase…" ariaLabel={question} />
          ) : affordance.kind === "role-picker" && roleOptions.length ? (
            <Picker value={answer} onChange={onAnswer} options={roleOptions} placeholder="pick the role…" ariaLabel={question} freeText />
          ) : (
            <div className="v3fs-rvw-field">
              <textarea rows={2} value={answer} aria-label={question} maxLength={2000}
                placeholder="In your own words — type, or speak it."
                onChange={(event) => onAnswer(event.target.value)} />
              <DictationButton compact label="Speak this answer"
                onText={(spoken) => onAnswer(joinDictation(answer, spoken))} />
            </div>
          )}
          {/* A chip/picker answer can carry its reason — optional, never demanded. */}
          {(affordance.kind === "chips" || affordance.kind === "phase-picker" || affordance.kind === "role-picker") && answer ? (
            <input className="v3fs-pq-why" value={why} placeholder="Why? (optional — one line)"
              aria-label={`Why: ${question}`} maxLength={400}
              onChange={(event) => onWhy(event.target.value)} />
          ) : null}
          {onDefer && (roster?.length ?? 0) > 0 ? (
            <div className="v3fs-portal-defer">
              <span>Not yours to answer?</span>
              <select value="" aria-label={`Route this question to someone else`}
                onChange={(event) => { if (event.target.value) onDefer(event.target.value); }}>
                <option value="">this is for someone else…</option>
                {(roster ?? []).map((person, i) => (
                  <option key={`${person.name}-${i}`} value={person.name}>
                    {person.name}{person.role ? ` — ${person.role}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** A picker fed by the ledger's OWN values, plus a free-text escape when the real
 *  answer isn't on the list (an answer we don't hold yet must still fit). */
function Picker({ value, onChange, options, placeholder, ariaLabel, freeText }: {
  value: string; onChange: (value: string) => void; options: string[];
  placeholder: string; ariaLabel: string; freeText?: boolean;
}) {
  const onList = !value || options.includes(value);
  return (
    <div className="v3fs-pq-pick">
      <select value={onList ? value : "__other"} aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value === "__other" ? " " : event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
        <option value="__other">{freeText ? "someone else…" : "something else…"}</option>
      </select>
      {!onList ? (
        <input value={value.trim()} aria-label={`${ariaLabel} — in your own words`} maxLength={200}
          placeholder="in your own words" onChange={(event) => onChange(event.target.value || " ")} />
      ) : null}
    </div>
  );
}
