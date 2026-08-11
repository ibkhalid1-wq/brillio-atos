/**
 * The "— TBC" placeholder convention, defined ONCE for the Deno side.
 *
 * The kit generator emits `"<Domain> SME — TBC"` when it knows a voice is needed but
 * not who fills it — a machine token, deliberately not a job title, so the gap is
 * visible instead of being filled with a fabricated name. Several readers detect it and
 * strip it.
 *
 * It was hand-written in at least four places (twice in `flowStakeholders.ts`, once in
 * `FlowShell.tsx`, twice here in the edge) — one convention, five spellings, which is
 * exactly the smell this codebase exists to prevent. The client half now reads
 * `UNNAMED_SUFFIX_RE` from `flowStakeholders.ts`; Deno cannot import from `src/v3`, so
 * this is the second and LAST copy, and `unnamedSuffixLockstep.test.ts` asserts the two
 * patterns are character-for-character identical.
 *
 * The character class is not paranoia: the generator, and operators pasting from
 * documents, produce em dash, en dash, minus sign, non-breaking hyphen and plain hyphen
 * interchangeably. Narrowing it silently strands a placeholder as a real name.
 */
export const UNNAMED_SUFFIX_RE = /\s*[—–−‑-]\s*TBC\s*$/i;

/** The stored token appended to a role when no person is named yet. */
export const UNNAMED_SUFFIX = " — TBC";

/** Strip the placeholder token, leaving the role. Returns the input when absent. */
export const stripUnnamedSuffix = (label: string): string =>
  String(label ?? "").replace(UNNAMED_SUFFIX_RE, "").trim();
