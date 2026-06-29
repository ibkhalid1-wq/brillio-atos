import { useCallback, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { GateReview } from "@/new/types";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { recordGateRiskSnapshot } from "@/lib/adamGateRisk";
import { getChangeRequests, makeChangeRequest, applyDecision, phasesToReopenForChange } from "@/v3/lib/changeControl";

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

function readGateReviews(inner: Record<string, unknown>): Record<string, GateReview> {
  return typeof inner.gateReviews === "object" && inner.gateReviews !== null && !Array.isArray(inner.gateReviews)
    ? inner.gateReviews as Record<string, GateReview>
    : {};
}

function readDecisionQueue(inner: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(inner.decisionQueue) ? inner.decisionQueue as Record<string, unknown>[] : [];
}

/** Pure transform that reopens one phase's gate on a given inner state. Reads the
 *  gate reviews and decision queue off the inner it receives so it can be folded
 *  over several phases without later iterations clobbering earlier reopens. Shared
 *  by the direct reopen flow and the change-request approval flow so both produce
 *  the exact same gate/decision-queue mutation in a single atomic write. */
function reopenPhaseInner(
  inner: Record<string, unknown>,
  phaseId: string,
  reason: string,
  reopenedBy: string,
): Record<string, unknown> {
  const gateReviews = readGateReviews(inner);
  const decisionQueue = readDecisionQueue(inner);
  const review: GateReview = gateReviews[phaseId] ?? defaultGateReview(phaseId);
  const nextReviews = {
    ...gateReviews,
    [phaseId]: {
      ...review,
      status: "remediation-requested" as const,
      reopenedAt: new Date().toISOString(),
      reopenedBy,
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
  return { ...inner, gateReviews: nextReviews, decisionQueue: [...decisionQueue, reopenDecision] };
}

/** Reopen several phases in one atomic transform, folding so each reopen sees the
 *  prior reopens (no stale-snapshot clobbering). */
function reopenPhasesInner(
  inner: Record<string, unknown>,
  phaseIds: string[],
  reason: string,
  reopenedBy: string,
): Record<string, unknown> {
  return phaseIds.reduce((acc, phaseId) => reopenPhaseInner(acc, phaseId, reason, reopenedBy), inner);
}

/** Pure transform that resets one phase to a blank workspace: drops every
 *  phase-keyed working record (inputs, artifacts, gate review, progress estimate,
 *  dependency/RACI checks) and removes the phase's entries from the shared
 *  decision queue and human-notes log. Resetting an approved phase removes its
 *  gate approval, so downstream phases re-lock automatically (getLockedPhaseIds
 *  reads gateReviews). RAID/risk entries are intentionally left untouched — they
 *  live in their own log and may span phases. */
function resetPhaseInner(inner: Record<string, unknown>, phaseId: string): Record<string, unknown> {
  const asMap = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const matchesPhase = (entry: Record<string, unknown>): boolean =>
    String(entry.phaseId ?? entry.phase_id ?? "") === phaseId;

  const next: Record<string, unknown> = { ...inner };
  for (const key of ["phaseInputs", "phaseArtifacts", "gateReviews", "phasePct", "dependencyCheck", "raciGaps"]) {
    const map = asMap(inner[key]);
    if (map && phaseId in map) {
      const { [phaseId]: _removed, ...rest } = map;
      next[key] = rest;
    }
  }
  if (Array.isArray(inner.decisionQueue)) {
    next.decisionQueue = (inner.decisionQueue as Record<string, unknown>[]).filter((entry) => !matchesPhase(entry));
  }
  if (Array.isArray(inner.humanNotes)) {
    next.humanNotes = (inner.humanNotes as Record<string, unknown>[]).filter((entry) => !matchesPhase(entry));
  }
  return next;
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

        // No automatic pattern-extract on gate approval. Closing a gate is a
        // deterministic state change; pattern mining is now on-demand (run from
        // the program intelligence surface) so approving a gate costs no LLM call.
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
    // Closing a phase approves its produced artifacts: the gate decision is the
    // PM sign-off on this phase's deliverables. This is what lets the next
    // phase's planner read them as approved prior-phase context (only approved
    // artifacts feed the cross-phase LLM handoff). Empty/placeholder slots stay
    // untouched in effect — the planner skips artifacts with no content.
    const phaseArtifacts = inner.phaseArtifacts && typeof inner.phaseArtifacts === "object" && !Array.isArray(inner.phaseArtifacts)
      ? inner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>
      : {};
    const phaseBucket = phaseArtifacts[phaseId];
    const nextPhaseArtifacts = phaseBucket && typeof phaseBucket === "object"
      ? {
          ...phaseArtifacts,
          [phaseId]: Object.fromEntries(
            Object.entries(phaseBucket).map(([artifactId, artifact]) => [
              artifactId,
              artifact && typeof artifact === "object" ? { ...artifact, status: "approved" } : artifact,
            ]),
          ),
        }
      : phaseArtifacts;
    const nextInner = {
      ...inner,
      gateReviews: nextReviews,
      phaseArtifacts: nextPhaseArtifacts,
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
    // Same tolerance as approveGate/reopenGate: a locked gate may have no stored
    // review (legacy or manual lock), so synthesise a default instead of failing.
    const review: GateReview = gateReviews[phaseId] ?? defaultGateReview(phaseId);
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
    const blockerLabels = Array.isArray((review as unknown as Record<string, unknown>).blockers)
      ? ((review as unknown as Record<string, unknown>).blockers as unknown[])
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
    const { inner } = getGateReviewState();
    // A gate can be locked without a stored review (legacy programmes, or a gate
    // closed before AI review existed). reopenPhaseInner synthesises a default
    // rather than failing the reopen.
    const reopenedBy = await getCurrentUserDisplayName().catch(() => "Program owner");
    await persistState(reopenPhaseInner(inner, phaseId, reason, reopenedBy));
  }, [getGateReviewState, persistState]);

  const resetPhase = useCallback(async (phaseId: string) => {
    const { inner } = getGateReviewState();
    await persistState(resetPhaseInner(inner, phaseId));
  }, [getGateReviewState, persistState]);

  // Log a change request against a locked phase. This is the sanctioned entry
  // point for editing a closed stage: nothing unlocks until the request is
  // approved (see resolveChangeRequest), so the audit trail is never bypassed.
  const raiseChangeRequest = useCallback(async (phaseId: string, title: string, reason: string) => {
    const { inner } = getGateReviewState();
    const requestedBy = await getCurrentUserDisplayName().catch(() => "Program owner");
    const list = getChangeRequests(inner);
    const cr = makeChangeRequest({ phaseId, title, reason, requestedBy });
    await persistState({ ...inner, changeRequests: [...list, cr] });
  }, [getGateReviewState, persistState]);

  // Approve or reject a logged change request. Approval reopens the target phase
  // AND every prior closed (gate-approved) phase — editing a closed phase
  // invalidates the closed phases it was built on, so the whole prior chain
  // reopens together. All of it lands in the SAME write so the request record and
  // the unlocked gates can never drift out of sync (a second write would race on a
  // stale snapshot). `orderedPhaseIds` is the programme's phase order, supplied by
  // the caller (the hook does not know phase ordering); without it the cascade
  // safely falls back to reopening just the target.
  const resolveChangeRequest = useCallback(async (
    id: string,
    decision: "approved" | "rejected",
    note?: string,
    orderedPhaseIds: string[] = [],
  ) => {
    const { inner, gateReviews } = getGateReviewState();
    const list = getChangeRequests(inner);
    const target = list.find((cr) => cr.id === id);
    if (!target || target.status !== "open") return;
    const decidedBy = await getCurrentUserDisplayName().catch(() => "Program owner");
    let nextInner: Record<string, unknown> = {
      ...inner,
      changeRequests: applyDecision(list, id, decision, decidedBy, note),
    };
    if (decision === "approved") {
      const approvedPhaseIds = Object.entries(gateReviews)
        .filter(([, review]) => review?.status === "approved")
        .map(([phaseId]) => phaseId);
      const phasesToReopen = phasesToReopenForChange(orderedPhaseIds, approvedPhaseIds, target.phaseId);
      nextInner = reopenPhasesInner(
        nextInner,
        phasesToReopen,
        `Change request approved: ${target.title}`,
        decidedBy,
      );
    }
    await persistState(nextInner);
  }, [getGateReviewState, persistState]);

  return {
    approveGate,
    requestRemediation,
    saveNote,
    reopenGate,
    resetPhase,
    raiseChangeRequest,
    resolveChangeRequest,
    isSaving,
  };
}
