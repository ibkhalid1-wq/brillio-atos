import { describe, it, expect } from "vitest";
import { findStakeholderGrid, resolveStakeholderField, STAKEHOLDER_PHASE_ID } from "@/v3/lib/phaseInputSchema";
import { stakeholderColumnKeys } from "@/v3/lib/rosterRaci";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import type { GridColumn, PhaseInputField } from "@/v3/lib/phaseInputSchema";

/**
 * Canonical stakeholder-list resolution. Like the roster, the Discover-phase
 * stakeholder list is an ai-derived dynamic grid whose columns the planner
 * proposes per programme — these helpers are the shared address the "create
 * placeholder rows for suggested stakeholders" action resolves it through.
 */

const grid = (over: Partial<PhaseInputField>): PhaseInputField => ({
  id: "g",
  label: "Grid",
  type: "grid",
  required: false,
  columns: [],
  ...over,
});

describe("findStakeholderGrid", () => {
  it("prefers the canonical ids over a column-shape match", () => {
    const canonical = grid({ id: "stakeholderList" });
    const lookalike = grid({
      id: "other",
      columns: [
        { key: "name", label: "Name" },
        { key: "influence", label: "Influence" },
      ],
    });
    expect(findStakeholderGrid([lookalike, canonical])).toBe(canonical);
    expect(findStakeholderGrid([grid({ id: "stakeholderMap" })])?.id).toBe("stakeholderMap");
  });

  it("falls back to the first grid carrying an identity and an engagement column", () => {
    const match = grid({
      id: "people",
      columns: [
        { key: "who", label: "Stakeholder" },
        { key: "interest", label: "Interest" },
      ],
    });
    expect(findStakeholderGrid([grid({ id: "noise", columns: [{ key: "x", label: "X" }] }), match])).toBe(match);
  });

  it("returns null when no grid carries both an identity and an engagement signal", () => {
    // A grid with only a name (no influence/interest/engagement/impact) is not a
    // stakeholder grid — we never fabricate one.
    expect(findStakeholderGrid([grid({ columns: [{ key: "name", label: "Name" }] })])).toBeNull();
    expect(findStakeholderGrid([])).toBeNull();
  });

  it("ignores non-grid fields with matching ids", () => {
    const text: PhaseInputField = { id: "stakeholderList", label: "x", type: "textarea", required: false };
    expect(findStakeholderGrid([text])).toBeNull();
  });
});

describe("resolveStakeholderField", () => {
  it("resolves the static Discover stakeholder grid without a store", () => {
    // Discover now seeds a static stakeholderList grid in the methodology, so it
    // resolves even before the planner emits a dynamic schema.
    const field = resolveStakeholderField(undefined)!;
    expect(field.id).toBe("stakeholderList");
    expect(field.type).toBe("grid");
  });

  it("resolves the ai-derived stakeholderList from the dynamic store at the Discover phase", () => {
    const store: DynamicSchemaStore = {
      inputFields: {
        [STAKEHOLDER_PHASE_ID]: [
          {
            id: "stakeholderList",
            label: "Discover-phase stakeholders",
            type: "grid",
            required: true,
            columns: [
              { key: "role", label: "Role", type: "text" },
              { key: "name", label: "Name", type: "text" },
              { key: "influence", label: "Influence", type: "text" },
            ],
          },
        ],
      },
    };
    const field = resolveStakeholderField(store)!;
    expect(field.id).toBe("stakeholderList");
  });
});

describe("stakeholderColumnKeys", () => {
  it("prefers a dedicated role/title column for the identity, name column blanked on placeholders", () => {
    const cols: GridColumn[] = [
      { key: "person", label: "Name" },
      { key: "title", label: "Title" },
      { key: "influence", label: "Influence" },
    ];
    expect(stakeholderColumnKeys(cols)).toEqual({ roleKey: "title", nameKey: "person" });
  });

  it("falls back to the name column as the identity when no role column exists", () => {
    const cols: GridColumn[] = [
      { key: "stakeholderName", label: "Name" },
      { key: "interest", label: "Interest" },
    ];
    // No role/title/position/stakeholder column, so the name column IS the identity.
    expect(stakeholderColumnKeys(cols)).toEqual({ roleKey: "stakeholderName", nameKey: "stakeholderName" });
  });
});
