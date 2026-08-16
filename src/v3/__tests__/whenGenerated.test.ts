/**
 * "How old is what I am looking at?" — the question the board could not answer.
 *
 * Every generator stamps `generatedAt` and no surface showed it, so a tile read
 * identically whether its document was minted a minute ago or three weeks ago.
 * It is NOT the same question as "evidence moved": that says the inputs shifted,
 * and a document can be weeks old and perfectly current by that measure.
 */
import { describe, expect, it } from "vitest";
import { timeAgo, exactWhen, generatedStamp } from "@/v3/lib/whenGenerated";
import { movementArtifacts } from "@/v3/components/flow/flowShellData";
import type { ProgramSummary } from "@/new/types";

const NOW = Date.parse("2026-08-16T15:00:00.000Z");

describe("the words", () => {
  it("is relative near the present and a date beyond a day", () => {
    expect(timeAgo("2026-08-16T14:59:30.000Z", NOW)).toBe("just now");
    expect(timeAgo("2026-08-16T14:54:00.000Z", NOW)).toBe("6m ago");
    expect(timeAgo("2026-08-16T13:00:00.000Z", NOW)).toBe("2h ago");
    // past a day "17d ago" stops meaning anything and a date starts
    expect(timeAgo("2026-07-30T09:00:00.000Z", NOW)).toMatch(/\d/);
    expect(timeAgo("2026-07-30T09:00:00.000Z", NOW)).not.toMatch(/ago/);
  });

  it("says nothing rather than guessing", () => {
    expect(timeAgo("not-a-date", NOW)).toBe("");
    expect(exactWhen("not-a-date")).toBe("");
    expect(generatedStamp(null)).toBeNull();
    expect(generatedStamp("")).toBeNull();
    expect(generatedStamp("not-a-date")).toBeNull();
  });

  it("the short form always carries the exact instant beside it", () => {
    const stamp = generatedStamp("2026-08-16T13:00:00.000Z", NOW)!;
    expect(stamp.label).toBe("Generated 2h ago");
    expect(stamp.title).toMatch(/^Generated /);
    expect(stamp.title).not.toBe(stamp.label);      // the tooltip is the whole truth
    expect(stamp.title).toMatch(/2026/);
  });
});

describe("the card carries the stamp off the record", () => {
  const programme = (inner: Record<string, unknown>): ProgramSummary => ({
    id: "p1", name: "Stamp", client: "", methodology: "atos-flow",
    rawData: { data: inner }, updatedAt: "2026-08-16",
  } as unknown as ProgramSummary);

  // movementArtifacts reads only `movement.id`; the minimal shape is the honest fixture.
  const listen = { id: "listen" } as unknown as Parameters<typeof movementArtifacts>[1];

  it("reads the document's own generatedAt", () => {
    const cards = movementArtifacts(programme({
      domainOntology: { entities: [], generatedAt: "2026-08-16T12:16:56.387Z" },
      phaseArtifacts: { listen: { "domain-ontology": { status: "draft" } } },
    }), listen);
    const onto = cards.find((c) => c.id === "domain-ontology")!;
    expect(onto.generatedAt).toBe("2026-08-16T12:16:56.387Z");
  });

  it("falls back to the ledger stub's draft time, and to null when neither says", () => {
    const withStub = movementArtifacts(programme({
      domainOntology: { entities: [] },
      phaseArtifacts: { listen: { "domain-ontology": { status: "draft", agentDraftedAt: "2026-08-16T09:00:00.000Z" } } },
    }), listen);
    expect(withStub.find((c) => c.id === "domain-ontology")!.generatedAt).toBe("2026-08-16T09:00:00.000Z");

    const silent = movementArtifacts(programme({
      domainOntology: { entities: [] },
      phaseArtifacts: { listen: { "domain-ontology": { status: "draft" } } },
    }), listen);
    expect(silent.find((c) => c.id === "domain-ontology")!.generatedAt).toBeNull();
  });

  it("an unparseable stamp is null, never rendered as itself", () => {
    const cards = movementArtifacts(programme({
      domainOntology: { entities: [], generatedAt: "whenever" },
      phaseArtifacts: { listen: { "domain-ontology": { status: "draft" } } },
    }), listen);
    expect(cards.find((c) => c.id === "domain-ontology")!.generatedAt).toBeNull();
  });
});
