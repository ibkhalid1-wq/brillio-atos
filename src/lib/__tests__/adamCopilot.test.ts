import { describe, it, expect } from "vitest";
import { detectCopilotRequestMode } from "../adamCopilot";

describe("detectCopilotRequestMode", () => {
  it("returns artifact mode for generation requests", () => {
    const result = detectCopilotRequestMode("draft a capability DNA canvas for invoice processing");
    expect(result.mode).toBe("artifact");
  });

  it("returns explain mode for explanation requests", () => {
    const result = detectCopilotRequestMode("why does autonomy level matter for this capability?");
    expect(result.mode).toBe("explain");
  });

  it("returns conversational mode for general questions", () => {
    const result = detectCopilotRequestMode("status of the program right now");
    expect(result.mode).toBe("conversational");
  });

  it("returns higher word limit for artifact mode", () => {
    const artifact = detectCopilotRequestMode("generate a workforce blueprint");
    const conversational = detectCopilotRequestMode("how are we doing?");
    expect(artifact.maxWords).toBeGreaterThan(conversational.maxWords);
  });
});
