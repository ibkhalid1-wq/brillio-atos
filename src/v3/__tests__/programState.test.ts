import { getProgramState, wrapProgramState } from "@/new/lib/programState";

describe("programState", () => {
  it("reads flat rawData", () => {
    const state = getProgramState({ objective: "Ship value", phases: [{ id: "strategy", pct: 20 }] });
    expect(state.usesNestedData).toBe(false);
    expect(state.inner.objective).toBe("Ship value");
  });

  it("reads nested rawData.data", () => {
    const state = getProgramState({ meta: "keep", data: { objective: "Nested", phases: [] } });
    expect(state.usesNestedData).toBe(true);
    expect(state.inner.objective).toBe("Nested");
  });

  it("wrapProgramState preserves unrelated keys", () => {
    const wrapped = wrapProgramState({ meta: "keep", data: { objective: "Old" } }, { objective: "New" }, true);
    expect(wrapped).toEqual({ meta: "keep", data: { objective: "New" } });
  });
});
