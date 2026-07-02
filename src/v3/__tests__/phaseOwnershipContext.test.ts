import { describe, it, expect } from "vitest";
import { buildPhaseOwnershipContext } from "@/v3/lib/methodology";

describe("buildPhaseOwnershipContext", () => {
  it("returns '' for an unknown phase id", () => {
    expect(buildPhaseOwnershipContext("not-a-phase")).toBe("");
  });

  it("marks the current phase, earlier phases, and later phases relative to the caller", () => {
    const map = buildPhaseOwnershipContext("discover"); // atos-lite: strategy, mobilise, discover, build, operate, valuerealize
    expect(map).toContain("▸ Strategy [EARLIER — already established upstream]");
    expect(map).toContain("▸ Mobilise [EARLIER — already established upstream]");
    expect(map).toContain("▸ Discover [CURRENT PHASE — gaps may be raised here]");
    expect(map).toContain("▸ Build [LATER — out of scope for this artifact]");
  });

  it("lists a phase's owned inputs (by label) and artifacts (required + input-flow targets)", () => {
    const map = buildPhaseOwnershipContext("strategy");
    // Strategy owns these captured inputs...
    expect(map).toContain("Business objective");
    expect(map).toContain("Executive sponsor");
    // ...and these artifacts (from requiredArtifacts).
    expect(map).toMatch(/Strategy \[CURRENT[^\n]*\n\s+• Inputs:[^\n]*\n\s+• Artifacts:[^\n]*charter/);
    expect(map).toContain("strategic-roadmap");
  });

  it("attributes later-phase-owned scope/roster facts to their owning phase, not Strategy", () => {
    const map = buildPhaseOwnershipContext("strategy");
    // The atomic scope inputs are Discover-owned (a LATER phase from Strategy).
    const discoverBlock = map.slice(map.indexOf("▸ Discover"));
    expect(discoverBlock).toContain("In-scope processes, systems & geographies");
    expect(discoverBlock).toContain("scope-map");
    // The named team roster is Mobilise-owned.
    const mobiliseBlock = map.slice(map.indexOf("▸ Mobilise"), map.indexOf("▸ Discover"));
    expect(mobiliseBlock).toContain("Core team roster");
    expect(mobiliseBlock).toContain("raci-matrix");
  });

  it("leads with an authoritative header the gap discipline can consult", () => {
    const map = buildPhaseOwnershipContext("strategy");
    expect(map.startsWith("## Phase ownership map")).toBe(true);
  });
});
