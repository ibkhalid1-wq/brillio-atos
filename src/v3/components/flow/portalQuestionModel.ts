/**
 * The stakeholder linked page's question model — LOCI in, the ONE renderer out.
 *
 * Until now the durable-link pack carried stored question STRINGS (built from the
 * generated kit agenda) and the linked page rendered those strings. A stakeholder
 * could therefore read phrasing no ledger locus backs, and answering closed
 * nothing. This module is the seam that ends that: a pack that carries
 * `questionLoci` (ledger `about` ids) is rendered through
 * `renderQuestion(store, about, "stakeholder")` — the SAME producer the operator
 * queue, the kit projection and the burn-down drill read — grouped per element by
 * `groupQuestions`, with the kind-specific affordance carried on each row.
 *
 * ADDITIVE AND BACKWARD COMPATIBLE, deliberately:
 *  · no `questionLoci`, or no store to resolve them against ⇒ `mode: "strings"`
 *    and the page renders exactly what it rendered before. Nothing regresses.
 *  · a locus whose element this store does not hold is NOT dropped — its stored
 *    string falls through to `strings`, so the ask survives a model that moved on.
 *    (A miss stays visible; it is never papered over.)
 *  · those leftovers are COUNTED SEPARATELY (`unbacked`), never folded into
 *    `count`. They compose as bare `Q:/A:` blocks with no `[locus: …]` tag, so
 *    ingest cannot attribute them and answering one closes nothing. Folding them
 *    into one total told the stakeholder that N questions were actionable when
 *    only `count` of them were — a fabricated number by omission. The surface
 *    gives them their own heading; the two are never presented as one figure.
 *
 * Answers compose with the locus named in the text (`[locus: …]`), so the answer
 * that comes back through the quarantine channel can be attributed to the exact
 * point it closes. The client cannot write a ledger assertion from a public page
 * (no store write path there — see docs/aura/stakeholder-linked-page-loci.md);
 * this carries the attribution as far as today's channel honestly can.
 */
import type { LedgerStore } from "@/v3/lib/ledger/store";
import { elementIdOf } from "@/v3/lib/ledger/types";
import { groupQuestions, type RenderedQuestion } from "@/v3/lib/ledger/renderQuestion";

/** One question on the linked page, tied to the ledger locus it closes. */
export interface PortalQuestionRow {
  /** The locus — `<elementId>#<slot>`. */
  about: string;
  /** The string the pack stored at mint. Kept because the edge validates a
   *  deferral against the pack's own question list, and because it is the honest
   *  record of what was ASKED if the model has since been re-rendered. */
  stored: string;
  /** The ONE renderer's stakeholder projection — text + kind-specific affordance. */
  rendered: RenderedQuestion;
}

/** One element's card — a step and its unknowns as sub-questions. */
export interface PortalQuestionGroup {
  elementId: string;
  header: string;
  rows: PortalQuestionRow[];
  count: number;
}

/** A stored question with no renderable locus — rendered as before. `index` is
 *  its position in the pack's own `questions` array, so the surfaces that key
 *  answers/attachments by index keep their keys. */
export interface PortalStringQuestion { index: number; question: string }

export interface PortalQuestionModel {
  /** "loci" ⇒ at least one locus resolved and renders through the ONE renderer. */
  mode: "loci" | "strings";
  groups: PortalQuestionGroup[];
  rows: PortalQuestionRow[];
  /** Stored strings with no renderable locus — rendered as before, never dropped. */
  strings: PortalStringQuestion[];
  /** The questions under the page's MAIN list: the locus-backed rows in `loci`
   *  mode, the whole stored list in `strings` mode. NEVER includes `unbacked` —
   *  a total that mixed them would imply the leftovers are actionable. */
  count: number;
  /** Questions shown BESIDE the locus-backed cards with no locus of their own
   *  (`strings.length` in `loci` mode, `0` in `strings` mode, where there are no
   *  locus cards for them to sit beside). An answer to one of these carries no
   *  `[locus: …]` tag, so it closes nothing — the surface must say so rather
   *  than absorb them into `count`. */
  unbacked: number;
}

/** The one decision: does this pack render through the renderer, or as stored strings? */
export function portalQuestionModel(
  pack: { questions?: readonly string[] | null; questionLoci?: readonly string[] | null },
  store: LedgerStore | null | undefined,
): PortalQuestionModel {
  // The raw array keeps INDEX ALIGNMENT with the loci; the surfaces key answers
  // and attachments by that same index, so it is carried on every string row.
  const questions = (pack.questions ?? []).map((q) => String(q));
  const plain: PortalStringQuestion[] = questions
    .map((question, index) => ({ index, question }))
    .filter((q) => q.question.trim());
  const loci = (pack.questionLoci ?? []).map((a) => String(a));
  const asStrings = (): PortalQuestionModel =>
    ({ mode: "strings", groups: [], rows: [], strings: plain, count: plain.length, unbacked: 0 });
  if (!store || !loci.some((a) => a.trim())) return asStrings();

  // Index-aligned at mint: questionLoci[i] is the locus behind questions[i].
  const storedFor = new Map<string, string>();
  loci.forEach((about, i) => { if (about && questions[i]) storedFor.set(about, questions[i]); });

  const known = new Set(store.elements().map((e) => e.id));
  const seen = new Set<string>();
  const renderable: string[] = [];
  const leftover: PortalStringQuestion[] = [];
  loci.forEach((about, index) => {
    if (!about.trim() || seen.has(about)) return;
    seen.add(about);
    if (known.has(elementIdOf(about))) renderable.push(about);
    // The ask survives; it just isn't locus-backed in THIS store. A miss stays visible.
    else if (questions[index]?.trim()) leftover.push({ index, question: questions[index] });
  });
  // Questions the pack carried BEYOND its loci list keep rendering as strings.
  for (let index = loci.length; index < questions.length; index += 1) {
    if (questions[index].trim()) leftover.push({ index, question: questions[index] });
  }
  if (!renderable.length) return asStrings();

  const groups: PortalQuestionGroup[] = groupQuestions(store, renderable, "stakeholder").map((g) => ({
    elementId: g.elementId,
    header: g.header,
    count: g.count,
    rows: g.questions.map((rendered) => ({
      about: rendered.id,
      stored: storedFor.get(rendered.id) ?? rendered.question,
      rendered,
    })),
  }));
  const rows = groups.flatMap((g) => g.rows);
  // `count` is the locus-backed rows ONLY. The leftovers travel as `unbacked`:
  // they are real asks that must stay on the page, but nothing can attribute an
  // answer to them, so they never join the headline figure.
  return { mode: "loci", groups, rows, strings: leftover, count: rows.length, unbacked: leftover.length };
}

/** How the locus rides the composed answer text so an ingest can attribute it. */
export const locusTag = (about: string): string => `[locus: ${about}]`;

/** A locus-backed answer as the composer writes it and a reader parses it back. */
export interface LocusAnswer { about: string; question: string; answer: string; why?: string }

/**
 * Compose the locus-backed answers into ONE attributed block. Each answer names
 * the exact point it closes, so the operator's ingest can attribute it rather
 * than guess from prose. Deferred questions are routed, not answered — excluded.
 */
export function composeLocusAnswers(
  rows: readonly PortalQuestionRow[],
  answers: Record<string, string>,
  whys: Record<string, string> = {},
  deferrals: Record<string, string> = {},
): string {
  const blocks: string[] = [];
  for (const row of rows) {
    if (deferrals[row.about]) continue;
    const a = (answers[row.about] ?? "").trim();
    if (!a) continue;
    const why = (whys[row.about] ?? "").trim();
    blocks.push([`Q: ${row.rendered.question}`, `A: ${a}`, why ? `Why: ${why}` : "", locusTag(row.about)]
      .filter(Boolean).join("\n"));
  }
  if (!blocks.length) return "";
  return ["Answers to open points in the model — each names the exact point it answers:", ...blocks].join("\n\n");
}

/**
 * THE PARSER THAT NEVER GOT A CALLER — deleted 2026-08-17, not left to rot.
 *
 * `parseLocusAnswers` read the `[locus: …]` tags back out of a returned block
 * and had exactly one occurrence outside its own tests: its definition. The
 * ingest was eventually built the other way round, as `deriveStakeholderAnswers`
 * reading the evidence already on the record, so this had no future caller
 * either. Two ways to do one thing, one of them dead, is how a reader loses an
 * afternoon deciding which is the real one.
 *
 * `composeLocusAnswers` above STAYS: it is what writes the tags, and the
 * derivation depends on them.
 */

/** Questions this person has handled — answered or routed to someone else. */
export function answeredLocusCount(
  rows: readonly PortalQuestionRow[],
  answers: Record<string, string>,
  deferrals: Record<string, string> = {},
): number {
  return rows.reduce((n, row) =>
    n + (((answers[row.about] ?? "").trim() || deferrals[row.about]) ? 1 : 0), 0);
}
