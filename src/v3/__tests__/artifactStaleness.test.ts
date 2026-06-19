import {
  artifactsForInputFields,
  changedInputFields,
  approvedArtifactsToStale,
  relatedArtifactsToStale,
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
    it("includes every declared artifact a field flows into", () => {
      const targets = artifactsForInputFields("strategy", ["businessObjective"]);
      expect(targets.has("charter")).toBe(true);
      expect(targets.has("business-case")).toBe(true);
    });
  });

  describe("approvedArtifactsToStale", () => {
    const bucket = {
      charter: { status: "approved" },
      "business-case": { status: "draft" },
    };

    it("returns approved artifacts the changed fields flow into", () => {
      const stale = approvedArtifactsToStale("strategy", ["sponsor"], bucket);
      // sponsor flows to charter; approved → stale.
      expect(new Set(stale)).toEqual(new Set(["charter"]));
    });

    it("never returns a non-approved artifact even if the field flows into it", () => {
      const stale = approvedArtifactsToStale("strategy", ["businessObjective"], bucket);
      // businessObjective flows to charter (approved) + business-case (draft).
      expect(stale).toContain("charter");
      expect(stale).not.toContain("business-case");
    });

    it("returns nothing when no fields changed or nothing is approved", () => {
      expect(approvedArtifactsToStale("strategy", [], bucket)).toEqual([]);
      expect(approvedArtifactsToStale("strategy", ["sponsor"], { charter: { status: "draft" } })).toEqual([]);
    });
  });

  describe("relatedArtifactsToStale", () => {
    const bucket = {
      charter: { status: "approved" },
      "business-case": { status: "draft" },
      "outcome-framework": { status: "archived" },
    };

    it("stales every fed artifact regardless of status, except archived/already-stale", () => {
      const stale = relatedArtifactsToStale("strategy", ["businessObjective"], bucket);
      // businessObjective → charter (approved) + business-case (draft): both stale.
      expect(stale).toContain("charter");
      expect(stale).toContain("business-case");
    });

    it("leaves archived artifacts untouched", () => {
      const stale = relatedArtifactsToStale("strategy", ["successMetric"], bucket);
      // successMetric → outcome-framework, but it is archived ⇒ excluded.
      expect(stale).not.toContain("outcome-framework");
    });

    it("ignores artifacts that have not been generated and no-op when nothing changed", () => {
      expect(relatedArtifactsToStale("strategy", [], bucket)).toEqual([]);
      expect(relatedArtifactsToStale("strategy", ["sponsor"], {})).toEqual([]);
    });
  });

  describe("fieldsFeedingApprovedArtifacts", () => {
    it("blocks reimport of fields feeding an approved artifact, allows the rest", () => {
      const bucket = { charter: { status: "approved" }, "business-case": { status: "draft" } };
      const blocked = fieldsFeedingApprovedArtifacts("strategy", ["sponsor", "successMetric"], bucket);
      // sponsor → charter (approved) ⇒ blocked. successMetric → outcome-framework (not approved) ⇒ allowed.
      expect(blocked.has("sponsor")).toBe(true);
      expect(blocked.has("successMetric")).toBe(false);
    });

    it("blocks a field that feeds multiple approved artifacts", () => {
      const bucket = { charter: { status: "approved" }, "business-case": { status: "approved" } };
      const blocked = fieldsFeedingApprovedArtifacts("strategy", ["industry", "successMetric"], bucket);
      // industry → charter + business-case (both approved) ⇒ blocked. successMetric → outcome-framework (not approved) ⇒ allowed.
      expect(blocked.has("industry")).toBe(true);
      expect(blocked.has("successMetric")).toBe(false);
    });
  });
});
