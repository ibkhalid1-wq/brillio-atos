import { useMemo } from "react";
import { runSanityTest, getSanityVerdict } from "@/lib/adamSanityEngine";
import { runAllWorkstreams } from "@/lib/adamValidationEngine";
import type { ProgramSummary } from "@/new/types";

export function useProgramValidation(program: ProgramSummary | null) {
  const sanity = useMemo(() => {
    if (!program) return null;
    const checks = runSanityTest();
    return getSanityVerdict(checks);
  }, [program]);

  const validation = useMemo(() => {
    if (!program) return null;
    const raw = (program.rawData || {}) as Record<string, unknown>;
    const inner = typeof raw.data === "object" && raw.data !== null ? raw.data : raw;
    return runAllWorkstreams(inner);
  }, [program]);

  const hasBlockers = useMemo(() => {
    if (!sanity && !validation) return false;
    return sanity?.label === "BLOCKED" || (validation?.some((entry) => entry.score < 40) ?? false);
  }, [sanity, validation]);

  const warningCount = useMemo(() => {
    if (!validation) return 0;
    return validation.filter((entry) => entry.status === "warn").length;
  }, [validation]);

  return { sanity, validation, hasBlockers, warningCount };
}
