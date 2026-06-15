#!/usr/bin/env tsx

import { ADAM_EVAL_DATASET } from "@/lib/evals/adamEvalDataset";
import { detectRegressions, runAllEvals, runEval, type EvalRunSummary } from "@/lib/evals/adamEvalRunner";
import { getActivePrompt } from "@/lib/adamPromptRegistry";
import type { AdamAgentId } from "@/lib/adamAgentPrompts";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

interface ParsedArgs {
  all: boolean;
  agent?: AdamAgentId;
  version?: string;
  compare?: string;
  tags: string[];
}

function colorize(color: keyof typeof colors, value: string): string {
  return `${colors[color]}${value}${colors.reset}`;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    all: false,
    tags: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--all":
        parsed.all = true;
        break;
      case "--agent":
        parsed.agent = argv[index + 1] as AdamAgentId;
        index += 1;
        break;
      case "--version":
        parsed.version = argv[index + 1];
        index += 1;
        break;
      case "--compare":
        parsed.compare = argv[index + 1];
        index += 1;
        break;
      case "--tags":
        parsed.tags = (argv[index + 1] || "").split(",").map((item) => item.trim()).filter(Boolean);
        index += 1;
        break;
      default:
        break;
    }
  }

  return parsed;
}

function usage(): void {
  const message = `
ATOS Eval CLI

Usage:
  npx tsx src/lib/evals/adamEvalCLI.ts --agent strategy
  npx tsx src/lib/evals/adamEvalCLI.ts --all
  npx tsx src/lib/evals/adamEvalCLI.ts --agent strategy --version 1.1.0 --compare 1.0.0
  npx tsx src/lib/evals/adamEvalCLI.ts --agent discover --tags edge_case
`;
  console.log(message);
}

function caseIdsForTags(agentId: AdamAgentId, tags: string[]): string[] {
  if (!tags.length) return [];
  return ADAM_EVAL_DATASET
    .filter((entry) => entry.agentId === agentId && tags.every((tag) => entry.tags.includes(tag)))
    .map((entry) => entry.id);
}

function printSummary(summary: EvalRunSummary, baseline?: EvalRunSummary): void {
  const header = `ATOS Eval Runner — ${summary.agentId} v${summary.promptVersion}`;
  console.log(colorize("bold", header));
  console.log("──────────────────────────────────────────");
  console.log(`Running ${summary.totalCases} test cases...\n`);

  summary.results.forEach((result) => {
    const label = result.passed
      ? result.weightedScore < 0.8
        ? colorize("yellow", "⚠ PASS")
        : colorize("green", "✅ PASS")
      : colorize("red", "❌ FAIL");
    const caseId = result.evalCaseId.split(`${summary.agentId}_`)[1] || result.evalCaseId;
    console.log(`${label}  ${caseId.padEnd(12)} ${result.weightedScore.toFixed(2)}  ${result.issues[0] || ""}`);
  });

  console.log("\n──────────────────────────────────────────");
  console.log(`Pass Rate:    ${summary.passedCases}/${summary.totalCases}  (${Math.round(summary.passRate * 100)}%)`);
  console.log(`Avg Score:    ${summary.averageScore.toFixed(2)}`);

  if (baseline) {
    const comparison = detectRegressions(summary, baseline);
    const deltaLabel = comparison.overallDelta >= 0
      ? colorize("green", `+${comparison.overallDelta.toFixed(2)} ↑`)
      : colorize("red", `${comparison.overallDelta.toFixed(2)} ↓`);
    console.log(`vs v${baseline.promptVersion}:    ${deltaLabel} (${comparison.improvements.length} improvements, ${comparison.regressions.length} regressions)`);
    const recommendationLabel = comparison.recommendation === "promote"
      ? colorize("green", "PROMOTE ✅")
      : comparison.recommendation === "reject"
        ? colorize("red", "REJECT ❌")
        : colorize("yellow", "INVESTIGATE ⚠");
    console.log(`Recommend:    ${recommendationLabel}`);
  }

  console.log("\nDimension Breakdown:");
  Object.entries(summary.scoresByDimension).forEach(([dimension, score]) => {
    const weakest = score < 0.75 ? "  ← weakest dimension" : "";
    console.log(`  ${dimension.padEnd(22)} ${score.toFixed(2)}${weakest}`);
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.all && !args.agent) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (args.all) {
    const summaries = await runAllEvals({ compareToVersion: args.compare });
    Object.values(summaries).forEach((summary) => {
      console.log("");
      printSummary(summary);
    });
    return;
  }

  const agentId = args.agent as AdamAgentId;
  const promptVersion = args.version || getActivePrompt(agentId).version;
  const caseIds = args.tags.length ? caseIdsForTags(agentId, args.tags) : undefined;
  const summary = await runEval({
    agentId,
    promptVersion,
    cases: caseIds && caseIds.length ? caseIds : undefined,
    compareToVersion: args.compare,
  });

  const baseline = args.compare
    ? await runEval({
        agentId,
        promptVersion: args.compare,
        cases: caseIds && caseIds.length ? caseIds : undefined,
      })
    : undefined;
  printSummary(summary, baseline);
}

void main().catch((error) => {
  console.error(colorize("red", `ATOS Eval CLI failed: ${error instanceof Error ? error.message : "Unknown error"}`));
  process.exitCode = 1;
});
