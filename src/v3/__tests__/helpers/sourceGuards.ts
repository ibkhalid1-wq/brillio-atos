/**
 * The pure predicates behind the FINAL GATE source sentries (finalGateInvariants.test.ts).
 *
 * They live here, apart from the assertions that use them, for ONE reason: a source
 * sentry that is silently bypassable is worse than no sentry, and the only way to prove
 * a sentry catches its bypass is to feed it the bypass. Inline regexes inside an `it()`
 * can never be tested; these can — see sourceGuards.test.ts, which hands each predicate
 * the exact string that slipped past the previous spelling of the guard.
 *
 * TEST-ONLY module. Nothing under src/v3/lib or src/v3/components imports it, so it
 * cannot change app behaviour.
 */
import { readdirSync } from "node:fs";

// ── (b) which ledger modules the fabricated-owner scan covers ───────────────────────
/**
 * FROZEN CORE — the four files the branch contract forbids editing. They are excluded
 * from the fabricated-owner scan, and each exclusion is safe for the same structural
 * reason: none of them MINTS a claim, so none can stamp an owner on one.
 *
 *   types.ts       — type declarations and pure helpers. It DEFINES `Owner`; it never builds one.
 *   store.ts       — the append-only log. It records whatever ownerWhileOpen its caller passes in.
 *   precedence.ts  — the source lattice. It compares claims; it writes none.
 *   projections.ts — read-only derivations over claims already in the log.
 *
 * The exclusion is also about the right ALARM: a fabricated owner appearing inside the
 * frozen core is a FINDING to raise, not something a scan here could let anyone fix.
 */
export const FROZEN_CORE = ["store.ts", "types.ts", "precedence.ts", "projections.ts"];

/**
 * Which files the scan reads. Takes a DIRECTORY LISTING, never a hand-kept array — the
 * previous guard listed 12 of the 20 modules by hand, so kitAgendaCache/pgStore/
 * readModel/useOperatorCommits were never scanned at all, and readModel is on the live
 * path (useProgramLedger and pgStore both import it). A module added tomorrow is covered
 * the day it lands.
 */
export const filesToScan = (entries: string[]): string[] =>
  entries.filter((f) => f.endsWith(".ts") && !FROZEN_CORE.includes(f)).sort();

export const ledgerFilesToScan = (dir: string): string[] => filesToScan(readdirSync(dir));

/**
 * Every CONSTANT role-owner in a source file. A constant owner is a role string somebody
 * typed, however it is spelled. Derived owners (`role: fn(x)`, `role: a.owner.label`) are
 * computed from the record and are deliberately not matched.
 *
 * ONE LEVEL OF CONST INDIRECTION IS RESOLVED, because the previous spelling —
 * `/role:\s*"([^"]+)"/` — was defeated by it completely. Planted on the LIVE path
 * (useProgramLedger.ts):
 *
 *     const FALLBACK_ROLE = "Sales Ops";
 *     const PLANTED_OWNER = { kind: "role", role: FALLBACK_ROLE };
 *
 * the whole (b) invariant stayed GREEN — finalGateInvariants 13/13, sourceGuards 19/19,
 * and validate-pipeline printed PASS F4, F5 and F6. The identical hole swallowed
 * `'Sales Ops'` (single quotes), `` `Sales Ops` `` (template) and the object shorthand
 * `{ kind: "role", role }`. That is the exact defect 0a023c9 fixed in adapters.ts, and
 * this file's own thesis — a sentry is only proven by feeding it its bypass — had never
 * been applied to THIS predicate: it was tested only against the inline double-quoted
 * literals it already matched. See sourceGuards.test.ts "H6".
 *
 * An identifier is reported ONLY when the same file binds it to a string literal, so
 * `role: someComputedLabel` stays unmatched: what is reported is a typed constant, never
 * a name. Chains deeper than one hop (const → const → role) remain invisible; a real
 * binding resolver is an AST job (H2), recorded as outstanding rather than faked here.
 */
const QUOTED = "[\"'`]([^\"'`]+)[\"'`]";

const constStringValue = (source: string, name: string): string | null => {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]+)?=\\s*${QUOTED}`).exec(source);
  return m ? m[1] : null;
};

export const literalRoleOwners = (source: string): string[] => {
  const out: string[] = [];
  // `role: "X"` / `role: 'X'` / role: `X` — the typed literal, any quote.
  for (const m of source.matchAll(new RegExp(`role:\\s*${QUOTED}`, "g"))) out.push(m[1]);
  // `role: NAME` — one const hop. The lookahead stops at `,` `}` or end-of-line, so
  // `role: fn(x)` and `role: a.owner.label` (a `(` or `.` follows) are never candidates.
  for (const m of source.matchAll(/role:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\r\n])/g)) {
    const v = constStringValue(source, m[1]);
    if (v !== null) out.push(v);
  }
  // `{ kind: "role", role }` — object shorthand, same one hop.
  for (const m of source.matchAll(/[{,]\s*(role)\s*(?=[,}])/g)) {
    const v = constStringValue(source, m[1]);
    if (v !== null) out.push(v);
  }
  return out;
};

/**
 * Is a constant owner literal INERT — i.e. can it only ever land on a claim that is
 * already weak or closed, where ownerWhileOpen routes no work to anybody?
 *
 * This is the condition the migrate.ts pin has always applied to `ownerFor("sales")`,
 * expressed for the const-binding shape dictionary.ts uses. The exemption used to be
 * granted on the STRING ALONE, unconditionally, so dictionary.ts could have started
 * stamping "System Owner" on an OPEN claim and the scan would have stayed green.
 *
 * Inert requires all of:
 *   1. the literal is bound to a named `const … : Owner` (not sprayed inline),
 *   2. it is actually spent somewhere (a vacuous exemption proves nothing),
 *   3. EVERY `ownerWhileOpen: <binding>` site also carries `status: "weak" | "closed"`,
 *   4. the binding is referenced nowhere else — declaration + those sites and no other,
 *      so there is no second path that could reach an open claim.
 *
 * (3) is line-scoped, exactly like the migrate pin. Reformatting the assert across
 * several lines turns this red rather than green: the fail-safe direction.
 */
export const constOwnerIsInert = (source: string, role: string): boolean => {
  // Any quote style, matching literalRoleOwners: a single-quoted band must be judged on
  // the same terms as a double-quoted one, not silently fail the exemption and go red.
  const decl = new RegExp(`const\\s+(\\w+)\\s*:\\s*Owner\\s*=\\s*\\{[^}]*role:\\s*["'\`]${escapeRe(role)}["'\`][^}]*\\}`).exec(source);
  if (!decl) return false;                                   // (1) inline literal, or no binding
  const name = decl[1];
  const uses = source.split("\n").filter((l) => l.includes(`ownerWhileOpen: ${name}`));
  if (uses.length === 0) return false;                       // (2)
  if (!uses.every((l) => /status:\s*"(weak|closed)"/.test(l))) return false;  // (3)
  const refs = source.match(new RegExp(`\\b${name}\\b`, "g")) ?? [];
  return refs.length === 1 + uses.length;                    // (4) declaration + use sites, nothing else
};

// ── (c) how a component reaches a count ────────────────────────────────────────────
/**
 * Does `source` import from module `spec` at all?
 *
 * The old guard for "FlowShell must not re-acquire its own copy of the operator-queue
 * count" was `not.toContain("operatorQueueCount(")`, which does NOT match the EXPORTED
 * plural `operatorQueueCounts(` — the one spelling a developer would actually reach for.
 * Naming the count is the wrong thing to forbid anyway; naming the MODULE is the real
 * rule. FlowShell may reach the ledger half only through flowInbox, so a new term in
 * the badge reaches the Inbox's empty state for free.
 */
const escapeRe = (s: string): string => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * The source with its COMMENTS removed.
 *
 * A guard that forbids a code pattern must not be tripped by the comment that explains
 * why the pattern is forbidden — and in this codebase the fix and its rationale live
 * side by side, so that collision is the normal case, not a corner one. (Concretely:
 * the D1 guard forbids `onRecordApproval ?` as a render gate, and the comment above the
 * now-required prop quotes that exact gate to say why it is gone.) Without this the
 * author's only ways out are to weaken the guard or to stop writing the reason down.
 */
export const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

export const importsModule = (source: string, spec: string): boolean =>
  new RegExp(`from\\s+["']${escapeRe(spec)}["']`).test(source);
