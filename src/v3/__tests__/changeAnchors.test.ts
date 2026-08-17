/**
 * "CHANGES REQUESTED" IS A STATUS. WHAT WAS WRONG IS THE WORK.
 *
 * A round already recorded a verdict, free text, an attestation and the design
 * version the answer was about. That last field is why a round can tell you
 * feedback has gone stale; what it could never tell you is what the feedback
 * was ABOUT. "The status column is wrong" arrived as prose attached to a whole
 * build, and somebody had to read every request and go hunting.
 *
 * The address is deliberately NOT a fabric id. A fabric id is derived from
 * names and dies of a rename it had nothing to do with — the same reasoning
 * that put `designOverrides` on a source tuple, and the reason this reuses that
 * type rather than inventing a second vocabulary for the same thing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readAnchors, anchorKey, anchorLabel, anchorResolves, anchorWorldOf,
  resolveAnchors, staleAnchorNotes, type ChangeAnchor,
} from "@shared/changeAnchors.ts";
import { recordDesignRoundVerdict, designRoundRollup } from "@/v3/components/flow/flowDesignRound";
import type { ProgramSummary } from "@/new/types";

const ONTOLOGY = {
  entities: [
    { name: "Account", attributes: [{ name: "Name" }, { name: "Status" }] },
    { name: "Opportunity", attributes: ["Amount"] },
  ],
  relations: [{ from: "Account", to: "Opportunity" }],
};
const HTML = '<section data-screen="list-account"></section><section data-screen="detail-account"></section>';
const world = anchorWorldOf(HTML, ONTOLOGY);

describe("an anchor is an address, and a malformed one is not kept", () => {
  it("reads each kind whole", () => {
    const got = readAnchors([
      { of: "screen", screen: "list-account" },
      { of: "entity", entity: "Account" },
      { of: "attribute", entity: "Account", attribute: "Status" },
      { of: "relation", parent: "Account", child: "Opportunity" },
    ]);
    expect(got).toHaveLength(4);
    expect(got.map(anchorLabel)).toEqual(["list-account", "Account", "Account.Status", "Account → Opportunity"]);
  });

  it("drops a half-formed one rather than storing a guess", () => {
    // An attribute with no attribute is not "the entity" — it is a row nobody
    // can act on, and inferring the coarser address would put a request on a
    // target the person never named.
    expect(readAnchors([{ of: "attribute", entity: "Account" }])).toEqual([]);
    expect(readAnchors([{ of: "screen" }, { of: "nonsense", screen: "x" }, "list-account", null])).toEqual([]);
  });

  it("dedupes and caps — one response is not the whole backlog", () => {
    expect(readAnchors([{ of: "entity", entity: "Account" }, { of: "entity", entity: "account" }])).toHaveLength(1);
    expect(readAnchors(Array.from({ length: 20 }, (_, i) => ({ of: "screen", screen: `s${i}` })))).toHaveLength(6);
  });

  it("shares one definition of 'the same locus' with designOverrides", () => {
    // Two modules disagreeing about what an address IS would let a request and
    // an override point at the same field and never meet.
    const a: ChangeAnchor = { of: "attribute", entity: "Account", attribute: "Status" };
    expect(anchorKey(a)).toBe(anchorKey({ of: "attribute", entity: "ACCOUNT", attribute: "status" }));
    expect(anchorKey(a)).not.toBe(anchorKey({ of: "entity", entity: "Account" }));
  });
});

describe("resolving against the build in front of you", () => {
  it("finds what the build still has", () => {
    expect(anchorResolves({ of: "screen", screen: "list-account" }, world)).toBe(true);
    expect(anchorResolves({ of: "attribute", entity: "account", attribute: "status" }, world)).toBe(true);
    expect(anchorResolves({ of: "relation", parent: "Account", child: "Opportunity" }, world)).toBe(true);
  });

  it("does not find what it does not", () => {
    expect(anchorResolves({ of: "screen", screen: "dashboard" }, world)).toBe(false);
    expect(anchorResolves({ of: "attribute", entity: "Account", attribute: "Owner" }, world)).toBe(false);
    expect(anchorResolves({ of: "entity", entity: "Invoice" }, world)).toBe(false);
  });

  it("an orphan is KEPT and named, never re-bound", () => {
    // THE POINT. The field somebody asked about was renamed between the round
    // and now. Guessing which field they meant would move their decision onto
    // one they never saw; dropping it would make the request look answered.
    const { found, orphaned } = resolveAnchors(
      [{ of: "screen", screen: "list-account" }, { of: "attribute", entity: "Account", attribute: "Owner" }],
      world,
    );
    expect(found.map(anchorLabel)).toEqual(["list-account"]);
    expect(orphaned.map(anchorLabel)).toEqual(["Account.Owner"]);
  });

  it("says so in words somebody can act on", () => {
    const notes = staleAnchorNotes(
      [{ who: "Priya Raman", anchors: [{ of: "entity", entity: "Invoice" }] }], world,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Priya Raman");
    expect(notes[0]).toContain("Invoice");
    expect(notes[0]).toContain("do not assume it was done");
  });

  it("is silent on a request that named nothing — that is normal feedback", () => {
    // "The whole thing feels heavy" points at no screen and is legitimate. A
    // channel that nagged about every unanchored comment would stop being read.
    expect(staleAnchorNotes([{ who: "Daniel Osei", anchors: [] }], world)).toEqual([]);
  });

  it("is silent when everything still resolves", () => {
    expect(staleAnchorNotes([{ who: "P", anchors: [{ of: "screen", screen: "list-account" }] }], world)).toEqual([]);
  });
});

/* ── the round actually carries it ────────────────────────────────────────── */

const roundProgram = (): ProgramSummary => ({
  id: "p1", name: "Prog",
  rawData: {
    data: {
      flowDesignRounds: [{
        id: "r1", ordinal: 1, openedAt: "2026-08-01", design: { key: "v1" },
        participants: [{ name: "Priya Raman", role: "Ops Lead" }],
      }],
    },
  },
} as unknown as ProgramSummary);

/** The writer returns the WRAPPED blob (`{ data: … }`), which is what the app
 *  stores. Unwrapping here keeps every assertion below about anchors rather
 *  than about the envelope. */
type Stored = { flowDesignRounds: Array<{ participants: Array<{ response?: { verdict?: string; anchors?: unknown } }> }> };
const recorded = (anchors: unknown): Stored => {
  const next = recordDesignRoundVerdict(roundProgram(), {
    roundId: "r1", who: "Priya Raman", verdict: "changes", attestation: "operator",
    text: "Said in the Tuesday review that the list is too dense.", anchors,
  }, "ops@brillio");
  expect(next, "the writer refused a verdict these cases assume it takes").not.toBeNull();
  return (next as { data: Stored }).data;
};
const responseOf = (stored: Stored) => stored.flowDesignRounds[0].participants[0].response;

describe("the verdict writer stores the address", () => {
  it("keeps a well-formed anchor on the response", () => {
    expect(responseOf(recorded([{ of: "screen", screen: "list-account" }]))?.anchors)
      .toEqual([{ of: "screen", screen: "list-account" }]);
  });

  it("stores NOTHING rather than an empty list", () => {
    // An empty array reads as "they pointed at nothing"; absent reads as "they
    // did not point", which is what happened.
    expect(responseOf(recorded([]))?.anchors).toBeUndefined();
  });

  it("a bad anchor does not cost the verdict", () => {
    // The verdict is the evidence. Refusing the whole capture over a malformed
    // address would lose what the person actually said.
    const response = responseOf(recorded([{ of: "attribute", entity: "Account" }]));
    expect(response?.verdict).toBe("changes");
    expect(response?.anchors).toBeUndefined();
  });

  it("the rollup re-reads them, because a stored round is only a cast", () => {
    const program = { id: "p1", name: "Prog",
      rawData: { data: recorded([{ of: "screen", screen: "list-account" }]) } } as unknown as ProgramSummary;
    const person = designRoundRollup(program).people.find((p) => p.name === "Priya Raman")!;
    expect(person.anchors.map(anchorLabel)).toEqual(["list-account"]);
  });

  it("a person who pointed at nothing gets an empty list, not undefined", () => {
    const program = { id: "p1", name: "Prog", rawData: { data: roundProgram().rawData!.data } } as unknown as ProgramSummary;
    expect(designRoundRollup(program).people[0].anchors).toEqual([]);
  });
});

/* ── the surface ──────────────────────────────────────────────────────────── */

describe("an operator can point at a screen, and cannot invent one", () => {
  const ZONE = readFileSync(resolve(__dirname, "../components/flow/DesignLoopZones.tsx"), "utf8");

  it("the options come from the BUILD, so a wrong answer is not on offer", () => {
    expect(ZONE).toContain("anchorWorldOf(prototypeBaselineOfProgram(inner)?.html");
    expect(ZONE).toContain("[...anchorWorld.screens].sort()");
  });

  it("only a change request is asked what it is about", () => {
    // An approval points at the whole design by definition; naming screens on
    // one would read as a partial approval nobody gave.
    expect(ZONE).toContain('verdictPick[person.name] === "changes" && anchorWorld?.screens.size');
    expect(ZONE).toMatch(/anchors: verdictPick\[person\.name\] === "changes"/);
  });

  it("an anchor the build has lost is struck through and named, not dropped", () => {
    expect(ZONE).toContain("anchorResolves(a, anchorWorld)");
    expect(ZONE).toContain("no longer in the build");
    expect(readFileSync(resolve(__dirname, "../components/flow/theLine.css"), "utf8"))
      .toContain(".v3dr-anchor.is-gone");
  });

  it("the pick is session state — nothing lands until the verdict does", () => {
    const decl = ZONE.slice(ZONE.indexOf("const [anchorPick"), ZONE.indexOf("const [anchorPick") + 120);
    expect(decl).toContain("useState");
  });
});
