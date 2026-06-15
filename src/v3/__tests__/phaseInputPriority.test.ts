import { prioritizePhaseFields } from "@/v3/lib/phaseInputPriority";
import type { PhaseInputField } from "@/v3/lib/phaseInputSchema";

const FIELDS: PhaseInputField[] = [
  { id: "a", label: "A (req)", type: "textarea", required: true },
  { id: "b", label: "B (opt)", type: "text", required: false },
  { id: "c", label: "C (req)", type: "text", required: true },
  { id: "d", label: "D (opt)", type: "textarea", required: false },
];

describe("prioritizePhaseFields", () => {
  it("floats required gaps to the top, then optional gaps, then complete", () => {
    // a filled, b empty, c empty (required), d filled
    const result = prioritizePhaseFields(FIELDS, { a: "done", b: "", c: "", d: "done" });
    expect(result.fields.map((f) => f.field.id)).toEqual(["c", "b", "a", "d"]);
    expect(result.requiredGaps).toBe(1); // only c
    expect(result.optionalGaps).toBe(1); // only b
    expect(result.firstGapId).toBe("c"); // required gap wins
  });

  it("preserves methodology order within each band as a stable tiebreak", () => {
    // nothing filled → required (a, c) keep order, then optional (b, d) keep order
    const result = prioritizePhaseFields(FIELDS, {});
    expect(result.fields.map((f) => f.field.id)).toEqual(["a", "c", "b", "d"]);
    expect(result.requiredGaps).toBe(2);
    expect(result.optionalGaps).toBe(2);
    expect(result.firstGapId).toBe("a");
  });

  it("reports no gaps and null firstGapId when all required filled", () => {
    const result = prioritizePhaseFields(FIELDS, { a: "x", c: "y" });
    expect(result.requiredGaps).toBe(0);
    // b and d still empty optional gaps
    expect(result.optionalGaps).toBe(2);
    expect(result.firstGapId).toBe("b");
  });

  it("treats whitespace-only values as gaps", () => {
    const result = prioritizePhaseFields(FIELDS, { a: "   ", c: "y" });
    expect(result.requiredGaps).toBe(1); // a is whitespace → gap
    expect(result.firstGapId).toBe("a");
  });
});
