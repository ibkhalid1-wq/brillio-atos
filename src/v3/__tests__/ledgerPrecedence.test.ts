/**
 * Precedence lattice — every cell exercised for invariants, the six hard cases
 * pinned explicitly, and the committed doc table pinned to the function output
 * (one definition, not two).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { resolvePrecedence, renderPrecedenceMarkdown, SOURCES, WORLDS, type Source, type World } from "@/v3/lib/ledger/precedence";

const R = (sa: Source, wa: World, sb: Source, wb: World) => resolvePrecedence({ source: sa, world: wa }, { source: sb, world: wb });

describe("precedence — lattice invariants (every cell)", () => {
  const cells: Array<[Source, World, Source, World]> = [];
  for (const sa of SOURCES) for (const wa of WORLDS) for (const sb of SOURCES) for (const wb of WORLDS) cells.push([sa, wa, sb, wb]);

  it("is total and well-formed on all 256 cells", () => {
    for (const [sa, wa, sb, wb] of cells) {
      const r = R(sa, wa, sb, wb);
      expect(["wins", "coexist", "escalate"]).toContain(r.outcome);
      if (r.outcome === "wins") { expect(r.winner).toBeDefined(); expect(r.loser).toBeDefined(); expect(r.loserDisposition).toBeDefined(); }
      if (r.outcome === "escalate") expect(r.escalateTo).toBeDefined();
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("is order-consistent — swapping a and b flips the winner and preserves coexist/escalate", () => {
    for (const [sa, wa, sb, wb] of cells) {
      const ab = R(sa, wa, sb, wb);
      const ba = R(sb, wb, sa, wa);
      if (ab.outcome === "wins") {
        expect(ba.outcome).toBe("wins");
        expect(ba.winner).toBe(ab.winner === "a" ? "b" : "a"); // same claim still wins
      } else {
        expect(ba.outcome).toBe(ab.outcome);
        if (ab.outcome === "escalate") expect(ba.escalateTo).toBe(ab.escalateTo);
      }
    }
  });

  it("is deterministic", () => {
    for (const [sa, wa, sb, wb] of cells) expect(R(sa, wa, sb, wb)).toEqual(R(sa, wa, sb, wb));
  });
});

describe("precedence — the six hard cases resolved explicitly", () => {
  it("1 · sf-export (code-derived, as-is) vs asserted correction → assertion wins, export kept as history", () => {
    const r = R("code-derived", "as-is", "asserted", "as-is");
    expect(r.outcome).toBe("wins"); expect(r.winner).toBe("b"); expect(r.loserDisposition).toBe("history");
  });
  it("2 · two attributed assertions from different sessions (same world) → escalate to the slot owner", () => {
    const r = R("asserted", "to-be", "asserted", "to-be");
    expect(r.outcome).toBe("escalate"); expect(r.escalateTo).toBe("slot-owner");
  });
  it("3 · document-sourced to-be vs external-standard → the client document wins", () => {
    const r = R("document", "to-be", "external-standard", "to-be");
    expect(r.outcome).toBe("wins"); expect(r.winner).toBe("a");
  });
  it("4a · regulation vs asserted → escalate to Legal; the assertion is held blocked (binds ≠ silent overwrite)", () => {
    const r = R("regulation", "to-be", "asserted", "to-be");
    expect(r.outcome).toBe("escalate"); expect(r.escalateTo).toBe("legal-compliance");
    expect(r.loser).toBe("b"); expect(r.loserDisposition).toBe("blocked");
  });
  it("4b · regulation vs anything non-asserted → regulation wins cleanly", () => {
    for (const s of SOURCES) {
      if (s === "regulation" || s === "asserted") continue;
      const r = R("regulation", "to-be", s, "to-be");
      expect(r.outcome).toBe("wins"); expect(r.winner).toBe("a");
    }
  });
  it("4c · regulation binds ACROSS worlds (regulation as-is vs asserted to-be still escalates)", () => {
    const r = R("regulation", "as-is", "asserted", "to-be");
    expect(r.outcome).toBe("escalate"); expect(r.escalateTo).toBe("legal-compliance");
  });
  it("5 · precedent vs a fresh generation (same engagement, to-be) → precedent wins", () => {
    const r = R("precedent", "to-be", "generated", "to-be");
    expect(r.outcome).toBe("wins"); expect(r.winner).toBe("a");
  });
  it("6 · dispositioned vs a later assertion on the same slot → the assertion wins", () => {
    const r = R("dispositioned", "to-be", "asserted", "to-be");
    expect(r.outcome).toBe("wins"); expect(r.winner).toBe("b");
  });
});

describe("precedence — the cross-world / world-dependent-strength rules", () => {
  it("cross-world, no regulation → coexist (a deviation, not a conflict)", () => {
    expect(R("asserted", "as-is", "asserted", "to-be").outcome).toBe("coexist");
    expect(R("code-derived", "as-is", "document", "to-be").outcome).toBe("coexist");
  });
  it("code-derived is strong for as-is but weak for to-be", () => {
    // as-is: export beats a document about the current system
    expect(R("code-derived", "as-is", "document", "as-is")).toMatchObject({ outcome: "wins", winner: "a" });
    // to-be: a target document beats the (past) export
    expect(R("code-derived", "to-be", "document", "to-be")).toMatchObject({ outcome: "wins", winner: "b" });
  });
  it("two equal-strength evidence/machine claims coexist as a visible contradiction", () => {
    expect(R("generated", "to-be", "generated", "to-be").outcome).toBe("coexist");
    expect(R("document", "as-is", "document", "as-is").outcome).toBe("coexist");
  });
});

describe("precedence — the doc table is generated from the function (one definition)", () => {
  it("the AUTOGEN block in ledger-precedence.md equals renderPrecedenceMarkdown()", () => {
    const doc = readFileSync(pathResolve(__dirname, "../../../docs/aura/ledger-precedence.md"), "utf8");
    const gen = renderPrecedenceMarkdown();
    const start = doc.indexOf("<!-- AUTOGEN:precedence");
    const end = doc.indexOf("<!-- /AUTOGEN:precedence -->");
    expect(start, "AUTOGEN start marker present").toBeGreaterThanOrEqual(0);
    expect(end, "AUTOGEN end marker present").toBeGreaterThan(start);
    const block = doc.slice(start, end + "<!-- /AUTOGEN:precedence -->".length).trim();
    expect(block).toBe(gen.trim());
  });
});
