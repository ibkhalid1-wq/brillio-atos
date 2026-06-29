import {
  availableModes,
  buildFieldAssistPrompt,
  isFreeTextAssistField,
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

describe("isFreeTextAssistField", () => {
  it("allows only open prose fields to be AI-rewritten", () => {
    expect(isFreeTextAssistField("text")).toBe(true);
    expect(isFreeTextAssistField("textarea")).toBe(true);
    expect(isFreeTextAssistField(undefined)).toBe(true);
  });

  it("blocks constrained and structured fields so their value space stays intact", () => {
    // A free-text rewrite of a select pins an off-list value the dropdown can't
    // render — the bug this guards against — so select/date/grid are excluded.
    expect(isFreeTextAssistField("select")).toBe(false);
    expect(isFreeTextAssistField("date")).toBe(false);
    expect(isFreeTextAssistField("grid")).toBe(false);
  });
});

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

  it("never offers merge as a standalone inline action", () => {
    expect(isModeAvailable("merge", "")).toBe(false);
    expect(isModeAvailable("merge", "some text")).toBe(false);
    expect(availableModes("some text")).not.toContain("merge");
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

  it("includes both existing and incoming values for merge mode", () => {
    const prompt = buildFieldAssistPrompt("merge", {
      ...CTX,
      currentValue: "Migrate the GL.",
      incomingValue: "Also migrate AP and AR.",
    });
    expect(prompt).toContain("EXISTING VALUE");
    expect(prompt).toContain("Migrate the GL.");
    expect(prompt).toContain("NEW VALUE");
    expect(prompt).toContain("Also migrate AP and AR.");
    expect(prompt).toContain("Preserve every distinct");
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
