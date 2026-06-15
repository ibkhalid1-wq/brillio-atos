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
import { useCopilotThread } from "@/hooks/useCopilotThread";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import { CopilotPanel } from "@/new/components/shell/CopilotPanel";
import type { AppView, DecisionSummary, Milestone, Persona, ProgramSummary } from "@/new/types";
import type { PhaseAgentTask } from "@/lib/adamPhaseAgentTypes";
import { buildCrossPhaseContext } from "@/lib/adamOrchestrator";
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
import { useRelativeTimeTick } from "@/lib/useRelativeTimeTick";
import { useAgentCascadeToasts } from "@/v3/hooks/useAgentCascadeToasts";
import { useCriticalEventAlerts } from "@/v3/hooks/useCriticalEventAlerts";
import { useLocalProgramMigration } from "@/v3/hooks/useLocalProgramMigration";
import { usePhaseAgentState } from "@/v3/hooks/usePhaseAgentState";
import { useProgramValidation } from "@/v3/hooks/useProgramValidation";
import { getPhaseSequence } from "@/v3/lib/methodology";
import { computePhaseReadiness, getLockedPhaseIds } from "@/v3/lib/phaseReadiness";
import { confidenceRag, getGateThreshold } from "@/v3/lib/confidenceScore";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { buildFieldAssistPrompt, sanitiseFieldReply } from "@/v3/lib/fieldAssist";
import type { FieldAssistRequest } from "@/v3/components/PhaseInputsPanel";
const DecideView = React.lazy(() => import("@/v3/surfaces/DecideView"));
import GateReopenModal from "@/v3/components/GateReopenModal";
import RemediationNoteModal from "@/v3/components/RemediationNoteModal";
const MoreView = React.lazy(() => import("@/v3/surfaces/MoreView"));
const PipelineView = React.lazy(() => import("@/v3/surfaces/PipelineView"));
const PortfolioView = React.lazy(() => import("@/v3/surfaces/PortfolioView"));
const ProgramView = React.lazy(() => import("@/v3/surfaces/ProgramView"));
const StageView = React.lazy(() => import("@/v3/surfaces/StageView"));
import type { AgentActivityItem } from "@/v3/components/AgentActivityFeed";
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

const MORE_ROUTE_MAP: Record<string, V3MoreView> = {
  documents: "documents",
  narrative: "narrative",
  plan: "plan",
  milestones: "milestones",
  milestone: "milestones",
  risks: "risks",
  budget: "budget",
  "critical-path": "critical-path",
  criticalpath: "critical-path",
  "change-impact": "change-impact",
  changeimpact: "change-impact",
  stakeholders: "stakeholders",
  stakeholder: "stakeholders",
  adoption: "adoption",
  health: "health",
  "health-heatmap": "health",
  retro: "retro",
  "scope-pcr": "scope-pcr",
  intelligence: "intelligence",
  "ai-settings": "intelligence",
  twin: "twin",
  accelerators: "accelerators",
  benchmark: "benchmark",
  "decision-audit": "decision-audit",
  "pattern-library": "pattern-library",
  "agent-activity": "agent-activity",
  "artifact-history": "artifact-history",
  schedules: "schedules",
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
  "critical-path": "/critical-path",
  "change-impact": "/change-impact",
  stakeholders: "/stakeholders",
  adoption: "/adoption",
  health: "/health-heatmap",
  retro: "/retro",
  "scope-pcr": "/scope-pcr",
  intelligence: "/intelligence",
  twin: "/twin",
  accelerators: "/accelerators",
  schedules: "/schedules",
  access: "/access",
  benchmark: "/benchmark",
  "decision-audit": "/decision-audit",
  "pattern-library": "/pattern-library",
  "agent-activity": "/agent-activity",
  "artifact-history": "/artifact-history",
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
  "critical-path": "critical-path",
  "change-impact": "change-impact",
  stakeholders: "stakeholders",
  adoption: "adoption",
  "health-heatmap": "health",
  retro: "retro",
  "scope-pcr": "scope-pcr",
  intelligence: "intelligence",
  twin: "twin",
  accelerators: "accelerators",
  schedules: "schedules",
  benchmark: "benchmark",
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
  adoption: "Adoption",
  health: "Health Dashboard",
  retro: "Retrospective",
  "scope-pcr": "Scope Changes",
  "critical-path": "Critical Path",
  narrative: "Programme Narrative",
  plan: "Action Plan",
  documents: "Documents",
  twin: "Digital Twin",
  accelerators: "Accelerators",
  schedules: "Agent Schedules",
  access: "Access & Sharing",
  benchmark: "Benchmarks",
  "decision-audit": "Decision Audit",
  "pattern-library": "Pattern Library",
  "agent-activity": "Programme Intelligence",
  "artifact-history": "Artifact History",
  intelligence: "AI Settings",
};

function TopbarBreadcrumb({
  surface,
  activePhaseLabel,
  moreView,
  onNavigate,
  onClearMoreView,
}: {
  surface: V3Surface;
  activePhaseLabel: string | null;
  moreView: string | null;
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

  // Workspace drill-down: "Workspaces › Risk & Issues"
  if (surface === "program" && moreView) {
    const workspaceLabel = MORE_VIEW_LABELS[moreView] || moreView;
    return (
      <nav className="v3-topbar-breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="v3-topbar-breadcrumb-link" onClick={onClearMoreView}>
          Workspaces
        </button>
        <span className="v3-topbar-breadcrumb-sep" aria-hidden="true">›</span>
        <span className="v3-topbar-breadcrumb-current" aria-current="page">{workspaceLabel}</span>
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
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
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
                        <input
                          id="atlas-auth-password"
                          type="password"
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
                    <input
                      id="atlas-auth-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Choose a strong password"
                      className="v3-auth-input"
                    />
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
                        <input
                          id="atlas-auth-password"
                          type="password"
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
    return window.location.pathname.replace(/^\/+/, "") === "ai-settings" ? "Provider" : undefined;
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
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [adamCopilotSidebarOpen, setAdamCopilotSidebarOpen] = useState(false);
  const [gateReopenPhase, setGateReopenPhase] = useState<string | null>(null);
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
  const { programs, activeProgram, activeProgramId, setActiveProgramId, refreshPrograms, updateProgramData, resolveDecision, isLoading: programsLoading, activeProgramRole, canEditActiveProgram, isActiveProgramAdmin } = usePrograms({
    enabled: authChecked && migrated,
    userId,
  });
  const { activeRuns, isRunning: agentIsRunning, isUserRunning: agentIsUserRunning, runAgent, channelStatus } = useAgentRun(activeProgramId, authed, refreshPrograms);
  const aiStatus = useAIStatus(true); // status check works without auth since edge function accepts anon key
  const agentCards = useMemo(() => buildAgentCards(activeProgram, activeRuns), [activeProgram, activeRuns]);
  const agentActivityMap = useMemo(() => buildAgentActivityMap(activeRuns), [activeRuns]);
  const rawData = useMemo(() => activeProgram?.rawData || {}, [activeProgram?.rawData]);

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

  // ── Phase-entry auto-trigger — brief the team when they first visit a fresh phase ──
  // Fires the onboarding-briefer agent exactly once per phase per programme session.
  // Gives the team the phase purpose, recommended first actions, and exit criteria
  // without requiring them to know the ATOS methodology.
  const phaseEntryTriggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeProgram || !activePhaseId || !activeProgramId) return;
    if (!authed || aiStatus.status !== "connected") return;
    if (anyAgentRunning) return;
    const gateStatus = activeProgram.gateReviews?.[activePhaseId]?.status;
    if (gateStatus === "approved") return; // Skip if phase already done

    const entryKey = `${activeProgramId}:${activePhaseId}`;
    if (phaseEntryTriggeredRef.current.has(entryKey)) return;

    // Check if this phase has any data at all
    const rawSource = typeof activeProgram.rawData === "object" && activeProgram.rawData !== null
      ? ("data" in activeProgram.rawData && typeof (activeProgram.rawData as Record<string,unknown>).data === "object"
        ? (activeProgram.rawData as Record<string,unknown>).data as Record<string,unknown>
        : activeProgram.rawData as Record<string,unknown>)
      : null;
    const phaseInputs = rawSource?.phaseInputs as Record<string,unknown> | undefined;
    const hasInputs = !!(phaseInputs?.[activePhaseId] && Object.keys(phaseInputs[activePhaseId] as Record<string,unknown>).filter((k) => !k.startsWith("_")).length > 0);
    const phaseArtifacts = rawSource?.phaseArtifacts as Record<string,unknown> | undefined;
    const hasArtifacts = !!(phaseArtifacts?.[activePhaseId] && Object.keys(phaseArtifacts[activePhaseId] as Record<string,unknown>).length > 0);

    // Only trigger for genuinely fresh phases with no data.
    // Use a 4-second delay so the UI settles before the agent fires,
    // preventing the perception of the dashboard being immediately "frozen".
    if (!hasInputs && !hasArtifacts) {
      phaseEntryTriggeredRef.current.add(entryKey);
      const t = setTimeout(() => {
        void runProgramAgent({
          agentId: "onboarding-briefer",
          phaseId: activePhaseId,
          triggeredBy: "proactive",
        });
      }, 4000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhaseId, activeProgramId, authed, aiStatus.status]);

  // ── Proactive agent triggers (Priority 3) ────────────────────────────────────
  // When readiness drops below 60% on the active phase, auto-trigger the gate
  // readiness coach so the user is proactively guided — not waiting to discover
  // the problem themselves. Runs at most once per phase per session.
  const lastProactiveTriggerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProgram || !activePhaseId || anyAgentRunning) return;
    if (!authed || !activeProgramId) return;
    // Only trigger when AI is connected
    if (aiStatus.status !== "connected") return;

    const readiness = computePhaseReadiness(activeProgram, activePhaseId);
    const threshold = getGateThreshold(activePhaseId);
    const gateStatus = activeProgram.gateReviews?.[activePhaseId]?.status;

    // Don't trigger if gate is already approved or already in review
    if (gateStatus === "approved" || gateStatus === "pending-review") return;

    const triggerKey = `${activeProgramId}:${activePhaseId}:${Math.round(readiness.score / 10)}`;
    if (lastProactiveTriggerRef.current === triggerKey) return;

    // Trigger when readiness is low but work is underway (score > 5 means some activity)
    if (readiness.score > 5 && readiness.score < Math.max(40, threshold - 20)) {
      lastProactiveTriggerRef.current = triggerKey;
      pushV3Toast(
        `Gate readiness is ${readiness.score}% — ADAM is running a readiness assessment to identify blockers.`,
        { tone: "info", duration: 4000 },
      );
      void runProgramAgent({
        agentId: "gate-readiness-coach",
        phaseId: activePhaseId,
        triggeredBy: "proactive",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePhaseId, activeProgramId, authed, aiStatus.status]);

  const nudges = useMemo(() => {
    if (!activeProgram) return [];
    return evaluateProactiveNudges(activeProgram);
  }, [activeProgram]);
  const firstNudge = useMemo(() => {
    const nudge = nudges[0];
    if (!nudge) return null;
    return {
      id: nudge.id || "nudge-0",
      message: nudge.message,
      actionLabel: nudge.actionLabel || "View →",
      actionView: (nudge.actionViewId as AppView | null | undefined) || null,
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
      "executive-brief": "daily-briefing",
      "portfolio-intelligence": "health-heatmap",
      "steerco-prep": "steerco-agenda-builder",
    };
    return aliases[agentId] || agentId;
  }, []);

  const runProgramAgent = useCallback(async ({
    agentId,
    phaseId,
    triggeredBy,
    decisionId,
    documentId,
    docText,
    audienceGroup,
    memberName,
    memberRole,
    meetingDate,
    meetingDurationMins,
  }: {
    agentId: string;
    phaseId: string;
    triggeredBy: "user" | "trigger" | "proactive";
    decisionId?: string;
    documentId?: string;
    docText?: string;
    audienceGroup?: "executive" | "operational" | "all";
    memberName?: string;
    memberRole?: string;
    meetingDate?: string;
    meetingDurationMins?: number;
  }) => {
    if (!activeProgramId) return;

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

    // Guard: AI not connected — show actionable message instead of a cryptic error
    if (!aiStatus || aiStatus.status !== "connected") {
      pushV3Toast("AI is not connected. Open AI Settings to add a provider key.", {
        tone: "warning",
        duration: 6000,
        action: { label: "AI Settings →", onClick: openAISettings },
      });
      return;
    }

    const resolvedAgentId = resolveAgentId(agentId);
    const crossPhaseContext = buildCrossPhaseContext(activeProgramId, phaseId);

    try {
      // Ensure the programme exists in Supabase before calling the edge function.
      // Local-only programmes (localStorage-only) will fail the edge function lookup.
      // We always upsert (not just on missing row) so that data stays current.
      // rawData may be {} if it was previously synced from an empty Supabase row,
      // so fall back to reading the raw entry directly from localStorage.
      if (isSupabaseConfigured && supabase && activeProgram && userId) {
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
          throw new Error(`Could not sync programme to cloud before running agent: ${syncError.message}`);
        }
      }
      await runAgent({
        agentId: resolvedAgentId,
        phaseId,
        triggeredBy,
        crossPhaseContext,
        decisionId,
        documentId,
        docText,
        audienceGroup,
        memberName,
        memberRole,
        meetingDate,
        meetingDurationMins,
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
      if (typeof window === "undefined" || window.location.pathname !== "/auth") {
        const isKeyError = /api key|not configured|provider|isOlderThan|connect/i.test(message);
        const isAuthError = /jwt|invalid.*token|unauthorized|not authenticated|malformed/i.test(message);
        const isNotDeployed = /not deployed|edge function/i.test(message);
        if (isAuthError) {
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
    (agentId: string, phaseId?: string) =>
      void runProgramAgent({ agentId, phaseId: phaseId || activePhaseId || "program", triggeredBy: "user" }),
    [runProgramAgent, activePhaseId],
  );

  const { addMilestone, completeMilestone, isSaving: milestoneSavePending } = useMilestones(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  const { saveBudgetInputs, isSaving: budgetSavePending } = useBudgetTracking(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  useClosure(activeProgramId || "", activeProgram?.rawData || {}, refreshPrograms);
  const { approveGate, requestRemediation, saveNote: saveGateNote, reopenGate } = useGateReview(activeProgramId || "", rawData, refreshPrograms);
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
    return ["narrative", "plan", "risk", "gate-review", "retro"]
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
  const anyAgentRunning = agentIsRunning || triggers.gateReviewRunningPhaseSet.size > 0 || triggers.escalationIsRunning;
  // For ExecCommandPanel / ExecutiveView buttons: only block when the *user* triggered a run,
  // not when a background / proactive agent is sitting in the DB in "queued"/"running" state.
  // agentIsUserRunning === isLoading, which is true only during the runAgent() HTTP call itself
  // and resets in the finally block — never gets stuck regardless of DB run state.
  const anyUserAgentRunning = agentIsUserRunning;
  const showConnectionStatus = !authRoute && authed && !!activeProgramId && channelStatus !== "connected";
  const openDecisions = useMemo(() => (activeProgram?.decisionQueue || []).filter(isDecisionOpen), [activeProgram?.decisionQueue]);
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
    const programme = score == null ? "amber" : confidenceRag(score);
    const ai = aiStatus.status === "connected" ? "green" : aiStatus.status === "checking" ? "amber" : "red";
    const escalationCount = (activeProgram?.escalations || []).filter((e: any) => e.status === "open").length;
    const aiNotReady = aiStatus.status !== "connected" && aiStatus.status !== "checking";
    const agents = aiNotReady ? "red"
      : anyAgentRunning ? "green"
      : escalationCount > 0 ? "red"
      : openDecisions.length > 0 ? "amber"
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
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => {
        if (current.some((toast) => toast.message === detail.message && toast.tone === detail.tone)) {
          return current;
        }
        return [...current, { id, message: detail.message, icon: detail.icon, tone: detail.tone, action: detail.action }].slice(-MAX_VISIBLE_TOASTS);
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

    void supabase.auth.getSession().then(({ data }) => {
      settled = true;
      window.clearTimeout(fallbackTimer);
      applySession(data.session);
    }).catch(() => {
      settled = true;
      window.clearTimeout(fallbackTimer);
      applySession(null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
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

  useEffect(() => {
    if (!activeProgram) return;
    const validCurrent = activeProgram.phases.some((phase) => phase.id === activePhaseId);
    if (validCurrent) return;
    const inProgress = activeProgram.phases.find((phase) => (phase.pct ?? 0) > 0 && (phase.pct ?? 0) < 100);
    setActivePhaseId(inProgress?.id || activeProgram.phases[0]?.id || null);
  }, [activePhaseId, activeProgram]);

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

  const handleCommandModeChange = useCallback((nextMode: V3CommandMode) => {
    if (nextMode === ("executive" as any)) {
      commitNavigation({ surface: "executive", moreView: null, activePhaseId, reportId: null });
      return;
    }
    setActiveMode(nextMode);
    const nextSurface = commandModeToSurface(nextMode, surface);
    commitNavigation({
      surface: nextSurface,
      moreView: nextSurface === "program" ? moreView : null,
      activePhaseId,
      reportId: nextSurface === "program" ? reportId || "status" : null,
    });
  }, [activePhaseId, commitNavigation, moreView, reportId, surface]);

  const navigateSurface = useCallback((nextSurface: V3Surface) => {
    commitNavigation({
      surface: nextSurface,
      moreView: null,
      activePhaseId,
      reportId: nextSurface === "program" ? reportId || "status" : null,
    });
  }, [activePhaseId, commitNavigation, reportId]);

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
        // Short delay so the new activeProgram is set before opening the wizard
        setTimeout(() => setWizardOpen(true), 150);
      }
    } catch (error) {
      reportError(error instanceof Error ? error : new Error(String(error)), { action: "create_program" });
      pushV3Toast("Could not create programme.", { tone: "error", duration: 4000 });
    }
  }, [refreshPrograms, setActiveProgramId, userId]);

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
  ) => {
    if (!activeProgram) return;
    const source = getProgramState(activeProgram.rawData || {}).inner;
    const queue = Array.isArray(source?.decisionQueue) ? source.decisionQueue as Record<string, unknown>[] : [];
    const decision = queue.find((entry) => entry.id === decisionId);
    const isPCR = decision?.type === "pcr-review" || decision?.source === "scope-pcr";

    try {
      await resolveDecision(activeProgram.id, decisionId, resolution, currentUser?.email, modifiedContent);
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
      setWizardOpen(false);
      pushV3Toast("Programme details saved.", { tone: "success", duration: 2500 });
    } catch (error) {
      pushV3Toast("Could not save programme details.", { tone: "error", duration: 4000 });
      throw error;
    }
  }, [saveSetup]);

  const handleUpdatePhasePct = useCallback(async (phaseId: string, pct: number) => {
    await updatePhasePct(phaseId, pct);
  }, [updatePhasePct]);

  const handleAddDecision = useCallback(async (decision: Omit<DecisionSummary, "id" | "status" | "createdAt">) => {
    const newDecision = await addDecision(decision);
    if (!activeProgram?.id || !newDecision || !supabase) return;
    await supabase.functions.invoke("run-agent", {
      body: {
        programId: activeProgram.id,
        agentId: "decision-advisor",
        phaseId: decision.phaseId || activePhaseId || "program",
        decisionId: newDecision.id,
        triggeredBy: "trigger",
      },
    });
    await refreshPrograms();
  }, [activePhaseId, activeProgram?.id, addDecision, refreshPrograms]);

  const handleSaveNarrativeCorrection = useCallback(async (note: string) => {
    await addProgramNote(note, "narrative-correction");
  }, [addProgramNote]);

  const handleSaveGateNote = useCallback(async (phaseId: string, note: string) => {
    await saveGateNote(phaseId, note);
    await addProgramNote(note, "gate-note", { phaseId });
  }, [addProgramNote, saveGateNote]);

  const handleSaveStageNote = useCallback(async (phaseId: string, note: string) => {
    await addProgramNote(note, "stage-note", { phaseId });
    pushV3Toast("Note saved. ADAM will use it on the next run.", { tone: "success", duration: 3000 });
  }, [addProgramNote]);

  const handleSavePhaseInputs = useCallback(async (phaseId: string, inputs: Record<string, string>) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const existing = typeof cloned.inner.phaseInputs === "object" && cloned.inner.phaseInputs !== null
      ? { ...(cloned.inner.phaseInputs as Record<string, unknown>) }
      : {};
    existing[phaseId] = { ...((existing[phaseId] as Record<string, unknown>) ?? {}), ...inputs, savedAt: new Date().toISOString() };
    const payload = cloned.commit({ ...cloned.inner, phaseInputs: existing });
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    await runProgramAgent({ agentId: "input-quality", phaseId, triggeredBy: "trigger" });
    await refreshPrograms();
    pushV3Toast("Inputs saved. Ready to run agents.", { tone: "success", duration: 2500 });
  }, [activeProgram, refreshPrograms, runProgramAgent, updateProgramData]);

  // Atomic multi-phase save — used by document import to avoid stale-closure overwrites
  const handleSaveAllPhaseInputs = useCallback(async (allInputs: Record<string, Record<string, string>>, firstPhaseId?: string) => {
    if (!activeProgram) return;
    const cloned = cloneRawProgram(activeProgram);
    const existing = typeof cloned.inner.phaseInputs === "object" && cloned.inner.phaseInputs !== null
      ? { ...(cloned.inner.phaseInputs as Record<string, unknown>) }
      : {};
    for (const [phaseId, inputs] of Object.entries(allInputs)) {
      existing[phaseId] = { ...((existing[phaseId] as Record<string, unknown>) ?? {}), ...inputs, savedAt: new Date().toISOString() };
    }
    const payload = cloned.commit({ ...cloned.inner, phaseInputs: existing });
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    await refreshPrograms();
    // Navigate to the first phase that received inputs and open the context drawer
    const targetPhase = firstPhaseId ?? Object.keys(allInputs)[0];
    if (targetPhase) {
      setActivePhaseId(targetPhase);
      commitNavigation({ surface: "stage", moreView: null, activePhaseId: targetPhase, reportId: null });
      setContextDrawerOpen(true);
      window.localStorage.setItem(CONTEXT_DRAWER_STORAGE_KEY, "true");
    }
    const phaseCount = Object.keys(allInputs).length;
    const fieldCount = Object.values(allInputs).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
    pushV3Toast(`${fieldCount} field${fieldCount !== 1 ? "s" : ""} saved across ${phaseCount} phase${phaseCount !== 1 ? "s" : ""}. Ready to run agents.`, { tone: "success", duration: 3500 });
  }, [activeProgram, commitNavigation, refreshPrograms, updateProgramData]);

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
    const phaseLabel = activeProgram.phases.find((p) => p.id === phaseId)?.name ?? phaseId;
    const message = buildFieldAssistPrompt(request.mode, {
      programName: activeProgram.name,
      client: activeProgram.client,
      industry: activeProgram.industry,
      objective: activeProgram.objective,
      phaseLabel,
      fieldLabel: request.fieldLabel,
      fieldHint: request.fieldHint,
      currentValue: request.currentValue,
    });
    const { data, error } = await supabase.functions.invoke("copilot-chat", {
      body: { programId: activeProgram.id, workspaceId: `phase-input:${phaseId}`, message, stream: false },
    });
    if (error) {
      throw new Error(error.message || "AI assist request failed.");
    }
    const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI assist returned no suggestion.");
    }
    return sanitiseFieldReply(content);
  }, [activeProgram]);

  const handleApproveGate = useCallback(async (phaseId: string) => {
    if (!activeProgram) return;

    // Only run dependency-check agent if Supabase is available (may be absent in local/anon mode)
    if (supabase) {
      try {
        const dependencyResponse = await supabase.functions.invoke("run-agent", {
          body: {
            programId: activeProgram.id,
            agentId: "dependency-check",
            phaseId,
            triggeredBy: "trigger",
          },
        });
        const dependencyCheck = (dependencyResponse.data as { output?: { passed?: boolean; issues?: Array<{ severity?: string; description?: string }> } } | undefined)?.output;
        const blockingIssue = dependencyCheck?.issues?.find((issue) => issue.severity === "blocking");
        if (dependencyCheck && dependencyCheck.passed === false && blockingIssue?.description) {
          pushV3Toast(`Gate blocked: ${blockingIssue.description}`, { tone: "error", duration: 5000 });
          return;
        }
      } catch {
        // Dependency check unavailable (no auth / agent down) — proceed with manual approval
      }
    }

    await refreshPrograms();
    const source = getProgramState(activeProgram.rawData || {}).inner;
    const handoffQuality = typeof source.handoffQuality === "object" && source.handoffQuality !== null
      ? (source.handoffQuality as Record<string, { passed?: boolean; score?: number; missing?: string[] }>)[phaseId]
      : undefined;
    if (handoffQuality && handoffQuality.passed === false) {
      pushV3Toast(
        `Handoff incomplete (${handoffQuality.score ?? 0}%): ${handoffQuality.missing?.[0] || "Missing sections"}`,
        { tone: "warning", duration: 5000 },
      );
    }
    try {
      await approveGate(phaseId);
      pushV3Toast("Gate approved.", { tone: "success", duration: 2500 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gate approval failed. Please try again.";
      pushV3Toast(message, { tone: "error", duration: 4000 });
    }
  }, [activeProgram, approveGate, refreshPrograms]);

  const handleReopenGate = useCallback(async (phaseId: string) => {
    setGateReopenPhase(phaseId);
  }, []);

  const handleConfirmGateReopen = useCallback(async (reason: string) => {
    if (!gateReopenPhase) return;
    const phaseId = gateReopenPhase;
    setGateReopenPhase(null);
    try {
      await reopenGate(phaseId, reason);
      pushV3Toast("Gate reopened. Next phase is locked pending re-approval.", { tone: "warning", duration: 4000 });
    } catch {
      pushV3Toast("Could not reopen gate.", { tone: "error", duration: 3000 });
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
    await updateProgramData(activeProgram.id, payload, activeProgram.updatedAt);
    await refreshPrograms();
    await refreshPhaseTasks();
    pushV3Toast("Answer saved. ADAM will continue from here.", { tone: "success", duration: 2500 });
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

  const handleDecideDecision = useCallback(async (id: string, decision: string) => {
    await handleResolveDecision(id, "approved", decision);
  }, [handleResolveDecision]);

  const handleDeferDecision = useCallback(async (id: string) => {
    await handleResolveDecision(id, "deferred");
  }, [handleResolveDecision]);

  // Map activeRuns to AgentActivityItem[] for new surfaces
  const agentActivityItems = useMemo((): AgentActivityItem[] =>
    activeRuns.map((run) => {
      const startTs = run.started_at ?? run.created_at;
      const endTs = run.completed_at;
      const durationMs = startTs && endTs
        ? new Date(endTs).getTime() - new Date(startTs).getTime()
        : undefined;
      const feedStatus: AgentActivityItem["status"] =
        run.status === "running" ? "running"
        : run.status === "done" || run.status === "complete" ? "success"
        : run.status === "error" || run.status === "failed" ? "failed"
        : "queued";
      return {
        runId: run.id,
        agentId: run.agent_id,
        status: feedStatus,
        startedAt: startTs ?? new Date().toISOString(),
        durationMs,
        phaseId: run.phase_id ?? undefined,
        // Surface the failure reason inline (provider outage vs auth vs other) so a
        // failed run isn't an opaque red ✗ — the feed classifies + renders it.
        errorMessage: feedStatus === "failed" ? (run.error_message ?? undefined) : undefined,
      };
    }),
  [activeRuns]);

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
      pushV3Toast("Demo programme loaded — ADAM is ready to explore.", { tone: "success", duration: 3000 });
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

  if (programsLoading && (!programs || programs.length === 0)) {
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

  if (!programsLoading && (!programs || programs.length === 0)) {
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
                Brillio's Agentic Transformation OS. Create your first programme to unlock agent-driven insights, gate reviews, and delivery intelligence.
              </p>
              <button
                type="button"
                className="v3-welcome-cta"
                onClick={() => void handleCreateProgram()}
              >
                + Create programme
              </button>
            </div>

            {/* Capability tiles */}
            <div className="v3-welcome-tiles">
              {[
                { icon: "◎", title: "Programme narrative", body: "ADAM reads your objective and generates a live status narrative updated by agents continuously." },
                { icon: "⬡", title: "Gate readiness", body: "Automated gate checks surface blockers, missing artefacts, and approval confidence before each milestone." },
                { icon: "⋯", title: "Action intelligence", body: "A prioritised action plan per phase, driven by risk signals, decisions, and delivery health." },
                { icon: "◫", title: "Executive deck", body: "One-click SteerCo packs and closure reports generated from live programme data." },
              ].map((tile) => (
                <div key={tile.title} className="v3-welcome-tile">
                  <span className="v3-welcome-tile-icon">{tile.icon}</span>
                  <span className="v3-welcome-tile-title">{tile.title}</span>
                  <span className="v3-welcome-tile-body">{tile.body}</span>
                </div>
              ))}
            </div>

            {/* Quick-start options */}
            <div className="v3-welcome-quickstart">
              <div className="v3-welcome-quickstart-label">Or get started another way</div>
              <div className="v3-welcome-quickstart-row">
                <button
                  type="button"
                  className="v3-welcome-quickstart-item"
                  onClick={() => { void handleCreateProgram(); }}
                >
                  <span className="v3-welcome-quickstart-item-icon">↑</span>
                  <span className="v3-welcome-quickstart-item-text">Upload a document</span>
                </button>
                <button
                  type="button"
                  className="v3-welcome-quickstart-item"
                  onClick={() => setHelpOpen(true)}
                >
                  <span className="v3-welcome-quickstart-item-icon">?</span>
                  <span className="v3-welcome-quickstart-item-text">Read the guide</span>
                </button>
                <button
                  type="button"
                  className="v3-welcome-quickstart-item"
                  onClick={openAISettings}
                >
                  <span className="v3-welcome-quickstart-item-icon">✦</span>
                  <span className="v3-welcome-quickstart-item-text">Connect AI provider</span>
                </button>
              </div>
            </div>

          </div>
        </div>

        {helpOpen && (
          <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
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
        activePhaseLabel={activePhaseId ? phaseNameById(activeProgram, activePhaseId) : null}
        confidenceScore={programConfidenceScore}
        anyAgentRunning={anyAgentRunning}
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
        openDecisionCount={openDecisions.length}
      />

      <div className="v3-main-frame">
      <div className="v3-topbar">
        <div className="v3-topbar-brand-group">
          <BrandLogo />
          <TopbarBreadcrumb
            surface={surface}
            activePhaseLabel={activePhaseId ? phaseNameById(activeProgram, activePhaseId) : null}
            moreView={moreView}
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
                onOpenReport={openReport}
                onSaveGateNote={handleSaveGateNote}
                onSaveStageNote={handleSaveStageNote}
                onApproveGate={handleApproveGate}
                onReopenGate={handleReopenGate}
                onGenerateCriteria={() => void runProgramAgent({ agentId: "exit-criteria-generator", phaseId: activePhaseId || "program", triggeredBy: "user" })}
                onRequestRemediation={requestRemediation}
                onRunAgent={handleRunAgent}
                onSaveArtifact={handleSaveArtifact}
                onSaveInputs={handleSavePhaseInputs}
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
              onApproveGate={handleApproveGate}
              onRequestRemediation={requestRemediation}
              onAddRaid={addRaidEntry}
              onCloseRaid={closeRaidEntry}
              persona={persona}
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
              openDecisionCount={openDecisions.length}
              anyAgentRunning={anyUserAgentRunning}
              agentsAvailable={authed && isSupabaseConfigured}
              onNavigateToDecide={() => navigateSurface("decide")}
              onNavigateToGates={() => navigateSurface("programme-health")}
              onNavigateToPipeline={() => navigateSurface("pipeline")}
              onNavigateToPhase={openPhaseSheet}
              onOpenPhase={openPhaseSheet}
              onRunAgent={handleRunAgent}
              onNavigateToPortfolio={() => navigateSurface("portfolio")}
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
              onApproveGate={handleApproveGate}
              onRunAgent={handleRunAgent}
              anyAgentRunning={anyUserAgentRunning}
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
              agentActivity={agentActivityItems}
              onNavigateToPhase={(phaseId) => { setActivePhaseId(phaseId); navigateSurface("stage"); }}
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
          decisions={(activeProgram?.decisionQueue || []).filter(
            (decision) => (!decision.status || decision.status === "open") && (!decision.phaseId || decision.phaseId === activePhaseId),
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
        />
      ) : null}
      </div>
      </div>

      {wizardOpen && activeProgram ? (
        <ProgramSetupWizard
          program={activeProgram}
          onSave={handleSaveSetup}
          onClose={() => setWizardOpen(false)}
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
        openDecisionCount={openDecisions.length}
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
                    openDecisions: openDecisions.length,
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
          const openD = openDecisions.length;
          const score = programConfidenceScore;
          if (lower.includes("risk")) {
            const raidCount = (activeProgram?.raidEntries || []).length;
            return `There are ${raidCount} risks recorded. Programme confidence is ${score ?? "unknown"}%. Run the Risk agent for a full assessment.`;
          }
          if (lower.includes("track") || lower.includes("status") || lower.includes("health")) {
            return `Programme is ${avgPct}% complete overall. Confidence: ${score ?? "calculating"}%. ${openD} decisions are open. ${activePhaseId ? `Currently active in phase: ${activePhaseId}.` : ""}`;
          }
          if (lower.includes("gate") || lower.includes("ready")) {
            const gateCount = Object.keys(activeProgram?.gateReviews ?? {}).length;
            const approvedCount = Object.values(activeProgram?.gateReviews ?? {}).filter((g: any) => g?.status === "approved").length;
            return `${approvedCount} of ${gateCount} gates approved. ${score && score < 70 ? "Gate readiness is below 70% — run an AI Gate Check to identify blockers." : "Gate readiness looks healthy."}`;
          }
          if (lower.includes("decision")) {
            return `${openD} decision${openD !== 1 ? "s" : ""} currently open. ${openD > 0 ? "Navigate to Decisions to review and resolve them." : "No pending decisions."}`;
          }
          if (lower.includes("phase") || lower.includes("stage")) {
            const phaseList = phases.map(p => `${p.displayName ?? p.id} (${p.pct}%)`).join(", ");
            return `Phases: ${phaseList || "No phases configured"}.`;
          }
          return `Programme: ${activeProgram?.name ?? "Unknown"}. Confidence: ${score ?? "N/A"}%. Completion: ${avgPct}%. Open decisions: ${openD}. Use specific queries like "status", "risks", "gate readiness", or "decisions" for more detail.`;
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
