import { requestEvalModel } from "@/lib/evals/adamEvalJudge";
import type { EvalDimension } from "@/lib/evals/adamEvalDataset";
import type { EvalResult } from "@/lib/evals/adamEvalRunner";

export async function generatePromptImprovements(params: {
  agentId: string;
  currentPrompt: string;
  failingCases: EvalResult[];
  weakDimensions: EvalDimension[];
}): Promise<{
  diagnosis: string;
  suggestedChanges: {
    section: string;
    current: string;
    suggested: string;
    rationale: string;
    expectedImpact: string;
  }[];
  newPromptDraft: string;
}> {
  const failureDigest = params.failingCases.slice(0, 6).map((result) => ({
    caseId: result.evalCaseId,
    score: result.weightedScore,
    issues: result.issues.slice(0, 4),
    recommendations: result.recommendations.slice(0, 3),
    excerpt: result.agentOutput.slice(0, 700),
  }));

  const system = `You are a principal AI engineer improving a production system prompt for an enterprise transformation agent.

You will be given the current prompt, failing eval cases, and the weakest evaluation dimensions. Diagnose why the prompt is underperforming, propose targeted changes by prompt section, and then rewrite the full prompt draft. Be concrete, not abstract. Do not suggest model changes, UI changes, or data-layer changes; only improve the prompt itself.`;

  const user = [
    `Agent: ${params.agentId}`,
    `Weak dimensions: ${params.weakDimensions.join(", ") || "none identified"}`,
    "",
    "Current prompt:",
    params.currentPrompt,
    "",
    "Failing cases:",
    JSON.stringify(failureDigest, null, 2),
    "",
    `Respond as JSON only:
{
  "diagnosis": "string",
  "suggestedChanges": [
    {
      "section": "string",
      "current": "string",
      "suggested": "string",
      "rationale": "string",
      "expectedImpact": "string"
    }
  ],
  "newPromptDraft": "string"
}`,
  ].join("\n");

  try {
    const response = await requestEvalModel({
      system,
      user,
      maxTokens: 2200,
      description: `prompt-improver-${params.agentId}`,
    });
    const match = response.text.match(/\{[\s\S]*\}/);
    if (!match?.[0]) {
      throw new Error("No JSON payload returned.");
    }
    const parsed = JSON.parse(match[0]) as {
      diagnosis?: string;
      suggestedChanges?: Array<{
        section?: string;
        current?: string;
        suggested?: string;
        rationale?: string;
        expectedImpact?: string;
      }>;
      newPromptDraft?: string;
    };
    return {
      diagnosis: parsed.diagnosis || "No diagnosis returned.",
      suggestedChanges: Array.isArray(parsed.suggestedChanges)
        ? parsed.suggestedChanges.map((item) => ({
            section: item.section || "Unknown section",
            current: item.current || "",
            suggested: item.suggested || "",
            rationale: item.rationale || "",
            expectedImpact: item.expectedImpact || "",
          }))
        : [],
      newPromptDraft: parsed.newPromptDraft || params.currentPrompt,
    };
  } catch (error) {
    return {
      diagnosis: `Prompt improver failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      suggestedChanges: [],
      newPromptDraft: params.currentPrompt,
    };
  }
}
