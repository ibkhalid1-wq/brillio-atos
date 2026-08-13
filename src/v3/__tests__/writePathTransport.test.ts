/**
 * THE TRANSPORT — link → edge → quarantine → ingest → claim.
 *
 * `stakeholderWritePath.test.ts` proves the LEDGER half: given a per-locus answer on
 * the record, the locus closes, `heard` ticks and the in-flight row clears. This file
 * proves the pipe that puts one there, and the one thing about that pipe which is not
 * a convenience: `flow-portal` is PUBLIC and token-gated, and a per-locus answer is
 * the first thing a respondent can send that goes on to close a claim.
 *
 * So the locus is never taken on trust. `sanitiseLocusAnswers` is the boundary, it
 * lives in `_shared` (the edge enforces it, this suite covers it — one definition,
 * not a client copy and an edge copy), and the assertion that matters most below is
 * the one where a link-holder tries to answer a locus that was never sent to them.
 */
import { describe, it, expect } from "vitest";
import { sanitiseLocusAnswers, MAX_LOCUS_ANSWER_CHARS } from "@shared/portalLinkState.ts";
import { ingestPortalResponse } from "@/v3/components/flow/flowPortal";
import { readStakeholderAnswers } from "@/v3/lib/ledger/stakeholderAnswers";

const MINE = "el:attr:account.segment#dataType";
const THEIRS = "el:attr:invoice.terms#dataType";
const PACK = { questions: ["What are the segments?"], questionLoci: [MINE] };

describe("the boundary: a link may only answer what was sent to it", () => {
  it("keeps an answer to a locus the pack carries", () => {
    expect(sanitiseLocusAnswers([{ about: MINE, answer: "Enterprise, Mid-Market, SMB" }], PACK))
      .toEqual([{ about: MINE, answer: "Enterprise, Mid-Market, SMB" }]);
  });

  it("DROPS an answer to a locus that was never sent to them", () => {
    // The one that matters. Without this, anyone holding one stakeholder's link
    // could assert an answer — which closes a claim and ticks heard — against any
    // locus in the programme.
    // MUTATION: remove the `allowed.has(about)` check → this returns the row.
    expect(sanitiseLocusAnswers([{ about: THEIRS, answer: "Net 30" }], PACK)).toEqual([]);
  });

  it("drops a pack with no loci at all, rather than trusting the client's list", () => {
    expect(sanitiseLocusAnswers([{ about: MINE, answer: "x" }], { questions: ["q"] })).toEqual([]);
    expect(sanitiseLocusAnswers([{ about: MINE, answer: "x" }], null)).toEqual([]);
  });

  it("keeps the FIRST answer per locus — a replay cannot overwrite what was said", () => {
    const out = sanitiseLocusAnswers([
      { about: MINE, answer: "the real answer" },
      { about: MINE, answer: "overwritten later" },
    ], PACK);
    expect(out).toEqual([{ about: MINE, answer: "the real answer" }]);
  });

  it("caps one answer's length, and drops the empties", () => {
    const long = sanitiseLocusAnswers([{ about: MINE, answer: "x".repeat(MAX_LOCUS_ANSWER_CHARS + 500) }], PACK);
    expect(long[0].answer).toHaveLength(MAX_LOCUS_ANSWER_CHARS);
    expect(sanitiseLocusAnswers([{ about: MINE, answer: "   " }], PACK)).toEqual([]);
    expect(sanitiseLocusAnswers("not an array", PACK)).toEqual([]);
  });
});

describe("ingest promotes a quarantined answer onto the record", () => {
  const ITEM = "item-1";
  const withInbox = (locusAnswers?: unknown) => ({
    id: "p1",
    rawData: {
      data: {
        flowPortalInbox: [{
          id: ITEM, kind: "interview", stakeholder: "Priya Raman", role: "Sales Operations Lead",
          receivedAt: "2026-08-13T09:00:00.000Z", text: "Q: What are the segments?\nA: Enterprise, Mid-Market, SMB",
          ...(locusAnswers ? { locusAnswers } : {}),
        }],
        flowInterviewPacks: [{ stakeholder: "Priya Raman", movementId: "listen", ...PACK }],
      },
    },
  }) as never;

  /** `ingestPortalResponse` returns the next blob; read it back as a programme. */
  const ingested = (program: unknown) => {
    const next = ingestPortalResponse(program as never, ITEM, "operator");
    expect(next, "ingest refused the item — the fixture is wrong, not the code").not.toBeNull();
    return { id: "p1", rawData: next } as never;
  };

  it("writes the answer where the ledger reads it, attributed and with its provenance", () => {
    // MUTATION: delete the promotion block in ingestInterviewResponse → 0 answers,
    // and the whole write path is inert again.
    const answers = readStakeholderAnswers(
      ingested(withInbox([{ about: MINE, answer: "Enterprise, Mid-Market, SMB" }])),
    );
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      about: MINE,
      answer: "Enterprise, Mid-Market, SMB",
      saidByName: "Priya Raman",           // THEM, never the operator
      saidByRole: "Sales Operations Lead",
      via: `portal:${ITEM}`,               // the link it arrived on
    });
  });

  it("still ingests a response that carries no per-locus answers", () => {
    // Every client older than this sends prose only. It must keep working, and it
    // must add nothing to the ledger's channel.
    expect(readStakeholderAnswers(ingested(withInbox()))).toHaveLength(0);
  });

  it("appends rather than replaces, so a second link does not erase the first", () => {
    const once = ingested(withInbox([{ about: MINE, answer: "Enterprise, Mid-Market, SMB" }]));
    // Re-ingest the same shape over the already-written record.
    const twice = ingestPortalResponse(
      { id: "p1", rawData: { data: {
        ...(once as unknown as { rawData: { data: Record<string, unknown> } }).rawData.data,
        flowPortalInbox: [{
          id: "item-2", kind: "interview", stakeholder: "Sam Ortiz", role: "Finance",
          receivedAt: "2026-08-13T10:00:00.000Z", text: "…",
          locusAnswers: [{ about: THEIRS, answer: "Net 30" }],
        }],
        flowInterviewPacks: [{ stakeholder: "Sam Ortiz", movementId: "listen", questions: ["Terms?"], questionLoci: [THEIRS] }],
      } } } as never,
      "item-2", "operator",
    );
    const answers = readStakeholderAnswers({ id: "p1", rawData: twice } as never);
    expect(answers.map((a) => a.saidByName).sort()).toEqual(["Priya Raman", "Sam Ortiz"]);
  });
});
