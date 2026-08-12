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
import { OFFERED_TYPES } from "@/v3/lib/ledger/derivedTypes";
import { elementIdOf } from "@/v3/lib/ledger/types";

/** One field awaiting a type, with whatever Aura made of its name. */
export interface TypingRow {
  about: string;
  entity: string;
  attribute: string;
  /** the derived reading, or "" when the name said nothing */
  suggested: string;
  confidence: number;
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

export default function TypingGrid({ ledger, onDictionary, onDone }: {
  ledger: ProgramLedger;
  onDictionary: (csv: string, sor: string | null) => void | Promise<void>;
  onDone?: () => void;
}) {
  const rows = useMemo(() => typingRows(ledger), [ledger]);
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
        <span className="v3tg-t"><b>{rows.length}</b> field{rows.length === 1 ? "" : "s"} still need a type</span>
        <span className="v3tg-m">
          Aura read {answerable.length} of them from the field names — too weak to record on its own,
          so they are set as the answer here rather than asked as a question. Change any, then confirm.
          {" "}Confirming records them as <b>your</b> statement, exactly as an uploaded dictionary would;
          a real dictionary still corrects them row for row.
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
              <li key={r.about} title={r.about}>
                <span className="v3tg-f">{r.entity}.{r.attribute}</span>
                <select className="v3tg-sel" value={typeOf(r)}
                  aria-label={`Type of ${r.entity}.${r.attribute}`}
                  onChange={(e) => setChosen((c) => ({ ...c, [r.about]: e.target.value }))}>
                  <option value="">— still asking —</option>
                  {OFFERED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {/* The reading's strength, stated. An operator scanning a screen of
                    defaults deserves to know which ones Aura was least sure of. */}
                {r.suggested && typeOf(r) === r.suggested ? (
                  <span className="v3tg-c">read from the name · {Math.round(r.confidence * 100)}%</span>
                ) : typeOf(r) ? <span className="v3tg-c yours">yours</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="v3tg-bar">
        <button type="button" className="v3ib-btn" disabled={busy !== null || !answerable.length}
          onClick={() => void commit(answerable, "all")}>
          {busy === "all" ? "Recording…" : `confirm all ${answerable.length}`}
        </button>
        <span className="v3tg-m">
          Anything left on “still asking” stays an open question — confirming records only what is set.
        </span>
      </div>
    </section>
  );
}
