import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { buildLineModel, areaInitials } from "@/v3/lib/lineModel";

const programme = (
  inner: Record<string, unknown>,
  gateReviews?: Record<string, { status: string }>,
): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: inner, gateReviews } as unknown as ProgramSummary);

describe("lineModel.buildLineModel", () => {
  it("renders the full methodology from an empty record — the day-0 board", () => {
    const model = buildLineModel(programme({}));
    expect(model.bands.map((b) => b.id)).toEqual(["frame", "listen", "loop", "ship", "evolve"]);
    // 2 + 3 + 5 + 3 + 2 = 15 stations, every one visible before anything exists.
    // Listen carries THREE: the ontology, the atlas, and Agentify — the call on
    // each of the atlas's steps. Agentify GATES Listen, so a programme without
    // one has to be able to see that it is missing, here, at maturity ○.
    expect(model.bands.reduce((n, b) => n + b.stations.length, 0)).toBe(15);
    expect(model.bands[1].stations.map((s) => s.id))
      .toEqual(["domain-ontology", "current-state-atlas", "agentify"]);
    for (const band of model.bands) {
      for (const station of band.stations) {
        expect(station.maturity).toBe(0);
        expect(station.needsRefresh).toBe(false);
      }
    }
    expect(model.round).toBeGreaterThanOrEqual(1);
    expect(model.stats.refresh).toBe(0);
  });

  it("a present artifact reads grounded; an approved gate lifts it to approved", () => {
    const inner = { phaseArtifacts: { frame: { "charter": { confidence: 0.9 } } } };
    const drafted = buildLineModel(programme(inner));
    const charter = drafted.bands[0].stations.find((s) => s.id === "charter")!;
    expect(charter.card?.present).toBe(true);
    expect(charter.maturity).toBe(2);

    const approved = buildLineModel(programme(inner, { frame: { status: "approved" } }));
    expect(approved.bands[0].stations.find((s) => s.id === "charter")!.maturity).toBe(4);
    expect(approved.bands[0].chip.tone).toBe("green");
  });

  it("the ledger's stale status surfaces as needs-refresh and is counted", () => {
    const model = buildLineModel(programme({
      phaseArtifacts: { frame: { "discovery-kit": { status: "stale" } } },
    }));
    const kit = model.bands[0].stations.find((s) => s.id === "discovery-kit")!;
    expect(kit.needsRefresh).toBe(true);
    expect(model.stats.refresh).toBe(1);
  });

  it("the Kit's coverage domains become the board's areas, and a drafted ontology covers each at provisional", () => {
    const model = buildLineModel(programme({
      discoveryKit: { coverageMap: [
        { domain: "Sales", coveredBy: ["A"] },
        { domain: "CRM Platform", coveredBy: ["B"] },
      ] },
      phaseArtifacts: { listen: { "domain-ontology": { confidence: 0.7 } } },
    }));
    expect(model.areas).toEqual(expect.arrayContaining(["Sales", "CRM Platform"]));
    const onto = model.bands[1].stations.find((s) => s.id === "domain-ontology")!;
    expect(onto.perArea).not.toBeNull();
    const byArea = new Map(onto.perArea!.map((s) => [s.area, s.maturity]));
    // Provisional seed: drafted from the mandate, no interviews yet → ◔ per area.
    expect(byArea.get("Sales")).toBe(1);
    expect(byArea.get("CRM Platform")).toBe(1);
    // An absent atlas stays ○ per area.
    const atlas = model.bands[1].stations.find((s) => s.id === "current-state-atlas")!;
    expect(atlas.perArea!.every((s) => s.maturity === 0)).toBe(true);
  });

  it("gate chips expose real checklist arithmetic, not authored copy", () => {
    const model = buildLineModel(programme({}));
    const frame = model.bands[0];
    expect(frame.gate.length).toBeGreaterThan(0);
    const gating = frame.gate.filter((item) => !item.advisory);
    const done = gating.filter((item) => item.done).length;
    expect(frame.chip.text).toContain(`${done}/${gating.length}`);
  });

  it("ship and evolve documents drafted before convergence read provisional — drafting early, honestly", () => {
    const model = buildLineModel(programme({
      phaseArtifacts: { ship: { "hardening-plan": { confidence: 0.8 } } },
    }));
    const hardening = model.bands[3].stations.find((s) => s.id === "hardening-plan")!;
    expect(hardening.card?.present).toBe(true);
    expect(hardening.maturity).toBe(1);
  });
});

describe("lineModel.areaInitials", () => {
  it("labels segments with stable two-letter initials", () => {
    expect(areaInitials("Sales")).toBe("SA");
    expect(areaInitials("CRM Platform")).toBe("CP");
    expect(areaInitials("IT / Integration")).toBe("II");
  });
});
