import { projectCharterInScope, projectCharterOutOfScope } from "@/v3/lib/scopeDrafts";

describe("projectCharterInScope / projectCharterOutOfScope", () => {
  const charter = {
    inScope: ["Order-to-cash process", "EU & UK geographies", "SAP S/4HANA"],
    outOfScope: ["Payroll", "APAC rollout"],
  };

  it("maps charter inScope onto scopeInclusions grid rows (item + empty category)", () => {
    const rows = projectCharterInScope({ data: { transformationCharter: charter } });
    expect(rows).toEqual([
      { item: "Order-to-cash process", category: "" },
      { item: "EU & UK geographies", category: "" },
      { item: "SAP S/4HANA", category: "" },
    ]);
  });

  it("maps charter outOfScope onto scopeExclusions grid rows", () => {
    const rows = projectCharterOutOfScope({ data: { transformationCharter: charter } });
    expect(rows).toEqual([
      { item: "Payroll", category: "" },
      { item: "APAC rollout", category: "" },
    ]);
  });

  it("accepts an already-unwrapped data root (no data wrapper)", () => {
    const rows = projectCharterInScope({ transformationCharter: charter });
    expect(rows).toHaveLength(3);
    expect(rows[0].item).toBe("Order-to-cash process");
  });

  it("trims whitespace and drops blank/non-string scope entries", () => {
    const rows = projectCharterInScope({
      data: { transformationCharter: { inScope: ["  Order-to-cash  ", "", "   ", null, 42] } },
    });
    expect(rows).toEqual([
      { item: "Order-to-cash", category: "" },
      { item: "42", category: "" },
    ]);
  });

  it("de-duplicates repeated scope lines case-insensitively", () => {
    const rows = projectCharterInScope({
      data: { transformationCharter: { inScope: ["Order-to-cash", "order-to-cash", "Billing"] } },
    });
    expect(rows).toEqual([
      { item: "Order-to-cash", category: "" },
      { item: "Billing", category: "" },
    ]);
  });

  it("returns [] when the charter has not run or names no scope", () => {
    expect(projectCharterInScope({ data: {} })).toEqual([]);
    expect(projectCharterInScope({ data: { transformationCharter: {} } })).toEqual([]);
    expect(projectCharterInScope({ data: { transformationCharter: { inScope: "nope" } } })).toEqual([]);
    expect(projectCharterOutOfScope({ data: { transformationCharter: { outOfScope: {} } } })).toEqual([]);
  });

  it("returns [] for null/undefined/non-object input without throwing", () => {
    expect(projectCharterInScope(null)).toEqual([]);
    expect(projectCharterInScope(undefined)).toEqual([]);
    expect(projectCharterOutOfScope("nope")).toEqual([]);
  });
});
