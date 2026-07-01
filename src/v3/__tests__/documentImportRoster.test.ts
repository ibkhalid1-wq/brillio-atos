import { mergeGridJson, deriveRosterReviewField, deriveStakeholderReviewField, classifyStakeholderRole } from "@/new/lib/useDocumentIntelligence";
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
  it("returns null when the target phase declares no roster grid", () => {
    const field = deriveRosterReviewField(
      [stakeholder({ name: "Jane Doe", role: "Delivery Lead" })],
      {},
      undefined, // no store
      "strategy", // Strategy has no roster grid (only Mobilise seeds the static roster)
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

describe("classifyStakeholderRole", () => {
  it("routes advisory/SME/governance roles to personas", () => {
    for (const role of ["Advisory Board Member", "SME - Tax", "Subject Matter Expert", "Steering Committee", "Programme Board", "Change Champion", "External Auditor", "End User Rep"]) {
      expect(classifyStakeholderRole(role)).toBe("persona");
    }
  });

  it("keeps delivery/team roles (and blank/unknown) on the team", () => {
    for (const role of ["Delivery Lead", "Project Manager", "Solution Architect", "Business Analyst", "Developer", "Sponsor", "", undefined]) {
      expect(classifyStakeholderRole(role)).toBe("team");
    }
  });
});

describe("deriveStakeholderReviewField", () => {
  it("serializes personas into the Discover stakeholder register (static grid, no store needed)", () => {
    const field = deriveStakeholderReviewField(
      [
        stakeholder({ name: "Dr Amina Yusuf", role: "Advisory Board Member" }),
        stakeholder({ name: "Lee Chan", role: "SME - Data Privacy" }),
      ],
      {},
    );
    expect(field).not.toBeNull();
    expect(field!.phaseId).toBe("discover");
    expect(field!.fieldId).toBe("stakeholderList");
    const parsed = rows(field!.mapping.value);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "Dr Amina Yusuf", role: "Advisory Board Member" });
    // Influence/interest columns are seeded blank for the PM to grade.
    expect(parsed[0].influence).toBe("");
    expect(parsed[0].interest).toBe("");
  });

  it("returns null when there are no named personas", () => {
    expect(deriveStakeholderReviewField([], {})).toBeNull();
    expect(deriveStakeholderReviewField([stakeholder({ name: "  ", role: "" })], {})).toBeNull();
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

  it("updates the matching role rather than appending a duplicate (corrected name)", () => {
    const existing = JSON.stringify([{ id: "a", role: "Delivery Lead", name: "Jane Doe" }]);
    const incoming = JSON.stringify([{ id: "b", role: "Delivery Lead", name: "Jane A. Doe" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", role: "Delivery Lead", name: "Jane A. Doe" });
  });

  it("matches roles fuzzily so trivial variations resolve to one row", () => {
    const existing = JSON.stringify([{ id: "a", role: "Project Manager", name: "Bob" }]);
    const incoming = JSON.stringify([{ id: "b", role: "Project Manager ", name: "Bobby" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", name: "Bobby" });
  });

  it("fills a canonical seed slot from a synonym role and drops the empty slot", () => {
    // Seeded roster slots (empty) in their canonical wording.
    const existing = JSON.stringify([
      { id: "s1", role: "Programme Manager", name: "" },
      { id: "s2", role: "Product Owner", name: "" },
    ]);
    // Import describes the same seat differently ("Project Manager").
    const incoming = JSON.stringify([{ id: "i1", role: "Project Manager", name: "Prasoon Gupta" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    const pm = merged.filter((r) => /manager/i.test(r.role));
    expect(pm).toHaveLength(1); // no duplicate Programme/Project Manager
    expect(pm[0].name).toBe("Prasoon Gupta");
    // The still-empty Product Owner slot is preserved (no person for it yet).
    expect(merged.find((r) => /product owner/i.test(r.role))).toMatchObject({ name: "" });
  });

  it("collapses a pre-existing empty/filled duplicate of the same role on re-import", () => {
    // The legacy bad state: an empty seed slot beside the filled imported row.
    const existing = JSON.stringify([
      { id: "s1", role: "Programme Manager", name: "" },
      { id: "i1", role: "Project Manager", name: "Prasoon Gupta" },
    ]);
    const incoming = JSON.stringify([{ id: "i2", role: "Project Manager", name: "Prasoon Gupta" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "Prasoon Gupta" });
  });

  it("does not collapse distinct roles that merely share a word", () => {
    const existing = JSON.stringify([{ id: "a", role: "Programme Manager", name: "Pat" }]);
    const incoming = JSON.stringify([{ id: "b", role: "Delivery Manager", name: "Sam" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.name).sort()).toEqual(["Pat", "Sam"]);
  });

  it("appends a genuinely new role while updating matched ones", () => {
    const existing = JSON.stringify([{ id: "a", role: "Sponsor", name: "Raj" }]);
    const incoming = JSON.stringify([
      { id: "b", role: "Sponsor", name: "Raj Patel" }, // updates existing
      { id: "c", role: "Architect", name: "Mei" }, // new role → append
    ]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.role === "Sponsor")).toMatchObject({ id: "a", name: "Raj Patel" });
    expect(merged.find((r) => r.role === "Architect")).toMatchObject({ name: "Mei" });
  });

  it("preserves cells the import leaves blank", () => {
    const existing = JSON.stringify([{ id: "a", role: "PM", name: "Alice", org: "Acme" }]);
    const incoming = JSON.stringify([{ id: "b", role: "PM", name: "Alice", org: "" }]);
    const merged = rows(mergeGridJson(existing, incoming));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", name: "Alice", org: "Acme" });
  });

  it("survives corrupt/empty input without throwing", () => {
    expect(rows(mergeGridJson("", ""))).toEqual([]);
    expect(rows(mergeGridJson("not json", "[{bad}]"))).toEqual([]);
  });
});
