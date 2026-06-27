import { mergeKpiJson, deriveKpiReviewField } from "@/new/lib/useDocumentIntelligence";
import type { ExtractedKpi } from "@/new/lib/documentIntelligenceTypes";

/**
 * Structured KPI import contract. The AI emits a `kpis[]` array; the client must
 * land it in the Strategy KPI grid's JSON shape (`[{id,name,baseline,target,unit}]`)
 * and merge non-destructively on conflict — a naive string concat would corrupt
 * the JSON and silently wipe rows the PM already entered.
 */

function rows(json: string) {
  return JSON.parse(json) as Array<{ id: string; name: string; baseline: string; target: string; unit: string }>;
}

const kpi = (over: Partial<ExtractedKpi>): ExtractedKpi => ({
  name: "",
  baseline: "",
  target: "",
  unit: "",
  source: "",
  confidence: 0.85,
  extractionType: "extracted",
  ...over,
});

describe("mergeKpiJson", () => {
  it("appends genuinely new KPIs while keeping existing rows", () => {
    const existing = JSON.stringify([{ id: "a", name: "Accuracy", baseline: "55%", target: "80%", unit: "%" }]);
    const incoming = JSON.stringify([{ id: "b", name: "Prep Time", baseline: "60", target: "10", unit: "min" }]);

    const merged = rows(mergeKpiJson(existing, incoming));

    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.name).sort()).toEqual(["Accuracy", "Prep Time"]);
  });

  it("fills blank cells on an existing row without overwriting set values", () => {
    const existing = JSON.stringify([{ id: "a", name: "Accuracy", baseline: "55%", target: "", unit: "" }]);
    const incoming = JSON.stringify([{ id: "b", name: "accuracy", baseline: "99%", target: "80%", unit: "%" }]);

    const merged = rows(mergeKpiJson(existing, incoming));

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ baseline: "55%", target: "80%", unit: "%" });
  });

  it("survives corrupt/empty input without throwing", () => {
    expect(rows(mergeKpiJson("", ""))).toEqual([]);
    expect(rows(mergeKpiJson("not json", "[{bad}]"))).toEqual([]);
  });

  it("on re-extract (preferIncoming) refreshes overlapping cells from the document", () => {
    const existing = JSON.stringify([{ id: "a", name: "Accuracy", baseline: "55%", target: "80%", unit: "%" }]);
    const incoming = JSON.stringify([{ id: "b", name: "accuracy", baseline: "72%", target: "90%", unit: "%" }]);

    const merged = rows(mergeKpiJson(existing, incoming, true));

    expect(merged).toHaveLength(1);
    // Document values win, but the stable existing row id is retained.
    expect(merged[0]).toMatchObject({ id: "a", name: "Accuracy", baseline: "72%", target: "90%", unit: "%" });
  });

  it("on re-extract keeps existing cells the document leaves blank and preserves PM-only KPIs", () => {
    const existing = JSON.stringify([
      { id: "a", name: "Accuracy", baseline: "55%", target: "80%", unit: "%" },
      { id: "p", name: "PM Only", baseline: "1", target: "2", unit: "u" },
    ]);
    const incoming = JSON.stringify([{ id: "b", name: "Accuracy", baseline: "72%", target: "", unit: "" }]);

    const merged = rows(mergeKpiJson(existing, incoming, true));

    expect(merged).toHaveLength(2);
    const accuracy = merged.find((r) => r.name === "Accuracy")!;
    expect(accuracy).toMatchObject({ baseline: "72%", target: "80%", unit: "%" });
    expect(merged.find((r) => r.name === "PM Only")).toMatchObject({ baseline: "1", target: "2", unit: "u" });
  });
});

describe("deriveKpiReviewField", () => {
  it("returns null when there are no named KPIs", () => {
    expect(deriveKpiReviewField(undefined, {})).toBeNull();
    expect(deriveKpiReviewField([kpi({ name: "  " })], {})).toBeNull();
  });

  it("serializes KPIs into the strategy grid shape", () => {
    const field = deriveKpiReviewField(
      [kpi({ name: "Accuracy", baseline: "55%", target: "80%", unit: "%" })],
      {},
    );

    expect(field).not.toBeNull();
    expect(field!.phaseId).toBe("strategy");
    expect(field!.fieldId).toBe("kpis");
    const parsed = rows(field!.mapping.value);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ name: "Accuracy", baseline: "55%", target: "80%", unit: "%" });
    expect(parsed[0].id).toBeTruthy();
    expect(field!.hasConflict).toBe(false);
  });

  it("flags a conflict when the strategy phase already has different KPIs", () => {
    const existing = JSON.stringify([{ id: "x", name: "Old", baseline: "1", target: "2", unit: "u" }]);
    const field = deriveKpiReviewField(
      [kpi({ name: "Accuracy", baseline: "55%", target: "80%", unit: "%" })],
      { strategy: { kpis: existing } },
    );

    expect(field!.hasConflict).toBe(true);
    expect(field!.existingValue).toBe(existing);
  });

  it("averages confidence across extracted KPIs", () => {
    const field = deriveKpiReviewField(
      [kpi({ name: "A", confidence: 0.9 }), kpi({ name: "B", confidence: 0.7 })],
      {},
    );
    expect(field!.mapping.confidence).toBeCloseTo(0.8, 5);
  });
});
