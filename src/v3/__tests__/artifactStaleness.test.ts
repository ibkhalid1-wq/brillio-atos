import {
  artifactsForInputFields,
  changedInputFields,
  approvedArtifactsToStale,
  fieldsFeedingApprovedArtifacts,
} from "@/v3/lib/artifactStaleness";

describe("artifactStaleness", () => {
  describe("changedInputFields", () => {
    it("reports only fields whose value differs, ignoring meta keys", () => {
      const prev = { sponsor: "Jane", businessObjective: "Cut cost", savedAt: "x", _provenance: { a: 1 } };
      const next = { sponsor: "John", businessObjective: "Cut cost", savedAt: "y", _provenance: { a: 2 } };
      expect(changedInputFields(prev, next)).toEqual(["sponsor"]);
    });

    it("treats a newly-filled field (no prior value) as changed", () => {
      expect(changedInputFields({}, { sponsor: "Jane" })).toEqual(["sponsor"]);
      expect(changedInputFields(undefined, { sponsor: "Jane" })).toEqual(["sponsor"]);
    });

    it("does not report clearing a field that was already empty", () => {
      expect(changedInputFields({ sponsor: "" }, { sponsor: "" })).toEqual([]);
    });
  });

  describe("artifactsForInputFields", () => {
    it("includes the Narrative for any field plus declared specialised targets", () => {
      const targets = artifactsForInputFields("strategy", ["businessObjective"]);
      expect(targets.has("narrative")).toBe(true);
      expect(targets.has("charter")).toBe(true);
      expect(targets.has("business-case")).toBe(true);
    });
  });

  describe("approvedArtifactsToStale", () => {
    const bucket = {
      narrative: { status: "approved" },
      charter: { status: "approved" },
      "business-case": { status: "draft" },
    };

    it("returns approved artifacts the changed fields flow into", () => {
      const stale = approvedArtifactsToStale("strategy", ["sponsor"], bucket);
      // sponsor flows to narrative + charter; both approved → both stale.
      expect(new Set(stale)).toEqual(new Set(["narrative", "charter"]));
    });

    it("never returns a non-approved artifact even if the field flows into it", () => {
      const stale = approvedArtifactsToStale("strategy", ["constraints"], bucket);
      // constraints flows to narrative (approved) + business-case (draft).
      expect(stale).toContain("narrative");
      expect(stale).not.toContain("business-case");
    });

    it("returns nothing when no fields changed or nothing is approved", () => {
      expect(approvedArtifactsToStale("strategy", [], bucket)).toEqual([]);
      expect(approvedArtifactsToStale("strategy", ["sponsor"], { narrative: { status: "draft" } })).toEqual([]);
    });
  });

  describe("fieldsFeedingApprovedArtifacts", () => {
    it("blocks reimport of fields feeding an approved artifact, allows the rest", () => {
      const bucket = { charter: { status: "approved" }, narrative: { status: "draft" } };
      const blocked = fieldsFeedingApprovedArtifacts("strategy", ["sponsor", "successMetric"], bucket);
      // sponsor → charter (approved) ⇒ blocked. successMetric → outcome-framework (not approved) ⇒ allowed.
      expect(blocked.has("sponsor")).toBe(true);
      expect(blocked.has("successMetric")).toBe(false);
    });

    it("blocks every field once the Narrative is approved (all fields feed it)", () => {
      const bucket = { narrative: { status: "approved" } };
      const blocked = fieldsFeedingApprovedArtifacts("strategy", ["sponsor", "successMetric"], bucket);
      expect(blocked.has("sponsor")).toBe(true);
      expect(blocked.has("successMetric")).toBe(true);
    });
  });
});
