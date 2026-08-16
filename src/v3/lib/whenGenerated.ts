/**
 * WHEN A THING WAS LAST GENERATED, in words.
 *
 * Every generator stamps `generatedAt` and no surface showed it, so a board of
 * tiles read identically whether a document was minted a minute ago or three
 * weeks ago. "Stale" answers a different question — its INPUTS moved — and a
 * document can be weeks old and perfectly fresh by that measure. This answers
 * the one an operator asks first: how old is what I am looking at?
 *
 * Relative near the present (where "2h ago" is what a person actually wants)
 * and absolute beyond a day (where "17d ago" stops meaning anything and a date
 * starts). The precise instant always travels alongside as a tooltip — see
 * `exactWhen` — so the short form never has to be the whole truth.
 *
 * `timeAgo` was file-local to FlowShell; it lives here because the tiles, the
 * Line and the decision cards must phrase the same instant the same way.
 */

/** "just now" · "6m ago" · "2h ago" · "12 Aug". Empty for an unparseable stamp. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The full instant, for a title attribute — the short form's whole truth. */
export function exactWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** The tile stamp: "Generated 2h ago", with the exact instant for the tooltip.
 *  Null when nothing on the record says when — never a guess, never "unknown". */
export function generatedStamp(iso: string | null | undefined, now?: number): { label: string; title: string } | null {
  if (!iso || !iso.trim()) return null;
  const rel = timeAgo(iso, now);
  if (!rel) return null;
  return { label: `Generated ${rel}`, title: `Generated ${exactWhen(iso)}` };
}
