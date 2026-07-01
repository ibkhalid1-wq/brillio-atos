import { projectArchitectureDecisions } from "@/v3/lib/designDecisions";

describe("projectArchitectureDecisions", () => {
  const decision = {
    decision: "Adopt an event-driven integration backbone",
    rationale: "Decouples the order and fulfilment domains and absorbs peak load",
    alternatives: ["Point-to-point REST", "Batch file exchange"],
  };

  it("maps agent architectureDecisions onto grid-shaped rows", () => {
    const rows = projectArchitectureDecisions({
      data: { solutionArchitecture: { architectureDecisions: [decision] } },
    });
    expect(rows).toEqual([
      {
        decision: "Adopt an event-driven integration backbone",
        optionsConsidered: "Point-to-point REST, Batch file exchange",
        rationale: "Decouples the order and fulfilment domains and absorbs peak load",
      },
    ]);
  });

  it("accepts an already-unwrapped data root (no data wrapper)", () => {
    const rows = projectArchitectureDecisions({
      solutionArchitecture: { architectureDecisions: [decision] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe(decision.decision);
  });

  it("drops entries with no decision (the grid's lead column)", () => {
    const rows = projectArchitectureDecisions({
      data: {
        solutionArchitecture: {
          architectureDecisions: [
            { rationale: "orphan rationale", alternatives: ["a"] },
            { decision: "  ", rationale: "blank decision" },
            decision,
          ],
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe(decision.decision);
  });

  it("handles a missing or non-array alternatives field", () => {
    const rows = projectArchitectureDecisions({
      data: {
        solutionArchitecture: {
          architectureDecisions: [
            { decision: "No alternatives listed", rationale: "sole viable path" },
            { decision: "String alternative", alternatives: "Only one option" },
          ],
        },
      },
    });
    expect(rows[0].optionsConsidered).toBe("");
    expect(rows[1].optionsConsidered).toBe("Only one option");
  });

  it("trims whitespace and filters empty alternatives", () => {
    const rows = projectArchitectureDecisions({
      data: {
        solutionArchitecture: {
          architectureDecisions: [
            { decision: "  Trim me  ", rationale: "  spaced  ", alternatives: ["  x  ", "", "  y"] },
          ],
        },
      },
    });
    expect(rows[0].decision).toBe("Trim me");
    expect(rows[0].rationale).toBe("spaced");
    expect(rows[0].optionsConsidered).toBe("x, y");
  });

  it("returns [] when the agent has not produced solutionArchitecture", () => {
    expect(projectArchitectureDecisions({ data: {} })).toEqual([]);
    expect(projectArchitectureDecisions({ data: { solutionArchitecture: {} } })).toEqual([]);
    expect(
      projectArchitectureDecisions({ data: { solutionArchitecture: { architectureDecisions: "nope" } } }),
    ).toEqual([]);
  });

  it("returns [] for null/undefined/non-object input without throwing", () => {
    expect(projectArchitectureDecisions(null)).toEqual([]);
    expect(projectArchitectureDecisions(undefined)).toEqual([]);
    expect(projectArchitectureDecisions("nope")).toEqual([]);
  });
});
