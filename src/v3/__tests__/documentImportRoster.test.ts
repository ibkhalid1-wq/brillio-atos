import { mergeGridJson, deriveRosterReviewField } from "@/new/lib/useDocumentIntelligence";
import type { StakeholderEntity } from "@/new/lib/documentIntelligenceTypes";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";

/**
 * Core-team roster import contract. The AI lands people in `entities.stakeholders`
 * but only intermittently fills the per-phase grid mapping, so the client bridges
 * stakeholders into the Mobilise roster grid (id "coreTeamRoster") — mirroring the
 * KPI bridge. The roster grid is ai-derived (dynamic), so the bridge must (a) only
 * fire when the grid is actually declared and (b) key rows to the grid's real
 * column keys. Re-import must merge structurally, never corrupt the JSON.
 */

const stakeholder = (over: Partial<StakeholderEntity>): StakeholderEntity => ({
  name: "",
  role: "",
  organization: "",
  source: "",
  confidence: 0.9,
  extractionType: "extracted",
  text: "",
  ...over,
});

/** A dynamic store whose Mobilise phase declares the canonical roster grid. */
function rosterStore(): DynamicSchemaStore {
  return {
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
}

function rows(json: string) {
  return JSON.parse(json) as Array<Record<string, string>>;
}

describe("deriveRosterReviewField", () => {
  it("returns null when the roster grid is not a declared field (no dynamic schema)", () => {
    const field = deriveRosterReviewField(
      [stakeholder({ name: "Jane Doe", role: "Delivery Lead" })],
      {},
      undefined, // no store → mobilise has no static inputs, so no roster grid
    );
    expect(field).toBeNull();
  });

  it("returns null when there are no named stakeholders", () => {
    expect(deriveRosterReviewField(undefined, {}, rosterStore())).toBeNull();
    expect(deriveRosterReviewField([stakeholder({ name: "  " })], {}, rosterStore())).toBeNull();
  });

  it("serializes stakeholders into the roster grid using its declared column keys", () => {
    const field = deriveRosterReviewField(
      [
        stakeholder({ name: "Jane Doe", role: "Delivery Lead", organization: "Acme" }),
        stakeholder({ name: "Raj Patel", role: "Sponsor" }),
      ],
      {},
      rosterStore(),
    );

    expect(field).not.toBeNull();
    expect(field!.phaseId).toBe("mobilise");
    expect(field!.fieldId).toBe("coreTeamRoster");
    const parsed = rows(field!.mapping.value);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ role: "Delivery Lead", name: "Jane Doe" });
    expect(parsed[1]).toMatchObject({ role: "Sponsor", name: "Raj Patel" });
    expect(parsed[0].id).toBeTruthy();
    expect(field!.hasConflict).toBe(false);
  });

  it("flags a conflict when the roster already holds different rows", () => {
    const existing = JSON.stringify([{ id: "x", role: "PM", name: "Old Person" }]);
    const field = deriveRosterReviewField(
      [stakeholder({ name: "Jane Doe", role: "Delivery Lead" })],
      { mobilise: { coreTeamRoster: existing } },
      rosterStore(),
    );
    expect(field!.hasConflict).toBe(true);
    expect(field!.existingValue).toBe(existing);
  });
});

describe("mergeGridJson", () => {
  it("appends new rows while keeping existing ones, de-duplicating by content", () => {
    const existing = JSON.stringify([{ id: "a", role: "PM", name: "Alice" }]);
    const incoming = JSON.stringify([
      { id: "b", role: "PM", name: "Alice" }, // duplicate content, different id
      { id: "c", role: "Dev", name: "Bob" },
    ]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("survives corrupt/empty input without throwing", () => {
    expect(rows(mergeGridJson("", ""))).toEqual([]);
    expect(rows(mergeGridJson("not json", "[{bad}]"))).toEqual([]);
  });
});
