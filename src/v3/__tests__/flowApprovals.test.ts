import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  mintApprovalRequest, ingestApprovalResponse, artifactApprovalState,
  approvalEvidenceEntries, listApprovalResponses, approvalLinkFor, reconcilePackVerdict,
} from "@/v3/components/flow/flowApprovals";
import type { ProgramSummary } from "@/new/types";

beforeAll(() => {
  // jsdom provides crypto.getRandomValues; window.location is present.
  if (!globalThis.crypto?.getRandomValues) {
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.map(() => 7) });
  }
});

const prog = (data: Record<string, unknown>): ProgramSummary => ({ id: "p1", rawData: data } as unknown as ProgramSummary);
const withCharter = () => prog({
  phaseArtifacts: { frame: { charter: { status: "draft" } } },
});
const input = { artifactId: "charter", movementId: "frame", artifactTitle: "Transformation Charter", approver: { name: "Raj Mamodia", role: "Executive Sponsor", email: "raj@brillio.com" } };

describe("flowApprovals — send", () => {
  it("mint flips the artifact to in-review, records the approver, and stashes a tokened pack", () => {
    const blob = mintApprovalRequest(withCharter(), input, "op") as Record<string, any>;
    expect(blob).not.toBeNull();
    expect(blob.phaseArtifacts.frame.charter.status).toBe("in-review");
    expect(blob.phaseArtifacts.frame.charter.approval.approver.name).toBe("Raj Mamodia");
    const packs = blob.flowApprovalPacks;
    expect(packs).toHaveLength(1);
    expect(packs[0].token).toMatch(/^[0-9a-f]{36}$/);
    expect(packs[0].artifactId).toBe("charter");
    // state resolver reflects it
    const state = artifactApprovalState(prog(blob), "frame", "charter");
    expect(state.status).toBe("in-review");
    expect(state.approver?.name).toBe("Raj Mamodia");
  });

  it("re-sending supersedes the earlier open pack (no duplicate live requests)", () => {
    const first = mintApprovalRequest(withCharter(), input, "op") as Record<string, any>;
    const second = mintApprovalRequest(prog(first), input, "op") as Record<string, any>;
    expect(second.flowApprovalPacks.filter((p: any) => !p.respondedAt)).toHaveLength(1);
  });

  it("link points at the flowApprove route with programId.token", () => {
    const blob = mintApprovalRequest(withCharter(), input, "op") as Record<string, any>;
    const link = approvalLinkFor("p1", blob.flowApprovalPacks[0]);
    expect(link).toContain("flowApprove=p1.");
  });

  it("returns null when the approver has no name", () => {
    expect(mintApprovalRequest(withCharter(), { ...input, approver: { name: "  ", role: "" } }, "op")).toBeNull();
  });
});

describe("flowApprovals — record verdict", () => {
  const sent = () => mintApprovalRequest(withCharter(), input, "op") as Record<string, any>;
  const inboxItem = (verdict: "approved" | "changes", comment?: string) => ({
    id: "resp-1", kind: "approval", artifactId: "charter", movementId: "frame",
    artifactTitle: "Transformation Charter", approver: { name: "Raj Mamodia", role: "Executive Sponsor" },
    verdict, comment, receivedAt: "2026-07-13T10:00:00.000Z",
  });

  it("approving flips the artifact to approved and consumes the inbox item", () => {
    const base = { ...sent(), flowPortalInbox: [inboxItem("approved", "Looks good.")] };
    const out = ingestApprovalResponse(prog(base), "resp-1", "op") as Record<string, any>;
    expect(out.phaseArtifacts.frame.charter.status).toBe("approved");
    expect(out.flowPortalInbox).toHaveLength(0);
    expect(out.flowApprovalPacks[0].verdict).toBe("approved");
  });

  it("approval surfaces as a first-class evidence entry attributed to the approver", () => {
    const base = { ...sent(), flowPortalInbox: [inboxItem("approved", "Ship it.")] };
    const out = ingestApprovalResponse(prog(base), "resp-1", "op") as Record<string, any>;
    const evidence = approvalEvidenceEntries(prog(out), "frame");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].who).toContain("Raj Mamodia");
    expect(evidence[0].text).toContain("approved “Transformation Charter”");
    expect(evidence[0].text).toContain("Ship it.");
  });

  it("changes verdict returns the artifact to draft with the note, no evidence", () => {
    const base = { ...sent(), flowPortalInbox: [inboxItem("changes", "Tighten the objective.")] };
    const out = ingestApprovalResponse(prog(base), "resp-1", "op") as Record<string, any>;
    expect(out.phaseArtifacts.frame.charter.status).toBe("draft");
    const state = artifactApprovalState(prog(out), "frame", "charter");
    expect(state.status).toBe("changes");
    expect(state.comment).toBe("Tighten the objective.");
    expect(approvalEvidenceEntries(prog(out), "frame")).toHaveLength(0);
  });

  it("listApprovalResponses surfaces only pending approval items", () => {
    const base = { ...sent(), flowPortalInbox: [inboxItem("approved"), { id: "x", kind: "interview" }] };
    expect(listApprovalResponses(prog(base))).toHaveLength(1);
  });

  it("ingest returns null for an unknown item", () => {
    expect(ingestApprovalResponse(withCharter(), "nope", "op")).toBeNull();
  });
});

describe("flowApprovals — verdict reconciliation (unstick 'reply received')", () => {
  const stuckPack = { id: "ap1", token: "t", artifactId: "charter", movementId: "frame",
    artifactTitle: "Charter", approver: { name: "Raj Mamodia", role: "Executive Sponsor" },
    createdAt: "2026-07-10T00:00:00Z", respondedAt: "2026-07-11T00:00:00Z" } as any; // no verdict
  const inner = (verdictApprover: string, verdict = "approved") => ({
    flowApprovalPacks: [stuckPack],
    phaseArtifacts: { frame: { charter: { status: "approved",
      approval: { approver: { name: verdictApprover, role: "Executive Sponsor" }, verdict, decidedAt: "2026-07-11T00:00:00Z" } } } },
  });

  it("backfills a responded-but-verdict-less pack from the artifact record (same approver)", () => {
    const out = reconcilePackVerdict(inner("Raj Mamodia") as any, "frame", "charter", stuckPack);
    expect(out?.verdict).toBe("approved");
    expect(out?.respondedAt).toBe("2026-07-11T00:00:00Z");
  });

  it("does NOT adopt a verdict recorded for a DIFFERENT approver", () => {
    const out = reconcilePackVerdict(inner("Someone Else") as any, "frame", "charter", stuckPack);
    expect(out?.verdict).toBeUndefined();
  });

  it("leaves a pack that already carries a verdict untouched", () => {
    const withVerdict = { ...stuckPack, verdict: "changes" };
    expect(reconcilePackVerdict(inner("Raj Mamodia") as any, "frame", "charter", withVerdict)).toBe(withVerdict);
  });
});
