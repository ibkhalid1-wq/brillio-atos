import { normalizeProgram } from "@/new/lib/programData";

describe("normalizeProgram", () => {
  const baseRow = {
    id: "program-1",
    name: "ERP Transformation",
    client: "Acme",
    industry: "Financial Services",
    updated_at: "2026-06-13T00:00:00.000Z",
    data: {
      projectMeta: { name: "ERP Transformation" },
      objective: "Modernize finance operations",
      phases: [
        { id: "strategy", pct: 100 },
        { id: "mobilise", pct: 40 },
        { id: "discover", pct: 0 },
      ],
    },
  };

  it("derives activePhaseId from phases", () => {
    const program = normalizeProgram(baseRow);
    expect(program.activePhaseId).toBe("mobilise");
  });

  it("handles empty phases without throwing", () => {
    const program = normalizeProgram({
      ...baseRow,
      data: { objective: "", phases: [] },
    });
    expect(program.phases.length).toBeGreaterThan(0);
    expect(program.activePhaseId).toBeTruthy();
  });

  it("returns stable output for the same input", () => {
    const first = normalizeProgram(baseRow);
    const second = normalizeProgram(baseRow);
    expect(second).toEqual(first);
  });
});
