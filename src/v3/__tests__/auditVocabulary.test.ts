/**
 * Step 1b — the static half of the audit-vocabulary enumeration test.
 *
 * Step 1b (client publishes `aura.intent` so the DB audit trigger records WHAT a
 * write meant) is NOT wired yet — the client sets `aura.intent` nowhere, so there
 * is no live emit surface to assert `action_type ∈ ACTION_TYPES` against. That half
 * waits for the intent wiring and is called out below.
 *
 * What IS testable today, and what this file guards, is the closed set itself. The
 * one source of truth is `docs/aura/action-type-vocabulary.md` (§1 user actions,
 * §2 system actions, §5 `affected_kind`). Until an exported `ACTION_TYPES` const
 * exists in code (doc §6.1), the doc IS the register — so this test pins it:
 *
 *   1. every `affected_kind` a §1/§2 action pairs with ∈ the §5 closed set
 *      (closed-set membership — no orphan kind);
 *   2. no `action_type` is defined twice (a duplicate is a synonym by construction);
 *   3. the user/system split is exactly the `system.` prefix (doc §3);
 *   4. the client publishes NO audit intent — it sets `aura.intent` nowhere — so no
 *      client call site can pass an audit `actor` (the DB derives actor from the JWT;
 *      a client-supplied audit actor would be a spoof). This is the "no actor passed
 *      from the client" invariant, in the only form testable before intent wiring.
 *
 * Author-only: no intent wiring, no payload change, no Step-1 gate touched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const vocab = readFileSync(resolve(repoRoot, "docs/aura/action-type-vocabulary.md"), "utf8");

/** A markdown table row `| a | b | c | d |` → trimmed, backtick-stripped cells. */
function rows(section: string): string[][] {
  const start = vocab.indexOf(section);
  if (start < 0) throw new Error(`section not found: ${section}`);
  // the section runs until the next "## " heading
  const rest = vocab.slice(start + section.length);
  const end = rest.indexOf("\n## ");
  const body = end < 0 ? rest : rest.slice(0, end);
  return body
    .split("\n")
    .filter((l) => l.trimStart().startsWith("| `")) // data rows only (col1 is a `code` cell)
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/^`|`$/g, "")));
}

const userRows = rows("## §1 · User actions");
const systemRows = rows("## §2 · System actions");
const kindRows = rows("## §5 · `affected_kind`");

const AFFECTED_KINDS = new Set(kindRows.map((r) => r[0]));
const actionRows = [...userRows, ...systemRows]; // [action_type, what, affected_kind, origin]

describe("Step 1b static — audit vocabulary closed set (docs/aura/action-type-vocabulary.md)", () => {
  it("parses a non-trivial register", () => {
    expect(userRows.length).toBeGreaterThan(20);
    expect(systemRows.length).toBeGreaterThan(5);
    expect(AFFECTED_KINDS.size).toBe(7); // §5 states "Seven values"
  });

  it("every action's affected_kind ∈ the §5 closed set (membership — no orphan kind)", () => {
    const orphans = actionRows
      .map((r) => ({ action: r[0], kind: r[2] }))
      .filter((x) => !AFFECTED_KINDS.has(x.kind));
    expect(orphans, `actions pairing with an undeclared affected_kind: ${JSON.stringify(orphans)}`).toEqual([]);
  });

  it("no action_type is defined twice (a duplicate is a synonym by construction — doc §6.2a)", () => {
    const names = actionRows.map((r) => r[0]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, `duplicate action_type(s): ${JSON.stringify([...new Set(dupes)])}`).toEqual([]);
  });

  it("the user/system split is exactly the `system.` prefix (doc §3)", () => {
    expect(userRows.filter((r) => r[0].startsWith("system.")).map((r) => r[0]), "user rows must be bare").toEqual([]);
    expect(systemRows.filter((r) => !r[0].startsWith("system.")).map((r) => r[0]), "system rows must be prefixed").toEqual([]);
  });

  it("every §5 affected_kind is actually used by at least one action (no dead kind)", () => {
    const used = new Set(actionRows.map((r) => r[2]));
    const dead = [...AFFECTED_KINDS].filter((k) => !used.has(k));
    expect(dead, `affected_kind declared but paired with no action: ${JSON.stringify(dead)}`).toEqual([]);
  });

  it("the client publishes NO audit intent — sets `aura.intent` nowhere (so it cannot pass an audit actor)", () => {
    // Walk the client source. The audit `actor` is derived server-side from the JWT;
    // the client must never set it. Before intent wiring exists, the guarantee is
    // stronger and simpler: the client sets aura.intent at no site at all.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
        // pgStore.ts is the server-side Postgres persistence layer (PgLedger): it requires a
        // live pg Pool, is imported only by the scripts/ledger harnesses, and correctly sets
        // the SERVER's audit actor. It is NOT client-reachable — buildReadModel (the only piece
        // the client needs) lives in the pg-free readModel.ts — so it can't spoof a client actor.
        if (name === "pgStore.ts") continue;
        const src = readFileSync(p, "utf8");
        if (/aura\.intent/.test(src) || /set_config\s*\(\s*['"]aura\.intent/.test(src)) hits.push(p.slice(repoRoot.length + 1));
      }
    };
    walk(resolve(repoRoot, "src"));
    // When Step 1b lands, this test's replacement asserts every emitted intent's
    // action_type ∈ ACTION_TYPES and carries no `actor` key — see the file header.
    expect(hits, `client site(s) setting aura.intent (audit actor spoof risk): ${JSON.stringify(hits)}`).toEqual([]);
  });
});
