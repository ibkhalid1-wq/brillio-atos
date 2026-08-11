/**
 * A COMMENT ATE A FIELD, AND EVERY GATE STAYED GREEN.
 *
 * On 2026-08-11, commit `0012d4e` (the authorised Owner N-parties change) added
 * an explanatory comment to one line of `rowToClaim`:
 *
 *   ownerWhileOpen: normalizeOwner(r.owner),   // rows written before Owner.parties carry {a,b} closedBy: (r.closed_by ?? undefined) as Claim["closedBy"],
 *
 * The `closedBy:` property was already on that line, behind where the comment
 * was appended. `//` runs to end of line, so the property was silently deleted.
 * Every claim rehydrated from Postgres lost its closure attribution — who closed
 * it, by what method, in whose words.
 *
 * NOTHING CAUGHT IT, and each reason is worth keeping:
 *   · tsc was quiet, because `closedBy` is optional on `Claim`. An optional
 *     field that vanishes is indistinguishable from one that was never set.
 *   · No test caught it, because the Postgres path runs only against
 *     embedded-postgres, which this environment cannot start. The whole
 *     persisted read path was outside the suite.
 *   · It survived a full validation pass. It was found by a subagent reading the
 *     file for an unrelated reason, not by any gate.
 *
 * So this test needs NO DATABASE. It reads the source of `rowToClaim` and
 * asserts that every persisted column is mapped — a structural claim about the
 * function, checkable anywhere. The rule it enforces: if the row carries it, the
 * claim must carry it back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = resolve(__dirname, "../lib/ledger/pgStore.ts");
const source = () => readFileSync(SRC, "utf8");

/** The body of `rowToClaim`, comments stripped — what the mapping ACTUALLY is. */
function mappingBody(src: string): string {
  const start = src.indexOf("const rowToClaim");
  expect(start, "rowToClaim not found — re-anchor this scan").toBeGreaterThan(-1);
  const end = src.indexOf("});", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end)
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))   // the exact hazard: kill comments FIRST
    .join("\n");
}

describe("rowToClaim maps every persisted column", () => {
  // The columns the schema writes. A claim rebuilt without one of these is a
  // claim that quietly forgot something the database still knows.
  const REQUIRED: Array<[column: string, field: string]> = [
    ["r.id", "id"],
    ["r.about", "about"],
    ["r.value", "value"],
    ["r.world", "world"],
    ["r.layer", "layer"],
    ["r.source", "source"],
    ["r.status", "status"],
    ["r.owner", "ownerWhileOpen"],
    ["r.closed_by", "closedBy"],          // the one a comment deleted
    ["r.superseded_by", "supersededBy"],
    ["r.contradicts", "contradicts"],
    ["r.escalate_to", "escalateTo"],
    ["r.blocked_reason", "blockedReason"],
  ];

  it("reads every column the row carries", () => {
    const body = mappingBody(source());
    const missing = REQUIRED.filter(([column]) => !body.includes(column)).map(([c]) => c);
    expect(missing, `rowToClaim never reads: ${missing.join(", ")}`).toEqual([]);
  });

  it("assigns every field the claim needs", () => {
    const body = mappingBody(source());
    const missing = REQUIRED.filter(([, field]) => !new RegExp(`\\b${field}\\s*:`).test(body)).map(([, f]) => f);
    expect(missing, `rowToClaim never assigns: ${missing.join(", ")}`).toEqual([]);
  });

  it("closure attribution specifically survives rehydration", () => {
    // Named on its own because losing it is silent and expensive: `closedBy`
    // carries the verbatim words a stakeholder used, and the convergence
    // readout counts attributed closures. Losing it turns real answers into
    // anonymous ones — the burn-down still moves, but nobody said anything.
    const body = mappingBody(source());
    expect(body).toMatch(/closedBy\s*:\s*\(?\s*r\.closed_by/);
  });

  it("no mapped property is hiding behind a comment on a shared line", () => {
    // The general form of the defect. A `//` comment that is not the first
    // thing on its line puts everything after it out of the program — and in an
    // object literal that reads as a deleted property, not as an error.
    const start = source().indexOf("const rowToClaim");
    const raw = source().slice(start, source().indexOf("});", start));
    for (const line of raw.split("\n")) {
      const comment = line.indexOf("//");
      if (comment === -1) continue;
      const after = line.slice(comment);
      expect(
        after,
        `a property is commented out on a shared line — this is exactly how closedBy was lost:\n  ${line.trim()}`,
      ).not.toMatch(/\w+\s*:\s*\(?\s*r\./);
    }
  });
});
