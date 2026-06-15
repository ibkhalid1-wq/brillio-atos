import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { GateReview } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { recordGateRiskSnapshot } from "@/lib/adamGateRisk";

const LEGACY_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"] as const;

async function getCurrentUserDisplayName(): Promise<string> {
  if (!supabase) return "Program owner";
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return "Program owner";
  return user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email
    || "Program owner";
}

/** Minimal default gate review for manual/offline approval */
function defaultGateReview(phaseId: string): GateReview {
  return {
    phaseId,
    status: "pending" as const,
    readinessScore: 75,
    exitCriteria: [],
    blockers: [],
    recommendations: [],
    summary: "Gate approved manually — AI gate review was not available.",
    generatedAt: new Date().toISOString(),
    remediationNote: null,
    approvedAt: null,
    approvedBy: null,
  } as unknown as GateReview;
}

function persistLocally(programId: string, payload: Record<string, unknown>) {
  if (typeof localStorage === "undefined") return;
  const now = new Date().toISOString();
  LEGACY_KEYS.forEach((storageKey) => {
    try {
      const entries: unknown[] = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      const next = entries.map((entry) => {
        if (typeof entry !== "object" || entry === null) return entry;
        const e = entry as Record<string, unknown>;
        if (e.id !== programId) return entry;
        return { ...e, updatedAt: now, lastActiveAt: now, data: { ...payload, _syncedAt: now } };
      });
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch { /* ignore */ }
  });
}

export function useGateReview(
  programId: string,
  rawData: Record<string, unknown>,
  onRefresh: () => Promise<void>,
) {
  const [isSaving, setIsSaving] = useState(false);

  const getGateReviewState = useCallback(() => {
    const { wrapper, inner, usesNestedData } = getProgramState(rawData);
    const gateReviews = typeof inner.gateReviews === "object" && inner.gateReviews !== null && !Array.isArray(inner.gateReviews)
      ? inner.gateReviews as Record<string, GateReview>
      : {};
    const decisionQueue = Array.isArray(inner.decisionQueue) ? [...inner.decisionQueue] as Record<string, unknown>[] : [];
    return { wrapper, inner, gateReviews, decisionQueue, usesNestedData };
  }, [rawData]);

  const persistState = useCallback(async (
    nextInner: Record<string, unknown>,
  ) => {
    if (!programId) throw new Error("No programme selected.");
    setIsSaving(true);
    try {
      const { wrapper, usesNestedData } = getGateReviewState();
      const payload = wrapProgramState(wrapper, nextInner, usesNestedData);

      if (isSupabaseConfigured && supabase) {
        const now = new Date().toISOString();
        const { data: updatedRows, error } = await supabase
          .from("adam_programs")
          .update({ data: payload as Json, updated_at: now })
          .eq("id", programId)
          .select("id");

        if (error) throw new Error(error.message);

        // UPSERT fallback if RLS blocked the UPDATE (0 rows affected)
        if (!updatedRows || updatedRows.length === 0) {
          console.warn("[useGateReview] UPDATE 0 rows — attempting upsert for", programId);
          const { error: upsertErr } = await supabase
            .from("adam_programs")
            .upsert(
              { id: programId, data: payload as Json, updated_at: now, is_deleted: false, owner_id: null },
              { onConflict: "id" },
            );
          if (upsertErr) {
            // Persist locally as last-resort but surface the error so the caller knows Supabase failed
            persistLocally(programId, payload);
            throw new Error(`Gate state could not be saved to Supabase: ${upsertErr.message}`);
          }
        }

        // Fire pattern-extract asynchronously (ignore errors — agents may need auth)
        supabase.functions.invoke("run-agent", {
          body: { programId, agentId: "pattern-extract", phaseId: "program", triggeredBy: "trigger", triggerEvent: "gate-approved" },
        }).catch(() => undefined);
      } else {
        // localStorage-only path
        persistLocally(programId, payload);
      }

      await onRefresh();
    } finally {
      setIsSaving(false);
    }
  }, [getGateReviewState, onRefresh, programId]);

  const approveGate = useCallback(async (phaseId: string) => {
    const { inner, gateReviews, decisionQueue } = getGateReviewState();
    // If no gate review exists (agent never ran), create a default manual one
    const review: GateReview = gateReviews[phaseId] ?? defaultGateReview(phaseId);
    const approvedBy = await getCurrentUserDisplayName().catch(() => "Program owner");
    const nextReviews = {
      ...gateReviews,
      [phaseId]: {
        ...review,
        status: "approved" as const,
        approvedAt: new Date().toISOString(),
        approvedBy,
        remediationNote: null,
      },
    };
    const nextInner = {
      ...inner,
      gateReviews: nextReviews,
      decisionQueue: decisionQueue.filter((decision) => !(
        String(decision.type || "") === "gate-approval"
        && String(decision.phaseId || decision.phase_id || "") === phaseId
      )),
    };
    await persistState(nextInner);
    recordGateRiskSnapshot(phaseId, {
      phaseId,
      level: "low",
      riskScore: 0,
      reasons: [],
      readiness: typeof review.readinessScore === "number" ? review.readinessScore : 75,
      confidence: 0.5,
      blockerCount: 0,
      exitsPassing: true,
      contradictionCount: 0,
      projectedWeeksToGate: 0,
      snapshot: {
        ts: Date.now(),
        readiness: typeof review.readinessScore === "number" ? review.readinessScore : 75,
        blockerCount: 0,
      },
    }, programId);
  }, [getGateReviewState, persistState, programId]);

  const requestRemediation = useCallback(async (phaseId: string, note: string) => {
    const { inner, gateReviews, decisionQueue } = getGateReviewState();
    const review = gateReviews[phaseId];
    if (!review) throw new Error("Gate review not found.");
    const nextReviews = {
      ...gateReviews,
      [phaseId]: {
        ...review,
        status: "remediation-requested" as const,
        remediationNote: note || null,
        approvedAt: null,
        approvedBy: null,
      },
    };
    // Surface remediation as an actionable item so the loop doesn't dead-end:
    // without this, requesting remediation only sets a status + note and the PM
    // has no queued next step. Mirrors reopenGate's pattern — push a gate-approval
    // decision pointing at the blockers + re-run gate review, then re-approve.
    // Carry the top blockers (if the gate review captured any) into the prompt so
    // the PM sees *what* to fix, not just *that* something needs fixing.
    const blockerLabels = Array.isArray((review as Record<string, unknown>).blockers)
      ? ((review as Record<string, unknown>).blockers as unknown[])
          .map((b) => (typeof b === "string" ? b : (b && typeof b === "object" ? String((b as Record<string, unknown>).label ?? (b as Record<string, unknown>).criterion ?? "") : "")))
          .filter((label) => label.trim().length > 0)
          .slice(0, 3)
      : [];
    const remediationDecision = {
      id: `remediation-gate-${phaseId}-${Date.now()}`,
      title: `Gate remediation: ${phaseId}`,
      question: `The ${phaseId} gate needs remediation before it can be approved.${note ? ` Reason: ${note}.` : ""}${blockerLabels.length ? ` Open blockers: ${blockerLabels.join("; ")}.` : ""} Address the blockers, re-run the gate review, then re-submit for approval.`,
      type: "gate-approval",
      priority: "high",
      status: "open",
      phaseId,
      source: "gate-remediation",
      createdAt: new Date().toISOString(),
      recommendation: "Resolve the noted blockers, re-run gate review, then approve.",
    };
    const nextInner = {
      ...inner,
      gateReviews: nextReviews,
      decisionQueue: [
        // De-dupe any stale gate-approval item for this phase, then append the fresh one.
        ...decisionQueue.filter((decision) => !(
          String(decision.type || "") === "gate-approval"
          && String(decision.phaseId || decision.phase_id || "") === phaseId
        )),
        remediationDecision,
      ],
    };
    await persistState(nextInner);
    recordGateRiskSnapshot(phaseId, {
      phaseId,
      level: "high",
      riskScore: 1,
      reasons: [{ severity: "high", msg: note || "Remediation requested" }],
      readiness: typeof review.readinessScore === "number" ? review.readinessScore : 0,
      confidence: 0.5,
      blockerCount: 1,
      exitsPassing: false,
      contradictionCount: 0,
      projectedWeeksToGate: 0,
      snapshot: {
        ts: Date.now(),
        readiness: typeof review.readinessScore === "number" ? review.readinessScore : 0,
        blockerCount: 1,
      },
    }, programId);
  }, [getGateReviewState, persistState, programId]);

  const saveNote = useCallback(async (phaseId: string, note: string) => {
    const { inner, gateReviews } = getGateReviewState();
    const existing = gateReviews[phaseId] || {};
    const nextReviews = { ...gateReviews, [phaseId]: { ...existing, humanNote: note } };
    await persistState({ ...inner, gateReviews: nextReviews });
  }, [getGateReviewState, persistState]);

  const reopenGate = useCallback(async (phaseId: string, reason: string) => {
    const { inner, gateReviews, decisionQueue } = getGateReviewState();
    const review = gateReviews[phaseId];
    if (!review) throw new Error("Gate review not found.");

    const nextReviews = {
      ...gateReviews,
      [phaseId]: {
        ...review,
        status: "remediation-requested" as const,
        reopenedAt: new Date().toISOString(),
        reopenedBy: await getCurrentUserDisplayName().catch(() => "Program owner"),
        reopenReason: reason,
        approvedAt: null,
        approvedBy: null,
      },
    };

    const reopenDecision = {
      id: `reopen-gate-${phaseId}-${Date.now()}`,
      title: `Gate reopened: ${phaseId}`,
      question: `The ${phaseId} gate has been reopened. Reason: ${reason}. Review the gate conditions and re-approve when resolved.`,
      type: "gate-approval",
      priority: "high",
      status: "open",
      phaseId,
      source: "gate-reopen",
      createdAt: new Date().toISOString(),
      recommendation: "Address the reopen reason, re-run gate review, then re-approve.",
    };

    await persistState({
      ...inner,
      gateReviews: nextReviews,
      decisionQueue: [...decisionQueue, reopenDecision],
    });
  }, [getGateReviewState, persistState]);

  return {
    approveGate,
    requestRemediation,
    saveNote,
    reopenGate,
    isSaving,
  };
}
