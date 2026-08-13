/**
 * ANSWER THE TYPING WALL IN ONE PASS, NOT ONE QUESTION AT A TIME.
 *
 * The wall presented itself as 47 rows of "What type of value is Account.X?" —
 * the same question, asked once per field, open-ended. Measured on Laila New,
 * every one of the 30 that survived the derivation already had a reading; they
 * were only below the floor at which a guess may be asserted. That knowledge was
 * being thrown away at exactly the moment it was most useful.
 *
 * So the question arrives pre-answered. Each row's control starts on the derived
 * suggestion, the rows are grouped BY that suggestion — the operator is answering
 * the same question repeatedly, so the groups are the real units of work — and a
 * group can be confirmed in one act. Six decisions instead of forty-seven.
 *
 * WHAT IS WRITTEN, AND AS WHOSE. A suggestion is never written; only a
 * confirmation is. And a confirmation is the OPERATOR stating a field's type, so
 * it is recorded the way any stated dictionary is: the grid emits the exact CSV an
 * upload would, through the same `onDictionary` path, reconciled by the same
 * merge. No new write mechanism, no new precedence, and a later real dictionary
 * corrects it row for row.
 *
 * The rows an operator does NOT confirm stay open. Confirm-all confirms what is on
 * screen, never what was scrolled past.
 */
import { useCallback, useMemo, useState } from "react";
import type { ProgramLedger } from "@/v3/lib/ledger/useProgramLedger";
import { OFFERED_TYPES, attributeEvidence } from "@/v3/lib/ledger/derivedTypes";
import { elementIdOf } from "@/v3/lib/ledger/types";

/** One field awaiting a type, with whatever Aura made of its name. */
export interface TypingRow {
  about: string;
  entity: string;
  attribute: string;
  /** the derived reading, or "" when the name said nothing */
  suggested: string;
  confidence: number;
  /** what the ontology says named this field, or null when it says nothing. Null is
   *  the useful answer: it separates a field somebody stated from one the model
   *  listed while summarising, which until now read identically. */
  source: string | null;
}

/**
 * The rows, resolved to the names a person recognises.
 *
 * The locus carries slugs (`el:attr:account.gst-number`), so entity and attribute
 * are read back off the ELEMENTS — the same strings the ontology stated and the
 * ones a dictionary row has to carry to slug back to this locus.
 */
export function typingRows(ledger: ProgramLedger): TypingRow[] {
  const byId = new Map(ledger.store.elements().map((e) => [e.id, e] as const));
  const suggestion = new Map((ledger.typeSuggestions ?? []).map((s) => [s.about, s] as const));
  const rows: TypingRow[] = [];
  for (const item of ledger.typingLoci) {
    if (!item.about.endsWith("#dataType")) continue;
    const el = byId.get(elementIdOf(item.about));
    if (!el || el.kind !== "attribute") continue;
    const entity = el.of ? byId.get(el.of)?.name ?? "" : "";
    if (!entity) continue;                       // an attribute with no entity cannot be keyed
    const s = suggestion.get(item.about);
    rows.push({
      about: item.about, entity, attribute: el.name,
      suggested: s?.dataType ?? "", confidence: s?.confidence ?? 0,
      source: attributeEvidence(ledger.store, el.id),
    });
  }
  return rows;
}

/** The CSV a set of confirmations makes — the exact shape an upload produces. */
export function confirmedCsv(rows: readonly TypingRow[], chosen: Readonly<Record<string, string>>): string {
  const lines = ["entity,field,type"];
  for (const r of rows) {
    const type = chosen[r.about] ?? r.suggested;
    if (!type) continue;
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    lines.push([r.entity, r.attribute, type].map(cell).join(","));
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export default function TypingGrid({ ledger, onDictionary, onDone, onClose, rows: given }: {
  ledger: ProgramLedger;
  onDictionary: (csv: string, sor: string | null) => void | Promise<void>;
  onDone?: () => void;
  /** Close without answering anything. The grid can be a page long, so the trigger
   *  that opened it is usually scrolled out of sight by the time you want out. */
  onClose?: () => void;
  /**
   * The rows to work, when they are NOT the open typing wall.
   *
   * The derived-types strip reports readings Aura already WROTE (weak claims, not
   * open questions), so its loci are absent from `typingRows`. It reported them and
   * offered nothing — informational text on the operator's decision surface. Passing
   * its rows here gives that strip the grid's own act: confirm the reading as yours,
   * or change it. Both write through `onDictionary`, exactly as an upload does, so a
   * derived reading is overruled by the same mechanism that would have answered it.
   */
  rows?: TypingRow[];
}) {
  const wall = useMemo(() => typingRows(ledger), [ledger]);
  const rows = given ?? wall;
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Memoised so the grouping below can depend on IT rather than on `chosen`
  // indirectly — the lint rule is right that a closure read inside a useMemo is a
  // dependency, and a stale one here would group rows by an answer the operator
  // has already changed.
  const typeOf = useCallback((r: TypingRow) => chosen[r.about] ?? r.suggested, [chosen]);

  // Grouped BY the answer, because that is what the operator is deciding. A field
  // Aura could not read at all sits in its own group and is the only place an
  // open-ended answer is genuinely owed.
  const groups = useMemo(() => {
    const m = new Map<string, TypingRow[]>();
    for (const r of rows) {
      const key = typeOf(r) || "";
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length));
  }, [rows, typeOf]);

  const commit = async (subset: readonly TypingRow[], key: string) => {
    const csv = confirmedCsv(subset, chosen);
    if (!csv) return;
    setBusy(key);
    try { await onDictionary(csv, null); onDone?.(); } finally { setBusy(null); }
  };

  if (!rows.length) return null;
  const answerable = rows.filter((r) => typeOf(r));

  return (
    <section className="v3tg" aria-label="Confirm field types">
      <header className="v3tg-h">
        {/* TWO POPULATIONS, TWO TRUTHFUL HEADINGS. The wall is fields with NO answer
            yet; the review is fields Aura already answered weakly on its own. Saying
            "still need a type" over the second would be false — they have one, it is
            just the weakest claim the ledger holds. */}
        <span className="v3tg-t">
          <b>{rows.length}</b> field{rows.length === 1 ? "" : "s"}{" "}
          {given ? "Aura typed from their names" : "still need a type"}
        </span>
        {/* NAMED BY WHAT IT CLOSES. Both grids can be open at once — the open typing
            wall and the review of Aura's own readings — and two buttons called
            "close" leave a screen-reader user with no way to tell which one they are
            about to press. */}
        {onClose ? (
          <button type="button" className="v3ib-btn ghost sm v3tg-x" onClick={onClose}
            aria-label={given
              ? "Close the review of the fields Aura typed, without recording anything"
              : "Close the type grid, without recording anything"}>close</button>
        ) : null}
        <span className="v3tg-m">
          {given ? (
            <>These are already on the record as <b>code-derived · weak</b> — Aura&rsquo;s reading of
            the field name, nobody&rsquo;s answer. Confirming makes each one <b>yours</b>, which any
            stakeholder can still deviate from; changing one overrules it outright.</>
          ) : (
            <>Aura read {answerable.length} of them from the field names — too weak to record on its own,
            so they are set as the answer here rather than asked as a question. Change any, then confirm.
            {" "}Confirming records them as <b>your</b> statement, exactly as an uploaded dictionary would;
            a real dictionary still corrects them row for row.</>
          )}
        </span>
      </header>

      {groups.map(([type, list]) => (
        <div key={type || "unread"} className={`v3tg-g${type ? "" : " unread"}`}>
          <div className="v3tg-g-h">
            <span className="v3tg-g-t">{type || "Aura could not read these — they need a real answer"}</span>
            <span className="v3tg-g-n">{list.length}</span>
            {type ? (
              <button type="button" className="v3ib-btn ghost sm" disabled={busy !== null}
                onClick={() => void commit(list, type)}>
                {busy === type ? "Recording…" : `confirm ${list.length} as ${type}`}
              </button>
            ) : null}
          </div>
          <ul className="v3tg-rows">
            {list.map((r) => (
              <li key={r.about}
                title={r.suggested
                  ? `${r.about} — Aura read "${r.suggested}" from the field name, ${Math.round(r.confidence * 100)}% confident.`
                  : r.about}>
                <span className="v3tg-f">{r.entity}.{r.attribute}
                  {r.source
                    ? <span className="v3tg-src" title={r.source}> · from {r.source}</span>
                    : <span className="v3tg-src none"> · no source on record</span>}
                </span>
                <select className="v3tg-sel" value={typeOf(r)}
                  aria-label={`Type of ${r.entity}.${r.attribute}`}
                  onChange={(e) => setChosen((c) => ({ ...c, [r.about]: e.target.value }))}>
                  <option value="">— still asking —</option>
                  {OFFERED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {/* ONLY THE ROWS THAT DIFFER SAY ANYTHING. "read from the name · 60%"
                    printed on every default row was the same sentence the header
                    already says, repeated 60-odd times down the page — noise the
                    operator has to read past to find the rows they changed. The
                    strength is not lost: it is on the row's tooltip. */}
                {r.suggested && typeOf(r) !== r.suggested && typeOf(r)
                  ? <span className="v3tg-c yours">yours</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="v3tg-bar">
        <button type="button" className="v3ib-btn" disabled={busy !== null || !answerable.length}
          onClick={() => void commit(answerable, "all")}>
          {/* "confirm all 18" on a page headed "24 fields still need a type" reads as
              a contradiction — all of WHAT? Both numbers, so the button says what it
              will and will not touch. */}
          {busy === "all" ? "Recording…" : `confirm ${answerable.length} of ${rows.length}`}
        </button>
        <span className="v3tg-m">
          Records the type set on {answerable.length} field{answerable.length === 1 ? "" : "s"} as your answer
          {rows.length > answerable.length ? <>; the {rows.length - answerable.length} left on “still asking”
          {" "}stay open questions</> : null}.
        </span>
      </div>
    </section>
  );
}
