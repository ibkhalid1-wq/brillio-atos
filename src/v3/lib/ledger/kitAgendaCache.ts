/**
 * The kit agenda is a CACHE, not a source.
 *
 * Question TEXT has exactly one producer — `renderQuestion.ts` over the ledger's
 * open unknowns (`kitProjection.ts` projects them for the kit). The generated
 * `discoveryKit` artifact predates that: it stores agenda question STRINGS on
 * `interviews[].agenda[].questions`, in a field whose name and position read like
 * the plan itself. Two producers of the same thing is exactly the drift the ledger
 * exists to end, and a reader cannot tell by looking which one it is holding.
 *
 * This module demotes those strings to a VERSIONED CACHE (`interviews[].agendaCache`)
 * and makes every reader go through ONE accessor, so:
 *  · the strings live under a name that says what they are (a cache of a rendering),
 *    carrying the version + the moment they were cached and, when the mint knew them,
 *    the LOCI they were rendered from — the way back to the source;
 *  · nothing re-implements "flatten agenda blocks into strings" a sixth time;
 *  · nothing regresses. A kit with no cache falls back to the legacy inline strings
 *    and is reported as `origin: "legacy-inline"`, `version: 0` — the miss stays
 *    visible rather than being papered over as a fresh cache.
 *
 * The demotion is APPLIED wherever the client writes the kit (the Discovery Kit
 * studio). The generator still emits inline `agenda[].questions`; making it emit the
 * cache directly is an edge change (supabase/functions/run-agent) and is NOT done
 * here — until it deploys, `readKitAgendaCache` is what keeps the two shapes one
 * reader.
 */

/** Bump when the cache's own shape changes; `0` means "lifted from legacy inline". */
export const KIT_AGENDA_CACHE_VERSION = 1;
/** The field the demoted strings live under, on each interview. */
export const KIT_AGENDA_CACHE_FIELD = "agendaCache";
/**
 * Written INTO the artifact, so the JSON itself says what these strings are.
 *
 * It is a PROVENANCE CLAIM, not decoration: it asserts the strings were rendered
 * from the ledger's open unknowns. So it is stamped only when the `loci` that
 * make the claim checkable are stamped with it (`demoteInterviewAgenda`) —
 * otherwise the operator's own keystrokes from the kit studio
 * (`studios.tsx:161-169`) would carry a note saying the ledger produced them.
 */
export const KIT_AGENDA_CACHE_NOTE =
  "cache of rendered question text — the ledger's open unknowns are the source";

export interface KitAgendaCache {
  /** `KIT_AGENDA_CACHE_VERSION` when read from the cache; `0` when lifted from legacy. */
  version: number;
  questions: string[];
  /** The loci the strings were rendered from, index-aligned when known; `[]` otherwise. */
  loci: string[];
  /** When the cache was written. `null` for legacy strings — nobody recorded it. */
  at: string | null;
  /** Where these strings actually came from — never inferred, never dressed up. */
  origin: "cache" | "legacy-inline" | "none";
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((s) => String(s ?? "").trim()).filter(Boolean);

/** The legacy shape: strings inline on the agenda blocks. */
const legacyQuestions = (interview: Record<string, unknown>): string[] =>
  (Array.isArray(interview.agenda) ? interview.agenda : [])
    .filter(isRecord)
    .flatMap((block) => strings(block.questions));

/**
 * The ONE read of a kit interview's agenda strings. Prefers the versioned cache;
 * falls back to the legacy inline strings so an un-migrated artifact reads exactly
 * as it did before. An EMPTY cache is still a cache — it means the operator cleared
 * the questions, and falling back would resurrect what they deleted.
 */
export function readKitAgendaCache(interview: unknown): KitAgendaCache {
  if (!isRecord(interview)) return { version: 0, questions: [], loci: [], at: null, origin: "none" };
  const cached = interview[KIT_AGENDA_CACHE_FIELD];
  if (isRecord(cached)) {
    const version = Number(cached.version);
    return {
      version: Number.isFinite(version) ? version : KIT_AGENDA_CACHE_VERSION,
      questions: strings(cached.questions),
      loci: strings(cached.loci),
      at: typeof cached.at === "string" && cached.at.trim() ? cached.at : null,
      origin: "cache",
    };
  }
  const questions = legacyQuestions(interview);
  return { version: 0, questions, loci: [], at: null, origin: questions.length ? "legacy-inline" : "none" };
}

/** The one accessor every reader uses — cache or legacy, one list of strings. */
export const kitAgendaQuestions = (interview: unknown): string[] => readKitAgendaCache(interview).questions;

/**
 * Demote ONE interview: the strings move to the versioned cache and the agenda
 * blocks keep the part that is genuinely a plan (topic + minutes). The blocks are
 * never dropped — a 45-minute shape is the conversation's design, not a question
 * producer — they simply stop carrying text that looks like a source.
 */
export function demoteInterviewAgenda(
  interview: Record<string, unknown>,
  opts: { questions?: readonly string[]; loci?: readonly string[]; at?: string } = {},
): Record<string, unknown> {
  const questions = opts.questions ? strings(opts.questions) : readKitAgendaCache(interview).questions;
  const loci = strings(opts.loci ?? readKitAgendaCache(interview).loci);
  const blocks = (Array.isArray(interview.agenda) ? interview.agenda : []).filter(isRecord);
  const kept = blocks.map((block) => {
    const { questions: _dropped, ...rest } = block;
    return rest;
  });
  return {
    ...interview,
    // Keep at least one block so the plan's shape survives a demotion of a kit
    // whose only agenda content WAS the questions.
    agenda: kept.length ? kept : [{ topic: "Conversation", minutes: 45 }],
    [KIT_AGENDA_CACHE_FIELD]: {
      version: KIT_AGENDA_CACHE_VERSION,
      questions,
      // The loci and the note travel TOGETHER or not at all. The note claims the
      // ledger is these strings' source; the loci are the evidence for it. Written
      // apart, a hand-typed question from the kit studio landed stamped as a
      // rendering of open unknowns with nothing to check that against.
      ...(loci.length ? { loci, note: KIT_AGENDA_CACHE_NOTE } : {}),
      at: opts.at ?? new Date().toISOString(),
    },
  };
}

/**
 * Demote a whole kit doc. Idempotent: an interview already on the cache is left
 * alone, so re-saving a migrated kit is a no-op rather than a fresh timestamp on
 * strings nobody touched.
 */
export function demoteKitAgendas(
  kit: unknown,
  at?: string,
): { doc: Record<string, unknown>; demoted: number } {
  if (!isRecord(kit) || !Array.isArray(kit.interviews)) {
    return { doc: isRecord(kit) ? kit : {}, demoted: 0 };
  }
  let demoted = 0;
  const interviews = kit.interviews.map((iv) => {
    if (!isRecord(iv)) return iv;
    if (readKitAgendaCache(iv).origin === "cache") return iv;
    demoted += 1;
    return demoteInterviewAgenda(iv, { at });
  });
  return { doc: demoted ? { ...kit, interviews } : kit, demoted };
}
