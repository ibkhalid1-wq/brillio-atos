/**
 * INGEST MUST NOT SPEND MONEY THE SETTINGS SCREEN SAYS IT WON'T.
 *
 * Control renders one governance promise, verbatim:
 *
 *   "Auto-build artifacts on input — off by default: evidence stales the
 *    affected artifacts and waits for you to press Regenerate."
 *
 * Driving the live app against a freshly seeded programme (no `_autoBuild`
 * anywhere in its blob) falsified that promise: ONE click on "Ingest as
 * evidence" fired three agent runs and REPLACED two generated artifacts, with
 * no confirm and no cost signal. The auto-regeneration effect higher in
 * `AppShellV3` consults `autoBuildEnabled` correctly; the ingest handler had
 * its own copy of the regeneration loop and consulted nothing.
 *
 * That is the worst shape a governance defect takes: not a missing control,
 * but a control that reads as authoritative while a second code path ignores
 * it. A buyer who reads the Control screen and then meters their spend is
 * being misinformed by the product itself.
 *
 * WHY THIS IS A SOURCE SCAN. The handler is an inline JSX prop on the live
 * shell — there is no seam to call it through without mounting the whole app
 * and stubbing Supabase, auth, and the agent runner. The behaviour we must
 * hold is nonetheless a single, checkable fact about the code: the ingest
 * handler's regeneration list is gated on the opt-in. A scan states that fact
 * exactly. Deleting the gate fails this test; deleting the whole handler fails
 * it too (the anchors go missing), so it cannot pass vacuously — the sin of
 * the harness checks this codebase has already been bitten by twice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL = resolve(__dirname, "../AppShellV3.tsx");
const source = () => readFileSync(SHELL, "utf8");

/** The `onIngestPortalItem` handler body — from its prop to the next sibling prop. */
function ingestHandler(src: string): string {
  const start = src.indexOf("onIngestPortalItem={async");
  expect(start, "onIngestPortalItem handler not found — did the prop get renamed?").toBeGreaterThan(-1);
  const end = src.indexOf("onDismissPortalItem={", start);
  expect(end, "onDismissPortalItem no longer follows the ingest handler — re-anchor this scan").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("ingest honours the auto-build opt-in", () => {
  it("still has a handler that regenerates artifacts (the scan is not vacuous)", () => {
    const handler = ingestHandler(source());
    // If these anchors ever vanish, the gate assertion below would pass by
    // finding nothing to gate. Prove the thing being gated is really there.
    expect(handler).toContain("movementArtifacts(");
    expect(handler).toContain("runProgramAgent(");
  });

  it("gates the artifact regeneration on autoBuildEnabled", () => {
    const handler = ingestHandler(source());
    expect(
      handler.includes("autoBuildEnabled("),
      "ingest regenerates artifacts without consulting the operator's opt-in — Control's copy promises the opposite",
    ).toBe(true);
  });

  it("gates the LIST, so nothing is queued when the opt-in is off", () => {
    const handler = ingestHandler(source());
    // The impacted-artifact list is what the regeneration loop iterates. Gating
    // must happen where the list is built (or earlier); gating only the loop
    // body would still compute and, historically, still leak into guidance.
    const impacted = handler.slice(handler.indexOf("const impacted"), handler.indexOf("// The area this response touches"));
    expect(impacted).toContain("autoBuildEnabled(");
  });

  it("leaves the contradiction sweep ungated, and says so on the Control screen", () => {
    // The sweep is not an artifact build — it is what puts conflicts in the
    // operator's queue, and the "waits for you" path depends on it. It stays
    // unconditional BY DECISION, so the settings copy has to disclose it;
    // otherwise we have merely moved the contradiction rather than fixed it.
    const handler = ingestHandler(source());
    expect(handler).toContain('agentId: "contradiction-detector"');
    const control = readFileSync(resolve(__dirname, "../components/flow/FlowShell.tsx"), "utf8");
    const row = control.slice(control.indexOf("Auto-build artifacts on input"));
    expect(row.slice(0, 600)).toContain("contradiction sweep");
  });
});
