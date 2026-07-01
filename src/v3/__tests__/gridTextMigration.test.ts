import { parseRows, serializeRows, isLegacyFreeTextGridValue } from "@/v3/components/StructuredGrid";
import type { GridColumn } from "@/v3/lib/phaseInputSchema";

// When a field migrates from a free-text textarea to a grid (e.g. Discover's
// scope inclusions/exclusions), the previously-stored plain string must not be
// dropped. parseRows coerces it into one row per line under the first column,
// and serializeRows re-emits it as JSON — a self-healing, one-time migration.
const SCOPE_COLUMNS: GridColumn[] = [
  { key: "item", label: "In-scope element" },
  { key: "category", label: "Type" },
];

describe("grid free-text → rows migration (parseRows)", () => {
  it("splits a bullet list into one row per line under the first column", () => {
    const rows = parseRows("- Order-to-cash\n- Billing platform\n• EMEA region", SCOPE_COLUMNS);
    expect(rows.map((r) => r.item)).toEqual(["Order-to-cash", "Billing platform", "EMEA region"]);
    // Non-primary columns are left blank for the user to fill.
    expect(rows.every((r) => r.category === "")).toBe(true);
  });

  it("treats a single-line string as one item", () => {
    const rows = parseRows("Customer onboarding journey", SCOPE_COLUMNS);
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBe("Customer onboarding journey");
  });

  it("drops blank lines and trims whitespace", () => {
    const rows = parseRows("  Process A  \n\n   \n*   Process B", SCOPE_COLUMNS);
    expect(rows.map((r) => r.item)).toEqual(["Process A", "Process B"]);
  });

  it("re-serializes the migrated rows to JSON so the next save persists structure", () => {
    const rows = parseRows("Process A\nProcess B", SCOPE_COLUMNS);
    const json = serializeRows(rows, SCOPE_COLUMNS);
    const reparsed = parseRows(json, SCOPE_COLUMNS);
    expect(reparsed.map((r) => r.item)).toEqual(["Process A", "Process B"]);
  });

  it("still parses an already-migrated JSON value unchanged (idempotent)", () => {
    const json = JSON.stringify([{ id: "x", item: "Process A", category: "process" }]);
    const rows = parseRows(json, SCOPE_COLUMNS);
    expect(rows).toEqual([{ id: "x", item: "Process A", category: "process" }]);
  });

  it("yields no rows for empty input or a grid with no columns", () => {
    expect(parseRows("", SCOPE_COLUMNS)).toEqual([]);
    expect(parseRows("   ", SCOPE_COLUMNS)).toEqual([]);
    expect(parseRows("Process A", [])).toEqual([]);
  });

  it("does not coerce a non-array JSON value (object/number) into rows", () => {
    expect(parseRows('{"item":"x"}', SCOPE_COLUMNS)).toEqual([]);
    expect(parseRows("42", SCOPE_COLUMNS)).toEqual([]);
  });
});

// A field that migrated from free text still holds an unstructured value until the
// first re-save. isLegacyFreeTextGridValue lets the panel tell that legacy value
// (over which a projected draft may still be offered as replace/merge) apart from
// an empty grid and a genuinely curated JSON-array grid.
describe("isLegacyFreeTextGridValue", () => {
  it("is true for plain-text values (single line or paragraph)", () => {
    expect(isLegacyFreeTextGridValue("Customer onboarding journey")).toBe(true);
    expect(isLegacyFreeTextGridValue("In scope are sales and service processes across EMEA.")).toBe(true);
    // A bullet list is still plain text, not a JSON array.
    expect(isLegacyFreeTextGridValue("- Order-to-cash\n- Billing")).toBe(true);
  });

  it("is false for an empty / blank / '[]' value (that is an empty grid)", () => {
    expect(isLegacyFreeTextGridValue("")).toBe(false);
    expect(isLegacyFreeTextGridValue("   ")).toBe(false);
    expect(isLegacyFreeTextGridValue("[]")).toBe(false);
    expect(isLegacyFreeTextGridValue(" [] ")).toBe(false);
  });

  it("is false for a genuine serialized JSON-array grid (already structured)", () => {
    expect(isLegacyFreeTextGridValue(JSON.stringify([{ id: "x", item: "Process A", category: "" }]))).toBe(false);
    expect(isLegacyFreeTextGridValue("[{}]")).toBe(false);
  });

  it("treats a non-array JSON value (object/number) as legacy free text", () => {
    // parseRows yields no rows for these, but they are not a structured grid, so
    // the draft may still be offered rather than the value silently blocking it.
    expect(isLegacyFreeTextGridValue('{"item":"x"}')).toBe(true);
    expect(isLegacyFreeTextGridValue("42")).toBe(true);
  });

  it("is false for non-string input", () => {
    expect(isLegacyFreeTextGridValue(null)).toBe(false);
    expect(isLegacyFreeTextGridValue(undefined)).toBe(false);
    expect(isLegacyFreeTextGridValue(["Process A"])).toBe(false);
  });
});
