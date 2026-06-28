import { describe, it, expect } from "vitest";
import { resolveGovernanceSelection } from "@/v3/lib/governanceModel";

/**
 * Governance selection is AI-generated, user-selectable, "replace-but-re-selectable":
 * every option stays available while one is effective. This resolver turns the
 * persisted payload into the option set plus the effective selection.
 */

describe("resolveGovernanceSelection", () => {
  it("returns null for non-object or legacy single-model payloads", () => {
    expect(resolveGovernanceSelection(null)).toBeNull();
    expect(resolveGovernanceSelection("model")).toBeNull();
    expect(resolveGovernanceSelection([])).toBeNull();
    expect(resolveGovernanceSelection({ summary: "legacy single model" })).toBeNull();
    expect(resolveGovernanceSelection({ options: [] })).toBeNull();
  });

  it("maps options and falls back to the first when nothing is selected", () => {
    const sel = resolveGovernanceSelection({
      options: [
        { id: "a", name: "Lean", decisionBodies: [{ x: 1 }] },
        { id: "b", name: "Federated" },
      ],
    })!;
    expect(sel.options.map((o) => o.id)).toEqual(["a", "b"]);
    expect(sel.recommendedId).toBeNull();
    expect(sel.selectedId).toBe("a");
    expect(sel.selected.name).toBe("Lean");
    expect(sel.options[0].decisionBodies).toEqual([{ x: 1 }]);
  });

  it("honours selectedOptionId over the recommendation", () => {
    const sel = resolveGovernanceSelection({
      options: [{ id: "a" }, { id: "b" }, { id: "c" }],
      recommendedOptionId: "b",
      selectedOptionId: "c",
    })!;
    expect(sel.recommendedId).toBe("b");
    expect(sel.selectedId).toBe("c");
    expect(sel.selected.id).toBe("c");
  });

  it("falls back to the recommendation when the selection is invalid", () => {
    const sel = resolveGovernanceSelection({
      options: [{ id: "a" }, { id: "b" }],
      recommendedOptionId: "b",
      selectedOptionId: "missing",
    })!;
    expect(sel.selectedId).toBe("b");
  });

  it("assigns stable fallback ids when options omit them", () => {
    const sel = resolveGovernanceSelection({
      options: [{ name: "First" }, { name: "Second" }],
    })!;
    expect(sel.options.map((o) => o.id)).toEqual(["option-1", "option-2"]);
    expect(sel.selectedId).toBe("option-1");
  });
});
