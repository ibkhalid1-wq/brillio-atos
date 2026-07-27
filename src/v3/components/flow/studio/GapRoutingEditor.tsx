/**
 * The gap editor with routing — a two-column table where column one is the gap
 * (or open question) itself and column two REDIRECTS it to a stakeholder / role.
 * When an item names an addressee it stops being movement-wide and lands on THAT
 * person's follow-up script instead of everyone's.
 *
 * Two modes:
 *  • Overlay (derived artifacts — ontology, atlas): the item TEXT is read-only
 *    (it arrives by resynthesis), but WHO it's asked of is an operator judgement
 *    kept as an overlay. Column two is a DROPDOWN of the movement's roles (with
 *    the person filling each role shown in parentheses). `onRoute` writes
 *    `_gapRoutes`; the follow-up router honours it. This is how the operator
 *    redirects an item without editing the locked document.
 *  • Inline (an editable document): both columns edit the item STRING directly,
 *    stored as "Ask the <who>: <text>" — the same grammar the router reads.
 */
import { useId, useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { useStudioLocked } from "./StudioKit";
import { resolveMovementStakeholders, gapRouteKey } from "@/v3/components/flow/flowStakeholders";

// Kept in lockstep with askAddressee / stripAskAddressee in flowStakeholders.ts
// — the same "Ask the <who>: <text>" grammar the follow-up router matches on. A
// who is at most six words and free of the delimiter characters.
const ASK_RE = /^\s*ask\s+(?:the\s+)?([^:：—–-]{2,60}?)\s*[:：—–-]\s+(.*)$/is;

function parseGap(gap: string): { who: string; text: string } {
  const match = gap.match(ASK_RE);
  if (match && match[1].trim().split(/\s+/).length <= 6) return { who: match[1].trim(), text: match[2] };
  return { who: "", text: gap };
}

function composeGap(text: string, who: string): string {
  const w = who.trim();
  if (!w) return text;
  return text.trim() ? `Ask the ${w}: ${text}` : `Ask the ${w}: `;
}

export function GapRoutingEditor({ values, onChange, program, movementId, gapRoutes, onRoute, addLabel = "gap", placeholder = "what's missing or unresolved", emptyHint }: {
  values: string[];
  onChange: (next: string[]) => void;
  program?: ProgramSummary;
  /** The movement whose roster is offered as redirect targets (e.g. "listen"). */
  movementId: string;
  /** Operator redirect overlay (gapRouteKey → who). Presence enables OVERLAY
   *  mode: the item text is read-only and the redirect persists separately. */
  gapRoutes?: Record<string, string>;
  /** Persist one item's redirect (overlay mode). "" clears it (movement-wide). */
  onRoute?: (gap: string, who: string) => void | Promise<void>;
  addLabel?: string;
  placeholder?: string;
  emptyHint?: string;
}) {
  const locked = useStudioLocked();
  const listId = useId();
  const overlay = !!onRoute; // derived doc: text read-only, redirect editable

  // The redirect targets — a ROLE per option, with the person who fills it in
  // parentheses when one is known, so the operator routes to a role and still
  // sees who that is. The stored value stays the bare role (the "(name)" is a
  // label hint only), so the follow-up router's addressee parsing is unaffected.
  const options = useMemo(() => {
    if (!program) return [] as Array<{ value: string; label: string }>;
    const byValue = new Map<string, string>();
    resolveMovementStakeholders(program, movementId).forEach((s) => {
      const name = (s.name ?? "").trim();
      const role = (s.role ?? "").trim();
      const value = role || name;
      if (!value) return;
      const label = role && name && role.toLowerCase() !== name.toLowerCase() ? `${role} (${name})` : value;
      // Prefer the annotated label (the one that carries a name) on duplicates.
      const existing = byValue.get(value);
      if (!existing || (label.includes("(") && !existing.includes("("))) byValue.set(value, label);
    });
    return [...byValue.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [program, movementId]);

  const set = (index: number, next: string) => onChange(values.map((v, i) => (i === index ? next : v)));
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));

  return (
    <div className="v3fs-stu-table v3fs-gaprt">
      {values.length ? (
        <div className="v3fs-stu-tr v3fs-stu-th" aria-hidden="true">
          <span style={{ flexGrow: 2, flexBasis: 0 }}>Gap</span>
          <span style={{ flexGrow: 1, flexBasis: 0 }}>Redirect to — stakeholder / role</span>
          {overlay ? null : <span className="v3fs-stu-xcol" />}
        </div>
      ) : emptyHint ? <div className="v3fs-stu-empty">{emptyHint}</div> : null}

      {values.map((gap, index) => {
        const parsed = parseGap(gap);
        // In overlay mode the redirect the operator set wins over the generator's
        // own addressee; fall back to the addressee baked into the item string.
        const who = overlay ? (gapRoutes?.[gapRouteKey(gap)] ?? parsed.who) : parsed.who;
        return (
          <div key={index} className="v3fs-stu-tr">
            <input style={{ flexGrow: 2, flexBasis: 0 }} value={parsed.text} placeholder={placeholder} aria-label="Gap"
              title={parsed.text || undefined}
              disabled={overlay || locked} readOnly={overlay}
              onChange={(e) => set(index, composeGap(e.target.value, who))} />
            {overlay ? (
              <div className={`v3fs-gaprt-who${who ? " on" : ""}`} style={{ flexGrow: 1, flexBasis: 0 }}>
                <span className="v3fs-gaprt-ic" aria-hidden="true">{who ? "→" : "○"}</span>
                <select value={who} aria-label="Redirect to stakeholder or role" onChange={(e) => onRoute!(gap, e.target.value)}>
                  <option value="">— unassigned (movement-wide) —</option>
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {who && !options.some((o) => o.value === who) ? <option value={who}>{who}</option> : null}
                </select>
              </div>
            ) : (
              <div className="v3fs-gaprt-who" style={{ flexGrow: 1, flexBasis: 0 }}>
                <span className="v3fs-gaprt-ic" aria-hidden="true">{who ? "→" : "○"}</span>
                <input list={listId} value={who} placeholder="unassigned" aria-label="Redirect to stakeholder or role" disabled={locked}
                  onChange={(e) => set(index, composeGap(parsed.text, e.target.value))} />
              </div>
            )}
            {overlay || locked ? null : <button type="button" className="v3fs-stu-x v3fs-stu-xcol" aria-label="Remove gap" onClick={() => remove(index)}>×</button>}
          </div>
        );
      })}

      {overlay ? null : <datalist id={listId}>{options.map((o) => <option key={o.value} value={o.value} />)}</datalist>}
      {overlay || locked ? null : <button type="button" className="v3fs-a" onClick={() => onChange([...values, ""])}>＋ {addLabel}</button>}
    </div>
  );
}
