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
      expect(changedInputFields(prev as unknown as Record<string, string>, next as unknown as Record<string, string>)).toEqual(["sponsor"]);
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

    it("follows the canonical field's edges for an aliased companion key (kpis → successMetric)", () => {
      // The Strategy KPI table persists as `kpis` but is the successMetric editor,
      // so editing/deleting a KPI must stale whatever successMetric feeds.
      const viaKpis = artifactsForInputFields("strategy", ["kpis"]);
      const viaSuccessMetric = artifactsForInputFields("strategy", ["successMetric"]);
      expect(viaKpis.has("outcome-framework")).toBe(true);
      expect(new Set(viaKpis)).toEqual(new Set(viaSuccessMetric));
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

    it("stales the success-metric artifacts when a KPI is deleted (kpis alias)", () => {
      // Deleting a row in the Strategy KPI table changes the `kpis` key. That key
      // aliases to successMetric, which feeds the outcome framework — so the
      // outcome framework must move to stale even though successMetric text is
      // unchanged.
      const stale = relatedArtifactsToStale("strategy", ["kpis"], {
        "outcome-framework": { status: "ready" },
      });
      expect(stale).toContain("outcome-framework");
    });

    it("resolves dynamic-store flow edges, so a custom grounding field stales the locked artifact it feeds", () => {
      // The field→artifact edge for planner-generated/custom inputs lives only in
      // the dynamic schema store's artifactInputFlow, not the static methodology
      // map. Editing such a grounding input on a reopened (PCR) phase must stale
      // the locked artifact — but only when the store is passed. Without it the
      // edge is invisible and the artifact wrongly stays fresh (the bug this guards).
      const store = { artifactInputFlow: { strategy: { charter: ["customGroundingField"] } } };
      const bucket = { charter: { status: "approved" } };
      expect(relatedArtifactsToStale("strategy", ["customGroundingField"], bucket)).toEqual([]);
      expect(relatedArtifactsToStale("strategy", ["customGroundingField"], bucket, store)).toEqual(["charter"]);
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

    it("resolves dynamic-store flow edges, so a custom field feeding an approved dynamic artifact is blocked only when the store is passed", () => {
      // The field→artifact edge for planner-generated/custom inputs lives only in
      // the dynamic schema store's artifactInputFlow, not the static methodology
      // map. Reimporting a document on a dynamic phase must not overwrite such a
      // grounding input when it feeds an approved artifact — but only the store
      // exposes that edge. Without it the field is wrongly writable (the bug this guards).
      const store = { artifactInputFlow: { strategy: { charter: ["customGroundingField"] } } };
      const bucket = { charter: { status: "approved" } };
      expect(fieldsFeedingApprovedArtifacts("strategy", ["customGroundingField"], bucket).has("customGroundingField")).toBe(false);
      expect(fieldsFeedingApprovedArtifacts("strategy", ["customGroundingField"], bucket, store).has("customGroundingField")).toBe(true);
    });

    it("does not protect an EMPTY field feeding an approved artifact, so an import can populate it", () => {
      // The reported bug: functionalDesignSummary maps from a document and is
      // accepted, but Design has an approved artifact it feeds — the guard dropped
      // the import even though the field was blank, leaving it unpopulated. With the
      // phase's prior inputs passed, an empty/absent/[]-grid field is NOT protected.
      const bucket = { "future-state-design": { status: "approved" } };
      const fields = ["functionalDesignSummary"];
      // No prior inputs given → back-compatible blocking (nothing to compare against).
      expect(fieldsFeedingApprovedArtifacts("design", fields, bucket).has("functionalDesignSummary")).toBe(true);
      // Field absent, blank, or an empty grid ⇒ nothing to protect ⇒ writable.
      expect(fieldsFeedingApprovedArtifacts("design", fields, bucket, undefined, {}).has("functionalDesignSummary")).toBe(false);
      expect(fieldsFeedingApprovedArtifacts("design", fields, bucket, undefined, { functionalDesignSummary: "   " }).has("functionalDesignSummary")).toBe(false);
      expect(fieldsFeedingApprovedArtifacts("design", fields, bucket, undefined, { functionalDesignSummary: "[]" }).has("functionalDesignSummary")).toBe(false);
    });

    it("still protects a field that ALREADY holds content from being overwritten on reimport", () => {
      const bucket = { "future-state-design": { status: "approved" } };
      const prior = { functionalDesignSummary: "Existing PM-authored workflow summary" };
      expect(
        fieldsFeedingApprovedArtifacts("design", ["functionalDesignSummary"], bucket, undefined, prior).has("functionalDesignSummary"),
      ).toBe(true);
    });
  });
});
