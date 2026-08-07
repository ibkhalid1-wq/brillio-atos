/**
 * Enforces the client↔edge shared numeric contract the code only *asserted* by
 * duplication (duplicate-definitions.md S4): the portal answer length cap.
 *
 * The client `maxLength` on the stakeholder answer fields (`FlowRespond.tsx`,
 * via `MAX_ANSWER_CHARS` in `blobGuard.ts`) must equal the edge's
 * `MAX_ANSWER_CHARS` in `supabase/functions/flow-portal/index.ts`. If the client
 * allows MORE than the edge, a stakeholder types text the server silently
 * truncates on submit — data loss with no notice. The Deno boundary prevents a
 * shared import, so this text-parses the edge source (the edgeLockstep idiom).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_ANSWER_CHARS } from "@/v3/lib/blobGuard";

const EDGE = readFileSync(resolve(__dirname, "../../../supabase/functions/flow-portal/index.ts"), "utf8");

describe("portal answer cap — client ↔ edge lockstep", () => {
  it("client MAX_ANSWER_CHARS equals the edge MAX_ANSWER_CHARS", () => {
    const m = EDGE.match(/MAX_ANSWER_CHARS\s*=\s*([0-9_]+)/);
    expect(m, "edge MAX_ANSWER_CHARS not found").toBeTruthy();
    const edgeValue = Number(m![1].replace(/_/g, ""));
    expect(edgeValue).toBe(MAX_ANSWER_CHARS);
  });

  it("the client never allows MORE than the edge accepts (no silent truncation)", () => {
    const client = readFileSync(resolve(__dirname, "../components/flow/FlowRespond.tsx"), "utf8");
    // the answer fields bind maxLength to the shared constant, not a bare literal
    expect(client).toMatch(/maxLength=\{MAX_ANSWER_CHARS\}/);
    expect(client).not.toMatch(/maxLength=\{20000\}/);
  });
});
