/**
 * The flow shell honors BOTH staleness signals.
 *
 * Two staleness systems existed and did not speak: the ledger's status field
 * (written by the server-side cascade when an upstream deliverable is
 * regenerated, and by the app's input-edit and confirm paths) and the flow
 * shell's inputsFingerprint drift. The shell read only the fingerprint, so a
 * status of "stale" — the entire point of the regeneration cascade — never
 * surfaced anywhere in a flow programme. Regenerating the Discovery Kit set
 * the flag on the ontology and atlas and no prompt ever appeared: verified
 * live on the surgery-cancellations programme after an isolated ontology
 * regeneration left the atlas reading fresh.
 */
import { describe, expect, it } from "vitest";
import { movementArtifacts } from "@/v3/components/flow/flowShellData";
import { flowMovements } from "@/v3/components/flow/flowShellData";
import type { ProgramSummary } from "@/new/types";

const program = (atlasStatus?: string): ProgramSummary => ({
  id: "p", name: "Surgery cancellations",
  rawData: {
    data: {
      currentStateAtlas: { workflows: [{ name: "W", area: "Scheduling", steps: [] }], generatedAt: "2026-07-31T00:00:00Z" },
      phaseArtifacts: {
        listen: {
          "current-state-atlas": {
            title: "Current-State Atlas",
            ...(atlasStatus ? { status: atlasStatus } : {}),
          },
        },
      },
    },
  },
} as unknown as ProgramSummary);

const atlasCard = (p: ProgramSummary) => {
  const listen = flowMovements().find((m) => m.id === "listen")!;
  return movementArtifacts(p, listen).find((a) => a.id === "current-state-atlas");
};

describe("flow shell staleness", () => {
  it('status "stale" on the ledger surfaces as stale, fingerprint or not', () => {
    expect(atlasCard(program("stale"))?.stale).toBe(true);
  });

  it("an approved artifact with matching fingerprint reads fresh", () => {
    expect(atlasCard(program("approved"))?.stale).toBe(false);
  });

  it("no status at all still reads fresh", () => {
    expect(atlasCard(program())?.stale).toBe(false);
  });
});
