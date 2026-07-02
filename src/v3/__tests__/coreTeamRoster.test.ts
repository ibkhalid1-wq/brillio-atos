import { describe, it, expect } from "vitest";
import { findRosterGrid, matchColumnKey, resolveRosterField } from "@/v3/lib/phaseInputSchema";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import type { PhaseInputField } from "@/v3/lib/phaseInputSchema";

/**
 * Canonical roster resolution. Mobilise seeds the roster as a static grid (id
 * "coreTeamRoster"), so it is always present; the planner may add other fields
 * but static wins on id collision. These helpers are the single shared address
 * every consumer (inputs-panel reference, document-import bridge,
 * capacity-assessor) uses to find it. The pure findRosterGrid fallback still
 * resolves a purely planner-proposed roster (by name+role columns) for any field
 * list that lacks the canonical id.
 */

const grid = (over: Partial<PhaseInputField>): PhaseInputField => ({
  id: "g",
  label: "Grid",
  type: "grid",
  required: false,
  columns: [],
  ...over,
});

describe("matchColumnKey", () => {
  it("matches by key or label and falls back when nothing matches", () => {
    const cols = [
      { key: "personName", label: "Full name" },
      { key: "jobRole", label: "Role" },
    ];
    expect(matchColumnKey(cols, /name/i)).toBe("personName");
    expect(matchColumnKey(cols, /role|title/i)).toBe("jobRole");
    expect(matchColumnKey(cols, /allocation/i)).toBeUndefined();
    expect(matchColumnKey(cols, /allocation/i, "fallback")).toBe("fallback");
  });
});

describe("findRosterGrid", () => {
  it("prefers the canonical id over a column-shape match", () => {
    const canonical = grid({ id: "coreTeamRoster" });
    const lookalike = grid({
      id: "other",
      columns: [
        { key: "name", label: "Name" },
        { key: "role", label: "Role" },
      ],
    });
    expect(findRosterGrid([lookalike, canonical])).toBe(canonical);
  });

  it("falls back to the first grid carrying a name and a role column", () => {
    const match = grid({
      id: "people",
      columns: [
        { key: "who", label: "Name" },
        { key: "position", label: "Position" },
      ],
    });
    expect(findRosterGrid([grid({ id: "noise", columns: [{ key: "x", label: "X" }] }), match])).toBe(match);
  });

  it("returns null when no grid carries both a name and a role", () => {
    expect(findRosterGrid([grid({ columns: [{ key: "name", label: "Name" }] })])).toBeNull();
    expect(findRosterGrid([])).toBeNull();
  });

  it("ignores non-grid fields with matching ids", () => {
    const text: PhaseInputField = { id: "coreTeamRoster", label: "x", type: "textarea", required: false };
    expect(findRosterGrid([text])).toBeNull();
  });
});

describe("resolveRosterField", () => {
  it("resolves the static coreTeamRoster grid without a store", () => {
    const field = resolveRosterField(undefined)!;
    expect(field.id).toBe("coreTeamRoster");
    expect(field.type).toBe("grid");
    expect(field.columns?.map((c) => c.key)).toEqual(expect.arrayContaining(["role", "name"]));
  });

  it("keeps the static roster columns when the planner re-proposes coreTeamRoster (static wins on id collision)", () => {
    const store: DynamicSchemaStore = {
      inputFields: {
        mobilise: [
          {
            id: "coreTeamRoster",
            label: "Named individuals per core team role",
            type: "grid",
            required: true,
            columns: [
              { key: "role", label: "Role", type: "text" },
              { key: "name", label: "Name", type: "text" },
            ],
          },
        ],
      },
    };
    const field = resolveRosterField(store)!;
    expect(field.id).toBe("coreTeamRoster");
    // The static seed wins, so its richer column set (incl. org/allocation/startDate)
    // is kept, not the planner's two-column proposal.
    expect(field.columns?.map((c) => c.key)).toEqual(["role", "name", "org", "allocation", "startDate"]);
  });
});
