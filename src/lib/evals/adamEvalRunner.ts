import {
  ADAM_EVAL_DATASET,
  getEvalCasesForAgent,
  type AntiPattern,
  type EvalCase,
  type EvalDimension,
  type ExpectedTrait,
} from "@/lib/evals/adamEvalDataset";
import { evaluateWithLLM, requestEvalModel } from "@/lib/evals/adamEvalJudge";
import {
  getAgentOutputSchema,
  type AdamAgentId,
  type ObjectSchema,
  type OutputFieldSchema,
} from "@/lib/adamAgentPrompts";
import {
  getActivePrompt,
  getPromptVersion,
  updatePromptEvalScores,
  type PromptVersion,
} from "@/lib/adamPromptRegistry";

export interface EvalResult {
  evalCaseId: string;
  agentId: string;
  promptVersion: string;
  runAt: string;
  agentOutput: string;
  parsedOutput: Record<string, unknown> | null;
  tokensUsed: number;
  latencyMs: number;
  dimensionScores: {
    dimension: EvalDimension;
    score: number;
    passed: boolean;
    reasoning: string;
    weight: number;
  }[];
  weightedScore: number;
  passed: boolean;
  antiPatternViolations: {
    pattern: string;
    found: boolean;
    evidence?: string;
  }[];
  issues: string[];
  recommendations: string[];
}

export interface EvalRunSummary {
  runId: string;
  promptVersion: string;
  agentId: string;
  runAt: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  averageScore: number;
  scoresByDimension: Record<EvalDimension, number>;
  scoresByTag: Record<string, number>;
  regressions: string[];
  improvements: string[];
  results: EvalResult[];
}

const PASS_THRESHOLD = 0.75;

type PauseMarker = {
  hasPause: boolean;
  reason?: string;
  question?: string;
  options?: string[];
};

function safeJsonObject(raw: string): Record<string, unknown> | null {
  const match = String(raw || "").match(/\{[\s\S]*\}/);
  if (!match?.[0]) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractPauseMarker(raw: string): PauseMarker {
  const match = String(raw || "").match(/\[PAUSE_FOR_DECISION:\s*(\{[\s\S]*\})\]/);
  if (!match?.[1]) {
    return { hasPause: false };
  }
  try {
    const parsed = JSON.parse(match[1]) as {
      reason?: string;
      question?: string;
      options?: string[];
    };
    return {
      hasPause: true,
      reason: parsed.reason,
      question: parsed.question,
      options: Array.isArray(parsed.options) ? parsed.options : [],
    };
  } catch {
    return { hasPause: true };
  }
}

function isNonEmpty(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0 && value.every((item) => isNonEmpty(item));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isNonEmpty(item));
  }
  return false;
}

function summarizeProgramInput(evalCase: EvalCase): string {
  const { programContext, crossPhaseContext, memory, incomingHandoff } = evalCase.input;
  return [
    `Program context: ${JSON.stringify(programContext, null, 2)}`,
    crossPhaseContext ? `Prior phase context:\n${crossPhaseContext}` : "",
    memory?.length ? `Memory:\n${JSON.stringify(memory, null, 2)}` : "",
    incomingHandoff ? `Incoming handoff:\n${JSON.stringify(incomingHandoff, null, 2)}` : "",
  ].filter(Boolean).join("\n\n");
}

function validateNode(
  schema: OutputFieldSchema,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (schema.required && (value === undefined || value === null)) {
    errors.push(`${path} is required`);
    return;
  }

  if (value === undefined || value === null) return;

  switch (schema.kind) {
    case "string":
      if (typeof value !== "string") {
        errors.push(`${path} should be a string`);
      } else if (schema.minLength && value.trim().length < schema.minLength) {
        errors.push(`${path} should be at least ${schema.minLength} characters`);
      }
      return;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) {
        errors.push(`${path} should be a number`);
        return;
      }
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`${path} should be >= ${schema.minimum}`);
      }
      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`${path} should be <= ${schema.maximum}`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} should be a boolean`);
      return;
    case "enum":
      if (typeof value !== "string" || !schema.values.includes(value)) {
        errors.push(`${path} should be one of ${schema.values.join(", ")}`);
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${path} should be an array`);
        return;
      }
      if (schema.minItems && value.length < schema.minItems) {
        errors.push(`${path} should contain at least ${schema.minItems} items`);
      }
      value.forEach((item, index) => validateNode(schema.item, item, `${path}[${index}]`, errors));
      return;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path} should be an object`);
        return;
      }
      Object.entries(schema.properties).forEach(([key, childSchema]) => {
        validateNode(childSchema, (value as Record<string, unknown>)[key], `${path}.${key}`, errors);
      });
  }
}

export function validateOutputSchema(
  agentId: string,
  output: unknown,
): { valid: boolean; errors: string[] } {
  const schema = getAgentOutputSchema(agentId as AdamAgentId);
  const errors: string[] = [];
  validateNode(schema, output, agentId, errors);
  return { valid: errors.length === 0, errors };
}

async function runAntiPatternCheck(
  antiPattern: AntiPattern,
  evalCase: EvalCase,
  agentOutput: string,
): Promise<{ pattern: string; found: boolean; evidence?: string }> {
  const label = antiPattern.description;
  if (antiPattern.pattern) {
    const regex = new RegExp(antiPattern.pattern, "i");
    const match = agentOutput.match(regex);
    return {
      pattern: label,
      found: Boolean(match),
      evidence: match?.[0],
    };
  }

  if (!antiPattern.llmCheck) {
    return { pattern: label, found: false };
  }

  try {
    const response = await requestEvalModel({
      system: "You are checking whether an anti-pattern is present in an enterprise AI agent output. Return JSON only.",
      user: [
        `Eval case: ${evalCase.name}`,
        `Check: ${antiPattern.llmCheck}`,
        "Output:",
        agentOutput,
        'Respond as {"found": true|false, "evidence": "..."}',
      ].join("\n"),
      maxTokens: 180,
      description: "eval-anti-pattern",
    });
    const parsed = safeJsonObject(response.text);
    return {
      pattern: label,
      found: parsed?.found === true,
      evidence: typeof parsed?.evidence === "string" ? parsed.evidence : undefined,
    };
  } catch {
    return { pattern: label, found: false };
  }
}

async function scoreCustomTrait(params: {
  trait: ExpectedTrait;
  evalCase: EvalCase;
  agentOutput: string;
  parsedOutput: Record<string, unknown> | null;
  pauseMarker: PauseMarker;
  schemaResult: { valid: boolean; errors: string[] };
}): Promise<{ score: number; passed: boolean; reasoning: string }> {
  const { trait, evalCase, parsedOutput, pauseMarker, schemaResult } = params;
  if (trait.dimension === "completeness") {
    if (!parsedOutput || !schemaResult.valid) {
      return { score: 0, passed: false, reasoning: "Output was not parseable or failed schema validation." };
    }
    const emptyKeys = Object.entries(parsedOutput)
      .filter(([, value]) => !isNonEmpty(value))
      .map(([key]) => key);
    return emptyKeys.length
      ? {
          score: 0.35,
          passed: false,
          reasoning: `These top-level fields were empty or incomplete: ${emptyKeys.join(", ")}.`,
        }
      : {
          score: 1,
          passed: true,
          reasoning: "All top-level fields were populated with non-empty content.",
        };
  }

  if (trait.dimension === "pause_behavior") {
    const shouldPause = trait.evaluatorConfig?.shouldPause === true;
    const score = shouldPause === pauseMarker.hasPause ? 1 : 0;
    return {
      score,
      passed: score >= PASS_THRESHOLD,
      reasoning: shouldPause
        ? pauseMarker.hasPause
          ? "Agent paused as expected for insufficient context."
          : "Agent should have paused but returned a completion instead."
        : pauseMarker.hasPause
          ? "Agent paused even though the case should have been completable."
          : "Agent completed without an unnecessary pause.",
    };
  }

  if (trait.dimension === "confidence_calibration") {
    if (pauseMarker.hasPause) {
      return {
        score: 1,
        passed: true,
        reasoning: "Agent paused instead of overstating confidence.",
      };
    }

    const confidence = typeof parsedOutput?.confidence === "number" ? parsedOutput.confidence : null;
    if (confidence == null) {
      return { score: 0, passed: false, reasoning: "Output did not contain a numeric confidence field." };
    }
    const contextQuality = String(trait.evaluatorConfig?.contextQuality || "medium");
    const valid = contextQuality === "high"
      ? confidence >= 0.7 && confidence <= 1
      : contextQuality === "medium"
        ? confidence >= 0.55 && confidence <= 0.85
        : contextQuality === "mixed"
          ? confidence >= 0.45 && confidence <= 0.8
          : confidence < 0.5;
    return {
      score: valid ? 0.9 : 0.35,
      passed: valid,
      reasoning: valid
        ? `Confidence ${confidence.toFixed(2)} is plausible for ${contextQuality} context quality.`
        : `Confidence ${confidence.toFixed(2)} does not fit ${contextQuality} context quality.`,
    };
  }

  return {
    score: 0.5,
    passed: false,
    reasoning: `No custom evaluator implemented for ${trait.dimension}.`,
  };
}

async function scoreTrait(params: {
  trait: ExpectedTrait;
  evalCase: EvalCase;
  agentOutput: string;
  parsedOutput: Record<string, unknown> | null;
  pauseMarker: PauseMarker;
  schemaResult: { valid: boolean; errors: string[] };
}): Promise<{ score: number; passed: boolean; reasoning: string }> {
  const { trait, evalCase, agentOutput, parsedOutput, pauseMarker, schemaResult } = params;
  if (trait.evaluator === "schema") {
    return {
      score: schemaResult.valid ? 1 : 0,
      passed: schemaResult.valid,
      reasoning: schemaResult.valid ? "Output matched the registered schema." : schemaResult.errors.join("; "),
    };
  }
  if (trait.evaluator === "regex") {
    const pattern = typeof trait.evaluatorConfig?.pattern === "string" ? trait.evaluatorConfig.pattern : "";
    const found = Boolean(pattern && new RegExp(pattern, "i").test(agentOutput));
    return {
      score: found ? 1 : 0,
      passed: found,
      reasoning: found ? `Matched required pattern ${pattern}.` : `Required pattern ${pattern} not found.`,
    };
  }
  if (trait.evaluator === "custom") {
    return scoreCustomTrait({ trait, evalCase, agentOutput, parsedOutput, pauseMarker, schemaResult });
  }
  return evaluateWithLLM({
    dimension: trait.dimension,
    evalCase,
    agentOutput,
    trait,
  });
}

async function executeAgent(
  evalCase: EvalCase,
  promptVersion: PromptVersion,
): Promise<{ agentOutput: string; parsedOutput: Record<string, unknown> | null; tokensUsed: number; latencyMs: number }> {
  const startedAt = Date.now();
  const user = [
    "Run this ADAM phase agent for the following evaluation case.",
    "Use the supplied context exactly as given. Return only the required JSON object or the pause marker if human input is required.",
    "",
    summarizeProgramInput(evalCase),
  ].join("\n\n");

  const response = await requestEvalModel({
    system: promptVersion.prompt,
    user,
    maxTokens: 2200,
    description: `eval-run-${evalCase.agentId}`,
  });
  return {
    agentOutput: response.text,
    parsedOutput: safeJsonObject(response.text),
    tokensUsed: response.tokensUsed,
    latencyMs: Date.now() - startedAt,
  };
}

function buildCaseIssues(
  schemaErrors: string[],
  antiPatterns: { pattern: string; found: boolean; evidence?: string }[],
  dimensionScores: EvalResult["dimensionScores"],
): string[] {
  const issues = [...schemaErrors];
  antiPatterns.filter((entry) => entry.found).forEach((entry) => {
    issues.push(`Anti-pattern detected: ${entry.pattern}${entry.evidence ? ` (${entry.evidence})` : ""}`);
  });
  dimensionScores.filter((score) => !score.passed).forEach((score) => {
    issues.push(`${score.dimension} failed: ${score.reasoning}`);
  });
  return issues;
}

function buildRecommendations(result: EvalResult): string[] {
  const weakest = [...result.dimensionScores]
    .sort((left, right) => left.score - right.score)
    .slice(0, 2);
  const recommendations = weakest.map((entry) => `Improve ${entry.dimension}: ${entry.reasoning}`);
  if (result.antiPatternViolations.some((entry) => entry.found)) {
    recommendations.push("Remove generic filler, placeholders, and unsupported claims from the prompt instructions.");
  }
  if (!result.parsedOutput) {
    recommendations.push("Tighten the output-format section so the agent returns clean JSON more reliably.");
  }
  return recommendations;
}

async function runEvalInternal(params: {
  agentId: AdamAgentId;
  promptVersion?: string;
  cases?: string[];
  compareToVersion?: string;
  skipCompare?: boolean;
}): Promise<EvalRunSummary> {
  const promptVersion = params.promptVersion
    ? getPromptVersion(params.agentId, params.promptVersion)
    : getActivePrompt(params.agentId);
  const sourceCases = getEvalCasesForAgent(params.agentId);
  const evalCases = params.cases?.length
    ? sourceCases.filter((entry) => params.cases?.includes(entry.id))
    : sourceCases;

  const runAt = new Date().toISOString();
  const runId = `eval-${params.agentId}-${Date.now()}`;
  const results: EvalResult[] = [];

  for (const evalCase of evalCases) {
    const execution = await executeAgent(evalCase, promptVersion);
    const pauseMarker = extractPauseMarker(execution.agentOutput);
    const schemaResult = pauseMarker.hasPause
      ? { valid: false, errors: ["Output paused before JSON completion."] }
      : validateOutputSchema(evalCase.agentId, execution.parsedOutput);

    const dimensionScores: EvalResult["dimensionScores"] = [];
    for (const trait of evalCase.expectedOutputTraits) {
      const evaluated = await scoreTrait({
        trait,
        evalCase,
        agentOutput: execution.agentOutput,
        parsedOutput: execution.parsedOutput,
        pauseMarker,
        schemaResult,
      });
      dimensionScores.push({
        dimension: trait.dimension,
        score: evaluated.score,
        passed: evaluated.passed,
        reasoning: evaluated.reasoning,
        weight: trait.weight,
      });
    }

    const weightedScore = dimensionScores.reduce((sum, item) => sum + (item.score * item.weight), 0);
    const antiPatternViolations = await Promise.all(
      evalCase.antiPatterns.map((antiPattern) => runAntiPatternCheck(antiPattern, evalCase, execution.agentOutput)),
    );
    const issues = buildCaseIssues(schemaResult.errors, antiPatternViolations, dimensionScores);
    const result: EvalResult = {
      evalCaseId: evalCase.id,
      agentId: evalCase.agentId,
      promptVersion: promptVersion.version,
      runAt,
      agentOutput: execution.agentOutput,
      parsedOutput: execution.parsedOutput,
      tokensUsed: execution.tokensUsed,
      latencyMs: execution.latencyMs,
      dimensionScores,
      weightedScore,
      passed: weightedScore >= PASS_THRESHOLD && antiPatternViolations.every((entry) => !entry.found),
      antiPatternViolations,
      issues,
      recommendations: [],
    };
    result.recommendations = buildRecommendations(result);
    results.push(result);
  }

  const passedCases = results.filter((entry) => entry.passed).length;
  const scoresByDimension = results.reduce<Record<EvalDimension, number>>((accumulator, result) => {
    result.dimensionScores.forEach((score) => {
      accumulator[score.dimension] = (accumulator[score.dimension] || 0) + score.score;
    });
    return accumulator;
  }, {
    accuracy: 0,
    completeness: 0,
    specificity: 0,
    consistency: 0,
    schema_validity: 0,
    confidence_calibration: 0,
    pause_behavior: 0,
    tone: 0,
    hallucination: 0,
  });

  (Object.keys(scoresByDimension) as EvalDimension[]).forEach((dimension) => {
    const samples = results.flatMap((result) => result.dimensionScores.filter((score) => score.dimension === dimension));
    scoresByDimension[dimension] = samples.length
      ? Number((samples.reduce((sum, score) => sum + score.score, 0) / samples.length).toFixed(2))
      : 0;
  });

  const scoresByTag = results.reduce<Record<string, number[]>>((accumulator, result) => {
    const caseDef = ADAM_EVAL_DATASET.find((entry) => entry.id === result.evalCaseId);
    (caseDef?.tags || []).forEach((tag) => {
      accumulator[tag] = accumulator[tag] || [];
      accumulator[tag].push(result.weightedScore);
    });
    return accumulator;
  }, {});

  const normalizedScoresByTag = Object.fromEntries(
    Object.entries(scoresByTag).map(([tag, values]) => [
      tag,
      Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    ]),
  );

  const averageScore = results.length
    ? Number((results.reduce((sum, result) => sum + result.weightedScore, 0) / results.length).toFixed(2))
    : 0;

  const summary: EvalRunSummary = {
    runId,
    promptVersion: promptVersion.version,
    agentId: params.agentId,
    runAt,
    totalCases: results.length,
    passedCases,
    passRate: results.length ? Number((passedCases / results.length).toFixed(2)) : 0,
    averageScore,
    scoresByDimension,
    scoresByTag: normalizedScoresByTag,
    regressions: [],
    improvements: [],
    results,
  };

  updatePromptEvalScores(params.agentId, promptVersion.version, {
    overallScore: averageScore,
    byDimension: scoresByDimension,
    sampleSize: results.length,
    evalRunId: runId,
  });

  if (!params.skipCompare && params.compareToVersion && params.compareToVersion !== promptVersion.version) {
    const baseline = await runEvalInternal({
      agentId: params.agentId,
      promptVersion: params.compareToVersion,
      cases: evalCases.map((entry) => entry.id),
      skipCompare: true,
    });
    const comparison = detectRegressions(summary, baseline);
    summary.regressions = comparison.regressions.map((entry) => entry.caseId);
    summary.improvements = comparison.improvements.map((entry) => entry.caseId);
  }

  return summary;
}

export async function runEval(params: {
  agentId: AdamAgentId;
  promptVersion?: string;
  cases?: string[];
  compareToVersion?: string;
}): Promise<EvalRunSummary> {
  return runEvalInternal(params);
}

export async function runAllEvals(params: {
  compareToVersion?: string;
}): Promise<Record<string, EvalRunSummary>> {
  const agentIds = Array.from(new Set(ADAM_EVAL_DATASET.map((entry) => entry.agentId)));
  const summaries: Record<string, EvalRunSummary> = {};
  for (const agentId of agentIds) {
    summaries[agentId] = await runEval({
      agentId,
      compareToVersion: params.compareToVersion,
    });
  }
  return summaries;
}

export function detectRegressions(
  currentRun: EvalRunSummary,
  baselineRun: EvalRunSummary,
): {
  regressions: { caseId: string; before: number; after: number; delta: number }[];
  improvements: { caseId: string; before: number; after: number; delta: number }[];
  overallDelta: number;
  recommendation: "promote" | "reject" | "investigate";
} {
  const baselineByCase = new Map(baselineRun.results.map((result) => [result.evalCaseId, result]));
  const regressions: { caseId: string; before: number; after: number; delta: number }[] = [];
  const improvements: { caseId: string; before: number; after: number; delta: number }[] = [];

  currentRun.results.forEach((result) => {
    const baseline = baselineByCase.get(result.evalCaseId);
    if (!baseline) return;
    const delta = Number((result.weightedScore - baseline.weightedScore).toFixed(2));
    if (delta < 0) {
      regressions.push({
        caseId: result.evalCaseId,
        before: baseline.weightedScore,
        after: result.weightedScore,
        delta,
      });
    } else if (delta > 0) {
      improvements.push({
        caseId: result.evalCaseId,
        before: baseline.weightedScore,
        after: result.weightedScore,
        delta,
      });
    }
  });

  const overallDelta = Number((currentRun.averageScore - baselineRun.averageScore).toFixed(2));
  const happyPathRegression = regressions.some((entry) => (
    entry.delta < -0.15 && entry.caseId.includes("happy_")
  ));
  const recommendation = happyPathRegression
    ? "reject"
    : regressions.length === 0 && overallDelta >= 0
      ? "promote"
      : "investigate";

  return {
    regressions,
    improvements,
    overallDelta,
    recommendation,
  };
}
