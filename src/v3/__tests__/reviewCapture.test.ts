/**
 * TRANSCRIPT → CANDIDATES → (a person confirms) → THE LEDGER.
 *
 * The most direct evidence a programme gets is a stakeholder talking in a
 * meeting, and it was the one kind that could not reach the ledger: a question
 * pack carries its loci out and home, while a transcript is prose with no
 * addresses in it.
 *
 * The whole design turns on one refusal — a model inferring which question a
 * sentence answers is doing something useful that is NOT testimony. So these
 * cases are mostly about what the reader throws away, and why each throw is
 * reported rather than silent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readReviewCapture, reviewAnswerRows, reviewAskOf,
  type ReviewAsk, type ReviewCandidate,
} from "@shared/reviewCapture.ts";
import { readStakeholderAnswers, stakeholderAnswerClaims } from "@/v3/lib/ledger/stakeholderAnswers";
import type { ProgramSummary } from "@/new/types";

const ASKED: ReviewAsk[] = [
  { about: "el-campaign#rel-lead:cardinality", question: "Can one Campaign have many Lead, or just one?", owner: "Marketing" },
  { about: "el-lead#status:values", question: "Which statuses does a lead move through?" },
];

const capture = (extra: Record<string, unknown>) => readReviewCapture(extra, ASKED);

describe("a candidate is a match, not a closure", () => {
  it("keeps a well-formed one whole — locus, verbatim, speaker, its own confidence", () => {
    const out = capture({
      candidates: [{
        about: "el-campaign#rel-lead:cardinality",
        quote: "One campaign feeds hundreds of leads — never the other way round.",
        speaker: "Priya Raman", confidence: 0.9, why: "answers the direction head-on",
      }],
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].speaker).toBe("Priya Raman");
    expect(out.candidates[0].why).toBe("answers the direction head-on");
    expect(out.refused).toEqual([]);
  });

  it("refuses a locus this review never asked about — and says so", () => {
    // THE ONE THAT MATTERS MOST. An invented address would close a question
    // nobody put, and the register would report somebody heard on a point they
    // never addressed.
    const out = capture({
      candidates: [{ about: "el-invented#thing", quote: "We do it monthly, always have.", speaker: "Priya Raman", confidence: 1 }],
    });
    expect(out.candidates).toEqual([]);
    expect(out.refused[0]).toContain("not a question this review asked");
  });

  it("refuses a match with no quote — there is nothing to confirm", () => {
    const out = capture({
      candidates: [{ about: "el-lead#status:values", quote: "yes", speaker: "Priya Raman", confidence: 1 }],
    });
    expect(out.candidates).toEqual([]);
    expect(out.refused[0]).toContain("cannot confirm what they cannot read");
  });

  it("refuses a closure attributed to nobody, or to the machine", () => {
    for (const speaker of ["", "system", "operator", "prototype"]) {
      const out = capture({
        candidates: [{ about: "el-lead#status:values", quote: "New, working, qualified, then closed.", speaker, confidence: 1 }],
      });
      expect(out.candidates, speaker || "(empty)").toEqual([]);
      expect(out.refused[0]).toContain("attributed to a person");
    }
  });

  it("does not let one speaker answer one question twice", () => {
    const out = capture({
      candidates: [
        { about: "el-lead#status:values", quote: "New, working, qualified, closed.", speaker: "Priya Raman", confidence: 0.8 },
        { about: "el-lead#status:values", quote: "…and sometimes we park one.", speaker: "Priya Raman", confidence: 0.4 },
      ],
    });
    expect(out.candidates).toHaveLength(1);
  });

  it("keeps BOTH when two people disagree — adjudication is not the model's", () => {
    const out = capture({
      candidates: [
        { about: "el-lead#status:values", quote: "Four stages, that is all.", speaker: "Priya Raman", confidence: 0.8 },
        { about: "el-lead#status:values", quote: "There is a fifth, we park them.", speaker: "Daniel Osei", confidence: 0.7 },
      ],
    });
    expect(out.candidates.map((c) => c.speaker)).toEqual(["Priya Raman", "Daniel Osei"]);
  });

  it("clamps a confidence the model overstated", () => {
    const out = capture({
      candidates: [{ about: "el-lead#status:values", quote: "New, working, qualified, closed.", speaker: "P", confidence: 4 }],
    });
    expect(out.candidates[0].confidence).toBe(1);
  });
});

describe("what answers nothing we asked is the point, not the leftovers", () => {
  it("keeps the residue with its speaker", () => {
    // A statement nobody had a question for is how the team finds the question
    // it failed to ask.
    const out = capture({
      unmatched: [{ quote: "We cannot cancel a campaign once it has shipped.", speaker: "Daniel Osei", note: "a rule about lifecycle" }],
    });
    expect(out.unmatched).toHaveLength(1);
    expect(out.unmatched[0].speaker).toBe("Daniel Osei");
  });

  it("does not keep pleasantries", () => {
    expect(capture({ unmatched: [{ quote: "Hi all", speaker: "P", note: "" }] }).unmatched).toEqual([]);
  });
});

describe("the ask the agent is handed", () => {
  it("carries the question, dedupes the locus and caps the list", () => {
    const rows = [
      { about: "a#1", question: "Q one", owner: "Marketing" },
      { about: "a#1", question: "Q one again" },
      { about: "b#2", question: "Q two" },
      { about: "c#3", question: "" },
    ];
    const asks = reviewAskOf(rows);
    expect(asks.map((a) => a.about)).toEqual(["a#1", "b#2"]);
    expect(asks[0].owner).toBe("Marketing");
    expect(reviewAskOf(Array.from({ length: 90 }, (_, i) => ({ about: `x#${i}`, question: "q" })))).toHaveLength(60);
  });
});

/* ── what a CONFIRMED candidate is allowed to claim ───────────────────────── */

describe("a confirmed candidate closes the locus, and says how it arrived", () => {
  const confirmed: ReviewCandidate[] = [{
    about: "el-campaign#rel-lead:cardinality",
    quote: "One campaign feeds hundreds of leads.",
    speaker: "Priya Raman", confidence: 0.9,
  }];

  it("the VERBATIM is the answer — never the model's summary of it", () => {
    // A paraphrase in the ledger under somebody's name is the thing this whole
    // path exists to prevent; the quote is why it is allowed to close anything.
    const [row] = reviewAnswerRows(confirmed, { via: "review-2026-08-17", at: "2026-08-17", confirmedBy: "ops@brillio" });
    expect(row.answer).toBe("One campaign feeds hundreds of leads.");
    expect(row.saidByName).toBe("Priya Raman");
    expect(row.method).toBe("transcript");
    expect(row.confirmedBy).toBe("ops@brillio");
  });

  it("reaches the ledger through the channel that already existed", () => {
    const program = {
      id: "p1", name: "Laila",
      rawData: { data: { phaseInputs: { listen: {
        _stakeholderAnswers: JSON.stringify(reviewAnswerRows(confirmed, {
          via: "review-2026-08-17", at: "2026-08-17", confirmedBy: "ops@brillio",
        })),
      } } } },
    } as unknown as ProgramSummary;
    const rows = readStakeholderAnswers(program);
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe("transcript");
    expect(rows[0].confirmedBy).toBe("ops@brillio");
  });

  it("is a HUMAN closure — not an assertion, and not an import", () => {
    // "assertion" belongs to a reply that came through their own token-gated
    // link with nobody in between. "import" would mean a machine put it there
    // and would wrongly drop them from the heard count. They WERE heard: out
    // loud, in a meeting, and the claim carries the quote to prove it.
    const store = {
      liveClaimsAbout: () => [{
        about: "el-campaign#rel-lead:cardinality", status: "open", world: "to-be",
        layer: "domain", ownerWhileOpen: "Marketing", source: "generated",
        value: { kind: "unknown" }, retractedAt: undefined,
      }],
    } as never;
    const [claim] = stakeholderAnswerClaims(store, readStakeholderAnswers({
      id: "p", name: "n",
      rawData: { data: { phaseInputs: { listen: { _stakeholderAnswers: JSON.stringify(
        reviewAnswerRows(confirmed, { via: "review-1", at: "2026-08-17", confirmedBy: "ops" })) } } } },
    } as unknown as ProgramSummary));
    expect(claim.source).toBe("asserted");
    expect(claim.closedBy?.method).toBe("transcript");
    expect(claim.closedBy?.verbatim).toBe("One campaign feeds hundreds of leads.");
    expect(claim.closedBy?.note).toContain("confirmed by ops");
  });
});

/* ── the agent itself ─────────────────────────────────────────────────────── */

describe("the agent is registered and post-conditioned", () => {
  const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");

  it("exists, on the movement that owns the questions it answers", () => {
    expect(EDGE).toContain('"review-capture": {');
    expect(EDGE).toMatch(/"review-capture":\s*\{\s*\n\s*phase: "listen"/);
  });

  it("its answer is READ before it is stored — the refusals are not optional", () => {
    // Same discipline as the prototype and blueprint post-conditions: the
    // decision is a pure _shared function, so a test can run it.
    expect(EDGE).toContain('request.agentId === "review-capture"');
    expect(EDGE).toContain("readReviewCapture(formalResult");
  });

  it("is told the quote must be verbatim and the locus must be one we asked", () => {
    const spec = EDGE.slice(EDGE.indexOf('"review-capture": {'), EDGE.indexOf('"architecture-strategy": {'));
    expect(spec).toContain("verbatim");
    expect(spec).toContain("Never invent a locus");
    expect(spec).toMatch(/MATCHING, NOT DECIDING/i);
  });
});
