import {
  availableModes,
  buildFieldAssistPrompt,
  isModeAvailable,
  sanitiseFieldReply,
  type FieldAssistContext,
} from "@/v3/lib/fieldAssist";

const CTX: FieldAssistContext = {
  programName: "ERP Transformation",
  client: "Acme",
  industry: "Financial Services",
  objective: "Modernize finance operations",
  phaseLabel: "Mobilise",
  fieldLabel: "Scope statement",
  fieldHint: "What is in and out of scope",
  currentValue: "",
};

describe("fieldAssist mode availability", () => {
  it("offers only Generate when the field is empty", () => {
    expect(availableModes("")).toEqual(["generate"]);
    expect(isModeAvailable("generate", "")).toBe(true);
    expect(isModeAvailable("improve", "")).toBe(false);
  });

  it("offers Improve/Expand/Rewrite (not Generate) when the field has content", () => {
    expect(availableModes("some text")).toEqual(["improve", "expand", "rewrite"]);
    expect(isModeAvailable("generate", "some text")).toBe(false);
    expect(isModeAvailable("rewrite", "some text")).toBe(true);
  });
});

describe("buildFieldAssistPrompt", () => {
  it("embeds programme + field context and the empty-draft marker", () => {
    const prompt = buildFieldAssistPrompt("generate", CTX);
    expect(prompt).toContain("Programme: ERP Transformation");
    expect(prompt).toContain("Client: Acme");
    expect(prompt).toContain("Phase: Mobilise");
    expect(prompt).toContain("Field: Scope statement");
    expect(prompt).toContain("CURRENT DRAFT: (empty)");
    expect(prompt).toContain("Return ONLY the field text");
  });

  it("includes the current draft for improve mode", () => {
    const prompt = buildFieldAssistPrompt("improve", { ...CTX, currentValue: "Migrate the GL." });
    expect(prompt).toContain("CURRENT DRAFT:");
    expect(prompt).toContain("Migrate the GL.");
    expect(prompt).toContain("Improve the current draft");
  });

  it("omits optional context lines when absent", () => {
    const prompt = buildFieldAssistPrompt("generate", { ...CTX, client: null, industry: null, objective: null, fieldHint: null });
    expect(prompt).not.toContain("Client:");
    expect(prompt).not.toContain("Industry:");
    expect(prompt).not.toContain("Field guidance:");
  });
});

describe("sanitiseFieldReply", () => {
  it("strips a leading preamble line", () => {
    expect(sanitiseFieldReply("Here is the improved version: The scope covers GL.")).toBe("The scope covers GL.");
    expect(sanitiseFieldReply("Sure! Here you go: Done.")).toBe("Done.");
  });

  it("strips wrapping quotes and code fences", () => {
    expect(sanitiseFieldReply('"Quoted answer"')).toBe("Quoted answer");
    expect(sanitiseFieldReply("```\nFenced answer\n```")).toBe("Fenced answer");
  });

  it("leaves clean text untouched", () => {
    expect(sanitiseFieldReply("Just a plain answer.")).toBe("Just a plain answer.");
  });
});
