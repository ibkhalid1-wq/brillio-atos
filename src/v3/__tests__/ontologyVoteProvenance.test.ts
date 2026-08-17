/**
 * A DOCUMENT THAT DID NOT EARN ITS CONFIDENCE MUST NOT LOOK LIKE ONE THAT DID.
 *
 * The provisional ontology is an ensemble: the same grounded prompt run five
 * times, reconciled by majority vote, with the vote share acting as a real
 * confidence signal — a concept short of consensus rides into gaps as an
 * interview question instead of being asserted.
 *
 * THE DEFECT. Every draft call carries `.catch(() => null)`, and when fewer than
 * three come back the voted path returns null and the caller falls through to
 * ONE ordinary generation. The fallback is right; a programme should not stall
 * on an API's bad afternoon. What was wrong is that it was SILENT — the result
 * was a single draft with no vote and no agreement bar, indistinguishable from
 * a reconciled document. That is worse than a failure: a failure gets retried
 * and this gets trusted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconciliationOf, wasReconciled } from "@shared/ontologyVote.ts";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/run-agent/index.ts"), "utf8");
const full = { asked: 5, usable: 5, threshold: 3 };

describe("the stamp says how the document was made", () => {
  it("a full run is reconciled, and says what the bar bought", () => {
    const r = reconciliationOf(full);
    expect(r.method).toBe("voted");
    expect(r.note).toContain("majority vote");
    expect(r.note).toContain("interview question");
  });

  it("too few drafts is NOT a vote, and the note says to re-run", () => {
    // THE CASE THIS EXISTS FOR.
    const r = reconciliationOf({ asked: 5, usable: 2, threshold: 3 });
    expect(r.method).toBe("single-draft");
    expect(r.note).toContain("SINGLE generation");
    expect(r.note).toContain("Re-running the agent");
    expect(r.usable).toBe(2);
  });

  it("nothing came back at all — still a truthful stamp, not an absent one", () => {
    expect(reconciliationOf({ asked: 5, usable: 0, threshold: 3 }).method).toBe("single-draft");
  });

  it("a short-handed vote is reported as STRICTER, not weaker", () => {
    // The threshold is absolute, so 3-of-4 is a higher bar than 3-of-5. Losing
    // a draft narrows the document rather than degrading it, and saying so
    // stops somebody re-running an agent whose longer gap list is correct.
    const r = reconciliationOf({ asked: 5, usable: 4, threshold: 3 });
    expect(r.method).toBe("voted");
    expect(r.note).toContain("STRICTER");
    expect(r.note).not.toContain("Re-running the agent");
  });

  it("does not cry wolf on the ordinary case", () => {
    // A full run is the overwhelming majority of runs. Its note explains the
    // method; it must not read as a warning, or the real one stops landing.
    const note = reconciliationOf(full).note;
    expect(note).not.toMatch(/SINGLE|STRICTER|did not come back|Treat every assertion/);
  });

  it("clamps a nonsense count rather than stamping a lie", () => {
    expect(reconciliationOf({ asked: 5, usable: 9, threshold: 3 }).usable).toBe(5);
    expect(reconciliationOf({ asked: 5, usable: -2, threshold: 3 }).usable).toBe(0);
  });
});

describe("reading the stamp back off a stored document", () => {
  it("tells a voted document from a single-draft one", () => {
    expect(wasReconciled({ reconciliation: reconciliationOf(full) })).toBe(true);
    expect(wasReconciled({ reconciliation: reconciliationOf({ asked: 5, usable: 1, threshold: 3 }) })).toBe(false);
  });

  it("an OLDER document is unknown, never 'degraded'", () => {
    // Every ontology generated before this existed carries no stamp. Reporting
    // those as single-draft would invent a defect in documents that may well
    // have been voted — the honest answer is that nobody recorded it.
    expect(wasReconciled({ entities: [] })).toBeNull();
    expect(wasReconciled(null)).toBeNull();
    expect(wasReconciled({ reconciliation: { method: "something-else" } })).toBeNull();
  });
});

describe("an operator can see it without opening the JSON", () => {
  const STUDIO = readFileSync(resolve(__dirname, "../components/flow/studio/FlowArtifactStudio.tsx"), "utf8");
  const SHELL = readFileSync(resolve(__dirname, "../components/flow/flowShellData.ts"), "utf8");

  it("the card carries a warning ONLY when the document says it is degraded", () => {
    // Unknown must not read as degraded, or every document older than the
    // stamp sprouts a defect it may not have.
    expect(SHELL).toContain("wasReconciled(mirror) === false");
    expect(SHELL).toContain("single draft — not reconciled by vote");
  });

  it("it sits beside the confidence figure, which is the number it qualifies", () => {
    // Anchored on the colophon's own JSX, not on the first `v3fs-disc-hint`
    // (that class serves several disclosures) and not on the bare phrase
    // "About this document" (which appears first in a comment 46 lines above
    // the element). Both near-misses tested code this change never touched.
    const at = STUDIO.indexOf('v3fs-disc-l">About this document');
    const hint = STUDIO.slice(at, at + 900);
    expect(hint).toContain("artifact.confidence != null ? `confidence");
    expect(hint).toContain("artifact.provenanceWarning");
  });

  it("the colophon shows the document's OWN note, not a re-derivation", () => {
    expect(STUDIO).toContain("How it was made");
    expect(STUDIO).toContain("draft.reconciliation as Record<string, unknown>).note");
  });

  it("a document with no stamp draws no empty row", () => {
    const row = STUDIO.slice(STUDIO.indexOf("How it was made") - 700, STUDIO.indexOf("How it was made"));
    expect(row).toContain('typeof draft.reconciliation === "object"');
    expect(row).toContain("draft.reconciliation !== null");
  });
});

describe("the edge records it, on the paths where it matters", () => {
  it("the outcome is stamped BEFORE the drafts run, so a throw still records", () => {
    // The catch returns null to protect the run. Without an up-front stamp the
    // one path that most needs provenance would leave none.
    const fn = EDGE.slice(EDGE.indexOf("async function runVotedProvisionalOntology"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body.indexOf("report.outcome =")).toBeLessThan(body.indexOf("await Promise.all"));
    expect(body).toContain("usable: 0");
  });

  it("counts DRAFTS, not calls that merely returned", () => {
    // A call that came back as prose or a truncated stream cannot vote.
    // Counting it would overstate the agreement behind the document.
    const fn = EDGE.slice(EDGE.indexOf("async function runVotedProvisionalOntology"));
    expect(fn.slice(0, 2600)).toContain("usable: drafts.length");
  });

  it("the stamp lands on the document, beside the other post-conditions", () => {
    expect(EDGE).toContain('request.agentId === "domain-ontology" && voteReport.outcome');
    expect(EDGE).toContain("reconciliation: reconciliationOf(voteReport.outcome)");
  });

  it("and NOT in gaps — that channel gates the movement", () => {
    // `gaps === 0` is part of an artifact's `done`. A provenance note there
    // would hold a programme on something no stakeholder can answer.
    const block = EDGE.slice(EDGE.indexOf('request.agentId === "domain-ontology" && voteReport.outcome'));
    expect(block.slice(0, 400)).not.toContain("gaps:");
  });
});
