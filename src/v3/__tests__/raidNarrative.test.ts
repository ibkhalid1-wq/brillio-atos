import { describe, it, expect } from "vitest";
import { buildRaidNarrativePrompt } from "@/v3/lib/raidNarrative";
import type { RaidLinkage, RaidSynthesis } from "@/v3/lib/raidSynthesis";

/**
 * The narrative layer must never become a second source of truth. These tests
 * pin the grounding contract of the prompt builder: it refuses to produce a
 * prompt with no links, every provided edge appears verbatim in the user
 * message, the system prompt forbids inventing links, and the persona steers
 * the lens. The LLM call itself is not exercised here — only the pure prompt.
 */
function link(over: Partial<RaidLinkage> & { id: string }): RaidLinkage {
  return {
    from: { kind: "risk", id: "r1", label: "Vendor slip" },
    to: { kind: "decision", id: "d1", label: "Pick vendor" },
    relation: "causes",
    basis: "artifact",
    rationale: "Both reference artifact art-1.",
    confidence: 0.9,
    ...over,
  };
}

function synthesis(over: Partial<RaidSynthesis> = {}): RaidSynthesis {
  return {
    linkages: [],
    rollup: "1 risk(s), 0 blocker(s), 1 decision(s) (0 escalated). 1 cross-type link(s).",
    stats: { risks: 1, blockers: 0, decisions: 1, escalations: 0, linkages: 1 },
    ...over,
  };
}

describe("buildRaidNarrativePrompt", () => {
  it("returns null when there are no linkages to narrate", () => {
    expect(buildRaidNarrativePrompt(synthesis({ linkages: [] }))).toBeNull();
  });

  it("forbids inventing links in the system prompt", () => {
    const prompt = buildRaidNarrativePrompt(synthesis({ linkages: [link({ id: "e1" })] }));
    expect(prompt).not.toBeNull();
    expect(prompt!.system).toMatch(/Use ONLY the links provided/i);
    expect(prompt!.system).toMatch(/Never invent/i);
  });

  it("lists every provided edge by label, not id, in the user prompt", () => {
    const prompt = buildRaidNarrativePrompt(
      synthesis({
        linkages: [
          link({ id: "e1" }),
          link({ id: "e2", from: { kind: "blocker", id: "b1", label: "No objective" }, to: { kind: "decision", id: "d1", label: "Pick vendor" }, relation: "blocks" }),
        ],
      }),
    );
    expect(prompt!.user).toContain("Vendor slip");
    expect(prompt!.user).toContain("No objective");
    expect(prompt!.user).toContain("blocks");
    expect(prompt!.user).toContain("Pick vendor");
    // The deterministic rollup is carried in as the factual anchor.
    expect(prompt!.user).toContain("cross-type link(s)");
    // Ids never leak into the prose-facing prompt.
    expect(prompt!.user).not.toMatch(/\bd1\b/);
  });

  it("steers the lens by persona", () => {
    const exec = buildRaidNarrativePrompt(synthesis({ linkages: [link({ id: "e1" })] }), "executive");
    const arch = buildRaidNarrativePrompt(synthesis({ linkages: [link({ id: "e1" })] }), "architect");
    expect(exec!.system).toMatch(/executive sponsor/i);
    expect(arch!.system).toMatch(/architect/i);
  });
});
