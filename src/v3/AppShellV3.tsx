import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAgentRun } from "@/hooks/useAgentRun";
import { deleteProgramFromSupabase } from "@/lib/adamSync";
import { evaluateProactiveNudges } from "@/lib/adamCopilotProactive";
import { buildMemoryContext, saveAgentMemory } from "@/lib/adamAgentMemory";
import { runWalkthrough } from "@/lib/adamWalkthroughRunner";
import { WALKTHROUGH_PROGRAM } from "@/lib/adamWalkthroughScript";
import { buildAgentActivityMap, buildAgentCards } from "@/new/lib/programData";
import { ConflictError } from "@/new/lib/conflicts";
import { useAgentTriggers } from "@/new/lib/useAgentTriggers";
import { useBudgetTracking } from "@/new/lib/useBudgetTracking";
import { useClosure } from "@/new/lib/useClosure";
import { useDecisionQueue } from "@/new/lib/useDecisionQueue";
import { useRaidLog } from "@/new/lib/useRaidLog";
import { useEscalations } from "@/new/lib/useEscalations";
import { useGateReview } from "@/new/lib/useGateReview";
import { useMilestones } from "@/new/lib/useMilestones";
import { usePatternLibrary } from "@/new/lib/usePatternLibrary";
import { usePhaseProgress } from "@/new/lib/usePhaseProgress";
import { useProgramNotes } from "@/new/lib/useProgramNotes";
import { type ProgramSetupPatch, useProgramSetup } from "@/new/lib/useProgramSetup";
import { usePrograms } from "@/new/lib/usePrograms";
import { useProgramSnapshots } from "@/new/lib/useProgramSnapshots";
import { useCopilotThread } from "@/hooks/useCopilotThread";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { CopilotPanel } from "@/new/components/shell/CopilotPanel";
import type { AppView, DecisionSummary, Milestone, Persona, ProgramSummary } from "@/new/types";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import { buildCrossPhaseContext, recordAgentFeedback } from "@/lib/adamOrchestrator";
// Surfaces are code-split: only one renders at a time, so lazy-loading keeps
// them out of the initial shell chunk (see Suspense boundary around the layout).
const InsightFeedView = React.lazy(() => import("@/v3/surfaces/InsightFeedView"));
const ExecutiveView = React.lazy(() => import("@/v3/surfaces/ExecutiveView"));
const ProgrammeHealthView = React.lazy(() => import("@/v3/surfaces/ProgrammeHealthView"));
import CoPilotSidebar from "@/v3/components/CoPilotSidebar";
import AgentTraceDrawer from "@/v3/components/AgentTraceDrawer";
import { AIStatusBanner } from "@/v3/components/AIStatusBanner";
import { useAIStatus } from "@/v3/hooks/useAIStatus";
import { AdamErrorBoundary } from "@/v3/components/AdamErrorBoundary";
import { AgentSweepBar } from "@/v3/components/ui/AgentSweepBar";
import { CommandRail } from "@/v3/components/CommandRail";
import { CommandPalette } from "@/v3/components/CommandPalette";
import { ContextDrawer } from "@/v3/components/ContextDrawer";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { SkeletonShimmer } from "@/v3/components/ui/Skeleton";
import EscalationPanel from "@/v3/components/EscalationPanel";
import HelpPanel from "@/v3/components/HelpPanel";
import OnboardingCard from "@/v3/components/OnboardingCard";
import ProgramDetailRouter from "@/v3/components/ProgramDetailRouter";
import ProgramSetupWizard from "@/v3/components/ProgramSetupWizard";
import { reportError } from "@/lib/errorReporter";
import { sanitizeMarkdown } from "@/lib/sanitize";
import { changedInputFields, relatedArtifactsToStale, fieldsFeedingApprovedArtifacts } from "@/v3/lib/artifactStaleness";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { AGENT_ID_ALIASES } from "@/v3/lib/agentMeta";
import { useRelativeTimeTick } from "@/lib/useRelativeTimeTick";
import { useAgentCascadeToasts } from "@/v3/hooks/useAgentCascadeToasts";
import { useCriticalEventAlerts } from "@/v3/hooks/useCriticalEventAlerts";
import { useLocalProgramMigration } from "@/v3/hooks/useLocalProgramMigration";
import { usePhaseAgentState } from "@/v3/hooks/usePhaseAgentState";
import { useProgramValidation } from "@/v3/hooks/useProgramValidation";
import { getPhaseSequence, getPhaseDefinition, ATOS_STANDARD } from "@/v3/lib/methodology";
import { buildPhaseSchedule } from "@/v3/lib/phaseSchedule";
import { computePhaseReadiness, getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { confidenceRag, getGateThreshold } from "@/v3/lib/confidenceScore";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { artifactReviewFieldKey } from "@/v3/lib/artifactReview";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { buildFieldAssistPrompt, sanitiseFieldReply } from "@/v3/lib/fieldAssist";
import { PROVENANCE_KEY, mergeProvenance } from "@/new/lib/fieldProvenance";
import type { FieldAssistRequest } from "@/v3/components/PhaseInputsPanel";
const DecideView = React.lazy(() => import("@/v3/surfaces/DecideView"));
import GateReopenModal from "@/v3/components/GateReopenModal";
import RemediationNoteModal from "@/v3/components/RemediationNoteModal";
import PhaseDataOverwriteModal from "@/v3/components/PhaseDataOverwriteModal";
const MoreView = React.lazy(() => import("@/v3/surfaces/MoreView"));
const PipelineView = React.lazy(() => import("@/v3/surfaces/PipelineView"));
const PortfolioView = React.lazy(() => import("@/v3/surfaces/PortfolioView"));
const ProgramView = React.lazy(() => import("@/v3/surfaces/ProgramView"));
const StageView = React.lazy(() => import("@/v3/surfaces/StageView"));
import type { V3CommandMode, V3Mode, V3MoreView, V3ReportId, V3Surface } from "@/v3/types";
import { isDecisionOpen, phaseNameById, pushV3Toast } from "@/v3/utils";
import "@/new/styles.css";
import "./v3.css";

const LOCAL_PROGRAM_STORAGE_KEY = "brillio-adam-projects";
const CONTEXT_DRAWER_STORAGE_KEY = "adam_context_drawer";
const V3_THEME_STORAGE_KEY = "atlas-v3-theme";
const V3_COMMAND_RAIL_PINNED_KEY = "atlas-v3-command-rail-pinned";
const V3_COMMAND_RAIL_COLLAPSED_KEY = "atlas-v3-rail-collapsed";
const AUTH_RECOVERY_INTENT_STORAGE_KEY = "atlas-auth-recovery-intent";
const PROACTIVE_FIRED_STORAGE_KEY = "atlas-v3-proactive-fired";

// Persistent dedup for proactive (background) agent triggers. In-memory refs reset on
// every reload, which let the proactive onboarding/gate-coach agents re-fire on each
// page load — a major source of background AI volume that starves user generations.
// Persisting the "already fired" keys makes each proactive trigger fire at most once
// per (program, phase) ever, instead of once per browser session.
function hasProactiveFired(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(PROACTIVE_FIRED_STORAGE_KEY);
    if (!raw) return false;
    const fired = JSON.parse(raw) as unknown;
    return Array.isArray(fired) && fired.includes(key);
  } catch {
    return false;
  }
}

function markProactiveFired(key: string): void {
  try {
    const raw = window.localStorage.getItem(PROACTIVE_FIRED_STORAGE_KEY);
    const fired = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(fired) ? (fired as string[]) : [];
    if (!list.includes(key)) {
      list.push(key);
      // Cap the list so it can't grow unbounded across many programs/phases.
      window.localStorage.setItem(PROACTIVE_FIRED_STORAGE_KEY, JSON.stringify(list.slice(-300)));
    }
  } catch {
    /* storage unavailable — fall back to in-session behaviour */
  }
}

// Retired agent families. runProgramAgent short-circuits these ids at the single
// dispatch chokepoint so any residual auto-trigger, cascade hop, or stale call
// site becomes a no-op without unpicking the woven trigger logic.
const DISABLED_AGENTS = new Set<string>([
  "critical-path",
  "retro",
  "pattern-extract",
  "pattern-query",
  "twin-sync",
  "benchmark-comparator",
]);

const MORE_ROUTE_MAP: Record<string, V3MoreView> = {
  documents: "documents",
  narrative: "narrative",
  plan: "plan",
  milestones: "milestones",
  milestone: "milestones",
  risks: "risks",
  budget: "budget",
  "change-impact": "change-impact",
  changeimpact: "change-impact",
  stakeholders: "stakeholders",
  stakeholder: "stakeholders",
  health: "health",
  "health-heatmap": "health",
  "scope-pcr": "scope-pcr",
  intelligence: "intelligence",
  "ai-settings": "intelligence",
  "artifact-map": "artifact-map",
  "program-graph": "program-graph",
  graph: "program-graph",
  accelerators: "accelerators",
  "decision-audit": "decision-audit",
  access: "access",
  "closure-workspace": "closure",
};

const MORE_VIEW_PATHS: Record<V3MoreView, string> = {
  documents: "/documents",
  narrative: "/narrative",
  plan: "/plan",
  milestones: "/milestones",
  risks: "/risks",
  budget: "/budget",
  "change-impact": "/change-impact",
  stakeholders: "/stakeholders",
  health: "/health-heatmap",
  "scope-pcr": "/scope-pcr",
  intelligence: "/intelligence",
  "artifact-map": "/artifact-map",
  "program-graph": "/program-graph",
  accelerators: "/accelerators",
  access: "/access",
  "decision-audit": "/decision-audit",
  closure: "/closure-workspace",
};

const REPORT_PATHS: Record<V3ReportId, string> = {
  narrative: "/reports",
  deck: "/deck",
  status: "/program",
  closure: "/closure",
};

const APP_VIEW_TO_MORE_VIEW: Partial<Record<AppView, V3MoreView>> = {
  narrative: "narrative",
  plan: "plan",
  milestones: "milestones",
  risks: "risks",
  budget: "budget",
  "change-impact": "change-impact",
  stakeholders: "stakeholders",
  "health-heatmap": "health",
  "scope-pcr": "scope-pcr",
  intelligence: "intelligence",
  accelerators: "accelerators",
  "decision-audit": "decision-audit",
};

const DEFAULT_V3_MODE: V3Mode = "power";
// Lite is the default methodology for new programmes; standard covers all known phase IDs for URL routing
const DEFAULT_PHASE_SEQUENCE = getPhaseSequence("atos-lite");
const ALL_KNOWN_PHASE_IDS = getPhaseSequence("atos-standard");


function buildProgramSeed(name: string) {
  const now = new Date().toISOString();
  return {
    projectMeta: { name },
    objective: "",
    phases: DEFAULT_PHASE_SEQUENCE.map((id) => ({ id, pct: 0 })),
    phasePct: Object.fromEntries(DEFAULT_PHASE_SEQUENCE.map((id) => [id, 0])),
    _syncedAt: now,
  };
}

function generateProgramId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `program-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistLocalProgram(name: string): string {
  const id = generateProgramId();
  const now = new Date().toISOString();
  const payload = { id, name, client: "", industry: "", updatedAt: now, lastActiveAt: now, data: buildProgramSeed(name) };
  if (typeof localStorage !== "undefined") {
    const existing = JSON.parse(localStorage.getItem(LOCAL_PROGRAM_STORAGE_KEY) || "[]");
    const nextEntries = Array.isArray(existing) ? [payload, ...existing] : [payload];
    localStorage.setItem(LOCAL_PROGRAM_STORAGE_KEY, JSON.stringify(nextEntries));
  }
  return id;
}

function cloneRawProgram(program: ProgramSummary) {
  const wrapper = structuredClone(program.rawData || {}) as Record<string, unknown>;
  const { inner, usesNestedData } = getProgramState(wrapper);
  return {
    raw: wrapper,
    inner,
    commit(nextInner: Record<string, unknown>) {
      return wrapProgramState(wrapper, nextInner, usesNestedData);
    },
  };
}

/**
 * Whether a phase already holds work the planner would overwrite: an existing
 * AI-derived input/artifact schema, captured input values, or produced
 * artifacts. Used to decide whether closing the prior phase should prompt before
 * regenerating this (subsequent) phase's inputs and artifacts.
 */
function phaseHasExistingData(inner: Record<string, unknown>, phaseId: string): boolean {
  const store = getDynamicSchemaStore(inner);
  if ((store.inputFields?.[phaseId]?.length ?? 0) > 0) return true;
  if ((store.artifacts?.[phaseId]?.length ?? 0) > 0) return true;

  const phaseInputs = inner.phaseInputs;
  const inputBucket = typeof phaseInputs === "object" && phaseInputs !== null
    ? (phaseInputs as Record<string, unknown>)[phaseId]
    : undefined;
  if (typeof inputBucket === "object" && inputBucket !== null) {
    const hasValue = Object.entries(inputBucket as Record<string, unknown>).some(([key, value]) =>
      !key.startsWith("_") && value != null && String(value).trim() !== "");
    if (hasValue) return true;
  }

  const phaseArtifacts = inner.phaseArtifacts;
  const artifactBucket = typeof phaseArtifacts === "object" && phaseArtifacts !== null
    ? (phaseArtifacts as Record<string, unknown>)[phaseId]
    : undefined;
  if (typeof artifactBucket === "object" && artifactBucket !== null) {
    const hasArtifact = Object.values(artifactBucket as Record<string, unknown>).some((entry) =>
      typeof entry === "object" && entry !== null
      && Boolean((entry as Record<string, unknown>).content
        || (entry as Record<string, unknown>).status === "approved"
        || (entry as Record<string, unknown>).status === "produced"));
    if (hasArtifact) return true;
  }

  return false;
}

/**
 * Merge a freshly-saved phase-input bucket onto the persisted one. Plain fields
 * are overwritten last-write-wins; the `_provenance` metadata map is deep-merged
 * so a second document import keeps the source traceability the first recorded.
 */
function mergePhaseInputBucket(
  prevBucket: unknown,
  inputs: Record<string, string>,
): Record<string, unknown> {
  const prev = (typeof prevBucket === "object" && prevBucket !== null ? prevBucket : {}) as Record<string, unknown>;
  const mergedProvenance = mergeProvenance(prev[PROVENANCE_KEY], inputs[PROVENANCE_KEY]);
  const bucket: Record<string, unknown> = { ...prev, ...inputs, savedAt: new Date().toISOString() };
  if (mergedProvenance) bucket[PROVENANCE_KEY] = mergedProvenance;
  else delete bucket[PROVENANCE_KEY];
  return bucket;
}

type ShellToast = {
  id: string;
  message: string;
  icon?: string;
  tone?: "info" | "success" | "warning" | "error";
  action?: { label: string; onClick: () => void };
};

const MAX_VISIBLE_TOASTS = 3;
function parseLocation(): { surface: V3Surface; moreView: V3MoreView | null; activePhaseId: string | null; reportId: V3ReportId | null } {
  const path = typeof window !== "undefined" ? window.location.pathname.replace(/^\/+/, "") : "";
  if (path === "auth") return { surface: "stage", moreView: null, activePhaseId: null, reportId: null };
  if (!path || path === "home" || path === "today") return { surface: "insight-feed", moreView: null, activePhaseId: null, reportId: null };
  if (path === "stage") return { surface: "stage", moreView: null, activePhaseId: null, reportId: null };
  if (path === "pipeline" || path === "journey" || path === "work") return { surface: "pipeline", moreView: null, activePhaseId: null, reportId: null };
  if (path === "decide" || path === "decisions") return { surface: "decide", moreView: null, activePhaseId: null, reportId: null };
  if (path === "program") return { surface: "program", moreView: null, activePhaseId: null, reportId: "status" };
  if (path === "portfolio") return { surface: "portfolio", moreView: null, activePhaseId: null, reportId: null };
  if (path === "insight-feed" || path === "home" || path === "today") return { surface: "insight-feed", moreView: null, activePhaseId: null, reportId: null };
  if (path === "executive") return { surface: "executive", moreView: null, activePhaseId: null, reportId: null };
  if (path === "programme-health" || path === "health-programme") return { surface: "programme-health", moreView: null, activePhaseId: null, reportId: null };
  if (path === "oversight-v2") return { surface: "executive", moreView: null, activePhaseId: null, reportId: null };
  if (path === "governance-v2") return { surface: "programme-health", moreView: null, activePhaseId: null, reportId: null };
  if (path === "cockpit") return { surface: "stage", moreView: null, activePhaseId: null, reportId: null };
  if (path === "reports") return { surface: "program", moreView: null, activePhaseId: null, reportId: "narrative" };
  if (path === "deck") return { surface: "program", moreView: null, activePhaseId: null, reportId: "deck" };
  if (path === "closure") return { surface: "program", moreView: null, activePhaseId: null, reportId: "closure" };
  if (MORE_ROUTE_MAP[path]) return { surface: "program", moreView: MORE_ROUTE_MAP[path], activePhaseId: null, reportId: null };
  if ((ALL_KNOWN_PHASE_IDS as readonly string[]).includes(path)) return { surface: "stage", moreView: null, activePhaseId: path, reportId: null };
  return { surface: "insight-feed", moreView: null, activePhaseId: null, reportId: null };
}

function pathForState(surface: V3Surface, moreView: V3MoreView | null, activePhaseId: string | null, reportId: V3ReportId | null): string {
  if (surface === "program" && moreView) return MORE_VIEW_PATHS[moreView];
  if (surface === "program" && reportId && reportId !== "status") return REPORT_PATHS[reportId];
  if (surface === "stage" && activePhaseId) return `/${activePhaseId}`;
  if (surface === "pipeline") return "/pipeline";
  if (surface === "decide") return "/decide";
  if (surface === "program") return "/program";
  if (surface === "portfolio") return "/portfolio";
  if (surface === "insight-feed") return "/home";
  if (surface === "executive") return "/executive";
  if (surface === "programme-health") return "/programme-health";
  return "/";
}

// ─── Topbar Breadcrumb ────────────────────────────────────────────────────────

type BreadcrumbCrumb = { label: string; surface?: V3Surface };

const MORE_VIEW_LABELS: Partial<Record<string, string>> = {
  risks: "Risk & Issues",
  budget: "Budget",
  milestones: "Milestones",
  stakeholders: "Stakeholders",
  "change-impact": "Change Impact",
  health: "Health Dashboard",
  "scope-pcr": "Scope Changes",
  narrative: "Programme Narrative",
  plan: "Action Plan",
  documents: "Documents",
  "artifact-map": "Artifact Map",
  "program-graph": "Program Graph",
  accelerators: "Accelerators",
  access: "Access & Sharing",
  "decision-audit": "Decision Audit",
  intelligence: "AI Settings",
};

// Report screens are reached by drill-down from the Workspaces grid but are
// tracked via reportId (not moreView), so they need their own crumb labels.
// `status` is the default /program landing (the overview itself), so it has no
// drill-down crumb — only the deeper reports do.
const REPORT_CRUMB_LABELS: Partial<Record<V3ReportId, string>> = {
  narrative: "Narrative",
  deck: "Status Deck",
  closure: "Closure",
};

function TopbarBreadcrumb({
  surface,
  activePhaseLabel,
  moreView,
  reportId,
  onNavigate,
  onClearMoreView,
}: {
  surface: V3Surface;
  activePhaseLabel: string | null;
  moreView: string | null;
  reportId: V3ReportId | null;
  onNavigate: (s: V3Surface) => void;
  onClearMoreView: () => void;
}) {
  // Surface labels for context chip
  const surfaceLabel: Partial<Record<V3Surface, string>> = {
    "insight-feed": "Today",
    pipeline: "Delivery",
    portfolio: "Portfolio",
    "programme-health": "Programme Health",
    decide: "Action Center",
    executive: "Executive",
    stage: activePhaseLabel || "Phase",
    program: "Programme Overview",
  };

  const label = surfaceLabel[surface];

  // Single context chip — no deep breadcrumb chains
  if (surface === "insight-feed" || surface === "pipeline") return null;

  // Workspace drill-down: "Workspaces › Risk & Issues" (moreView) or
  // "Workspaces › Narrative" (report). Both are reached from the Workspaces grid.
  if (surface === "program" && (moreView || (reportId && REPORT_CRUMB_LABELS[reportId]))) {
    const drilldownLabel = moreView
      ? MORE_VIEW_LABELS[moreView] || moreView
      : REPORT_CRUMB_LABELS[reportId as V3ReportId];
    return (
      <nav className="v3-topbar-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="v3-topbar-breadcrumb-link" onClick={onClearMoreView}>
          Workspaces
        </button>
        <span className="v3-topbar-breadcrumb-sep" aria-hidden="true">›</span>
        <span className="v3-topbar-breadcrumb-current" aria-current="page">{drilldownLabel}</span>
      </nav>
    );
  }

  if (!label) return null;

  return (
    <nav className="v3-topbar-breadcrumb" aria-label="Breadcrumb">
      <span className="v3-topbar-breadcrumb-current" aria-current="page">{label}</span>
    </nav>
  );
}

function surfaceToCommandMode(surface: V3Surface): V3CommandMode {
  if (surface === "decide" || surface === "programme-health") return "governance";
  if (surface === "program" || surface === "executive") return "oversight";
  if (surface === "portfolio") return "portfolio";
  if (surface === "insight-feed") return "delivery";
  return "delivery";
}

function commandModeToSurface(mode: V3CommandMode, currentSurface: V3Surface): V3Surface {
  if (mode === "governance") return "programme-health";
  if (mode === "oversight") return "executive";
  if (mode === "portfolio") return "portfolio";
  if (mode === "delivery") {
    if (currentSurface === "pipeline" || currentSurface === "stage") return currentSurface;
    return "insight-feed";
  }
  if (currentSurface === "pipeline") return currentSurface;
  return "stage";
}

function BrandLogo() {
  return <img src="/brillio-logo.png" alt="Brillio" className="v3-topbar-logo" />;
}

function isAuthPath(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/auth";
}

function isRecoveryReturn(): boolean {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  return search.get("type") === "recovery" || hashParams.get("type") === "recovery";
}

function hasStoredRecoveryIntent(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTH_RECOVERY_INTENT_STORAGE_KEY) === "reset";
}

function setStoredRecoveryIntent(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) {
    window.localStorage.setItem(AUTH_RECOVERY_INTENT_STORAGE_KEY, "reset");
  } else {
    window.localStorage.removeItem(AUTH_RECOVERY_INTENT_STORAGE_KEY);
  }
}

function AuthScreen({
  configured,
  authed,
  onSignOut,
}: {
  configured: boolean;
  authed: boolean;
  onSignOut: () => Promise<void>;
}) {
  const recoverySignal = isRecoveryReturn() || hasStoredRecoveryIntent();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "reset">(recoverySignal ? "reset" : "signin");
  const [signInMethod, setSignInMethod] = useState<"password" | "magic">("password");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(() => recoverySignal);
  const [resetRequested, setResetRequested] = useState(false);

  useEffect(() => {
    if (!recoverySignal) return;
    setAuthMode("reset");
    setRecoveryReady(true);
    setMessage("Enter your new password below to finish resetting your account.");
  }, [recoverySignal]);

  useEffect(() => {
    if (!supabase) return undefined;
    const { data: listener } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") {
        setStoredRecoveryIntent(true);
        setAuthMode("reset");
        setRecoveryReady(true);
        setMessage("Enter your new password below to finish resetting your account.");
      }
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const handlePasswordSignIn = useCallback(async () => {
    if (!configured || !supabase) {
      setMessage("Cloud access is not configured in this local app yet.");
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage("Enter both your email and password to sign in.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) throw error;
      setMessage("Signed in successfully. Returning to the workspace…");
      pushV3Toast("Signed in successfully.", { tone: "success", duration: 3000 });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not sign in with password.";
      setMessage(nextMessage);
      pushV3Toast(nextMessage, { tone: "error", duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [configured, email, password]);

  const handlePasswordSignUp = useCallback(async () => {
    if (!configured || !supabase) {
      setMessage("Cloud access is not configured in this local app yet.");
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage("Enter both your email and password to create an account.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
      const { error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      setMessage("Account created. Check your email to confirm your account if required, then sign in.");
      pushV3Toast("Account created. Check your email for any confirmation step.", { tone: "success", duration: 5000 });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not create account.";
      setMessage(nextMessage);
      pushV3Toast(nextMessage, { tone: "error", duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [configured, email, password]);

  const handleEmailSignIn = useCallback(async () => {
    if (!configured || !supabase) {
      setMessage("Cloud access is not configured in this local app yet.");
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage("Enter your email to receive a magic sign-in link.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmedEmail,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setMessage("Check your inbox for the sign-in link, then come back here.");
      pushV3Toast("Magic link sent — check your email.", { tone: "success", duration: 4000 });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not start sign-in.";
      setMessage(nextMessage);
      pushV3Toast(nextMessage, { tone: "error", duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [configured, email]);

  const handlePasswordResetRequest = useCallback(async () => {
    if (!configured || !supabase) {
      setMessage("Cloud access is not configured in this local app yet.");
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage("Enter your email to receive a password reset link.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo });
      if (error) throw error;
      setStoredRecoveryIntent(true);
      setRecoveryReady(false);
      setResetRequested(true);
      setMessage("Password reset email sent. Open the link in your email, then return here to set a new password.");
      pushV3Toast("Password reset email sent.", { tone: "success", duration: 4000 });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not send password reset email.";
      setMessage(nextMessage);
      pushV3Toast(nextMessage, { tone: "error", duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [configured, email]);

  const handlePasswordResetConfirm = useCallback(async () => {
    if (!configured || !supabase) {
      setMessage("Cloud access is not configured in this local app yet.");
      return;
    }
    if (!password) {
      setMessage("Enter your new password to finish resetting your account.");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStoredRecoveryIntent(false);
      setPassword("");
      setRecoveryReady(false);
      setResetRequested(false);
      setAuthMode("signin");
      setMessage("Password updated successfully. You can now sign in with your new password.");
      pushV3Toast("Password updated successfully.", { tone: "success", duration: 4000 });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not update password.";
      setMessage(nextMessage);
      pushV3Toast(nextMessage, { tone: "error", duration: 5000 });
    } finally {
      setSubmitting(false);
    }
  }, [configured, password]);

  const inDedicatedRecoveryStep = authMode === "reset" && recoveryReady;

  const authTitle = (authed && !recoveryReady)
    ? "You’re signed in"
    : authMode === "signin"
      ? "Welcome back"
      : authMode === "signup"
        ? "Create your workspace access"
        : recoveryReady
          ? "Choose a new password"
          : "Reset your password";

  const authBody = configured
    ? (authed && !recoveryReady)
      ? "Your authenticated session is active. Return to the workspace to continue."
      : authMode === "signin"
        ? signInMethod === "password"
          ? "Use your work email and password to sign in directly."
          : "Use a secure email link if you prefer passwordless access."
        : authMode === "signup"
          ? "Create an account with email and password. Your project may require email confirmation before first access."
          : recoveryReady
            ? "Set a new password below to complete recovery for this account."
            : resetRequested
              ? "We’ve sent a recovery email. Open the newest link on this device to continue."
              : "Request a password reset email, then come back here from the recovery link to finish the reset."
    : "Cloud access is not configured yet in this local app. Add the required connection values in .env.local first.";

  return (
    <div className="v3-auth-gate">
      <div className="v3-auth-shell">
        <div className="v3-auth-gate-inner">
          <div className="v3-auth-kicker">Brillio</div>
          <div className="v3-auth-gate-logo">ATOS</div>
          <h1 className="v3-auth-gate-title">{authTitle}</h1>
          <p className="v3-auth-gate-body">{authBody}</p>

          {configured && (!authed || recoveryReady) ? (
            <div className="v3-auth-form">
              <div className="v3-auth-mode-meta">
                <span className="v3-auth-mode-chip">
                  {authMode === "signin"
                    ? signInMethod === "password" ? "Password sign in" : "Magic link"
                    : authMode === "signup"
                      ? "New account"
                      : recoveryReady ? "Recovery" : "Reset request"}
                </span>
                <span className="v3-auth-mode-note">
                  {authMode === "reset" && !recoveryReady
                    ? (resetRequested ? "Email sent" : "Step 1 of 2")
                    : authMode === "reset" && recoveryReady
                      ? "Final step"
                      : "Secure access"}
                </span>
              </div>
              {inDedicatedRecoveryStep ? (
                <div className="v3-auth-recovery-banner">
                  <div className="v3-auth-recovery-banner-title">Recovery in progress</div>
                  <div className="v3-auth-recovery-banner-body">
                    Set a new password below to regain access, then return to sign in with your updated credentials.
                  </div>
                </div>
              ) : (
                <div className="v3-auth-mode-toggle" role="tablist" aria-label="Authentication mode">
                  <button
                    type="button"
                    className={`v3-auth-mode-btn ${authMode === "signin" ? "is-active" : ""}`}
                    onClick={() => {
                      setAuthMode("signin");
                      setResetRequested(false);
                      setMessage(null);
                    }}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    className={`v3-auth-mode-btn ${authMode === "signup" ? "is-active" : ""}`}
                    onClick={() => {
                      setAuthMode("signup");
                      setResetRequested(false);
                      setMessage(null);
                    }}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    className={`v3-auth-mode-btn ${authMode === "reset" ? "is-active" : ""}`}
                    onClick={() => {
                      setStoredRecoveryIntent(false);
                      setAuthMode("reset");
                      setRecoveryReady(false);
                      setResetRequested(false);
                      setMessage(null);
                    }}
                  >
                    Reset
                  </button>
                </div>
              )}
              {authMode === "signin" ? (
                <>
                  <div className="v3-auth-submode-toggle" role="tablist" aria-label="Sign-in method">
                    <button
                      type="button"
                      className={`v3-auth-submode-btn ${signInMethod === "password" ? "is-active" : ""}`}
                      onClick={() => {
                        setSignInMethod("password");
                        setMessage(null);
                      }}
                    >
                      Password
                    </button>
                    <button
                      type="button"
                      className={`v3-auth-submode-btn ${signInMethod === "magic" ? "is-active" : ""}`}
                      onClick={() => {
                        setSignInMethod("magic");
                        setMessage(null);
                      }}
                    >
                      Magic link
                    </button>
                  </div>
                  <div className="v3-auth-field">
                    <label className="v3-auth-label" htmlFor="atlas-auth-email">Work email</label>
                    <input
                      id="atlas-auth-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@company.com"
                      className="v3-auth-input"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void (signInMethod === "password" ? handlePasswordSignIn() : handleEmailSignIn());
                        }
                      }}
                    />
                  </div>
                  {signInMethod === "password" ? (
                    <>
                      <div className="v3-auth-field">
                        <label className="v3-auth-label" htmlFor="atlas-auth-password">Password</label>
                        <div className="v3-auth-password-wrap">
                          <input
                            id="atlas-auth-password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="Enter your password"
                            className="v3-auth-input"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handlePasswordSignIn();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="v3-auth-reveal"
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-pressed={showPassword}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? "Hide" : "Show"}
                          </button>
                        </div>
                      </div>
                      <button type="button" className="v3-button primary" onClick={() => void handlePasswordSignIn()} disabled={submitting}>
                        {submitting ? "Signing in…" : "Sign in"}
                      </button>
                      <div className="v3-auth-inline-links">
                        <button
                          type="button"
                          className="v3-auth-text-link"
                          onClick={() => {
                            setAuthMode("reset");
                            setRecoveryReady(false);
                            setResetRequested(false);
                            setMessage(null);
                          }}
                        >
                          Forgot password?
                        </button>
                        <button
                          type="button"
                          className="v3-auth-text-link"
                          onClick={() => {
                            setSignInMethod("magic");
                            setMessage(null);
                          }}
                        >
                          Use magic link instead
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="v3-auth-helper-card">
                        A secure sign-in link will be emailed to you and will bring you back into this workspace.
                      </div>
                      <button type="button" className="v3-button primary" onClick={() => void handleEmailSignIn()} disabled={submitting}>
                        {submitting ? "Sending link…" : "Send magic link"}
                      </button>
                      <div className="v3-auth-inline-links">
                        <button
                          type="button"
                          className="v3-auth-text-link"
                          onClick={() => {
                            setSignInMethod("password");
                            setMessage(null);
                          }}
                        >
                          Use password instead
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : authMode === "signup" ? (
                <>
                  <div className="v3-auth-field">
                    <label className="v3-auth-label" htmlFor="atlas-auth-email">Work email</label>
                    <input
                      id="atlas-auth-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@company.com"
                      className="v3-auth-input"
                    />
                  </div>
                  <div className="v3-auth-field">
                    <label className="v3-auth-label" htmlFor="atlas-auth-password">Create password</label>
                    <div className="v3-auth-password-wrap">
                      <input
                        id="atlas-auth-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Choose a strong password"
                        className="v3-auth-input"
                      />
                      <button
                        type="button"
                        className="v3-auth-reveal"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-pressed={showPassword}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <div className="v3-auth-helper-card">
                    Use at least 8 characters. Some workspaces may ask you to confirm your email before first access.
                  </div>
                  <button type="button" className="v3-button primary" onClick={() => void handlePasswordSignUp()} disabled={submitting}>
                    {submitting ? "Creating account…" : "Create account"}
                  </button>
                </>
              ) : (
                <>
                  {!recoveryReady ? (
                    <>
                      <div className="v3-auth-field">
                        <label className="v3-auth-label" htmlFor="atlas-auth-email">Work email</label>
                        <input
                          id="atlas-auth-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="name@company.com"
                          className="v3-auth-input"
                        />
                      </div>
                      <div className="v3-auth-helper-card">
                        We’ll send a recovery link to this email. Open the newest link on this device to continue.
                      </div>
                      <button type="button" className="v3-button primary" onClick={() => void handlePasswordResetRequest()} disabled={submitting}>
                        {submitting ? "Sending reset email…" : (resetRequested ? "Resend reset email" : "Send reset email")}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="v3-auth-field">
                        <label className="v3-auth-label" htmlFor="atlas-auth-password">New password</label>
                        <div className="v3-auth-password-wrap">
                          <input
                            id="atlas-auth-password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="Choose a strong new password"
                            className="v3-auth-input"
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handlePasswordResetConfirm();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="v3-auth-reveal"
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-pressed={showPassword}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? "Hide" : "Show"}
                          </button>
                        </div>
                      </div>
                      <div className="v3-auth-helper-card">
                        This update will replace your old password for future sign-ins.
                      </div>
                      <button type="button" className="v3-button primary" onClick={() => void handlePasswordResetConfirm()} disabled={submitting}>
                        {submitting ? "Updating password…" : "Update password"}
                      </button>
                    </>
                  )}
                  <div className="v3-auth-inline-links">
                    <button
                      type="button"
                      className="v3-auth-text-link"
                      onClick={() => {
                        setStoredRecoveryIntent(false);
                        setAuthMode("signin");
                        setRecoveryReady(false);
                        setResetRequested(false);
                        setMessage(null);
                      }}
                      disabled={submitting}
                    >
                      {recoveryReady ? "Cancel recovery" : "Back to sign in"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {message ? <div className="v3-auth-feedback">{message}</div> : null}

          <div className="v3-auth-actions">
            {authed && !recoveryReady ? (
              <>
                <a href="/" className="v3-button ghost">
                  Back to workspace
                </a>
                <button
                  type="button"
                  className="v3-button ghost"
                  onClick={() => void onSignOut()}
                >
                  Sign out
                </button>
              </>
            ) : !recoveryReady ? (
              <a href="/" className="v3-button ghost">
                Back to workspace
              </a>
            ) : null}
          </div>
        </div>

        <aside className="v3-auth-sidecard">
          <div className="v3-auth-sidecard-topline">Workspace access</div>
          <h2 className="v3-auth-sidecard-title">
            {inDedicatedRecoveryStep
              ? "Complete recovery here, then return with your new password."
              : "One secure entry point for sign in, registration, and recovery."}
          </h2>
          <ul className="v3-auth-sidecard-list">
            {inDedicatedRecoveryStep ? (
              <>
                <li>Choose a strong password you have not recently used for this workspace.</li>
                <li>After saving, sign in again with the updated password.</li>
                <li>If the link expires, request a fresh recovery email from the reset flow.</li>
              </>
            ) : (
              <>
                <li>Email and password work directly in the preview.</li>
                <li>Magic link stays available if you prefer passwordless access.</li>
                <li>Password reset finishes here after the recovery email redirect.</li>
              </>
            )}
          </ul>
          <div className="v3-auth-sidecard-footer">
            <span className={`v3-auth-state-pill ${configured ? "is-ready" : "is-warning"}`}>
              {configured ? "Cloud ready" : "Setup required"}
            </span>
            {recoveryReady
              ? <span className="v3-auth-state-pill is-warning">Recovery mode</span>
              : authed ? <span className="v3-auth-state-pill is-ready">Signed in</span> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function AppShellV3() {
  useRelativeTimeTick();
  const initialRoute = useMemo(() => parseLocation(), []);
  const authRoute = isAuthPath();
  const [surface, setSurface] = useState<V3Surface>(initialRoute.surface);
  const [activeMode, setActiveMode] = useState<V3CommandMode>(surfaceToCommandMode(initialRoute.surface));
  const [moreView, setMoreView] = useState<V3MoreView | null>(initialRoute.moreView);
  const [decideIntent, setDecideIntent] = useState<{ tab: "blockers" | "risks" | "actions"; nonce: number; openAdd?: boolean } | null>(null);
  const [reportId, setReportId] = useState<V3ReportId | null>(initialRoute.reportId);
  const [activePhaseId, setActivePhaseId] = useState<string | null>(initialRoute.activePhaseId);
  const mode: V3Mode = DEFAULT_V3_MODE;
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(V3_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // Respect OS preference if no explicit choice stored
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const [intelligenceInitialTab, setIntelligenceInitialTab] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return window.location.pathname.replace(/^\/+/, "") === "ai-settings" ? "Setup" : undefined;
  });
  const [commandRailPinned, setCommandRailPinned] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(V3_COMMAND_RAIL_PINNED_KEY) === "true";
  });

  // Apply theme to <html> and persist
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(V3_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const toggleCommandRailPinned = useCallback(() => {
    setCommandRailPinned((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(V3_COMMAND_RAIL_PINNED_KEY, String(next));
      }
      return next;
    });
  }, []);

  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(V3_COMMAND_RAIL_COLLAPSED_KEY) === "true";
  });

  const toggleRailCollapsed = useCallback(() => {
    setRailCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(V3_COMMAND_RAIL_COLLAPSED_KEY, String(next));
      }
      return next;
    });
  }, []);

  const [wizardOpen, setWizardOpen] = useState(false);
  // When the wizard is opened immediately after creating a fresh programme,
  // this holds that draft's id so cancelling can discard it (rather than
  // leaving an empty "New Programme" behind). Cleared once setup is saved.
  const [draftProgramId, setDraftProgramId] = useState<string | null>(null);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [adamCopilotSidebarOpen, setAdamCopilotSidebarOpen] = useState(false);
  const [gateReopenPhase, setGateReopenPhase] = useState<string | null>(null);
  // When closing a phase whose next phase already holds data, the planner step
  // waits on this prompt: the resolver is fulfilled with the user's choice
  // (overwrite & recreate vs. keep existing) before any regeneration runs.
  const [overwritePrompt, setOverwritePrompt] = useState<
    { nextPhaseId: string; resolve: (overwrite: boolean) => void } | null
  >(null);
  const [remediationPhase, setRemediationPhase] = useState<string | null>(null);
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ShellToast[]>([]);
  const [programDropdownOpen, setProgramDropdownOpen] = useState(false);
  const [backendPanelOpen, setBackendPanelOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email?: string } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // True once we've resolved the signed-in user's id from the session (or
  // conclusively determined there's no session). Until this is true we must not
  // create/save programs, because an owner_id of null is rejected by RLS and
  // silently degrades to localStorage — the root cause of "history lost on relaunch".
  const [userResolved, setUserResolved] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [lastAuthEvent, setLastAuthEvent] = useState<string | null>(() => isRecoveryReturn() ? "PASSWORD_RECOVERY" : null);
  const [escalationPanelOpen, setEscalationPanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [taskStateVersion, setTaskStateVersion] = useState(0);
  const [contextDrawerOpen, setContextDrawerOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(CONTEXT_DRAWER_STORAGE_KEY) !== "false";
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const backendPanelRef = useRef<HTMLDivElement>(null);

  const backendStatus: "connected" | "local" | "config-missing" = !isSupabaseConfigured
    ? "config-missing"
    : authed
      ? "connected"
      : "local";

  const migrated = useLocalProgramMigration(userId);
  const { programs, activeProgram, activeProgramId, setActiveProgramId, refreshPrograms, hydratePrograms, updateProgramData, resolveDecision, isLoading: programsLoading, hasResolvedPrograms, activeProgramRole, canEditActiveProgram, isActiveProgramAdmin } = usePrograms({
    enabled: authChecked && migrated,
    userId,
  });
  const { activeRuns, isRunning: agentIsRunning, isUserRunning: agentIsUserRunning, runAgent, channelStatus } = useAgentRun(activeProgramId, authed, refreshPrograms);
  const { snapshots: programSnapshots, createSnapshot: createProgramSnapshot, getSnapshotData: getProgramSnapshotData } = useProgramSnapshots(activeProgramId || null, { enabled: authChecked && migrated });
  const aiStatus = useAIStatus(true); // status check works without auth since edge function accepts anon key
  const agentCards = useMemo(() => buildAgentCards(activeProgram, activeRuns), [activeProgram, activeRuns]);
  const agentActivityMap = useMemo(() => buildAgentActivityMap(activeRuns), [activeRuns]);
  const rawData = useMemo(() => activeProgram?.rawData || {}, [activeProgram?.rawData]);

  // Portfolio shows rich per-programme data (phase dots, RAG, open actions) for the
  // WHOLE list, so it needs every programme's full blob — the only surface that
  // does. The metadata-only list path leaves non-active programmes unhydrated, so
  // hydrate them on demand when Portfolio opens. hydratePrograms is a no-op once
  // all are fresh, so the repeat caused by `programs` changing identity is cheap.
  useEffect(() => {
    if (surface !== "portfolio" || programs.length === 0) return;
    void hydratePrograms(programs.map((p) => p.id));
  }, [surface, programs, hydratePrograms]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setBackendPanelOpen(false);
      setProgramDropdownOpen(false);
      setCurrentUser(null);
      setUserId(null);
      setAuthed(false);
      // Clear programme context so the next user doesn't inherit stale state
      setActiveProgramId(null);
      setActivePhaseId(null);
      setMoreView(null);
      setSurface("insight-feed");
      setReportId(null);
      setLastAuthEvent("SIGNED_OUT");
      pushV3Toast("Signed out successfully.", { tone: "success", duration: 3000 });
      if (typeof window !== "undefined" && window.location.pathname !== "/auth") {
        window.location.href = "/auth";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sign out.";
      pushV3Toast(message, { tone: "error", duration: 5000 });
    }
  }, []);

  // Update document title to reflect active programme
  useEffect(() => {
    const name = activeProgram?.name;
    document.title = name ? `${name} — ATOS` : "Brillio ATOS — Agentic Transformation OS";
  }, [activeProgram?.name]);

  const nudges = useMemo(() => {
    if (!activeProgram) return [];
    return evaluateProactiveNudges(activeProgram);
  }, [activeProgram]);
  const firstNudge = useMemo(() => {
    const nudge = nudges[0];
    if (!nudge) return null;
    return {
      id: nudge.id || "nudge-0",
      type: nudge.type,
      priority: nudge.priority,
      message: nudge.message,
      actionLabel: nudge.actionLabel || "View →",
      actionView: (nudge.actionViewId as AppView | undefined) || undefined,
    };
  }, [nudges]);
  const persona = useMemo((): Persona => {
    if (surface === "decide") return "lead";
    if (surface === "program") return "executive";
    return "fde";
  }, [surface]);
  const copilotWorkspaceId = useMemo((): string => {
    if (surface === "decide") return "decisions";
    if (surface === "program") return moreView || "home";
    if (surface === "pipeline") return "work";
    return "home";
  }, [surface, moreView]);

  const resolveAgentId = useCallback((agentId: string) => {
    const aliases: Record<string, string> = {
      "portfolio-intelligence": "health-heatmap",
      "steerco-prep": "steerco-agenda-builder",
    };
    // UI-action aliases win; otherwise fall back to the registry's artifact-id
    // synonym map (e.g. "risk-log" → "risk") so any path that passes a raw
    // dynamic-artifact synonym still resolves to a valid producing agent.
    return aliases[agentId] || AGENT_ID_ALIASES[agentId] || agentId;
  }, []);

  // When the AI provider rate-limits us (HTTP 429), background/proactive agents
  // keep firing and failing, consuming the scarce provider budget so user-initiated
  // generations get starved. We park a short cooldown after any 429 and suppress
  // proactive auto-triggers during it, reserving the provider for explicit user actions.
  const rateLimitCooldownUntilRef = useRef<number>(0);
  const RATE_LIMIT_COOLDOWN_MS = 3 * 60 * 1000;

  const runProgramAgent = useCallback(async ({
    agentId,
    phaseId,
    triggeredBy,
    decisionId,
    documentId,
    docText,
    audienceGroup,
    meetingDate,
    meetingDurationMins,
    skipPreSync,
    regenGuidance,
  }: {
    agentId: string;
    phaseId: string;
    triggeredBy: "user" | "trigger" | "proactive";
    decisionId?: string;
    documentId?: string;
    docText?: string;
    audienceGroup?: "executive" | "operational" | "all";
    meetingDate?: string;
    meetingDurationMins?: number;
    // Quality-review suggestions folded into the generation prompt so a single
    // Regenerate applies them directly — no separate input-rewrite LLM round trip.
    regenGuidance?: string;
    // Caller has already persisted fresh program data; skip the pre-sync upsert
    // so it can't clobber that write with a stale closure snapshot.
    skipPreSync?: boolean;
  }) => {
    if (!activeProgramId) return;

    // Guard: retired agents. These agent families (legacy critical-path
    // scheduling, retrospective generation, pattern mining/query, digital-twin
    // sync, benchmark comparison) were removed from the product surface. The
    // chokepoint guard short-circuits any residual auto-trigger or stale call
    // site rather than threading the removal through every woven cascade.
    if (DISABLED_AGENTS.has(agentId)) return;

    // Guard: not signed in — agents require an authenticated session
    if (!authed) {
      pushV3Toast("Sign in to use AI agents.", { tone: "warning", duration: 5000 });
      return;
    }

    // Guard: read-only access — viewers cannot run agents (which mutate the program)
    if (!canEditActiveProgram) {
      pushV3Toast("You have read-only access to this programme and cannot run agents.", { tone: "warning", duration: 6000 });
      return;
    }

    // Guard: AI not connected — block only on definitive negative states.
    // "checking" (cold mount before the first status poll) and "error" (edge
    // cold-start or a transient network blip) are NOT proof of a missing key, so
    // they must not block a user who is actually configured. The edge call below
    // validates the key and surfaces a real error if it's genuinely absent.
    if (aiStatus && (aiStatus.status === "not-configured" || aiStatus.status === "offline")) {
      pushV3Toast("AI is not connected. Open AI Settings to add a provider key.", {
        tone: "warning",
        duration: 6000,
        action: { label: "AI Settings →", onClick: openAISettings },
      });
      return;
    }

    const resolvedAgentId = resolveAgentId(agentId);
    let crossPhaseContext = buildCrossPhaseContext(activeProgramId, phaseId);
    // Append the artifact's stored quality-review suggestions to the prompt context.
    // The edge function folds crossPhaseContext into prompt.system, so the model
    // applies these improvements directly in the regenerated artifact — collapsing
    // the old "improve quality → rewrite inputs → regenerate" loop into one run.
    if (regenGuidance && regenGuidance.trim()) {
      crossPhaseContext += `${crossPhaseContext ? "\n\n" : ""}## Reviewer improvements to apply in this regeneration\n${regenGuidance.trim()}`;
    }

    // Strategic-roadmap dates: the agent's prompt asks it to BOTH distribute the
    // phases across the programme window AND mark unknown dates "TBD", so it punts
    // every intermediate boundary to TBD even though the start/target-end dates are
    // known. Splitting a fixed window across an ordered phase list is arithmetic, not
    // judgement, so we compute it deterministically and hand the agent authoritative
    // per-phase ETAs (which its prompt already says to anchor to). No deploy needed —
    // crossPhaseContext is folded into prompt.system by the edge function.
    if (resolvedAgentId === "strategic-roadmap") {
      const inner = getProgramState(activeProgram?.rawData || {}).inner;
      const phaseInputs = inner.phaseInputs;
      const strategyInputs = typeof phaseInputs === "object" && phaseInputs !== null
        ? (phaseInputs as Record<string, unknown>).strategy as Record<string, unknown> | undefined
        : undefined;
      const startDate = typeof strategyInputs?.startDate === "string" ? strategyInputs.startDate : undefined;
      const targetEndDate = typeof strategyInputs?.targetEndDate === "string" ? strategyInputs.targetEndDate : undefined;
      const phaseWeights = (activeProgram?.phases || []).map((phase) => {
        const def = getPhaseDefinition(phase.id);
        const weight = def ? (def.typicalDurationWeeks.min + def.typicalDurationWeeks.max) / 2 : 1;
        return { id: phase.id, weight };
      });
      const schedule = buildPhaseSchedule(startDate, targetEndDate, phaseWeights);
      if (schedule.length > 0) {
        const lines = schedule
          .map((entry) => `- ${getPhaseDefinition(entry.id)?.displayName ?? entry.id}: ${entry.start} → ${entry.end}`)
          .join("\n");
        crossPhaseContext += `${crossPhaseContext ? "\n\n" : ""}## Authoritative phase schedule — use these exact dates\nThe programme window is fixed (${startDate} → ${targetEndDate}). Use these computed per-phase start/end dates verbatim as each phase's start and end. Do NOT mark any of them "TBD":\n${lines}`;
      }
    }

    try {
      // Ensure the programme exists in Supabase before calling the edge function.
      // Local-only programmes (localStorage-only) will fail the edge function lookup.
      // We always upsert (not just on missing row) so that data stays current.
      // rawData may be {} if it was previously synced from an empty Supabase row,
      // so fall back to reading the raw entry directly from localStorage.
      //
      // This runs as runAgent's `preflight`, so the optimistic "Generating…" button
      // state is already showing while this (sometimes slow) sync completes — the
      // user sees instant feedback instead of a dead button until the upsert returns.
      const preflight = async () => {
        if (skipPreSync || !isSupabaseConfigured || !supabase || !activeProgram || !userId) return;
        let programData: Record<string, unknown> = activeProgram.rawData || {};
        if (Object.keys(programData).length === 0 && typeof localStorage !== "undefined") {
          const LEGACY_KEYS = ["brillio-adam-projects", "brillio-atlas-projects"];
          for (const storageKey of LEGACY_KEYS) {
            try {
              const entries = JSON.parse(localStorage.getItem(storageKey) || "[]") as unknown[];
              const entry = entries.find((e) => typeof e === "object" && e !== null && (e as Record<string, unknown>).id === activeProgramId) as Record<string, unknown> | undefined;
              if (entry) {
                programData = (typeof entry.data === "object" && entry.data !== null ? entry.data : entry) as Record<string, unknown>;
                break;
              }
            } catch {
              // ignore parse errors for individual keys
            }
          }
        }
        const { error: syncError } = await supabase.from("adam_programs").upsert(
          {
            id: activeProgramId,
            name: activeProgram.name,
            client: activeProgram.client || null,
            industry: activeProgram.industry || null,
            owner_id: userId,
            data: programData as unknown as Json,
            is_deleted: false,
          },
          { onConflict: "id", ignoreDuplicates: false },
        );
        if (syncError) {
          // The full-blob upsert can exceed Postgres's statement timeout once a
          // programme's `data` JSONB has grown large (code 57014). That write only
          // exists to guarantee the row exists before the edge function reads it —
          // and the debounced autosave already keeps the cloud copy current. So if
          // the row already exists, a slow/timed-out pre-sync must NOT hard-block
          // the agent run: fall back to a cheap existence check and proceed. Only a
          // genuinely missing row (local-only programme) is a real blocker.
          const { data: existing, error: existsError } = await supabase
            .from("adam_programs")
            .select("id")
            .eq("id", activeProgramId)
            .maybeSingle();
          if (existsError || !existing) {
            throw new Error(`Could not sync programme to cloud before running agent: ${syncError.message}`);
          }
        }
      };
      await runAgent({
        agentId: resolvedAgentId,
        phaseId,
        triggeredBy,
        crossPhaseContext,
        decisionId,
        documentId,
        docText,
        audienceGroup,
        meetingDate,
        meetingDurationMins,
        preflight,
      });
      saveAgentMemory({
        agentId: resolvedAgentId,
        phaseId,
        programId: activeProgramId,
        timestamp: new Date().toISOString(),
        type: "artifact_outcome",
        summary: `${resolvedAgentId} completed for ${phaseId}`,
        outcome: "accepted",
        confidence: 0.8,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Agent run failed";
      const isRateLimit = /rate limit|temporarily busy|429|too many requests/i.test(message);
      if (isRateLimit) {
        // Park the cooldown so background agents stop competing for the throttled budget.
        rateLimitCooldownUntilRef.current = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      }
      if (typeof window === "undefined" || window.location.pathname !== "/auth") {
        const isKeyError = /api key|not configured|isOlderThan|connect your|connect a provider/i.test(message);
        const isAuthError = /jwt|invalid.*token|unauthorized|not authenticated|malformed/i.test(message);
        const isNotDeployed = /not deployed|edge function/i.test(message);
        if (isRateLimit) {
          pushV3Toast("AI is rate-limited right now — wait a moment, then try again. Background updates are paused to free up capacity.", {
            tone: "warning",
            duration: 7000,
          });
        } else if (isAuthError) {
          pushV3Toast("Sign in to use AI agents.", { tone: "warning", duration: 5000 });
        } else if (isNotDeployed) {
          pushV3Toast("Agent service not available in this environment.", { tone: "warning", duration: 6000 });
        } else if (isKeyError) {
          aiStatus.recheck(); // invalidate cached status
          pushV3Toast("AI provider is not connected. Check your API key in AI Settings.", {
            tone: "error",
            duration: 7000,
            action: { label: "AI Settings →", onClick: openAISettings },
          });
        } else {
          pushV3Toast(`Agent failed: ${message}`, { tone: "error", duration: 5000 });
        }
      }
    } finally {
      await refreshPrograms();
    }
  }, [activeProgramId, activeProgram, userId, canEditActiveProgram, refreshPrograms, resolveAgentId, runAgent]);

  // Single shared run-agent handler for every surface (Cycle 7 dedup). Surfaces
  // may pass an explicit phaseId; otherwise we fall back to the active phase,
  // then the "program"-level bucket.
  const handleRunAgent = useCallback(
    (agentId: string, phaseId?: string, guidance?: string) =>
      void runProgramAgent({ agentId, phaseId: phaseId || activePhaseId || "program", triggeredBy: "user", regenGuidance: guidance }),
    [runProgramAgent, activePhaseId],
  );

  const { addMilestone, completeMilestone, isSaving: milestoneSavePending } = useMilestones(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  const { saveBudgetInputs, isSaving: budgetSavePending } = useBudgetTracking(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  useClosure(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  const { approveGate, requestRemediation, reopenGate } = useGateReview(activeProgramId || "", rawData, refreshPrograms);
  const { acknowledgeEscalation, resolveEscalation } = useEscalations(activeProgramId || "", rawData, refreshPrograms);
  const { addNote: addProgramNote } = useProgramNotes(activeProgramId || "", rawData, refreshPrograms);
  const { addDecision } = useDecisionQueue(activeProgramId || "", rawData, refreshPrograms);
  const { addEntry: addRaidEntry, closeEntry: closeRaidEntry } = useRaidLog(activeProgramId || "", rawData, refreshPrograms);
  const { updatePct: updatePhasePct } = usePhaseProgress(activeProgramId || "", rawData, refreshPrograms);
  const { save: saveSetup, isSaving: wizardSaving } = useProgramSetup(activeProgramId || "", rawData, refreshPrograms);
  const industry = useMemo(() => {
    const meta = typeof rawData === "object" && rawData !== null && typeof rawData.projectMeta === "object" && rawData.projectMeta !== null
      ? rawData.projectMeta as Record<string, unknown>
      : {};
    return typeof meta.industry === "string" ? meta.industry : null;
  }, [rawData]);
  const { patterns, refresh: refreshPatterns } = usePatternLibrary(activeProgramId || "", industry);
  const { sanity, validation, hasBlockers, warningCount } = useProgramValidation(activeProgram);
  const copilotMemoryContext = useMemo(() => {
    if (!activeProgramId) return "";
    return ["narrative", "plan", "risk"]
      .map((agentId) => buildMemoryContext(agentId, activeProgramId))
      .filter(Boolean)
      .join("\n");
  }, [activeProgramId, activeRuns]);

  const { sendMessage: sendCopilotMessage } = useCopilotThread(
    activeProgramId || "",
    copilotWorkspaceId,
    copilotMemoryContext,
  );

  const triggers = useAgentTriggers({
    programId: activeProgramId,
    authed,
    activePhaseId,
    rawData,
    activeRuns,
    onRunAgent: runProgramAgent,
    onInvalidate: refreshPrograms,
    narrativeGeneratedAt: activeProgram?.narrativeGeneratedAt || null,
    planGeneratedAt: activeProgram?.planGeneratedAt || null,
    raidGeneratedAt: activeProgram?.raidGeneratedAt || null,
    milestonesGeneratedAt: activeProgram?.milestonesGeneratedAt || null,
    budgetGeneratedAt: activeProgram?.budgetGeneratedAt || null,
    criticalPathGeneratedAt: activeProgram?.criticalPathGeneratedAt || null,
    changeImpactGeneratedAt: activeProgram?.changeImpactGeneratedAt || null,
    stakeholderGeneratedAt: activeProgram?.stakeholderGeneratedAt || null,
    adoptionGeneratedAt: activeProgram?.adoptionGeneratedAt || null,
    healthHeatmapGeneratedAt: activeProgram?.healthHeatmapGeneratedAt || null,
    retrosGeneratedAt: activeProgram?.retrosGeneratedAt || {},
    deckGeneratedAt: activeProgram?.deckGeneratedAt || null,
    scopePcrGeneratedAt: activeProgram?.scopePcrGeneratedAt || null,
    patternExtractGeneratedAt: activeProgram?.patternExtractGeneratedAt || null,
    patternQueryCachedAt: activeProgram?.patternQueryCachedAt || null,
    gateReviews: activeProgram?.gateReviews || {},
    escalationsLastCheckedAt: activeProgram?.escalationsLastCheckedAt || null,
    closureGeneratedAt: activeProgram?.closureGeneratedAt || null,
    phases: activeProgram?.phases || [],
    raidEntries: activeProgram?.raidEntries || [],
    milestones: activeProgram?.milestones || [],
    decisions: activeProgram?.decisionQueue || [],
    closure: activeProgram?.closure || null,
  });

  // Why agents can / cannot generate artifacts — the three preconditions, checked
  // in the same order runProgramAgent enforces them, so the ledger names the exact blocker.
  const anyAgentRunning = agentIsRunning || triggers.escalationIsRunning;
  // Three-state rail indicator: running (working) → idle (at rest, ready) →
  // stopped (a recent run ended abnormally — failed/cancelled — within the
  // hook's terminal-run retention window, so it surfaces as needing attention).
  const agentStatus: "running" | "idle" | "stopped" = anyAgentRunning
    ? "running"
    : activeRuns.some((run) => run.status === "failed" || run.status === "cancelled")
    ? "stopped"
    : "idle";
  // For agent-run buttons (ExecutiveView etc.): only block when the *user* triggered a run,
  // not when a background / proactive agent is sitting in the DB in "queued"/"running" state.
  // agentIsUserRunning === isLoading, which is true only during the runAgent() HTTP call itself
  // and resets in the finally block — never gets stuck regardless of DB run state.
  const anyUserAgentRunning = agentIsUserRunning;
  const showConnectionStatus = !authRoute && authed && !!activeProgramId && channelStatus !== "connected";
  const openDecisions = useMemo(() => (activeProgram?.decisionQueue || []).filter(isDecisionOpen), [activeProgram?.decisionQueue]);
  // Rail badge count for the Action Center. Mirrors the surface's own derivation
  // (synthesised recommended actions for the delivery-lead persona it renders
  // with) so "N awaiting you" matches what the user sees when they open it —
  // distinct from openDecisions, which counts persisted decisions for the
  // confidence model and must stay untouched.
  const actionCenterCount = useMemo(() => deriveOpenRecommendedActions(activeProgram, "delivery_lead").length, [activeProgram]);
  // ── Unified confidence score (Priority 1) ────────────────────────────────────
  // Replaces the old inline weighted average with the full multi-signal model
  // from confidenceScore.ts. This is the single authoritative score used for
  // the rail badge, programme health RAG, and gate approval eligibility checks.
  const programConfidenceResult = useMemo(() => {
    if (!activeProgram) return null;
    // Single source of truth — same derivation now reused by Portfolio cards and
    // the Programme health KPI, so the active program's score here matches what
    // every other surface shows for it. (rawData/openDecisions are derived from
    // activeProgram inside the helper; listed here only to track recomputation.)
    return deriveProgramConfidence(activeProgram, activePhaseId);
  }, [activeProgram, activePhaseId, rawData, openDecisions]);

  const programConfidenceScore = programConfidenceResult?.score ?? null;
  const programHealth = useMemo(() => {
    const score = programConfidenceScore;
    // null → "amber" preserves the rail badge's long-standing neutral-pending
    // tone; a scored program routes through the canonical confidence→RAG band.
    const programmeRag = score == null ? "amber" : confidenceRag(score);
    // The rail dot only renders green/amber/red; collapse the "muted" band onto
    // the neutral-pending amber tone (same intent as the score==null branch).
    const programme = programmeRag === "muted" ? "amber" : programmeRag;
    const ai = aiStatus.status === "connected" ? "green" : aiStatus.status === "checking" ? "amber" : "red";
    const escalationCount = (activeProgram?.escalations || []).filter((e: any) => e.status === "open").length;
    const aiNotReady = aiStatus.status !== "connected" && aiStatus.status !== "checking";
    // Red is reserved for a genuinely unavailable AI layer. Open escalations and
    // decisions are "needs attention", not "broken" — they route to amber so the
    // dot doesn't read as an AI fault when the intelligence layer is healthy.
    const agents = aiNotReady ? "red"
      : anyAgentRunning ? "green"
      : escalationCount > 0 || openDecisions.length > 0 ? "amber"
      : "green";
    return { programme, ai, agents } as const;
  }, [programConfidenceScore, aiStatus.status, anyAgentRunning, activeProgram?.escalations, openDecisions.length]);

  const lockedPhaseIds = useMemo(
    () => activeProgram ? getLockedPhaseIds(activeProgram) : new Set<string>(),
    [activeProgram],
  );
  const isProgramEmpty = useMemo(() => {
    if (!activeProgram) return false;
    return (
      !activeProgram.objective &&
      (!activeProgram.name || activeProgram.name === "New Program" || activeProgram.name === "New Programme") &&
      activeProgram.phases.every((phase) => (phase.pct ?? 0) === 0)
    );
  }, [activeProgram]);
  const openEscalations = useMemo(() => (activeProgram?.escalations || []).filter((entry) => entry.status === "open"), [activeProgram?.escalations]);
  const narrativeIsRunning = activeRuns.some((run) => run.agent_id === "narrative" && run.status === "running");
  const healthHeatmapIsRunning = activeRuns.some((run) => run.agent_id === "health-heatmap" && run.status === "running") || triggers.healthHeatmapIsRunning;
  const { tasks: currentPhaseTasks, updateTask: updatePhaseTask, refresh: refreshPhaseTasks } = usePhaseAgentState(activeProgramId, activePhaseId);

  useAgentCascadeToasts(activeRuns);
  useCriticalEventAlerts(activeProgram);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; icon?: string; tone?: ShellToast["tone"]; duration?: number; action?: { label: string; onClick: () => void } }>).detail;
      if (!detail?.message) return;
      const message = detail.message;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => {
        if (current.some((toast) => toast.message === message && toast.tone === detail.tone)) {
          return current;
        }
        return [...current, { id, message, icon: detail.icon, tone: detail.tone, action: detail.action }].slice(-MAX_VISIBLE_TOASTS);
      });
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, detail.duration ?? 4000);
    };

    window.addEventListener("atlas-v3-toast", handleToast);
    return () => window.removeEventListener("atlas-v3-toast", handleToast);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthed(false);
      setAuthChecked(true);
      return undefined;
    }

    let settled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!settled) {
        setAuthChecked(true);
        // Don't strand the render gate waiting on a session that never resolved.
        setUserResolved(true);
      }
    }, 2500);

    // Derive the user id directly from the session so it resolves atomically
    // with `authed` — eliminating the race where the workspace rendered (and
    // could create/save programs) before a separate getUser() call resolved.
    const applySession = (session: { user?: { id: string; email?: string } | null } | null) => {
      const user = session?.user ?? null;
      setAuthed(!!session);
      setUserId(user?.id ?? null);
      setCurrentUser(user ? { id: user.id, email: user.email } : null);
      setUserResolved(true);
      setAuthChecked(true);
    };

    void supabase.auth.getSession().then(({ data }: { data: { session: { user?: { id: string; email?: string } | null } | null } }) => {
      settled = true;
      window.clearTimeout(fallbackTimer);
      applySession(data.session);
    }).catch(() => {
      settled = true;
      window.clearTimeout(fallbackTimer);
      applySession(null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event: string, session: { user?: { id: string; email?: string } | null } | null) => {
      settled = true;
      window.clearTimeout(fallbackTimer);
      setLastAuthEvent(event);
      applySession(session);
    });

    return () => {
      window.clearTimeout(fallbackTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      // No backend: nothing to resolve, let the local-only flow proceed.
      setUserId(null);
      setCurrentUser(null);
      setUserResolved(true);
    }
    // When Supabase is configured, userId/currentUser are derived from the
    // session in the auth-state effect above (atomic with `authed`).
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authChecked) return;
    if (!authed) return;
    if (lastAuthEvent === "PASSWORD_RECOVERY") return;
    if (window.location.pathname === "/auth") {
      window.history.replaceState({}, "", "/");
      const next = parseLocation();
      setSurface(next.surface);
      setActiveMode(surfaceToCommandMode(next.surface));
      setMoreView(next.moreView);
      setActivePhaseId(next.activePhaseId);
      setReportId(next.reportId);
    }
  }, [authChecked, authed, lastAuthEvent]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-density", "compact");
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (authRoute || !authed) {
      setToasts((current) => current.filter((toast) => !toast.message.startsWith("Agent failed:")));
    }
  }, [authChecked, authed, authRoute]);

  const handleDrawerToggle = useCallback(() => {
    setContextDrawerOpen((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CONTEXT_DRAWER_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const lastLandedProgramIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProgram) return;
    // Phase ids are shared across programmes, so a stale phase from the previous
    // programme stays "valid" and would otherwise be kept. Always land on the new
    // programme's frontier phase when the active programme changes.
    const programChanged = lastLandedProgramIdRef.current !== activeProgramId;
    lastLandedProgramIdRef.current = activeProgramId;
    const validCurrent = activeProgram.phases.some((phase) => phase.id === activePhaseId);
    if (validCurrent && !programChanged) return;
    // Prefer the canonical active phase so the landing phase matches what every
    // surface labels "Active phase"; fall back to the pct-based frontier.
    const canonical = activeProgram.activePhaseId;
    const canonicalValid = canonical && activeProgram.phases.some((phase) => phase.id === canonical);
    const inProgress = activeProgram.phases.find((phase) => (phase.pct ?? 0) > 0 && (phase.pct ?? 0) < 100);
    const firstIncomplete = activeProgram.phases.find((phase) => (phase.pct ?? 0) < 100);
    setActivePhaseId((canonicalValid ? canonical : null) || inProgress?.id || firstIncomplete?.id || activeProgram.phases[0]?.id || null);
  }, [activeProgramId, activePhaseId, activeProgram]);

  useEffect(() => {
    if (!activeProgram) return;
    const isEmpty =
      (!activeProgram.name || activeProgram.name === "New Program" || activeProgram.name === "New Programme") &&
      !activeProgram.objective &&
      activeProgram.phases.every((phase) => (phase.pct ?? 0) === 0);
    if (isEmpty) setWizardOpen(true);
  }, [activeProgram?.id]);

  const commitNavigation = useCallback((next: {
    surface: V3Surface;
    moreView?: V3MoreView | null;
    activePhaseId?: string | null;
    reportId?: V3ReportId | null;
    replace?: boolean;
  }) => {
    const nextMoreView = next.moreView ?? null;
    const nextActivePhaseId = next.activePhaseId ?? activePhaseId;
    const nextReportId = next.reportId ?? null;
    setSurface(next.surface);
    setActiveMode(surfaceToCommandMode(next.surface));
    setMoreView(nextMoreView);
    setActivePhaseId(nextActivePhaseId);
    setReportId(nextReportId);
    if (typeof window !== "undefined") {
      const nextPath = pathForState(next.surface, nextMoreView, nextActivePhaseId, nextReportId);
      const method = next.replace ? "replaceState" : "pushState";
      window.history[method]({}, "", nextPath);
    }
  }, [activePhaseId]);

  useEffect(() => {
    const handlePopstate = () => {
      const next = parseLocation();
      setSurface(next.surface);
      setActiveMode(surfaceToCommandMode(next.surface));
      setMoreView(next.moreView);
      setActivePhaseId(next.activePhaseId);
      setReportId(next.reportId);
    };
    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setProgramDropdownOpen(false);
      if (backendPanelRef.current && !backendPanelRef.current.contains(event.target as Node)) setBackendPanelOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((current) => !current);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        handleDrawerToggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleDrawerToggle]);

  useEffect(() => {
    const openDrawer = () => {
      setContextDrawerOpen(true);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CONTEXT_DRAWER_STORAGE_KEY, "true");
      }
    };
    window.addEventListener("atlas-v3-open-drawer", openDrawer);
    return () => window.removeEventListener("atlas-v3-open-drawer", openDrawer);
  }, []);

  // The phase the programme is currently working through. We prefer the
  // programme's canonical activePhaseId — the phase every other surface labels
  // "Active phase" — so navigating to the cockpit or Action Center always lands
  // on the same phase the user thinks of as current. Only when no valid active
  // phase is set do we fall back to the pct-based frontier (first in-progress,
  // else first incomplete, else first phase).
  const resolveCurrentPhaseId = useCallback((): string | null => {
    const phases = activeProgram?.phases ?? [];
    if (!phases.length) return null;
    const canonical = activeProgram?.activePhaseId;
    if (canonical && phases.some((phase) => phase.id === canonical)) return canonical;
    const inProgress = phases.find((phase) => (phase.pct ?? 0) > 0 && (phase.pct ?? 0) < 100);
    const firstIncomplete = phases.find((phase) => (phase.pct ?? 0) < 100);
    return inProgress?.id || firstIncomplete?.id || phases[0]?.id || null;
  }, [activeProgram]);

  const handleCommandModeChange = useCallback((nextMode: V3CommandMode) => {
    if (nextMode === ("executive" as any)) {
      commitNavigation({ surface: "executive", moreView: null, activePhaseId, reportId: null });
      return;
    }
    setActiveMode(nextMode);
    const nextSurface = commandModeToSurface(nextMode, surface);
    // Entering the phase cockpit from another surface lands on the current phase
    // (where the work is), not whatever phase was last viewed. Staying within the
    // stage surface keeps the user's explicit phase pick.
    const nextActivePhaseId = nextSurface === "stage" && surface !== "stage"
      ? (resolveCurrentPhaseId() ?? activePhaseId)
      : activePhaseId;
    commitNavigation({
      surface: nextSurface,
      moreView: nextSurface === "program" ? moreView : null,
      activePhaseId: nextActivePhaseId,
      reportId: nextSurface === "program" ? reportId || "status" : null,
    });
  }, [activePhaseId, commitNavigation, moreView, reportId, surface, resolveCurrentPhaseId]);

  const navigateSurface = useCallback((nextSurface: V3Surface) => {
    // The programme (phase cockpit) screen always opens on the current phase, so
    // landing there from the nav lands on where the work is, not a stale pick.
    const nextActivePhaseId = nextSurface === "stage" ? (resolveCurrentPhaseId() ?? activePhaseId) : activePhaseId;
    commitNavigation({
      surface: nextSurface,
      moreView: null,
      activePhaseId: nextActivePhaseId,
      reportId: nextSurface === "program" ? reportId || "status" : null,
    });
  }, [activePhaseId, commitNavigation, reportId, resolveCurrentPhaseId]);

  const handleSelectPhase = useCallback((id: string) => {
    if (lockedPhaseIds.has(id)) {
      pushV3Toast("Approve the previous phase gate to unlock this phase.", { tone: "warning", duration: 3000 });
      return;
    }
    // Navigate directly via commitNavigation so the new phaseId is committed atomically.
    // Calling setActivePhaseId() then navigateSurface() doesn't work because navigateSurface
    // closes over the stale activePhaseId and overwrites the new value inside commitNavigation.
    commitNavigation({ surface: "stage", moreView: null, activePhaseId: id, reportId: null });
  }, [lockedPhaseIds, commitNavigation]);

  const openMoreView = useCallback((view: V3MoreView | null) => {
    commitNavigation({ surface: "program", moreView: view, activePhaseId, reportId: null });
  }, [activePhaseId, commitNavigation]);

  const openAISettings = useCallback((tab?: string) => {
    setIntelligenceInitialTab(tab || "Setup");
    setSurface("program");
    setActiveMode(surfaceToCommandMode("program"));
    setMoreView("intelligence");
    setActivePhaseId(activePhaseId);
    setReportId(null);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/ai-settings");
    }
  }, [activePhaseId]);

  const openPhaseSheet = useCallback((phaseId: string) => {
    if (!phaseId) return;
    setActivePhaseId(phaseId);
    commitNavigation({ surface: "stage", moreView: null, activePhaseId: phaseId, reportId: null });
  }, [commitNavigation]);

  // Open a phase screen AND scroll to its inputs section. Used by the Action
  // Center: resolving an action / blocker / risk takes the user to where they
  // actually fix it — the phase's input fields. The anchor only exists once the
  // StageView has mounted, so poll briefly for it after navigation.
  //
  // When a drill-down `anchor` is supplied (e.g. `artifact:charter` or
  // `input:successMetric`) the view scrolls to that specific element and briefly
  // flashes it, so a risk/blocker/action lands the user on the exact artifact or
  // input it was derived from rather than the generic inputs section.
  const navigateToPhaseInputs = useCallback((phaseId: string, anchor?: string) => {
    if (!phaseId) return;
    openPhaseSheet(phaseId);
    if (typeof window === "undefined") return;
    let attempts = 0;
    const flash = (el: HTMLElement) => {
      // Restart the animation even if the class is already present (re-drilling the
      // same field should visibly flash again).
      el.classList.remove("v3-io-anchor-flash");
      void el.offsetWidth;
      el.classList.add("v3-io-anchor-flash");
      window.setTimeout(() => el.classList.remove("v3-io-anchor-flash"), 5000);
    };
    const tryScroll = () => {
      const el = anchor
        ? (document.querySelector(`[data-io-anchor="${anchor}"]`) as HTMLElement | null)
        : document.getElementById("phase-inputs-anchor");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: anchor ? "center" : "start" });
        // Only flash a precise target — the specific field or artifact drilled into.
        // A generic inputs jump (no anchor) just scrolls; flashing the whole inputs
        // card would be visually heavy and wouldn't point at anything in particular.
        if (anchor) flash(el);
        return;
      }
      if (attempts++ < 20) {
        window.setTimeout(tryScroll, 100);
        return;
      }
      // The specific anchor never resolved (e.g. the source field id no longer maps
      // to a rendered input). Scroll to the inputs section so the user still lands
      // on the editable area — without flashing the entire card.
      if (anchor) {
        document.getElementById("phase-inputs-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.setTimeout(tryScroll, 150);
  }, [openPhaseSheet]);

  const openReport = useCallback((nextReportId: V3ReportId) => {
    commitNavigation({ surface: "program", moreView: null, activePhaseId, reportId: nextReportId });
  }, [activePhaseId, commitNavigation]);

  const navigateAppView = useCallback((view: AppView) => {
    if (view === "home") return navigateSurface("insight-feed");
    if (view === "work") return navigateSurface("pipeline");
    if (view === "decisions") return navigateSurface("decide");
    const deepView = APP_VIEW_TO_MORE_VIEW[view];
    if (deepView) openMoreView(deepView);
  }, [navigateSurface, openMoreView]);

  const handleCreateProgram = useCallback(async () => {
    const name = "New Programme";
    try {
      let newId = "";
      if (isSupabaseConfigured && supabase) {
        if (!userId) {
          // Guard: never create a cloud program without an owner — RLS would
          // reject it and it would silently become localStorage-only.
          pushV3Toast("Still signing you in — please try again in a moment.", { tone: "warning", duration: 4000 });
          return;
        }
        newId = generateProgramId();
        const now = new Date().toISOString();
        const { error } = await supabase.from("adam_programs").insert({
          id: newId, name, updated_at: now, created_at: now, data: buildProgramSeed(name), is_deleted: false, owner_id: userId,
        });
        if (error) {
          console.error("[handleCreateProgram] Cloud insert failed, persisting locally:", error.message);
          newId = persistLocalProgram(name);
          pushV3Toast(
            "Programme created locally only — could not save to the cloud. It may not appear on other devices. Check your connection and access.",
            { tone: "warning", duration: 8000 },
          );
        }
      } else {
        newId = persistLocalProgram(name);
      }
      await refreshPrograms();
      if (newId) {
        setActiveProgramId(newId);
        // Track this as an unsaved draft so cancelling the wizard discards it.
        setDraftProgramId(newId);
        // Short delay so the new activeProgram is set before opening the wizard
        setTimeout(() => setWizardOpen(true), 150);
        // Nudge the user to connect an AI provider so agents are usable on the
        // new programme. Only prompt when the status check has resolved to a
        // definitively-unconnected state (skip "checking" to avoid false alarms).
        if (aiStatus.status !== "connected" && aiStatus.status !== "checking") {
          pushV3Toast("Connect an AI provider to unlock agents for this programme.", {
            tone: "info",
            duration: 10000,
            action: { label: "Connect AI provider →", onClick: () => openAISettings() },
          });
        }
      }
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "create_program" });
      pushV3Toast("Could not create programme.", { tone: "error", duration: 4000 });
    }
  }, [refreshPrograms, setActiveProgramId, userId, aiStatus.status, openAISettings]);

  const handleDeleteProgram = useCallback(async (programId: string) => {
    const ok = await deleteProgramFromSupabase(programId);
    if (!ok) {
      pushV3Toast("Could not delete programme.", { tone: "error", duration: 4000 });
      return;
    }
    // If deleting the active programme, reset to first remaining one
    if (programId === activeProgramId) {
      const remaining = programs.filter((p) => p.id !== programId);
      setActiveProgramId(remaining[0]?.id ?? null);
    }
    await refreshPrograms();
    pushV3Toast("Programme deleted.", { tone: "success", duration: 3000 });
  }, [activeProgramId, programs, refreshPrograms, setActiveProgramId]);

  const handleResolveDecision = useCallback(async (
    decisionId: string,
    resolution: "approved" | "deferred" | "rejected" | "modified",
    modifiedContent?: string,
    decisionPayload?: DecisionSummary,
  ) => {
    if (!activeProgram) return;
    const source = getProgramState(activeProgram.rawData || {}).inner;
    const queue = Array.isArray(source?.decisionQueue) ? source.decisionQueue as Record<string, unknown>[] : [];
    const decision = queue.find((entry) => entry.id === decisionId);
    const isPCR = decision?.type === "pcr-review" || decision?.source === "scope-pcr";

    try {
      await resolveDecision(activeProgram.id, decisionId, resolution, currentUser?.email, modifiedContent, undefined, decisionPayload);
      if (isPCR && resolution === "approved") {
        const cloned = cloneRawProgram(activeProgram);
        const nextInner = { ...cloned.inner };
        nextInner.programVersion = (typeof nextInner.programVersion === "number" ? nextInner.programVersion : 0) + 1;
        nextInner.lastPCRAt = new Date().toISOString();
        nextInner.lastPCRDecisionId = decisionId;
        nextInner.staleArtifacts = ["narrative", "plan", "raidEntries", "criticalPath", "changeImpact", "healthHeatmap"];
        nextInner.artifactsStaleReason = `PCR approved: ${String(decision?.title || decision?.question || "scope change")}`;
        await updateProgramData(activeProgram.id, cloned.commit(nextInner), activeProgram.updatedAt);
        for (const agentId of ["narrative", "plan", "risk", "critical-path"]) {
          await runProgramAgent({ agentId, phaseId: activePhaseId || "program", triggeredBy: "trigger" });
        }
      }
      await refreshPrograms();
      pushV3Toast(isPCR && resolution === "approved" ? "PCR approved. Affected artifacts have been flagged for refresh." : "Decision resolved.", { tone: "success", duration: 3000 });
    } catch (error) {
      if (error instanceof ConflictError) {
        const overwrite = window.confirm("This programme was updated by another session since you last loaded it.\n\nClick OK to reload the latest version (your current changes will be lost), or Cancel to keep your changes and try saving again.");
        if (overwrite) await refreshPrograms();
        return;
      }
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "resolve_decision", decisionId });
      pushV3Toast("Could not resolve decision. Please try again.", { tone: "error", duration: 4000 });
    }
  }, [activePhaseId, activeProgram, currentUser?.email, refreshPrograms, resolveDecision, runProgramAgent, updateProgramData]);

  const handleAddMilestone = useCallback(async (milestone: Omit<Milestone, "id" | "source" | "lastUpdatedAt">) => {
    try {
      await addMilestone(milestone);
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "add_milestone" });
      pushV3Toast("Could not save milestone.", { tone: "error", duration: 4000 });
    }
  }, [addMilestone]);

  const handleCompleteMilestone = useCallback(async (milestoneId: string) => {
    try {
      await completeMilestone(milestoneId);
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "complete_milestone", milestoneId });
      pushV3Toast("Could not mark milestone complete.", { tone: "error", duration: 4000 });
    }
  }, [completeMilestone]);

  const handleSaveBudgetInputs = useCallback(async (patch: {
    projectedCost: number | null;
    actualSpend: number | null;
    projectedBenefits: number | null;
    realisedBenefits: number | null;
  }) => {
    try {
      await saveBudgetInputs(patch);
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "save_budget_inputs" });
      pushV3Toast("Budget save failed. Check your connection and try again.", { tone: "error", duration: 4000 });
    }
  }, [saveBudgetInputs]);

  const handleSaveSetup = useCallback(async (patch: ProgramSetupPatch) => {
    try {
      await saveSetup(patch);
      // The draft is now a real, named programme — keep it on cancel/close.
      setDraftProgramId(null);
      setWizardOpen(false);
      pushV3Toast("Programme details saved.", { tone: "success", duration: 2500 });
    } catch (error) {
      pushV3Toast("Could not save programme details.", { tone: "error", duration: 4000 });
      throw error;
    }
  }, [saveSetup]);

  // Cancelling the wizard. If it was opened on a freshly-created, never-saved
  // draft, discard that programme so an empty "New Programme" isn't left behind.
  const handleCancelSetup = useCallback(async () => {
    setWizardOpen(false);
    const idToDelete = draftProgramId;
    if (!idToDelete) return;
    setDraftProgramId(null);
    const ok = await deleteProgramFromSupabase(idToDelete);
    if (idToDelete === activeProgramId) {
      const remaining = programs.filter((p) => p.id !== idToDelete);
      setActiveProgramId(remaining[0]?.id ?? null);
    }
    if (ok) await refreshPrograms();
  }, [draftProgramId, activeProgramId, programs, refreshPrograms, setActiveProgramId]);

  const handleUpdatePhasePct = useCallback(async (phaseId: string, pct: number) => {
    await updatePhasePct(phaseId, pct);
  }, [updatePhasePct]);

  const handleAddDecision = useCallback(async (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => {
    // Adding a decision is a deterministic write — no automatic LLM call. The
    // decision-advisor is now on-demand (run from the decision card) rather than
    // firing on every add, so capturing a decision never costs a model call.
    await addDecision(decision);
    await refreshPrograms();
  }, [addDecision, refreshPrograms]);

  const handleSaveNarrativeCorrection = useCallback(async (note: string) => {
    await addProgramNote(note, "narrative-correction");
  }, [addProgramNote]);

  const handleSavePhaseInputs = useCallback(async (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; clearReviewDefId?: string; staleDefId?: string }) => {
    if (!activeProgram) return;
    const silent = opts?.silent === true;
    // Hard freeze: once a phase clears its stage gate its inputs are locked, so no
    // save (manual or import) can mutate them. The UI already hides the editors;
    // this is the authoritative server-bound chokepoint that enforces it.
    if (activeProgram.gateReviews?.[phaseId]?.status === "approved") {
      pushV3Toast("Phase gate approved — inputs are locked. Reopen the gate to edit.", { tone: "warning", duration: 4000 });
      return;
    }
    // Build the field-level patch (input merge + stale flags + spent-review clear)
    // on top of a given base program. Parameterised by base so a version conflict
    // can re-base the exact same patch onto the freshest server copy and retry.
    const buildPayload = (base: ProgramSummary) => {
      const cloned = cloneRawProgram(base);
      const existing = typeof cloned.inner.phaseInputs === "object" && cloned.inner.phaseInputs !== null
        ? { ...(cloned.inner.phaseInputs as Record<string, unknown>) }
        : {};
      // An approved artifact must never silently drift: when a captured input that
      // feeds it changes, flag that artifact stale so it is regenerated. Flow edges
      // are methodology-derived, so which inputs touch which artifacts is not
      // hard-coded here. Computed against the prior bucket, before the merge.
      const changedFields = changedInputFields(existing[phaseId], inputs);
      existing[phaseId] = mergePhaseInputBucket(existing[phaseId], inputs);
      const artifactBuckets = typeof cloned.inner.phaseArtifacts === "object" && cloned.inner.phaseArtifacts !== null
        ? { ...(cloned.inner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>) }
        : {};
      const phaseBucket = artifactBuckets[phaseId];
      // Any artifact fed by a changed input is now out of date — flag it stale
      // regardless of status (draft, ready, OR approved), so every document built
      // from the old inputs is regenerated rather than silently drifting.
      const staled = relatedArtifactsToStale(phaseId, changedFields, phaseBucket);
      // Applying a reviewer's improvement list rewrites the artifact's grounding
      // inputs, so the existing draft/approved document built from the old inputs
      // is now out of date. Flag it stale explicitly (even when it isn't approved),
      // so the row shows "Stale — regenerate" and the user re-runs it.
      const staleDefId = opts?.staleDefId;
      const explicitStale = staleDefId && phaseBucket && phaseBucket[staleDefId] ? [staleDefId] : [];
      const allStaled = [...new Set([...staled, ...explicitStale])];
      if (allStaled.length) {
        const nextBucket = { ...phaseBucket };
        const nowIso = new Date().toISOString();
        const reason = changedFields.length
          ? `Inputs changed: ${changedFields.join(", ")}`
          : "Quality improvements applied to grounding inputs";
        for (const artifactId of allStaled) {
          nextBucket[artifactId] = { ...(nextBucket[artifactId] as Record<string, unknown>), status: "stale", staleReason: reason, staleAt: nowIso };
        }
        artifactBuckets[phaseId] = nextBucket;
      }
      // When inputs are applied straight from a reviewer's improvement list, the
      // suggestions that drove them are now spent — clear them in the same atomic
      // write so we never leave stale "fix this" guidance pointing at text we just
      // rewrote (a second write would risk an optimistic-concurrency conflict).
      const reviewPatch: Record<string, unknown> = {};
      const clearDefId = opts?.clearReviewDefId;
      if (clearDefId) {
        const key = artifactReviewFieldKey(clearDefId);
        const rec = cloned.inner[key];
        if (rec && typeof rec === "object" && !Array.isArray(rec)) {
          const nextRec: Record<string, unknown> = { ...(rec as Record<string, unknown>) };
          if ("improvements" in nextRec) nextRec.improvements = [];
          const pb = nextRec[phaseId];
          if (pb && typeof pb === "object" && !Array.isArray(pb)) {
            nextRec[phaseId] = { ...(pb as Record<string, unknown>), improvements: [] };
          }
          reviewPatch[key] = nextRec;
        }
      }
      const payload = cloned.commit({ ...cloned.inner, phaseInputs: existing, phaseArtifacts: artifactBuckets, ...reviewPatch });
      return { payload, staled: allStaled };
    };

    let { payload, staled } = buildPayload(activeProgram);
    try {
      await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    } catch (err) {
      if (!(err instanceof ConflictError) || !isSupabaseConfigured || !supabase) throw err;
      // A concurrent write — very often this user's OWN background agent
      // (input-quality, co-pilot) touching a different part of the blob — bumped
      // the row's version mid-edit. Don't reject the user's deliberate input change:
      // re-base the same field-level patch onto the freshest server copy and retry
      // once, so the edit lands without clobbering the concurrent change.
      const { data: fresh } = await supabase
        .from("adam_programs")
        .select("data, updated_at")
        .eq("id", activeProgram.id)
        .single();
      const freshRaw = (fresh?.data as Record<string, unknown> | undefined) ?? activeProgram.rawData ?? {};
      const rebased = buildPayload({ ...activeProgram, rawData: freshRaw, updatedAt: fresh?.updated_at ?? activeProgram.updatedAt });
      payload = rebased.payload;
      staled = rebased.staled;
      await updateProgramData(activeProgram.id, payload, fresh?.updated_at ?? undefined);
    }
    // Both branches above persist via updateProgramData, which already refreshes
    // on success — a second refetch here doubled every (debounced, very frequent)
    // input auto-save, re-pulling every programme's full data blob each keystroke.
    // Saving inputs is a deterministic persist — no model call. Input quality is
    // scored locally by derivePhaseInputQuality (phaseInputQuality.ts), so editing
    // inputs never silently triggers an agent run.
    // Auto-saves persist quietly (the panel shows its own "Saved" tick). The
    // stale-artifact warning is the one thing still worth surfacing even on an
    // auto-save, since it changes what the user must regenerate.
    if (staled.length) {
      pushV3Toast(
        `Inputs saved. ${staled.length} artifact${staled.length > 1 ? "s" : ""} marked stale — regenerate to apply your changes.`,
        { tone: "warning", duration: 5000 },
      );
    } else if (!silent) {
      pushV3Toast("Inputs saved. Ready to run agents.", { tone: "success", duration: 2500 });
    }
  }, [activeProgram, refreshPrograms, updateProgramData]);

  // Atomic multi-phase save — used by document import to avoid stale-closure overwrites
  const handleSaveAllPhaseInputs = useCallback(async (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const existing = typeof cloned.inner.phaseInputs === "object" && cloned.inner.phaseInputs !== null
      ? { ...(cloned.inner.phaseInputs as Record<string, unknown>) }
      : {};
    // Skip any phase whose gate is already approved — its inputs are frozen, so an
    // import must not overwrite them. Dropped phases are surfaced to the user below.
    const lockedPhases = Object.keys(allInputs).filter(
      (phaseId) => activeProgram.gateReviews?.[phaseId]?.status === "approved",
    );
    const writableInputs = Object.fromEntries(
      Object.entries(allInputs).filter(([phaseId]) => !lockedPhases.includes(phaseId)),
    );
    if (Object.keys(writableInputs).length === 0) {
      pushV3Toast("All targeted phases are gate-locked — nothing imported.", { tone: "warning", duration: 4000 });
      return;
    }
    // Reimport guard: an approved artifact's inputs must not be silently overwritten
    // by a re-scan. For each phase, drop any incoming field that feeds an already-
    // approved artifact (flow edges are methodology-derived, so this isn't hard-coded).
    // First imports approve nothing, so nothing is dropped then; only re-imports of a
    // phase with approved artifacts preserve those inputs.
    const artifactBuckets = typeof cloned.inner.phaseArtifacts === "object" && cloned.inner.phaseArtifacts !== null
      ? (cloned.inner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>)
      : {};
    let skippedFieldCount = 0;
    for (const [phaseId, inputs] of Object.entries(writableInputs)) {
      const blocked = fieldsFeedingApprovedArtifacts(phaseId, Object.keys(inputs), artifactBuckets[phaseId]);
      const writableFields = blocked.size
        ? Object.fromEntries(Object.entries(inputs).filter(([fieldId]) => !blocked.has(fieldId)))
        : inputs;
      skippedFieldCount += Object.keys(inputs).length - Object.keys(writableFields).length;
      if (Object.keys(writableFields).length === 0) continue;
      existing[phaseId] = mergePhaseInputBucket(existing[phaseId], writableFields);
    }
    const payload = cloned.commit({ ...cloned.inner, phaseInputs: existing });
    // updateProgramData already refreshes on success — no second refetch needed.
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    // Navigate to the first writable phase that received inputs and open the drawer
    const targetPhase = (firstPhaseId && !lockedPhases.includes(firstPhaseId) ? firstPhaseId : null) ?? Object.keys(writableInputs)[0];
    if (targetPhase) {
      setActivePhaseId(targetPhase);
      commitNavigation({ surface: "stage", moreView: null, activePhaseId: targetPhase, reportId: null });
      setContextDrawerOpen(true);
      window.localStorage.setItem(CONTEXT_DRAWER_STORAGE_KEY, "true");
    }
    const phaseCount = Object.keys(writableInputs).length;
    const totalIncoming = Object.values(writableInputs).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
    const fieldCount = totalIncoming - skippedFieldCount;
    const lockedNote = lockedPhases.length
      ? ` ${lockedPhases.length} gate-locked phase${lockedPhases.length > 1 ? "s" : ""} skipped.`
      : "";
    const protectedNote = skippedFieldCount
      ? ` ${skippedFieldCount} field${skippedFieldCount > 1 ? "s" : ""} feeding approved artifacts preserved.`
      : "";
    pushV3Toast(`${fieldCount} field${fieldCount !== 1 ? "s" : ""} saved across ${phaseCount} phase${phaseCount !== 1 ? "s" : ""}. Ready to run agents.${lockedNote}${protectedNote}`, { tone: "success", duration: 3500 });
  }, [activeProgram, commitNavigation, refreshPrograms, updateProgramData]);

  // ── Program save snapshots ──────────────────────────────────────────────────
  // Point-in-time backups the user can restore. Each snapshot is a full copy of
  // the live programme state, stored as its own row in adam_program_snapshots —
  // never inside the programme's own data blob — so the history can't bloat the
  // record the app reads and rewrites on every operation.
  const handleSaveProgramSnapshot = useCallback(async (label?: string, kind: "manual" | "lock" = "manual") => {
    if (!activeProgram) return;
    const { inner } = cloneRawProgram(activeProgram);
    // Legacy blobs may still carry an in-data snapshot array; never nest it.
    delete inner.programSnapshots;
    const resolvedLabel = (label && label.trim()) || `Manual save · ${new Date().toLocaleString()}`;
    try {
      await createProgramSnapshot(resolvedLabel, kind, inner);
      pushV3Toast(
        kind === "lock" ? `Snapshot saved: ${resolvedLabel}` : "Program saved.",
        { tone: "success", duration: 2500 },
      );
    } catch (err) {
      pushV3Toast(err instanceof Error ? err.message : "Failed to save snapshot.", { tone: "error", duration: 4000 });
    }
  }, [activeProgram, createProgramSnapshot]);

  const handleRevertProgramSnapshot = useCallback(async (snapshotId: string) => {
    if (!activeProgram) return;
    const restoredInner = await getProgramSnapshotData(snapshotId);
    if (!restoredInner) {
      pushV3Toast("Snapshot not found.", { tone: "error", duration: 3000 });
      return;
    }
    const cloned = cloneRawProgram(activeProgram);
    // The snapshot holds the inner programme state; strip any legacy snapshot key
    // so a restored copy never reintroduces an in-data history.
    delete restoredInner.programSnapshots;
    const payload = cloned.commit(restoredInner);
    // updateProgramData already refreshes on success — no second refetch needed.
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    const label = programSnapshots.find((s) => s.id === snapshotId)?.label ?? "snapshot";
    pushV3Toast(`Reverted to “${label}”.`, { tone: "success", duration: 3000 });
  }, [activeProgram, getProgramSnapshotData, programSnapshots, refreshPrograms, updateProgramData]);

  // Auto-snapshot when a phase gate transitions to approved (a "lock"). Detected
  // from the persisted gateReviews so it runs off the refreshed programme — no
  // stale closure from the approve click's await chain. Pre-existing locks are
  // baselined on first load / program switch so only *new* locks snapshot.
  const lockSnapshotSeenRef = useRef<{ programId: string | null; phases: Set<string> }>({ programId: null, phases: new Set() });
  useEffect(() => {
    if (!activeProgram) return;
    const approved = new Set(
      Object.entries(activeProgram.gateReviews ?? {})
        .filter(([, review]) => (review as { status?: string } | null)?.status === "approved")
        .map(([phaseId]) => phaseId),
    );
    const seen = lockSnapshotSeenRef.current;
    if (seen.programId !== activeProgram.id) {
      // New programme in focus — baseline its existing locks without snapshotting.
      lockSnapshotSeenRef.current = { programId: activeProgram.id, phases: approved };
      return;
    }
    const fresh = [...approved].filter((phaseId) => !seen.phases.has(phaseId));
    if (fresh.length === 0) return;
    for (const phaseId of fresh) seen.phases.add(phaseId);
    const phaseId = fresh[0];
    const name = activeProgram.phases.find((p) => p.id === phaseId)?.displayName ?? phaseId;
    void handleSaveProgramSnapshot(`${name} locked`, "lock");
  }, [activeProgram, handleSaveProgramSnapshot]);

  const handleUploadDocument = useCallback(() => {
    openMoreView("documents");
  }, [openMoreView]);

  // Per-field AI assist for phase inputs — reuses the copilot-chat endpoint
  // (non-streaming) with a focused, field-scoped prompt. Returns clean text the
  // panel writes straight into the field; throws a friendly message on failure
  // so the inline error state can surface it.
  const handleAssistField = useCallback(async (phaseId: string, request: FieldAssistRequest): Promise<string> => {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("AI assist needs a connected workspace.");
    }
    if (!activeProgram) {
      throw new Error("No active programme.");
    }
    const phaseLabel = activeProgram.phases.find((p) => p.id === phaseId)?.displayName ?? phaseId;
    const message = buildFieldAssistPrompt(request.mode, {
      programName: activeProgram.name,
      client: activeProgram.client,
      industry: activeProgram.industry,
      objective: activeProgram.objective,
      phaseLabel,
      fieldLabel: request.fieldLabel,
      fieldHint: request.fieldHint,
      currentValue: request.currentValue,
      incomingValue: request.incomingValue,
      guidance: request.guidance,
    });
    // A FunctionsFetchError ("Failed to send a request to the Edge Function") means
    // the request never reached the function — a transient network drop or edge
    // cold-start reset, not a real rejection. Retry once before surfacing it so a
    // single blip mid-apply doesn't fail the whole pass.
    let data: unknown;
    let error: { message?: string; name?: string; context?: Response } | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ({ data, error } = await supabase.functions.invoke("copilot-chat", {
        body: { programId: activeProgram.id, workspaceId: `phase-input:${phaseId}`, message, stream: false },
      }));
      if (!error || error.name !== "FunctionsFetchError") break;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
    }
    if (error) {
      // A fetch-level failure that survived the retry: the edge never answered.
      // Surface an actionable message instead of the raw "Failed to send a request".
      if (error.name === "FunctionsFetchError") {
        throw new Error("Couldn't reach the AI service — check your connection and try again.");
      }
      // supabase-js collapses any non-2xx into the opaque "Edge Function returned
      // a non-2xx status code". The real reason (provider key, program not synced,
      // invalid id, AI error) lives in the Response body it stashes on `.context`.
      let detail = error.message || "AI assist request failed.";
      const ctx = error.context;
      if (ctx && typeof ctx.json === "function") {
        try {
          const body = await ctx.clone().json() as { error?: string };
          if (body?.error) detail = body.error;
        } catch {
          try {
            const text = await ctx.text();
            if (text) detail = text;
          } catch { /* body unreadable — keep generic message */ }
        }
      }
      throw new Error(detail);
    }
    const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI assist returned no suggestion.");
    }
    return sanitiseFieldReply(content);
  }, [activeProgram]);

  // Merge-and-refine for document import: when an imported field collides with a
  // value the PM already entered, synthesise both into one coherent value via the
  // field-assist endpoint instead of overwriting. Throws on failure so the import
  // can fall back to a deterministic local merge.
  const handleRefineImportField = useCallback(
    (phaseId: string, fieldId: string, fieldLabel: string, existingValue: string, incomingValue: string) =>
      handleAssistField(phaseId, { fieldId, fieldLabel, mode: "merge", currentValue: existingValue, incomingValue }),
    [handleAssistField],
  );

  const handleApproveGate = useCallback(async (phaseId: string): Promise<boolean> => {
    if (!activeProgram) return false;

    // Authoritative hard gate: closing a phase is deterministic and governed by
    // artifact completeness and quality — the same two conditions the Close
    // phase button enables on (every required artifact approved AND quality
    // above 85%). No LLM gate-review and no mandatory exit-criteria gating. This
    // is the single chokepoint every surface (StageView, ProgrammeHealthView)
    // routes through, so a stale-enabled button can never close a phase whose
    // artifacts are incomplete or under-quality.
    const approvalReadiness = computePhaseReadiness(activeProgram, phaseId);
    if (approvalReadiness.artifactsComplete < 100) {
      pushV3Toast(
        `Artifacts are ${Math.round(approvalReadiness.artifactsComplete)}% complete — every required artifact must be approved before this phase can close.`,
        { tone: "error", duration: 5000 },
      );
      return false;
    }
    if (!(approvalReadiness.artifactScore > 85)) {
      pushV3Toast(
        `Artifact quality ${Math.round(approvalReadiness.artifactScore)}% is below the 85% required to close this phase.`,
        { tone: "error", duration: 5000 },
      );
      return false;
    }

    // Closing is deterministic: the only conditions are artifact completeness
    // and quality, checked above. We deliberately do NOT run the cross-phase
    // dependency-check or any other LLM verdict as a blocker here — those gate
    // on exit criteria / handoff quality the user has chosen not to enforce for
    // closing a phase. The single LLM call closing makes is the next-phase input
    // planner below, which generates rather than blocks.
    try {
      await approveGate(phaseId);
      pushV3Toast("Gate approved.", { tone: "success", duration: 2500 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gate approval failed. Please try again.";
      pushV3Toast(message, { tone: "error", duration: 4000 });
      return false;
    }

    // Dynamic schema: once a phase clears its gate, ask the planner agent to read
    // the just-approved phase's artifacts and propose tailored additional input
    // fields/artifacts for the *next* phase. Best-effort and fully guarded — if
    // the agent is unavailable the gate approval still stands. The proposal is
    // sanitised before it is persisted under rawData.dynamicSchema, where every
    // resolver merges it on top of the static methodology for this programme.
    const phaseOrder = activeProgram.phases?.map((p) => p.id) ?? [];
    const nextPhaseId = phaseOrder[phaseOrder.indexOf(phaseId) + 1];
    if (supabase && nextPhaseId) {
      // If the next phase already holds inputs/artifacts, regenerating would
      // overwrite that work — so ask the user first. "Keep existing" leaves the
      // next phase untouched (the gate is still approved); only "Overwrite &
      // recreate" runs the planner below. A pristine next phase skips the prompt.
      const { inner: closingInner } = cloneRawProgram(activeProgram);
      if (phaseHasExistingData(closingInner, nextPhaseId)) {
        const overwrite = await new Promise<boolean>((resolve) => {
          setOverwritePrompt({ nextPhaseId, resolve });
        });
        setOverwritePrompt(null);
        if (!overwrite) {
          pushV3Toast(`Phase closed. ${nextPhaseId} inputs and artifacts were left unchanged.`, { tone: "info", duration: 4000 });
          return true;
        }
      }
      try {
        // The edge can't import the methodology, so pass the next phase's spine
        // (mandatory exit criteria + recommended agents) for the planner to
        // ground a complete inventory on — persisted phases often carry no
        // exitCriteria yet, which otherwise leaves the planner under-generating.
        const nextPhaseDef = getPhaseDefinition(nextPhaseId);
        const response = await supabase.functions.invoke("run-agent", {
          body: {
            programId: activeProgram.id,
            agentId: "phase-input-planner",
            phaseId: nextPhaseId,
            triggeredBy: "trigger",
            phaseSpec: nextPhaseDef
              ? {
                  name: nextPhaseDef.displayName,
                  description: nextPhaseDef.description,
                  exitCriteria: nextPhaseDef.mandatoryExitCriteriaTemplates,
                  recommendedAgents: nextPhaseDef.recommendedAgents,
                }
              : undefined,
          },
        });
        if (response.error) throw response.error;
        // The edge persists the planner proposal into dynamicSchema itself (it
        // is the single writer — relying on this HTTP response to carry the
        // proposal back for the client to persist silently dropped good output
        // when the round-trip was flaky). Re-read the freshest row so the UI and
        // the toast reflect what was actually written.
        await refreshPrograms();
        const { data: fresh } = await supabase
          .from("adam_programs")
          .select("data")
          .eq("id", activeProgram.id)
          .single();
        const freshRaw = (fresh?.data as Record<string, unknown> | undefined) ?? activeProgram.rawData ?? {};
        const cloned = cloneRawProgram({ ...activeProgram, rawData: freshRaw });
        const store = getDynamicSchemaStore(cloned.inner);
        const nInputs = store.inputFields?.[nextPhaseId]?.length ?? 0;
        const nArtifacts = store.artifacts?.[nextPhaseId]?.length ?? 0;
        if (nInputs + nArtifacts > 0) {
          pushV3Toast(
            `Planner tailored ${nextPhaseId}: ${nInputs} input${nInputs === 1 ? "" : "s"} and ${nArtifacts} artifact${nArtifacts === 1 ? "" : "s"} generated.`,
            { tone: "info", duration: 5000 },
          );
        } else {
          pushV3Toast(
            `Phase closed, but the planner did not generate inputs/artifacts for ${nextPhaseId}. Re-run from the next phase if needed.`,
            { tone: "warning", duration: 6000 },
          );
        }
      } catch {
        pushV3Toast(
          `Phase closed, but the planner could not be reached to generate ${nextPhaseId} inputs/artifacts.`,
          { tone: "warning", duration: 6000 },
        );
      }
    }
    return true;
  }, [activeProgram, approveGate, refreshPrograms, updateProgramData]);

  const handleReopenGate = useCallback(async (phaseId: string) => {
    setGateReopenPhase(phaseId);
  }, []);

  const handleConfirmGateReopen = useCallback(async (reason: string) => {
    if (!gateReopenPhase) return;
    const phaseId = gateReopenPhase;
    // Keep the modal mounted (it shows a pending state) until the async reopen settles,
    // so a slow Supabase write can't be double-submitted by an impatient second click.
    try {
      await reopenGate(phaseId, reason);
      pushV3Toast("Gate reopened. Next phase is locked pending re-approval.", { tone: "warning", duration: 4000 });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "";
      pushV3Toast(detail ? `Could not reopen gate: ${detail}` : "Could not reopen gate.", { tone: "error", duration: 4000 });
    } finally {
      setGateReopenPhase(null);
    }
  }, [gateReopenPhase, reopenGate]);

  const handleAnswerAgentQuestion = useCallback(async (taskId: string, answer: string) => {
    if (!activeProgram || !activePhaseId || !activeProgramId) return;
    await updatePhaseTask(taskId, { status: "done", result: answer, completedAt: Date.now() } as Partial<PhaseAgentTask>);

    const cloned = cloneRawProgram(activeProgram);
    const existing = Array.isArray(cloned.inner.humanNotes) ? [...cloned.inner.humanNotes as Record<string, unknown>[]] : [];
    const payload = cloned.commit({
      ...cloned.inner,
      humanNotes: [...existing, {
        text: `Agent question answered: ${answer}`,
        savedAt: new Date().toISOString(),
        type: "stage-note",
        phaseId: activePhaseId,
        taskId,
      }],
    });
    // updateProgramData already refreshes programmes — only the phase tasks still
    // need a separate refetch here.
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    await refreshPhaseTasks();
    pushV3Toast("Answer saved. ATOS will continue from here.", { tone: "success", duration: 2500 });
  }, [activePhaseId, activeProgram, activeProgramId, refreshPhaseTasks, refreshPrograms, updatePhaseTask, updateProgramData]);

  const handleAcknowledgeTask = useCallback((taskId: string) => {
    if (!activeProgramId || !activePhaseId || !activeProgram) return;
    void updatePhaseTask(taskId, { status: "skipped" } as Partial<PhaseAgentTask>);
  }, [activeProgramId, activePhaseId, updatePhaseTask]);

  const handleSaveArtifact = useCallback(async (artifactId: "narrative" | "deck", content: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const nextInner = { ...cloned.inner };
    if (artifactId === "narrative") {
      nextInner.narrative = sanitizeMarkdown(content);
      const notes = Array.isArray(nextInner.humanNotes) ? [...nextInner.humanNotes as Record<string, unknown>[]] : [];
      nextInner.humanNotes = [...notes, {
        text: sanitizeMarkdown(content),
        savedAt: new Date().toISOString(),
        type: "narrative-correction",
        phaseId: activePhaseId,
      }];
    } else {
      const existing = typeof nextInner.deck === "object" && nextInner.deck !== null ? { ...(nextInner.deck as Record<string, unknown>) } : {};
      existing.programHealthSummary = sanitizeMarkdown(content);
      nextInner.deck = existing;
    }
    await updateProgramData(activeProgram.id, cloned.commit(nextInner), activeProgram.updatedAt);
    await refreshPrograms();
    pushV3Toast("Artifact saved. Your version will be used on the next agent run.", { tone: "success", duration: 3000 });
  }, [activePhaseId, activeProgram, refreshPrograms, updateProgramData]);

  const handleApproveArtifact = useCallback(async (phaseId: string, artifactId: string, agentId: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const nextInner = { ...cloned.inner };
    const buckets = { ...(nextInner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>> | undefined ?? {}) };
    const phaseBucket = { ...(buckets[phaseId] ?? {}) };
    const entry = phaseBucket[artifactId];
    if (!entry) return;
    phaseBucket[artifactId] = { ...entry, status: "approved", updatedAt: new Date().toISOString() };
    buckets[phaseId] = phaseBucket;
    nextInner.phaseArtifacts = buckets;
    await updateProgramData(activeProgram.id, cloned.commit(nextInner), activeProgram.updatedAt);
    await refreshPrograms();

    // Feed the human approval into the producing agent's memory so its next run
    // sees the artifact was accepted (buildMemoryContext surfaces it on dispatch).
    recordAgentFeedback(agentId, phaseId, activeProgram.id, artifactId, "accepted");

    pushV3Toast("Document approved.", { tone: "success", duration: 2500 });
  }, [activeProgram, refreshPrograms, updateProgramData]);

  // Approve every produced artifact in a phase in a single write. Approving one
  // at a time means a network round-trip (and gate re-check) per document; once
  // all artifacts are generated the user approves the whole set at once. Skips
  // anything already approved or archived, and records human feedback per agent.
  const handleApproveAllArtifacts = useCallback(async (phaseId: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const nextInner = { ...cloned.inner };
    const buckets = { ...(nextInner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>> | undefined ?? {}) };
    const phaseBucket = { ...(buckets[phaseId] ?? {}) };
    const nowIso = new Date().toISOString();
    const approved: Array<{ artifactId: string; agentId: string }> = [];
    for (const [artifactId, entry] of Object.entries(phaseBucket)) {
      if (!entry || typeof entry !== "object") continue;
      const status = (entry as { status?: unknown }).status;
      if (status === "approved" || status === "archived") continue;
      phaseBucket[artifactId] = { ...(entry as Record<string, unknown>), status: "approved", updatedAt: nowIso };
      const agentId = typeof (entry as { agentId?: unknown }).agentId === "string" ? (entry as { agentId: string }).agentId : artifactId;
      approved.push({ artifactId, agentId });
    }
    if (!approved.length) return;
    buckets[phaseId] = phaseBucket;
    nextInner.phaseArtifacts = buckets;
    await updateProgramData(activeProgram.id, cloned.commit(nextInner), activeProgram.updatedAt);
    await refreshPrograms();
    for (const { artifactId, agentId } of approved) {
      recordAgentFeedback(agentId, phaseId, activeProgram.id, artifactId, "accepted");
    }
    pushV3Toast(`${approved.length} document${approved.length > 1 ? "s" : ""} approved.`, { tone: "success", duration: 2500 });
  }, [activeProgram, refreshPrograms, updateProgramData]);

  // Reverse an artifact approval back to a working state so the user can edit,
  // regenerate, or re-review it. Only reachable while the phase gate is unlocked
  // (StageView hides Unlock once the gate is locked), so it never silently
  // unwinds a locked gate.
  const handleUnapproveArtifact = useCallback(async (phaseId: string, artifactId: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const nextInner = { ...cloned.inner };
    const buckets = { ...(nextInner.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>> | undefined ?? {}) };
    const phaseBucket = { ...(buckets[phaseId] ?? {}) };
    const entry = phaseBucket[artifactId];
    if (!entry) return;
    phaseBucket[artifactId] = { ...entry, status: "ready", updatedAt: new Date().toISOString() };
    buckets[phaseId] = phaseBucket;
    nextInner.phaseArtifacts = buckets;
    await updateProgramData(activeProgram.id, cloned.commit(nextInner), activeProgram.updatedAt);
    await refreshPrograms();
    pushV3Toast("Document unlocked for editing.", { tone: "info", duration: 2500 });
  }, [activeProgram, refreshPrograms, updateProgramData]);

  const handleDecideDecision = useCallback(async (id: string, decision: string) => {
    await handleResolveDecision(id, "approved", decision);
  }, [handleResolveDecision]);

  const handleDeferDecision = useCallback(async (id: string) => {
    await handleResolveDecision(id, "deferred");
  }, [handleResolveDecision]);

  const handleRunDemo = useCallback(async () => {
    if (!activeProgramId) return;
    try {
      const walkthrough = runWalkthrough();
      await updateProgramData(activeProgramId, {
        ...walkthrough.programState,
        name: WALKTHROUGH_PROGRAM.name,
        objective: WALKTHROUGH_PROGRAM.strategy?.desiredOutcome || "",
      });
      await refreshPrograms();
      pushV3Toast("Demo programme loaded — ATOS is ready to explore.", { tone: "success", duration: 3000 });
    } catch {
      pushV3Toast("Could not load demo programme.", { tone: "error", duration: 4000 });
    }
  }, [activeProgramId, refreshPrograms, updateProgramData]);

  if (
    !authChecked
    || !userResolved
    || (authed && !!userId && !migrated)
    // When signed in with the backend, never render the workspace until the
    // user id has resolved — otherwise a create/save could insert owner_id:null,
    // which RLS rejects and silently degrades to localStorage (data lost on relaunch).
    || (isSupabaseConfigured && authed && !userId)
  ) {
    return <div className="v3-splash">Loading…</div>;
  }

  // Gate: always require sign-in when Supabase is configured.
  // If Supabase is not configured (no .env) we fall through so local dev still works.
  if (authRoute || (isSupabaseConfigured && !authed)) {
    return <AuthScreen configured={isSupabaseConfigured} authed={authed} onSignOut={handleSignOut} />;
  }

  if ((!programs || programs.length === 0) && (programsLoading || !hasResolvedPrograms)) {
    return (
      <div className="v3-shell" aria-busy="true">
        <div className="v3-topbar">
          <BrandLogo />
          <SkeletonShimmer style={{ width: 140, height: 18, borderRadius: 6 }} />
          <div style={{ width: 48 }} />
        </div>
        <div className="v3-scroll">
          <div className="v3-section" style={{ gap: 12 }}>
            {[76, 220, 140, 180].map((height, index) => (
              <SkeletonShimmer key={index} style={{ height, borderRadius: 14 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!programsLoading && hasResolvedPrograms && (!programs || programs.length === 0)) {
    return (
      <div className="v3-shell">
        <div className="v3-topbar">
          <BrandLogo />
          <div style={{ flex: 1 }} />
          <button
            className="v3-topbar-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Help & guide"
            aria-label="Help"
          >?</button>
        </div>

        <div className="v3-scroll">
          <div className="v3-welcome-screen">

            {/* Hero */}
            <div className="v3-welcome-hero">
              <div className="v3-welcome-hero-glyph" aria-hidden="true">✦</div>
              <h1 className="v3-welcome-hero-title">Welcome to Brillio ATOS</h1>
              <p className="v3-welcome-hero-sub">
                Brillio's Agentic Transformation OS. Spin up a programme and ATOS plans every phase, drafts your artefacts from confirmed facts, and tracks gate readiness from strategy through to value realisation.
              </p>
              <button
                type="button"
                className="v3-welcome-cta"
                onClick={() => void handleCreateProgram()}
              >
                + Create programme
              </button>
            </div>

            {/* Phase journey — the methodology backbone, sourced from the registry */}
            <div className="v3-welcome-journey">
              <div className="v3-welcome-journey-label">The ATOS transformation lifecycle</div>
              <div className="v3-welcome-journey-track">
                {ATOS_STANDARD.phases.map((phase, index) => (
                  <React.Fragment key={phase.id}>
                    <div className="v3-welcome-journey-phase" title={phase.description}>
                      <span className="v3-welcome-journey-dot">{index + 1}</span>
                      <span className="v3-welcome-journey-name">{phase.displayName}</span>
                    </div>
                    {index < ATOS_STANDARD.phases.length - 1 ? (
                      <span className="v3-welcome-journey-arrow" aria-hidden="true">→</span>
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Capability tiles */}
            <div className="v3-welcome-tiles">
              {[
                { icon: "◇", title: "Methodology-driven phases", body: "Nine governed phases, each with its required artefacts, exit criteria, and a formal gate review before you advance." },
                { icon: "✦", title: "Specialised AI agents", body: "Phase agents draft your Charter, Business Case, Outcome Framework, and roadmaps — then keep them current as inputs change." },
                { icon: "⬡", title: "Fact-grounded traceability", body: "Every artefact is built from confirmed, citable facts, so each output traces back to its source instead of invented detail." },
                { icon: "◫", title: "Delivery & executive intelligence", body: "Live action plans, risk and decision surfacing, gate-readiness scoring, and one-click SteerCo packs from real programme data." },
              ].map((tile) => (
                <div key={tile.title} className="v3-welcome-tile">
                  <span className="v3-welcome-tile-icon">{tile.icon}</span>
                  <span className="v3-welcome-tile-title">{tile.title}</span>
                  <span className="v3-welcome-tile-body">{tile.body}</span>
                </div>
              ))}
            </div>

          </div>
        </div>

        {helpOpen && (
          <HelpPanel onClose={() => setHelpOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="v3-shell v3-shell--command">
      <CommandRail
        activeSurface={surface}
        moreView={moreView}
        onNavigate={navigateSurface}
        programs={programs.map((p) => ({ id: p.id, name: p.name }))}
        activeProgramId={activeProgramId}
        onSelectProgram={(id) => {
          setActiveProgramId(id);
          commitNavigation({ surface: "insight-feed", moreView: null, activePhaseId: null, reportId: null });
        }}
        programName={activeProgram?.name || "Programme"}
        confidenceScore={programConfidenceScore}
        anyAgentRunning={anyAgentRunning}
        agentStatus={agentStatus}
        userInitial={currentUser?.email?.[0]?.toUpperCase() || null}
        userEmail={currentUser?.email || null}
        onOpenHelp={() => setHelpOpen(true)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenCopilot={() => setAdamCopilotSidebarOpen(true)}
        onOpenAISettings={openAISettings}
        onOpenWorkspaces={() => openMoreView(null)}
        onSignOut={handleSignOut}
        theme={theme}
        onToggleTheme={toggleTheme}
        pinned={commandRailPinned}
        onTogglePinned={toggleCommandRailPinned}
        collapsed={railCollapsed}
        onToggleCollapse={toggleRailCollapsed}
        onCreateProgram={() => void handleCreateProgram()}
        onDeleteProgram={activeProgramId ? () => handleDeleteProgram(activeProgramId) : undefined}
        programHealth={activeProgram ? programHealth : undefined}
        openDecisionCount={actionCenterCount}
      />

      <div className="v3-main-frame">
      <div className="v3-topbar">
        <div className="v3-topbar-brand-group">
          <BrandLogo />
          <TopbarBreadcrumb
            surface={surface}
            activePhaseLabel={activePhaseId ? phaseNameById(activeProgram, activePhaseId) : null}
            moreView={moreView}
            reportId={reportId}
            onNavigate={navigateSurface}
            onClearMoreView={() => openMoreView(null)}
          />
        </div>

        <div className="v3-topbar-actions">
          {/* Escalations — only surface when action is needed */}
          {openEscalations.length > 0 ? (
            <button className="v3-topbar-status-pill is-alert" onClick={() => setEscalationPanelOpen(true)}>
              <div className="v3-escalation-dot" />
              <span>{openEscalations.length} escalation{openEscalations.length > 1 ? "s" : ""}</span>
            </button>
          ) : null}

          {/* Connection warning — only when degraded */}
          {showConnectionStatus ? (
            <div className="v3-topbar-status-pill is-warning">
              <div className="v3-thinking-dot" />
              <span>{channelStatus === "reconnecting" ? "Reconnecting…" : "Connection lost"}</span>
            </div>
          ) : null}

          {/* Edit program */}
          <button
            className="v3-topbar-icon-btn"
            onClick={() => setWizardOpen(true)}
            title="Edit programme setup"
            aria-label="Edit programme setup"
          >
            ✎
          </button>

          {/* Help */}
          <button
            className="v3-topbar-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Help & guide"
            aria-label="Help"
          >
            ?
          </button>

          {/* Copilot */}
          <button
            className="v3-topbar-ask-adam-btn"
            onClick={() => setAdamCopilotSidebarOpen(true)}
            title="Copilot — AI assistant"
            aria-label="Copilot"
          >
            <span className="v3-topbar-ask-adam-icon">✦</span>
            <span>Copilot</span>
          </button>
        </div>
      </div>

      {!userId && programs.length > 0 ? (
        <div className="v3-banner warning" style={{ margin: "8px 16px" }}>
          ⚠ Session user unknown — data isolation not guaranteed. Refresh to re-authenticate.
        </div>
      ) : null}
      <AIStatusBanner aiStatus={aiStatus.status} onOpenAISettings={openAISettings} />

      <div className="v3-surface-layout" style={{ position: "relative" }}>
      {anyAgentRunning && (
        <div role="status" aria-label="Analysing programme data" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 0, overflow: "hidden" }}>
          Analysing
        </div>
      )}
      <AgentSweepBar active={anyAgentRunning} />
      <div key={`${surface}:${moreView || "base"}:${reportId || "none"}`} className="v3-scroll v3-surface-enter">
        <React.Suspense fallback={<div style={{ padding: 24 }}><SkeletonShimmer /></div>}>
        {surface === "stage" ? (
          <AdamErrorBoundary context={{ surface: "stage", programId: activeProgramId, activePhaseId }}>
            {isProgramEmpty ? (
              <OnboardingCard
                programName={activeProgram?.name || ""}
                onSetup={() => setWizardOpen(true)}
                onUploadDoc={() => openMoreView("documents")}
                onRunDemo={() => void handleRunDemo()}
              />
            ) : (
              <StageView
                program={activeProgram}
                activeRuns={activeRuns}
                activePhaseId={activePhaseId}
                lockedPhaseIds={lockedPhaseIds}
                mode={mode}
                generatedAt={activeProgram?.planGeneratedAt || activeProgram?.narrativeGeneratedAt || null}
                agentsAvailable={authed && isSupabaseConfigured}
                triggers={triggers}
                onOpenMoreView={(view) => openMoreView(view)}
                onSelectPhase={handleSelectPhase}
                onResolveDecision={handleResolveDecision}
                onOpenDecide={() => navigateSurface("decide")}
                onOpenDecideTab={(tab) => { setDecideIntent({ tab, nonce: Date.now(), openAdd: false }); navigateSurface("decide"); }}
                onAddItem={(tab) => { setDecideIntent({ tab, nonce: Date.now() }); navigateSurface("decide"); }}
                onOpenReport={openReport}
                onReopenGate={handleReopenGate}
                onApproveGate={handleApproveGate}
                onRunAgent={handleRunAgent}
                onSaveArtifact={handleSaveArtifact}
                onApproveArtifact={handleApproveArtifact}
                onApproveAllArtifacts={handleApproveAllArtifacts}
                onUnapproveArtifact={handleUnapproveArtifact}
                onSaveInputs={handleSavePhaseInputs}
                onSaveProgram={handleSaveProgramSnapshot}
                onRevertProgram={handleRevertProgramSnapshot}
                programSnapshots={programSnapshots}
                onUploadDocument={handleUploadDocument}
                onAssistField={handleAssistField}
                artifactPreviews={{
                  narrative: activeProgram?.narrative || null,
                  plan: activeProgram?.plan?.nextThreeActions || null,
                  deck: activeProgram?.deck?.programHealthSummary || activeProgram?.deck?.slides?.[0]?.speakerNotes || null,
                }}
              />
            )}
          </AdamErrorBoundary>
        ) : null}

        {surface === "pipeline" ? (
          <AdamErrorBoundary context={{ surface: "pipeline", programId: activeProgramId, activePhaseId }}>
            <PipelineView
              program={activeProgram}
              activePhaseId={activePhaseId}
              onSelectPhase={handleSelectPhase}
              onOpenPhase={openPhaseSheet}
              onUpdatePhasePct={handleUpdatePhasePct}
              lockedPhaseIds={lockedPhaseIds}
              completionEstimates={(() => {
                const inner = getProgramState(activeProgram?.rawData || {}).inner;
                return (inner.phaseCompletionEstimates as Record<string, { estimate: number }> | undefined) || {};
              })()}
            />
          </AdamErrorBoundary>
        ) : null}

        {surface === "decide" ? (
          <AdamErrorBoundary context={{ surface: "decide", programId: activeProgramId, activePhaseId }}>
            <DecideView
              program={activeProgram}
              activePhaseId={activePhaseId}
              mode={mode}
              onResolveDecision={handleResolveDecision}
              onAddDecision={handleAddDecision}
              onRequestRemediation={requestRemediation}
              onAddRaid={addRaidEntry}
              onCloseRaid={closeRaidEntry}
              onNavigateToPhaseInputs={navigateToPhaseInputs}
              persona={persona}
              initialIntent={decideIntent}
            />
          </AdamErrorBoundary>
        ) : null}

        {surface === "program" ? (
          <AdamErrorBoundary context={{ surface: "program", programId: activeProgramId, activePhaseId }}>
            {activeProgram && activeProgramRole === "viewer" ? (
              <div
                role="status"
                style={{
                  margin: "0 0 12px",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--v3-surface-2, rgba(255,255,255,0.04))",
                  border: "1px solid var(--v3-border, rgba(255,255,255,0.12))",
                  fontSize: 12,
                  color: "var(--v3-text-secondary)",
                }}
              >
                You have <strong>read-only</strong> access to this program. Editing and running agents are disabled. Ask a program admin for editor access.
              </div>
            ) : null}
            {/* Workspace browser — shows when no specific workspace is selected */}
            {!moreView && !reportId ? (
              <MoreView
                currentView={null}
                onSelectView={(view) => view ? openMoreView(view) : openMoreView(null)}
                renderView={() => null}
                activePhaseId={activePhaseId}
                activePhaseName={activePhaseId ? phaseNameById(activeProgram, activePhaseId) : null}
              />
            ) : (
              <ProgramView
                program={activeProgram}
                mode={mode}
                focusedReportId={reportId}
                currentView={moreView}
                sanity={sanity}
                validation={validation}
                hasBlockers={hasBlockers}
                warningCount={warningCount}
                narrativeIsRunning={narrativeIsRunning}
                renderView={() => (
                  <ProgramDetailRouter
                    view={moreView}
                    reportId={reportId}
                    program={activeProgram}
                    programId={activeProgramId}
                    activeRuns={activeRuns}
                    triggers={{ ...triggers, runTwinSync: () => void runProgramAgent({ agentId: "twin-sync", phaseId: "program", triggeredBy: "user" }) }}
                    agentCards={agentCards}
                    agentActivityMap={agentActivityMap}
                    narrativeIsRunning={narrativeIsRunning}
                    healthHeatmapIsRunning={healthHeatmapIsRunning}
                    milestoneSavePending={milestoneSavePending}
                    budgetSavePending={budgetSavePending}
                    onRefresh={refreshPrograms}
                    onAddMilestone={handleAddMilestone}
                    onCompleteMilestone={handleCompleteMilestone}
                    onSaveBudgetInputs={handleSaveBudgetInputs}
                    onOpenPhase={openPhaseSheet}
                    onNavigate={navigateAppView}
                    onSaveNarrativeCorrection={handleSaveNarrativeCorrection}
                    onSavePhaseInputs={handleSavePhaseInputs}
                    onSaveAllPhaseInputs={handleSaveAllPhaseInputs}
                    onRefineImportField={handleRefineImportField}
                    onOpenIntelligence={() => { setIntelligenceInitialTab(undefined); openMoreView("intelligence"); }}
                    intelligenceInitialTab={intelligenceInitialTab}
                    onOpenTrace={(id) => setTraceRunId(id)}
                    patternsCount={patterns.length}
                    onExtractPatterns={async () => {
                      await runProgramAgent({ agentId: "pattern-extract", phaseId: "program", triggeredBy: "user" });
                      await refreshPatterns();
                    }}
                    onRunAgent={handleRunAgent}
                    currentUserId={userId}
                  />
                )}
                onOpenMoreView={openMoreView}
                onOpenReport={openReport}
                onNavigateToPipeline={() => navigateSurface("pipeline")}
                onNavigateToProgrammeHealth={() => navigateSurface("programme-health")}
                onNavigateToStage={openPhaseSheet}
              />
            )}
          </AdamErrorBoundary>
        ) : null}

        {surface === "portfolio" ? (
          <AdamErrorBoundary context={{ surface: "portfolio", programId: activeProgramId }}>
            <PortfolioView
              programs={programs}
              activeProgramId={activeProgramId}
              onSelectProgram={(id) => {
                setActiveProgramId(id);
                commitNavigation({ surface: "insight-feed", moreView: null, activePhaseId: null, reportId: null });
              }}
              onManageAccess={(id) => {
                setActiveProgramId(id);
                commitNavigation({ surface: "program", moreView: "access", activePhaseId: null, reportId: null });
              }}
              onDeleteProgram={handleDeleteProgram}
              loading={programsLoading || false}
              onCreateProgram={() => setWizardOpen(true)}
              anyAgentRunning={anyAgentRunning}
              onRunAgent={handleRunAgent}
            />
          </AdamErrorBoundary>
        ) : null}

        {surface === "insight-feed" ? (
          <AdamErrorBoundary context={{ surface: "insight-feed", programId: activeProgramId }}>
            <InsightFeedView
              program={activeProgram}
              programs={programs}
              activePhaseId={activePhaseId}
              confidenceScore={programConfidenceScore}
              confidenceResult={programConfidenceResult ?? undefined}
              openDecisionCount={actionCenterCount}
              anyAgentRunning={anyUserAgentRunning}
              agentsAvailable={authed && isSupabaseConfigured}
              onNavigateToDecide={() => navigateSurface("decide")}
              onNavigateToGates={() => navigateSurface("programme-health")}
              onNavigateToPipeline={() => navigateSurface("pipeline")}
              onNavigateToPhase={openPhaseSheet}
              onOpenPhase={openPhaseSheet}
              onRunAgent={handleRunAgent}
              onNavigateToPortfolio={() => navigateSurface("portfolio")}
              onNavigateToExecutive={() => navigateSurface("executive")}
              onOpenMoreView={(view) => openMoreView(view)}
            />
          </AdamErrorBoundary>
        ) : null}

        {surface === "executive" ? (
          <AdamErrorBoundary context={{ surface: "executive", programId: activeProgramId }}>
            <ExecutiveView
              program={activeProgram}
              programs={programs}
              confidenceScore={programConfidenceScore}
              confidenceResult={programConfidenceResult ?? undefined}
              onApproveGate={handleApproveGate}
              onRunAgent={handleRunAgent}
              anyAgentRunning={anyUserAgentRunning}
              narrativeRunning={narrativeIsRunning}
              onNavigateToDecide={() => navigateSurface("decide")}
              onNavigateToGates={() => navigateSurface("programme-health")}
              onNavigateToPipeline={() => navigateSurface("pipeline")}
              onNavigateToPhase={openPhaseSheet}
              onNavigateToRisks={() => openMoreView("risks")}
            />
          </AdamErrorBoundary>
        ) : null}

        {surface === "programme-health" ? (
          <AdamErrorBoundary context={{ surface: "programme-health", programId: activeProgramId }}>
            <ProgrammeHealthView
              programId={activeProgramId ?? ""}
              program={activeProgram}
              rawData={rawData}
              processedPhases={activeProgram?.phases}
              activePhaseId={activePhaseId}
              onSetPhase={handleSelectPhase}
              onApproveGate={handleApproveGate}
              onRequestRemediation={requestRemediation}
              onDecideDecision={handleDecideDecision}
              onDeferDecision={handleDeferDecision}
              onRunAgent={handleRunAgent}
              anyAgentRunning={anyAgentRunning}
              confidenceScore={programConfidenceScore}
              onNavigateToPhase={openPhaseSheet}
            />
          </AdamErrorBoundary>
        ) : null}
        </React.Suspense>


      </div>
      {/* Context drawer — only show in phase work areas */}
      {(surface === "stage" || surface === "pipeline") ? (
        <ContextDrawer
          open={contextDrawerOpen}
          onToggle={handleDrawerToggle}
          program={activeProgram}
          phaseId={activePhaseId}
          tasks={currentPhaseTasks}
          pendingTaskCount={currentPhaseTasks.filter((task) => task.status === "pending" || task.status === "running").length}
          decisions={deriveOpenRecommendedActions(activeProgram, "delivery_lead").filter(
            (decision) => !decision.phaseId || decision.phaseId === activePhaseId,
          )}
          agentsAvailable={authed && isSupabaseConfigured}
          onUploadDocument={handleUploadDocument}
          onAnswerQuestion={handleAnswerAgentQuestion}
          onAcknowledgeTask={handleAcknowledgeTask}
          onRunAgent={handleRunAgent}
          onAddDecision={handleAddDecision}
          onAddRaid={addRaidEntry}
          onCloseRaid={closeRaidEntry}
          onOpenMoreView={(view) => openMoreView(view)}
          onOpenDecide={() => navigateSurface("decide")}
          onNavigateToPhaseInputs={navigateToPhaseInputs}
        />
      ) : null}
      </div>
      </div>

      {wizardOpen && activeProgram ? (
        <ProgramSetupWizard
          program={activeProgram}
          onSave={handleSaveSetup}
          onClose={() => void handleCancelSetup()}
          isSaving={wizardSaving}
        />
      ) : null}

      {activeProgramId ? (
        <CopilotPanel
          programId={activeProgramId}
          workspaceId={copilotWorkspaceId}
          persona={persona}
          nudge={firstNudge}
          memoryContext={copilotMemoryContext}
          onNavigate={navigateAppView}
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
        />
      ) : null}

      <CoPilotSidebar
        open={adamCopilotSidebarOpen}
        onClose={() => setAdamCopilotSidebarOpen(false)}
        activePhaseId={activePhaseId}
        programName={activeProgram?.name || "Programme"}
        confidenceScore={programConfidenceScore}
        openDecisionCount={actionCenterCount}
        anyAgentRunning={anyAgentRunning}
        aiStatus={aiStatus.status}
        onOpenAISettings={openAISettings}
        onRunAgent={handleRunAgent}
        onSendMessage={activeProgramId ? async (msg) => {
          try {
            await sendCopilotMessage(msg);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Copilot request failed. Please try again.";
            window.dispatchEvent(new CustomEvent("atlas-v3-toast", { detail: { message, tone: "error" } }));
          }
        } : undefined}
        onNavigate={(view) => {
          if (view === "decide") navigateSurface("decide");
          else if (view === "programme-health") navigateSurface("programme-health");
          else if (view === "executive") navigateSurface("executive");
          else if (view === "stage") navigateSurface("stage");
        }}
      />

      {traceRunId ? <AgentTraceDrawer runId={traceRunId} onClose={() => setTraceRunId(null)} /> : null}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        program={activeProgram}
        activeMode={activeMode}
        activePhaseId={activePhaseId}
        onModeChange={handleCommandModeChange}
        onRunAgent={handleRunAgent}
        onSelectPhase={handleSelectPhase}
        onQuery={async (query: string): Promise<string> => {
          // Attempt real AI via Supabase Edge Function
          if (activeProgramId && supabase && isSupabaseConfigured) {
            try {
              const { data, error } = await supabase.functions.invoke("run-agent", {
                body: {
                  programId: activeProgramId,
                  agentId: "chat",
                  phaseId: activePhaseId || "program",
                  triggeredBy: "user",
                  chatQuery: query,
                  context: {
                    programName: activeProgram?.name,
                    confidenceScore: programConfidenceScore,
                    avgCompletion: activeProgram?.phases?.length
                      ? Math.round(activeProgram.phases.reduce((s, p) => s + (p.pct || 0), 0) / activeProgram.phases.length)
                      : 0,
                    openDecisions: actionCenterCount,
                    activePhaseId,
                  },
                },
              });
              if (!error && typeof (data as any)?.output?.response === "string") {
                return (data as any).output.response as string;
              }
            } catch {
              // fall through to keyword matching
            }
          }
          // Fallback keyword matching
          const lower = query.toLowerCase();
          const phases = activeProgram?.phases ?? [];
          const avgPct = phases.length > 0 ? Math.round(phases.reduce((s, p) => s + (p.pct || 0), 0) / phases.length) : 0;
          const openD = actionCenterCount;
          const score = programConfidenceScore;
          if (lower.includes("risk")) {
            const raidCount = (activeProgram?.raidEntries || []).length;
            return `There are ${raidCount} risks recorded. Programme confidence is ${score ?? "unknown"}%. Run the Risk agent for a full assessment.`;
          }
          if (lower.includes("track") || lower.includes("status") || lower.includes("health")) {
            return `Programme is ${avgPct}% complete overall. Confidence: ${score ?? "calculating"}%. ${openD} action${openD !== 1 ? "s" : ""} are open. ${activePhaseId ? `Currently active in phase: ${activePhaseId}.` : ""}`;
          }
          if (lower.includes("gate") || lower.includes("ready")) {
            const gateCount = Object.keys(activeProgram?.gateReviews ?? {}).length;
            const approvedCount = Object.values(activeProgram?.gateReviews ?? {}).filter((g: any) => g?.status === "approved").length;
            const gateThreshold = getGateThreshold(activePhaseId ?? "");
            return `${approvedCount} of ${gateCount} gates approved. ${score && score < gateThreshold ? `Gate readiness is below ${gateThreshold}% — run an AI Gate Check to identify blockers.` : "Gate readiness looks healthy."}`;
          }
          if (lower.includes("decision") || lower.includes("action")) {
            return `${openD} action${openD !== 1 ? "s" : ""} currently open. ${openD > 0 ? "Navigate to the Action Center to review and resolve them." : "No pending actions."}`;
          }
          if (lower.includes("phase") || lower.includes("stage")) {
            const phaseList = phases.map(p => `${p.displayName ?? p.id} (${p.pct}%)`).join(", ");
            return `Phases: ${phaseList || "No phases configured"}.`;
          }
          return `Programme: ${activeProgram?.name ?? "Unknown"}. Confidence: ${score ?? "N/A"}%. Completion: ${avgPct}%. Open actions: ${openD}. Use specific queries like "status", "risks", "gate readiness", or "actions" for more detail.`;
        }}
      />
      {escalationPanelOpen ? (
        <EscalationPanel
          escalations={openEscalations}
          onAcknowledge={async (id) => {
            await acknowledgeEscalation(id);
            pushV3Toast("Acknowledged.", { tone: "success", duration: 2500 });
          }}
          onResolve={async (id) => {
            await resolveEscalation(id);
            pushV3Toast("Escalation resolved.", { tone: "success", duration: 2500 });
          }}
          onClose={() => setEscalationPanelOpen(false)}
        />
      ) : null}
      {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}

      <GateReopenModal
        open={!!gateReopenPhase}
        phaseName={gateReopenPhase ? (phaseNameById(activeProgram, gateReopenPhase) ?? gateReopenPhase) : ""}
        onClose={() => setGateReopenPhase(null)}
        onConfirm={handleConfirmGateReopen}
      />
      <PhaseDataOverwriteModal
        open={!!overwritePrompt}
        phaseName={overwritePrompt ? (phaseNameById(activeProgram, overwritePrompt.nextPhaseId) ?? overwritePrompt.nextPhaseId) : ""}
        onOverwrite={() => overwritePrompt?.resolve(true)}
        onKeep={() => overwritePrompt?.resolve(false)}
      />
      <RemediationNoteModal
        open={!!remediationPhase}
        phaseName={remediationPhase ? (phaseNameById(activeProgram, remediationPhase) ?? remediationPhase) : ""}
        onClose={() => setRemediationPhase(null)}
        onConfirm={async (note) => {
          if (!remediationPhase) return;
          await requestRemediation(remediationPhase, note);
          setRemediationPhase(null);
          pushV3Toast("Issues flagged. Gate blocked pending remediation.", { tone: "warning", duration: 4000 });
        }}
      />

      {toasts.length ? (
        <div className="v3-toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`v3-toast ${toast.tone ? `is-${toast.tone}` : ""}`}>
              {toast.icon ? <span className="v3-toast-icon">{toast.icon}</span> : null}
              <span className="v3-toast-message">{toast.message}</span>
              {toast.action ? (
                <button
                  type="button"
                  className="v3-toast-action"
                  onClick={() => {
                    setToasts((current) => current.filter((t) => t.id !== toast.id));
                    toast.action!.onClick();
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
