import { describe, expect, it } from "vitest";
import {
  filterActionableImprovements,
  isSystemOwnedIdSuggestion,
} from "@/v3/lib/qualityImprovementFilter";

describe("isSystemOwnedIdSuggestion", () => {
  it("flags the milestone-ID suggestion that echoes a literal seed id", () => {
    const text =
      "Add a unique milestone ID for each milestone in the register (e.g., 'seed-1782761143653-0-d40k0' for 'Development complete') to ensure traceability.";
    expect(isSystemOwnedIdSuggestion(text)).toBe(true);
  });

  it("flags an 'assign unique identifiers' suggestion with no literal seed id", () => {
    expect(
      isSystemOwnedIdSuggestion("Assign unique identifiers to each requirement for traceability."),
    ).toBe(true);
  });

  it("flags variants of the add-unique-id phrasing", () => {
    expect(isSystemOwnedIdSuggestion("Include a unique requirement id per row")).toBe(true);
    expect(isSystemOwnedIdSuggestion("Generate unique milestone identifiers")).toBe(true);
  });

  it("keeps a substantive improvement that is not about system-owned ids", () => {
    expect(
      isSystemOwnedIdSuggestion("Add a clear owner and target date for each milestone."),
    ).toBe(false);
  });

  it("does not flag unrelated mentions of the word id", () => {
    expect(isSystemOwnedIdSuggestion("Clarify the identity of the approving stakeholder.")).toBe(
      false,
    );
  });

  it("returns false for empty input", () => {
    expect(isSystemOwnedIdSuggestion("")).toBe(false);
  });
});

describe("filterActionableImprovements", () => {
  it("removes only the system-owned-id false positives", () => {
    const input = [
      "Add a unique milestone ID for each milestone (e.g., 'seed-1782761143653-0-d40k0').",
      "Add a clear owner and target date for each milestone.",
      "Assign unique identifiers to each requirement.",
      "Tie each milestone to an acceptance criterion.",
    ];
    expect(filterActionableImprovements(input)).toEqual([
      "Add a clear owner and target date for each milestone.",
      "Tie each milestone to an acceptance criterion.",
    ]);
  });

  it("returns an empty list unchanged", () => {
    expect(filterActionableImprovements([])).toEqual([]);
  });
});
