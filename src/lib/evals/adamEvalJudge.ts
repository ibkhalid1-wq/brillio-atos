import { requestAIText } from "@/lib/adamCopilot";
import type { EvalCase, EvalDimension, ExpectedTrait } from "@/lib/evals/adamEvalDataset";

const EVAL_MODEL = "claude-sonnet-4-6";

type EvalModelResponse = {
  text: string;
  tokensUsed: number;
};

type ProcessLike = {
  env?: Record<string, string | undefined>;
};

function getProcessLike(): ProcessLike | undefined {
  if (typeof globalThis !== "undefined" && "process" in globalThis) {
    return (globalThis as typeof globalThis & { process?: ProcessLike }).process;
  }
  return undefined;
}

function getAnthropicApiKey(): string | null {
  const env = getProcessLike()?.env;
  if (typeof env?.ANTHROPIC_API_KEY === "string" && env.ANTHROPIC_API_KEY.trim()) {
    return env.ANTHROPIC_API_KEY.trim();
  }
  return null;
}

function summarizeEvalInput(evalCase: EvalCase): string {
  const { programContext, crossPhaseContext, memory, incomingHandoff } = evalCase.input;
  return [
    `Program: ${programContext.programName} (${programContext.industry})`,
    `Sponsor: ${programContext.sponsor || "Unknown"} ${programContext.sponsorRole ? `(${programContext.sponsorRole})` : ""}`,
    `Business challenge: ${programContext.businessChallenge}`,
    `Goal: ${programContext.transformationGoal}`,
    `Budget / timeline: $${programContext.budgetUsd.toLocaleString()} / ${programContext.timelineMonths} months`,
    `Baselines: ${programContext.baselineMetrics.join(" | ") || "None"}`,
    `Targets: ${programContext.targetMetrics.join(" | ") || "None"}`,
    `Constraints: ${programContext.constraints.join(" | ") || "None"}`,
    crossPhaseContext ? `Cross-phase context: ${crossPhaseContext}` : "",
    memory?.length ? `Memory: ${memory.map((item) => item.summary).join(" | ")}` : "",
    incomingHandoff ? `Incoming handoff: ${incomingHandoff.summary}` : "",
  ].filter(Boolean).join("\n");
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = String(raw || "").match(/\{[\s\S]*\}/);
  if (!match?.[0]) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function requestAnthropic(system: string, user: string, maxTokens: number): Promise<EvalModelResponse> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("Anthropic API key not available for eval execution.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: user,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (payload.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("")
    .trim();
  const tokensUsed = Number(payload.usage?.input_tokens || 0) + Number(payload.usage?.output_tokens || 0);
  return { text, tokensUsed };
}

export async function requestEvalModel(params: {
  system: string;
  user: string;
  maxTokens?: number;
  description?: string;
}): Promise<EvalModelResponse> {
  const maxTokens = params.maxTokens ?? 1400;
  try {
    const text = await requestAIText(params.system, params.user, {
      max_tokens: maxTokens,
      description: params.description || "adam-eval",
    });
    return { text, tokensUsed: 0 };
  } catch {
    return requestAnthropic(params.system, params.user, maxTokens);
  }
}

export async function evaluateWithLLM(params: {
  dimension: EvalDimension;
  evalCase: EvalCase;
  agentOutput: string;
  trait: ExpectedTrait;
}): Promise<{ score: number; reasoning: string; passed: boolean }> {
  const system = `You are an expert evaluator assessing AI agent outputs for an enterprise transformation platform. You do not know which AI system produced this output. Evaluate objectively.

Be strict. Generic outputs score low. Specific, grounded outputs score high. Hallucinated facts, names, or figures score 0.0 on accuracy. If the output ignores an explicit constraint or fails to answer the requested shape, score it down sharply.`;

  const user = [
    `DIMENSION: ${params.dimension}`,
    `CRITERIA: ${params.trait.description}`,
    "",
    "EVAL CASE INPUT:",
    summarizeEvalInput(params.evalCase),
    "",
    "AGENT OUTPUT:",
    params.agentOutput,
    "",
    'Score this output from 0.0 to 1.0. Respond with JSON only: {"score": 0.0, "reasoning": "...", "passed": true}',
    "Threshold for passing: 0.75",
  ].join("\n");

  try {
    const response = await requestEvalModel({
      system,
      user,
      maxTokens: 500,
      description: `eval-judge-${params.dimension}`,
    });
    const parsed = extractJsonObject(response.text);
    const score = typeof parsed?.score === "number"
      ? Math.max(0, Math.min(1, parsed.score))
      : 0;
    const reasoning = typeof parsed?.reasoning === "string"
      ? parsed.reasoning
      : "Judge did not provide reasoning.";
    const passed = typeof parsed?.passed === "boolean"
      ? parsed.passed
      : score >= 0.75;
    return { score, reasoning, passed };
  } catch (error) {
    return {
      score: 0,
      reasoning: `LLM judge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      passed: false,
    };
  }
}
