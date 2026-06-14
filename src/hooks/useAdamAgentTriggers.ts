import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runAdamAgent } from "@/lib/runAdamAgent";

type TriggeredBy = "manual" | "trigger" | "downstream";

type PhaseSummary = {
  id?: string;
  pct?: number;
};

type ProgramBlob = Record<string, unknown>;

interface UseAdamAgentTriggersOptions {
  programId: string;
  programData: ProgramBlob;
}

const ONE_HOUR_MS = 1000 * 60 * 60;
const ONE_DAY_MS = ONE_HOUR_MS * 24;
const SIX_HOURS_MS = ONE_HOUR_MS * 6;
const TWELVE_HOURS_MS = ONE_HOUR_MS * 12;
const FORTY_EIGHT_HOURS_MS = ONE_HOUR_MS * 48;
const SEVENTY_TWO_HOURS_MS = ONE_HOUR_MS * 72;
const SEVEN_DAYS_MS = ONE_DAY_MS * 7;
const RECENT_TRIGGER_COOLDOWN_MS = 45 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isOlderThan(timestamp: string | null | undefined, maxAgeMs: number): boolean {
  if (!timestamp) return true;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > maxAgeMs;
}

function resolvePhases(programData: ProgramBlob): Array<{ id: string; pct: number }> {
  return asArray<PhaseSummary>(programData.phases)
    .map((phase) => ({
      id: typeof phase?.id === "string" ? phase.id : "",
      pct: Math.max(0, Math.min(100, asNumber(phase?.pct, 0))),
    }))
    .filter((phase) => phase.id);
}

function resolveRaidGeneratedAt(programData: ProgramBlob): string | null {
  const raidLog = asRecord(programData.raidLog);
  return asString(programData.raidGeneratedAt)
    || asString(raidLog.generatedAt)
    || asString(programData.lastRiskScanAt)
    || null;
}

function resolveClosureGeneratedAt(programData: ProgramBlob): string | null {
  const closure = asRecord(programData.closure);
  return asString(programData.closureGeneratedAt)
    || asString(closure.generatedAt)
    || null;
}

function resolveStakeholderGeneratedAt(programData: ProgramBlob): string | null {
  return asString(programData.stakeholderGeneratedAt)
    || asString(programData.stakeholdersGeneratedAt)
    || null;
}

function resolveRetroGeneratedAt(programData: ProgramBlob, phaseId: string): string | null {
  const generated = asRecord(programData.retrosGeneratedAt);
  return asString(generated[phaseId]);
}

function makeKey(agentId: string, phaseId: string): string {
  return `${agentId}:${phaseId || "program"}`;
}

export function useAdamAgentTriggers({ programId, programData }: UseAdamAgentTriggersOptions) {
  const [isRunning, setIsRunning] = useState<Record<string, boolean>>({});
  const runningRef = useRef<Record<string, boolean>>({});
  const recentTriggersRef = useRef<Map<string, number>>(new Map());

  const phases = useMemo(() => resolvePhases(programData), [programData]);
  const gateReviews = useMemo(() => asRecord(programData.gateReviews), [programData]);
  const closureGeneratedAt = resolveClosureGeneratedAt(programData);
  const patternExtractGeneratedAt = asString(programData.patternExtractGeneratedAt);
  const patternQueryCachedAt = asString(programData.patternQueryCachedAt);

  const setRunning = useCallback((agentId: string, phaseId: string, value: boolean) => {
    const key = makeKey(agentId, phaseId);
    runningRef.current[key] = value;
    setIsRunning((current) => {
      const next = { ...current, [key]: value, [agentId]: value || Object.entries(runningRef.current).some(([entryKey, running]) => running && entryKey.startsWith(`${agentId}:`)) };
      return next;
    });
  }, []);

  const canTrigger = useCallback((agentId: string, phaseId: string) => {
    if (!programId) return false;
    const key = makeKey(agentId, phaseId);
    if (runningRef.current[key]) return false;
    const lastTriggeredAt = recentTriggersRef.current.get(key) || 0;
    return Date.now() - lastTriggeredAt > RECENT_TRIGGER_COOLDOWN_MS;
  }, [programId]);

  const triggerAgent = useCallback(async (agentId: string, phaseId = "program", triggeredBy: TriggeredBy = "manual") => {
    if (!programId || !canTrigger(agentId, phaseId)) return false;
    recentTriggersRef.current.set(makeKey(agentId, phaseId), Date.now());
    setRunning(agentId, phaseId, true);
    try {
      await runAdamAgent({
        agentId,
        phaseId,
        programId,
        triggeredBy,
      });
      return true;
    } finally {
      setRunning(agentId, phaseId, false);
    }
  }, [canTrigger, programId, setRunning]);

  useEffect(() => {
    if (!programId) {
      recentTriggersRef.current = new Map();
      runningRef.current = {};
      setIsRunning({});
    }
  }, [programId]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.some((phase) => phase.pct > 0)) return;
    if (!isOlderThan(asString(programData.narrativeGeneratedAt) || asString(asRecord(programData.programNarrative).generatedAt), ONE_DAY_MS)) return;
    void triggerAgent("narrative", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.some((phase) => phase.pct > 0)) return;
    if (!isOlderThan(asString(programData.planGeneratedAt), ONE_DAY_MS)) return;
    void triggerAgent("plan", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!isOlderThan(resolveRaidGeneratedAt(programData), TWELVE_HOURS_MS)) return;
    void triggerAgent("risk", "program", "trigger");
  }, [programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!isOlderThan(asString(programData.milestonesGeneratedAt), ONE_DAY_MS)) return;
    void triggerAgent("milestone", "program", "trigger");
  }, [programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!isOlderThan(asString(programData.budgetGeneratedAt) || asString(asRecord(programData.budgetTracking).generatedAt), ONE_DAY_MS)) return;
    void triggerAgent("budget", "program", "trigger");
  }, [programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!programData.plan) return;
    if (!isOlderThan(asString(programData.criticalPathGeneratedAt) || asString(asRecord(programData.criticalPath).generatedAt), ONE_DAY_MS)) return;
    void triggerAgent("critical-path", "program", "trigger");
  }, [programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!isOlderThan(asString(programData.escalationsLastCheckedAt), SIX_HOURS_MS)) return;
    void triggerAgent("escalation", "program", "trigger");
  }, [programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.length) return;
    if (!isOlderThan(asString(programData.healthHeatmapGeneratedAt), TWELVE_HOURS_MS)) return;
    void triggerAgent("health-heatmap", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.some((phase) => phase.pct > 0)) return;
    if (!isOlderThan(asString(programData.changeImpactGeneratedAt), FORTY_EIGHT_HOURS_MS)) return;
    void triggerAgent("change-impact", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.some((phase) => phase.pct > 0)) return;
    if (!isOlderThan(resolveStakeholderGeneratedAt(programData), FORTY_EIGHT_HOURS_MS)) return;
    void triggerAgent("stakeholder", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!phases.some((phase) => phase.pct > 50)) return;
    if (!isOlderThan(asString(programData.adoptionGeneratedAt), ONE_DAY_MS)) return;
    void triggerAgent("adoption", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (phases.filter((phase) => phase.pct > 0).length < 2) return;
    if (!isOlderThan(asString(programData.scopePcrGeneratedAt), FORTY_EIGHT_HOURS_MS)) return;
    void triggerAgent("scope-pcr", "program", "trigger");
  }, [programData, programId, phases, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!isOlderThan(patternQueryCachedAt, SIX_HOURS_MS)) return;
    void triggerAgent("pattern-query", "program", "trigger");
  }, [patternQueryCachedAt, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    if (!closureGeneratedAt) return;
    if (!isOlderThan(patternExtractGeneratedAt, SEVEN_DAYS_MS)) return;
    void triggerAgent("pattern-extract", "program", "trigger");
  }, [closureGeneratedAt, patternExtractGeneratedAt, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    phases
      .filter((phase) => phase.pct >= 90)
      .forEach((phase) => {
        const review = asRecord(gateReviews[phase.id]);
        if (!isOlderThan(asString(review.generatedAt), ONE_DAY_MS)) return;
        void triggerAgent("gate-review", phase.id, "trigger");
      });
  }, [gateReviews, phases, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    phases
      .filter((phase) => phase.pct >= 90)
      .forEach((phase) => {
        if (!isOlderThan(resolveRetroGeneratedAt(programData, phase.id), SEVENTY_TWO_HOURS_MS)) return;
        void triggerAgent("retro", phase.id, "trigger");
      });
  }, [phases, programData, programId, triggerAgent]);

  useEffect(() => {
    if (!programId) return;
    const hasClosure = !!programData.closure;
    const allReady = phases.length > 0 && phases.every((phase) => phase.pct >= 90);
    if (!allReady || hasClosure) return;
    void triggerAgent("closure", "program", "trigger");
  }, [phases, programData.closure, programId, triggerAgent]);

  return {
    isRunning,
    triggerAgent,
  };
}
