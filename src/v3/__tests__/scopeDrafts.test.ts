import { projectCharterInScope, projectCharterOutOfScope } from "@/v3/lib/scopeDrafts";

describe("projectCharterInScope / projectCharterOutOfScope", () => {
  const charter = {
    inScope: ["Order-to-cash process", "EU & UK geographies", "SAP S/4HANA"],
    outOfScope: ["Payroll", "APAC rollout"],
  };

  it("maps charter inScope onto scopeInclusions grid rows (item + empty category) with stable ids", () => {
    const rows = projectCharterInScope({ data: { transformationCharter: charter } });
    expect(rows).toEqual([
      { id: "scope-in-order-to-cash-process", item: "Order-to-cash process", category: "" },
      { id: "scope-in-eu-uk-geographies", item: "EU & UK geographies", category: "" },
      { id: "scope-in-sap-s-4hana", item: "SAP S/4HANA", category: "" },
    ]);
  });

  it("maps charter outOfScope onto scopeExclusions grid rows with side-prefixed ids", () => {
    const rows = projectCharterOutOfScope({ data: { transformationCharter: charter } });
    expect(rows).toEqual([
      { id: "scope-out-payroll", item: "Payroll", category: "" },
      { id: "scope-out-apac-rollout", item: "APAC rollout", category: "" },
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
      { id: "scope-in-order-to-cash", item: "Order-to-cash", category: "" },
      { id: "scope-in-42", item: "42", category: "" },
    ]);
  });

  it("de-duplicates repeated scope lines case-insensitively", () => {
    const rows = projectCharterInScope({
      data: { transformationCharter: { inScope: ["Order-to-cash", "order-to-cash", "Billing"] } },
    });
    expect(rows).toEqual([
      { id: "scope-in-order-to-cash", item: "Order-to-cash", category: "" },
      { id: "scope-in-billing", item: "Billing", category: "" },
    ]);
  });

  it("projects the same id for the same scope line across re-projections (stability)", () => {
    const data = { data: { transformationCharter: charter } };
    const first = projectCharterInScope(data);
    const second = projectCharterInScope(data);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it("disambiguates two distinct items that slug identically with a numeric suffix", () => {
    // "A/B" and "A B" both slug to "a-b"; the second must not collide with the first.
    const rows = projectCharterInScope({
      data: { transformationCharter: { inScope: ["A/B", "A B"] } },
    });
    expect(rows.map((r) => r.id)).toEqual(["scope-in-a-b", "scope-in-a-b-2"]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("falls back to a placeholder slug when the item has no alphanumerics", () => {
    const rows = projectCharterInScope({
      data: { transformationCharter: { inScope: ["!!!", "###"] } },
    });
    expect(rows.map((r) => r.id)).toEqual(["scope-in-item", "scope-in-item-2"]);
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
