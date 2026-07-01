import { preserveUntouchedGrids } from "@/v3/lib/gridSaveGuard";

describe("preserveUntouchedGrids", () => {
  const gridIds = ["keyDesignDecisions", "scopeInclusions"];
  const rows = JSON.stringify([{ id: "r1", decision: "Adopt SAP" }]);

  it("restores persisted rows for an untouched grid written empty", () => {
    const outgoing = { keyDesignDecisions: "[]", solutionApproach: "text" };
    const persisted = { keyDesignDecisions: rows };
    const result = preserveUntouchedGrids(outgoing, persisted, gridIds, new Set());
    expect(result.keyDesignDecisions).toBe(rows);
    // Non-grid fields pass through untouched.
    expect(result.solutionApproach).toBe("text");
  });

  it("treats null / '' / '[]' outgoing grid values as empty", () => {
    const persisted = { keyDesignDecisions: rows };
    for (const empty of ["", "  ", "[]", " [] "] as string[]) {
      const result = preserveUntouchedGrids({ keyDesignDecisions: empty }, persisted, gridIds, new Set());
      expect(result.keyDesignDecisions).toBe(rows);
    }
    // Absent key is also "empty" and gets restored.
    const restored = preserveUntouchedGrids({}, persisted, gridIds, new Set());
    expect(restored.keyDesignDecisions).toBe(rows);
  });

  it("never overrides a grid the user has touched (deliberate clear persists)", () => {
    const outgoing = { keyDesignDecisions: "[]" };
    const persisted = { keyDesignDecisions: rows };
    const touched = new Set(["keyDesignDecisions"]);
    const result = preserveUntouchedGrids(outgoing, persisted, gridIds, touched);
    expect(result.keyDesignDecisions).toBe("[]");
  });

  it("keeps a non-empty outgoing buffer (real edit wins)", () => {
    const edited = JSON.stringify([{ id: "r2", decision: "Adopt Oracle" }]);
    const outgoing = { keyDesignDecisions: edited };
    const persisted = { keyDesignDecisions: rows };
    const result = preserveUntouchedGrids(outgoing, persisted, gridIds, new Set());
    expect(result.keyDesignDecisions).toBe(edited);
  });

  it("does nothing when persisted is also empty (nothing to protect)", () => {
    for (const prev of ["[]", "", null, undefined, 42] as unknown[]) {
      const outgoing = { keyDesignDecisions: "[]" };
      const result = preserveUntouchedGrids(outgoing, { keyDesignDecisions: prev }, gridIds, new Set());
      expect(result.keyDesignDecisions).toBe("[]");
    }
  });

  it("returns the original object reference on a no-op (cheap change detection)", () => {
    const outgoing = { keyDesignDecisions: rows };
    const persisted = { keyDesignDecisions: rows };
    const result = preserveUntouchedGrids(outgoing, persisted, gridIds, new Set());
    expect(result).toBe(outgoing);
  });

  it("protects multiple untouched grids in one pass", () => {
    const inc = JSON.stringify([{ id: "s1", item: "Order-to-cash" }]);
    const outgoing = { keyDesignDecisions: "[]", scopeInclusions: "[]" };
    const persisted = { keyDesignDecisions: rows, scopeInclusions: inc };
    const result = preserveUntouchedGrids(outgoing, persisted, gridIds, new Set());
    expect(result.keyDesignDecisions).toBe(rows);
    expect(result.scopeInclusions).toBe(inc);
    // Original is not mutated.
    expect(outgoing.keyDesignDecisions).toBe("[]");
  });
});
