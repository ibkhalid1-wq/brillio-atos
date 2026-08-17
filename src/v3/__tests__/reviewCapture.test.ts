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

/* ── the quote must be IN the transcript ──────────────────────────────────── */

describe("a quote nobody said cannot become what somebody said", () => {
  // MEASURED, on a real 9,105-word discovery session: of 13 candidates the
  // model returned, FOUR carried quotes absent from the transcript — stitched
  // from fragments either side of a speaker change. Every one passed, because
  // the reader checked that a quote EXISTED and never that it was true. The
  // refusal list came back EMPTY, which reads as a clean run and was in fact
  // the reader being too permissive.
  const SOURCE = [
    "Smitha B V  0:14  We don't create anything. The creation happens only by the sales team.",
    "Ibrahim Khalid  0:31  Right, and the leads?",
    "Smitha B V  0:36  We run it for about 3 months and capture the leads.",
  ].join("\n");
  const read = (quote: string) => readReviewCapture(
    { candidates: [{ about: "el-lead#status:values", quote, speaker: "Smitha B V", confidence: 0.9 }] },
    ASKED, SOURCE,
  );

  it("keeps a quote that is really there", () => {
    expect(read("We run it for about 3 months and capture the leads.").candidates).toHaveLength(1);
  });

  it("REFUSES a line stitched across a speaker change", () => {
    // Exactly the shape of the four that got through: two real fragments,
    // joined into a sentence nobody uttered.
    const out = read("The creation happens only by the sales team. Right, and the leads?");
    expect(out.candidates).toEqual([]);
    expect(out.refused[0]).toContain("does not appear in the transcript");
    expect(out.refused[0]).toContain("Smitha B V");
  });

  it("refuses a paraphrase, however plausible", () => {
    expect(read("The sales team is the only one that creates records.").candidates).toEqual([]);
  });

  it("forgives re-wrapping and case — shape is not the claim", () => {
    // A model that collapses a double space or re-wraps a line has still quoted
    // the person. Refusing that would make the check cry wolf on every run.
    expect(read("we  DON'T create   anything.\nThe creation happens only by the sales team.").candidates)
      .toHaveLength(1);
  });

  it("checks nothing when it is given no source, rather than refusing everything", () => {
    // The reader is used in tests and by callers that hold no transcript; a
    // missing source must not turn every candidate into a refusal.
    expect(capture({ candidates: [{ about: "el-lead#status:values", quote: "Four stages, that is all.", speaker: "P", confidence: 1 }] }).candidates)
      .toHaveLength(1);
  });

  it("the edge hands the transcript in — the check is worthless unarmed", () => {
    const EDGE_SRC = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
    expect(EDGE_SRC).toMatch(/readReviewCapture\(\s*formalResult,/);
    expect(EDGE_SRC).toContain("brief.reviewTranscript");
  });
});

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
    // Whitespace-insensitive: this pinned the single-line call and went red the
    // day the argument list wrapped across lines to take the transcript. What
    // is being asserted is that the reader RUNS on the result, not how the call
    // is formatted.
    expect(EDGE).toMatch(/readReviewCapture\(\s*formalResult/);
  });

  it("is told the quote must be verbatim and the locus must be one we asked", () => {
    const spec = EDGE.slice(EDGE.indexOf('"review-capture": {'), EDGE.indexOf('"architecture-strategy": {'));
    expect(spec).toContain("verbatim");
    expect(spec).toContain("Never invent a locus");
    expect(spec).toMatch(/MATCHING, NOT DECIDING/i);
  });
});

/* ── the operator surface, as SOURCE facts ────────────────────────────────── */

describe("the queue is wired to the surface an operator actually uses", () => {
  const LINE = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");

  it("the transcript and the open questions are stashed together, then the agent runs", () => {
    // Stashed on LISTEN under underscore keys so neither moves a movement
    // fingerprint — the same channel `_prototypeRefine` uses.
    expect(LINE).toContain("_reviewTranscript");
    expect(LINE).toContain("_reviewAsks");
    expect(LINE).toContain('onRunAgent?.("review-capture", "listen")');
  });

  it("the ask list is built by the ONE renderer the operator reads on screen", () => {
    // Matching against a second phrasing of the question would mean the model is
    // answering something nobody was asked.
    expect(LINE).toContain("reviewAskOf(");
    expect(LINE).toMatch(/ownedQuestionsFor[\s\S]{0,400}reviewAskOf|reviewAskOf[\s\S]{0,400}ownedQuestionsFor/);
  });

  it("confirming writes through the answer channel that already existed", () => {
    // No second write path: the row lands in `_stakeholderAnswers`, which the
    // ledger already reads and turns into an attributed closure.
    const fn = LINE.slice(LINE.indexOf("const confirmCandidate"), LINE.indexOf("const confirmCandidate") + 1400);
    expect(fn).toContain("reviewAnswerRows(");
    expect(fn).toContain("_stakeholderAnswers");
    expect(fn).toContain("confirmedBy");
  });

  it("a dismissal is NOT written to the record", () => {
    // "That is not an answer" is a judgement about a model's reading, not a fact
    // about the business. Session state, so the next run re-proposes.
    const decl = LINE.slice(LINE.indexOf("const [dismissed"), LINE.indexOf("const [dismissed") + 120);
    expect(decl).toContain("useState");
    expect(LINE).not.toMatch(/_reviewDismissed|onSaveInputs\([^)]*dismissed/);
  });

  it("offers the read only when something is open to match against", () => {
    expect(LINE).toContain("asksForReview.length ?");
  });

  it("a transcript ALREADY on the record can be read, without pasting it again", () => {
    // THE GAP THIS CLOSED. `review-capture` could only run at capture time, off
    // the text in the paste box — so seven real discovery sessions sitting on a
    // live programme (~330kB of genuine speech) were unreachable by the reader
    // that exists to read exactly that. The only route was to paste one in a
    // second time, which is absurd and duplicates the evidence.
    expect(LINE).toContain("onFindAnswers={asksForReview.length && onSaveInputs");
    expect(LINE).toContain("openAsks={asksForReview.length}");
  });

  it("…through the SAME stash, not a second route into the reader", () => {
    // One channel, so a transcript matched from the reader and one matched at
    // capture time are the same operation on the same evidence.
    const block = LINE.slice(LINE.indexOf("onFindAnswers={asksForReview.length"));
    expect(block.slice(0, 700)).toContain("_reviewTranscript");
    expect(block.slice(0, 700)).toContain("_reviewAsks");
    expect(block.slice(0, 900)).toContain('onRunAgent?.("review-capture", "listen")');
  });

  it("writes NOTHING to the entry it reads", () => {
    // The evidence is already on the record. Only the underscore keys move,
    // and they stay out of the movement fingerprint — reading a transcript
    // must not restate it as new evidence.
    const block = LINE.slice(LINE.indexOf("onFindAnswers={asksForReview.length"));
    expect(block.slice(0, 700)).toContain('onSaveInputs("listen"');
    expect(block.slice(0, 700)).toContain("silent: true");
  });

  it("the control says what it will do before it is pressed", () => {
    const READER = readFileSync(resolve(__dirname, "../components/flow/EvidenceReader.tsx"), "utf8");
    expect(READER).toContain("Find answers — ");
    expect(READER).toContain("nothing is recorded as said until you do");
    // A reader offering to find answers to zero questions is a button that
    // cannot do anything; a reference entry has no text here to read.
    expect(READER).toContain('onFindAnswers && openAsks && entry.kind !== "reference"');
  });

  it("and cannot be fired twice while it is running", () => {
    // The agent takes real seconds on the edge. Without this the button looks
    // inert and gets pressed again, which runs the read — and the spend — twice.
    const READER = readFileSync(resolve(__dirname, "../components/flow/EvidenceReader.tsx"), "utf8");
    expect(READER).toContain("const [finding, setFinding]");
    expect(READER).toContain("disabled={finding}");
  });

  it("says what will happen and what will not, before it happens", () => {
    // The operator is agreeing to a MATCH, not to a recording.
    expect(LINE).toContain("nothing is recorded as said until you do");
  });
});
