/**
 * THE HALF OF THE LOOP THAT WAS NEVER BUILT.
 *
 * Every question went out with the exact point it settles attached. Every reply
 * came back with that point still attached, attributed, and stored on the
 * programme. And then nothing read it: `parseLocusAnswers` had no production
 * caller, so a locus stayed open after it had been answered, and `heard` was
 * zero on every real programme — not because nobody answered, but because the
 * ingest end of the loop was missing.
 *
 * The ingest is a READER over evidence that is already on the record, which is
 * why these cases are about recognition rather than storage. The one that
 * carries the whole design is the third: an operator retyping what somebody said
 * closes nothing, and the discriminator is the locus tag itself — produced only
 * by the response surface behind a person's own token-gated link.
 */
import { describe, it, expect } from "vitest";
import { deriveStakeholderAnswers, readStakeholderAnswers } from "@/v3/lib/ledger/stakeholderAnswers";
import { composeLocusAnswers } from "@/v3/components/flow/portalQuestionModel";
import type { ProgramSummary } from "@/new/types";

const programWith = (fields: Record<string, Record<string, unknown>>) =>
  ({ id: "p1", name: "Laila", rawData: { data: { phaseInputs: fields } } } as unknown as ProgramSummary);

const reply = (locus: string, answer: string) =>
  `Q: Can one Campaign have many Lead, or just one?\nA: ${answer}\n[locus: ${locus}]`;

const fromPriya = (...blocks: string[]) =>
  `— Priya Raman, Marketing lead, 2026-08-16 —\n${blocks.join("\n\n")}`;

describe("an answer that arrived on somebody's own link is read", () => {
  it("recovers the locus, the words and the person", () => {
    const rows = deriveStakeholderAnswers(programWith({
      listen: { stakeholderConversation: fromPriya(reply("el-campaign#rel-lead:cardinality", "Many — one campaign, many leads")) },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].about).toBe("el-campaign#rel-lead:cardinality");
    expect(rows[0].answer).toBe("Many — one campaign, many leads");
    expect(rows[0].saidByName).toBe("Priya Raman");
    expect(rows[0].saidByRole).toBe("Marketing lead");
    expect(rows[0].at).toBe("2026-08-16");
    // Provenance is required of a closure — where it arrived, not merely that it did.
    expect(rows[0].via).toBe("listen.stakeholderConversation");
  });

  it("reads what the response surface actually composes, not a test's idea of it", () => {
    // Round-trip through the real writer, so a change to either end fails here
    // rather than in a demo.
    const composed = composeLocusAnswers(
      [{ about: "el-lead#status:values", rendered: { question: "Which statuses does a lead move through?" } }] as never,
      { "el-lead#status:values": "New, Working, Qualified" },
    );
    const rows = deriveStakeholderAnswers(programWith({ listen: { conv: fromPriya(composed) } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].about).toBe("el-lead#status:values");
    expect(rows[0].answer).toBe("New, Working, Qualified");
  });

  it("finds answers wherever the review put them — a round does not land in Listen", () => {
    const rows = deriveStakeholderAnswers(programWith({
      listen: { conv: fromPriya(reply("a#1", "one")) },
      show: { demoFeedback: fromPriya(reply("b#2", "two")) },
    }));
    expect(rows.map((r) => r.about).sort()).toEqual(["a#1", "b#2"]);
  });

  it("keeps every person's own answer when several replied in one field", () => {
    const rows = deriveStakeholderAnswers(programWith({
      listen: {
        conv: [
          fromPriya(reply("a#1", "Priya's answer")),
          `— Daniel Osei, Sales ops, 2026-08-16 —\n${reply("b#2", "Daniel's answer")}`,
        ].join("\n\n"),
      },
    }));
    expect(rows.map((r) => [r.saidByName, r.answer])).toEqual([
      ["Priya Raman", "Priya's answer"],
      ["Daniel Osei", "Daniel's answer"],
    ]);
  });
});

describe("what must NOT close a locus", () => {
  it("an operator's capture — the boundary the whole module defends", () => {
    // The operator retyping what somebody said in a corridor stays beside the
    // ledger. It has no locus tag, because only the person's own link produces
    // one, so it cannot be mistaken for an assertion by them.
    const rows = deriveStakeholderAnswers(programWith({
      listen: { conv: "— Ops team, operator, 2026-08-16 —\nPriya said a campaign has many leads." },
    }));
    expect(rows).toEqual([]);
  });

  it("a dash-wrapped line inside a pasted document is not a voice", () => {
    const rows = deriveStakeholderAnswers(programWith({
      listen: { conv: `— INPUT SIGNALS —\n${reply("a#1", "orphaned")}` },
    }));
    expect(rows).toEqual([]);
  });

  it("a tagged block with no answer is not an answer", () => {
    const rows = deriveStakeholderAnswers(programWith({
      listen: { conv: fromPriya("Q: Can one Campaign have many Lead?\n[locus: a#1]") },
    }));
    expect(rows).toEqual([]);
  });

  it("the same person answering the same locus twice moves the burn-down once", () => {
    const program = programWith({
      listen: {
        _stakeholderAnswers: JSON.stringify([
          { about: "a#1", answer: "Many", saidByName: "Priya Raman", via: "pack-7", at: "2026-08-16" },
        ]),
        conv: fromPriya(reply("a#1", "Many")),
      },
    });
    const rows = readStakeholderAnswers(program);
    expect(rows).toHaveLength(1);
    // The explicitly filed row wins — a caller who stated the answer outright
    // keeps their own wording.
    expect(rows[0].via).toBe("pack-7");
  });

  it("the derivation reaches the reader even when nothing was filed explicitly", () => {
    const rows = readStakeholderAnswers(programWith({ listen: { conv: fromPriya(reply("a#1", "Many")) } }));
    expect(rows.map((r) => r.about)).toEqual(["a#1"]);
  });
});
