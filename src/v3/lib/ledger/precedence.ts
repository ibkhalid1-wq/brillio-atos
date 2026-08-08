/**
 * Claims-ledger precedence (docs/aura/ledger-precedence.md).
 *
 * Two claims on the SAME locus (`about`) can conflict. This resolves the conflict
 * to exactly one of three outcomes: `wins` (loser retained as history), `coexist`
 * (a visible contradiction, both live — routable), or `escalate` (routed to a named
 * authority). Pure and total: defined for every (source × world) × (source × world).
 *
 * THE DOC'S TABLE IS GENERATED FROM THIS FILE (`renderPrecedenceMarkdown`), and a
 * test pins the committed doc block to the function output — one definition, not two.
 *
 * Model, in three rules:
 *  1. Cross-world (neither is regulation) → COEXIST. Different worlds on one slot are
 *     the DEVIATION, not a conflict; the deviation register owns them. `as-is` never
 *     auto-promotes to `to-be` by winning.
 *  2. Regulation BINDS across worlds. vs an attributed `asserted` claim it ESCALATES
 *     (a human's firm assertion cannot be silently overridden — Legal reconciles; the
 *     asserted claim is held `blocked`). vs anything else regulation WINS (loser → history).
 *  3. Same world → compare source strength on that world's rank vector. Stronger WINS.
 *     Equal strength: two human-decision sources (asserted/dispositioned/regulation)
 *     ESCALATE to a human; two evidence/machine sources COEXIST as a visible contradiction.
 *
 * Source strength is WORLD-DEPENDENT: for `as-is` the system export (code-derived) is
 * near-ground-truth; for `to-be` the export is the past and a client target document
 * outranks it. See the doc for the full justification per rank.
 */

export type World = "as-is" | "to-be";
export type Source =
  | "regulation" | "external-standard" | "document" | "code-derived"
  | "precedent" | "asserted" | "dispositioned" | "generated";

export const WORLDS: readonly World[] = ["as-is", "to-be"] as const;
/** Canonical source order for tables/tests — NOT the strength order. */
export const SOURCES: readonly Source[] = [
  "regulation", "asserted", "dispositioned", "document",
  "external-standard", "code-derived", "precedent", "generated",
] as const;

/** Strength order per world, strongest first. Index = rank (lower = stronger). */
const RANK: Record<World, readonly Source[]> = {
  "as-is": ["regulation", "asserted", "code-derived", "document", "external-standard", "precedent", "dispositioned", "generated"],
  "to-be": ["regulation", "asserted", "document", "external-standard", "precedent", "dispositioned", "code-derived", "generated"],
};

/** Sources that are a human DECISION (attributed), not evidence/machine output. */
const HUMAN_DECISION: ReadonlySet<Source> = new Set<Source>(["regulation", "asserted", "dispositioned"]);

const rankOf = (s: Source, w: World): number => RANK[w].indexOf(s);

export type Outcome = "wins" | "coexist" | "escalate";
export type Authority = "slot-owner" | "legal-compliance";
export interface ClaimRef { source: Source; world: World }
export interface PrecedenceResult {
  outcome: Outcome;
  winner?: "a" | "b";
  loser?: "a" | "b";
  loserDisposition?: "history" | "blocked"; // what happens to the losing claim
  escalateTo?: Authority;                    // present iff outcome === "escalate"
  reason: string;
}

const wins = (winner: "a" | "b", loserDisposition: "history" | "blocked", reason: string): PrecedenceResult =>
  ({ outcome: "wins", winner, loser: winner === "a" ? "b" : "a", loserDisposition, reason });
const coexist = (reason: string): PrecedenceResult => ({ outcome: "coexist", reason });
const escalate = (escalateTo: Authority, reason: string, loser?: "a" | "b"): PrecedenceResult =>
  ({ outcome: "escalate", escalateTo, loser, loserDisposition: loser ? "blocked" : undefined, reason });

/** Resolve a conflict between two claims on the same locus. Pure, total, deterministic. */
export function resolvePrecedence(a: ClaimRef, b: ClaimRef): PrecedenceResult {
  const aReg = a.source === "regulation";
  const bReg = b.source === "regulation";

  // Rule 2 — regulation binds across worlds (checked before the cross-world coexist rule).
  if (aReg || bReg) {
    if (aReg && bReg) return escalate("legal-compliance", "two regulations conflict — Legal/Compliance reconciles");
    const regSide = aReg ? "a" : "b";
    const other = aReg ? b : a;
    const otherSide = aReg ? "b" : "a";
    if (other.source === "asserted") {
      return escalate("legal-compliance", "regulation binds, but a firm attributed assertion cannot be silently overridden — Legal reconciles; the assertion is held blocked", otherSide);
    }
    return wins(regSide, "history", `regulation binds and outranks ${other.source}`);
  }

  // Rule 1 — cross-world, no regulation: the deviation, not a conflict.
  if (a.world !== b.world) {
    return coexist(`different worlds (${a.world} vs ${b.world}) — a deviation, held by the deviation register, not resolved`);
  }

  // Rule 3 — same world: strength compare on that world's rank.
  const w = a.world;
  const ra = rankOf(a.source, w), rb = rankOf(b.source, w);
  if (ra < rb) return wins("a", "history", `${a.source} outranks ${b.source} for ${w}`);
  if (rb < ra) return wins("b", "history", `${b.source} outranks ${a.source} for ${w}`);
  // equal strength (same source class, same world)
  if (HUMAN_DECISION.has(a.source)) {
    return escalate("slot-owner", `two ${a.source} claims conflict — the slot owner decides`);
  }
  return coexist(`two ${a.source} claims conflict — both live as a visible, routable contradiction`);
}

// ── doc-table generation (one definition, shared with the markdown) ───────────────

const CODE: Record<Outcome, (r: PrecedenceResult) => string> = {
  wins: (r) => (r.winner === "a" ? "A▸" : "◂B"),
  coexist: () => "~",
  escalate: (r) => (r.escalateTo === "legal-compliance" ? "!L" : "!o"),
};

function sameWorldTable(w: World): string {
  const head = `| ${w} · a↓ b→ | ${SOURCES.map((s) => s.slice(0, 6)).join(" | ")} |`;
  const sep = `|${"---|".repeat(SOURCES.length + 1)}`;
  const rows = SOURCES.map((sa) => {
    const cells = SOURCES.map((sb) => CODE[resolvePrecedence({ source: sa, world: w }, { source: sb, world: w }).outcome](
      resolvePrecedence({ source: sa, world: w }, { source: sb, world: w })));
    return `| **${sa.slice(0, 8)}** | ${cells.join(" | ")} |`;
  });
  return [head, sep, ...rows].join("\n");
}

/** The full same-world lattice as two 8×8 tables + the cross-world rule + legend.
 *  Between the AUTOGEN markers so the doc-sync test can pin it. */
export function renderPrecedenceMarkdown(): string {
  return [
    "<!-- AUTOGEN:precedence (generated by src/v3/lib/ledger/precedence.ts — do not hand-edit) -->",
    "Legend: **A▸** = row (a) wins · **◂B** = col (b) wins · **~** = coexist (visible contradiction) · **!o** = escalate to slot-owner · **!L** = escalate to Legal/Compliance.",
    "",
    "**Same world = as-is** (both claims describe the current system):",
    "",
    sameWorldTable("as-is"),
    "",
    "**Same world = to-be** (both claims describe the target):",
    "",
    sameWorldTable("to-be"),
    "",
    "**Cross-world** (a and b describe different worlds of the same slot): **~ coexist** in every case —",
    "the pair is a *deviation* (the deviation register's job), not a conflict — **except** when either",
    "side is `regulation`, which **binds across worlds**: regulation vs `asserted` → **!L escalate**",
    "(assertion held blocked); regulation vs anything else → regulation **wins** (loser kept as history).",
    "<!-- /AUTOGEN:precedence -->",
  ].join("\n");
}
