/**
 * The governed metric registry (audit F-002, the semantic layer).
 *
 * The T5-Ω report card found metrics were free-form grid rows: no definition
 * bound to a metric, nothing stopping the same measure being defined twice, and
 * no single accessor the surfaces agreed on — so "the semantic layer" was a
 * claim with nothing behind it.
 *
 * This module is that layer, at the scale the product needs: ONE canonical
 * accessor, `readMetricRegistry`, that every surface (Pulse, board pack,
 * sponsor brief, drill-down picker) reads through, so a metric is defined once
 * and read the same everywhere. Each metric now carries a `definition` — what
 * it means, in the stakeholders' language — not just a label and two numbers.
 * `metricConsistency` is the governance check: it rejects a registry where a
 * measure is defined twice, left undefined, or can't verify attainment. The
 * registry is a VIEW over the single stored source (the Frame KPI grid), so
 * there is no second copy to drift — the governance is structural.
 */
import type { ProgramSummary } from "@/new/types";
import { frameKpis } from "@/v3/components/flow/flowShellData";

export interface GovernedMetric {
  /** Stable identity — the grid row id, or a slug of the name as a fallback. */
  id: string;
  name: string;
  /** What the metric means, defined once. Empty until an owner fills it in. */
  definition: string;
  baseline: string;
  target: string;
  unit: string;
}

export type MetricIssueKind = "undefined" | "duplicate-name" | "unverifiable";

export interface MetricIssue {
  kind: MetricIssueKind;
  severity: "error" | "warning";
  metric: string;
  message: string;
}

export interface MetricRegistryHealth {
  total: number;
  /** Metrics carrying a definition — the governed subset. */
  defined: number;
  issues: MetricIssue[];
  /** True when every metric is defined and verifiable with no duplicates. */
  governed: boolean;
}

const slug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "metric";

/**
 * The canonical metric list. Derived from the single stored source (the Frame
 * KPI grid) so there is exactly one definition of each metric in the system.
 * Every surface that shows a measure should read it from here.
 */
export function readMetricRegistry(program: ProgramSummary): GovernedMetric[] {
  const rows = frameKpis(program);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const name = (row.name ?? "").trim();
    const base = row.id?.trim() || slug(name);
    // Guarantee id uniqueness even if two rows slug to the same value.
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      id: n === 1 ? base : `${base}-${n}`,
      name,
      definition: (row.definition ?? "").trim(),
      baseline: (row.baseline ?? "").trim(),
      target: (row.target ?? "").trim(),
      unit: (row.unit ?? "").trim(),
    };
  });
}

/** Look up one governed metric by its stable id. */
export function metricById(program: ProgramSummary, id: string): GovernedMetric | null {
  return readMetricRegistry(program).find((metric) => metric.id === id) ?? null;
}

/**
 * The governance check over the registry. A governed metric must be defined
 * once (no duplicate names), carry a definition, and have both a baseline and a
 * target so attainment is verifiable. Returns every issue found.
 */
export function metricConsistency(program: ProgramSummary): MetricRegistryHealth {
  const metrics = readMetricRegistry(program);
  const issues: MetricIssue[] = [];
  const nameCounts = new Map<string, number>();
  for (const metric of metrics) {
    const key = metric.name.toLowerCase();
    if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const flaggedDup = new Set<string>();
  for (const metric of metrics) {
    const key = metric.name.toLowerCase();
    if (key && (nameCounts.get(key) ?? 0) > 1 && !flaggedDup.has(key)) {
      flaggedDup.add(key);
      issues.push({ kind: "duplicate-name", severity: "error", metric: metric.name, message: `"${metric.name}" is defined more than once — a metric must have a single definition.` });
    }
    if (!metric.definition) {
      issues.push({ kind: "undefined", severity: "warning", metric: metric.name || "(unnamed)", message: `"${metric.name || "(unnamed)"}" has no definition — the metric isn't governed until its meaning is recorded.` });
    }
    if (!metric.baseline || !metric.target) {
      issues.push({ kind: "unverifiable", severity: "error", metric: metric.name || "(unnamed)", message: `"${metric.name || "(unnamed)"}" is missing a ${!metric.baseline && !metric.target ? "baseline and target" : !metric.baseline ? "baseline" : "target"} — attainment can't be verified.` });
    }
  }
  const defined = metrics.filter((metric) => metric.definition).length;
  return {
    total: metrics.length,
    defined,
    issues,
    governed: metrics.length > 0 && issues.filter((i) => i.severity === "error").length === 0 && defined === metrics.length,
  };
}
