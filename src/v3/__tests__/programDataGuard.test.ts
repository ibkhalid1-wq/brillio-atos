import { describe, it, expect } from "vitest";
import { hasSubstantiveProgramData } from "@/v3/lib/programDataGuard";

/**
 * The guard must treat a content-free payload as non-substantive (so a writer can
 * refuse to overwrite a populated row with it) while recognising any real working
 * content — inputs, artifacts, gate reviews, formal mirrors, or snapshots.
 */
describe("hasSubstantiveProgramData", () => {
  it("returns false for an empty object", () => {
    expect(hasSubstantiveProgramData({})).toBe(false);
  });

  it("returns false for null / non-objects / arrays", () => {
    expect(hasSubstantiveProgramData(null)).toBe(false);
    expect(hasSubstantiveProgramData(undefined)).toBe(false);
    expect(hasSubstantiveProgramData("x")).toBe(false);
    expect(hasSubstantiveProgramData([{ phaseInputs: { a: 1 } }])).toBe(false);
  });

  it("returns false when only metadata/provenance keys are present", () => {
    expect(
      hasSubstantiveProgramData({
        _syncedAt: "2026-06-28T00:00:00Z",
        name: "Laila CRM",
        client: "Acme",
        industry: "Retail",
        objective: "",
        is_deleted: false,
      }),
    ).toBe(false);
  });

  it("treats empty container values as non-substantive", () => {
    expect(
      hasSubstantiveProgramData({ phaseInputs: {}, phaseArtifacts: {}, programSnapshots: [] }),
    ).toBe(false);
  });

  it("treats action side-channels (mints/attestations/approvals) as non-substantive", () => {
    // A mint or an approval fired pre-hydration appends only a side-channel key;
    // it must NOT make an otherwise-empty payload look like real content, or the
    // near-empty blob would clobber the populated cloud row.
    expect(hasSubstantiveProgramData({
      flowAttestations: [{ ts: "x", action: "y" }],
      flowInterviewPacks: [{ token: "t" }],
      flowApprovalPacks: [{ token: "t", artifactId: "charter" }],
      flowPortalInbox: [{ id: "i", kind: "approval" }],
    })).toBe(false);
  });

  it("returns true when phase inputs carry values", () => {
    expect(hasSubstantiveProgramData({ phaseInputs: { strategy: { industry: "Retail" } } })).toBe(true);
  });

  it("returns true when a formal mirror is present", () => {
    expect(hasSubstantiveProgramData({ transformationCharter: { purpose: "Modernise CRM" } })).toBe(true);
  });

  it("returns true when gate reviews exist alongside metadata", () => {
    expect(
      hasSubstantiveProgramData({ name: "X", gateReviews: { strategy: { status: "approved" } } }),
    ).toBe(true);
  });

  it("unwraps a one-level { data: {...} } wrapper", () => {
    expect(hasSubstantiveProgramData({ data: { phaseArtifacts: { strategy: { charter: {} } } } })).toBe(true);
    expect(hasSubstantiveProgramData({ data: {} })).toBe(false);
  });
});

describe("action side-channels never count as substance", () => {
  it("a payload holding ONLY a minted pack + attestations reads non-substantive (the 2026-07-13 clobber shape)", () => {
    expect(hasSubstantiveProgramData({
      _syncedAt: "2026-07-13T16:00:00Z",
      flowAttestations: [{ action: "Minted a link" }],
      flowInterviewPacks: [{ id: "pack-1", link: "https://x" }],
    })).toBe(false);
  });
  it("an opened DESIGN REVIEW ROUND is a side-channel too — same shape, newer key", () => {
    // `openDesignRound` appends `flowDesignRounds` + an attestation and nothing else.
    // Left out of META_KEYS it would have been the 2026-07-13 clobber shape wearing a
    // key the guard had never heard of.
    expect(hasSubstantiveProgramData({
      _syncedAt: "2026-08-10T09:00:00Z",
      flowDesignRounds: [{ id: "round-1", ordinal: 1, participants: [{ name: "Priya" }] }],
      flowAttestations: [{ action: "Opened design review round 1" }],
    })).toBe(false);
  });
  it("the same payload plus real inputs reads substantive", () => {
    expect(hasSubstantiveProgramData({
      flowInterviewPacks: [{ id: "pack-1" }],
      phaseInputs: { frame: { sponsor: "Raj" } },
    })).toBe(true);
  });
});
