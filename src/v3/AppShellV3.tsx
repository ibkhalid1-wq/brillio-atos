import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAgentRun } from "@/hooks/useAgentRun";
import { deleteProgramFromSupabase } from "@/lib/adamSync";
import { buildMemoryContext, saveAgentMemory } from "@/lib/adamAgentMemory";
import { ConflictError } from "@/new/lib/conflicts";
import { useAgentTriggers } from "@/new/lib/useAgentTriggers";
import { useBudgetTracking } from "@/new/lib/useBudgetTracking";
import { useClosure } from "@/new/lib/useClosure";
import { useDecisionQueue } from "@/new/lib/useDecisionQueue";
import { useGateReview } from "@/new/lib/useGateReview";
import { useMilestones } from "@/new/lib/useMilestones";
import { usePhaseProgress } from "@/new/lib/usePhaseProgress";
import { useProgramNotes } from "@/new/lib/useProgramNotes";
import { type ProgramSetupPatch, useProgramSetup } from "@/new/lib/useProgramSetup";
import { usePrograms } from "@/new/lib/usePrograms";
import { useProgramSnapshots } from "@/new/lib/useProgramSnapshots";
import { useCopilotThread } from "@/hooks/useCopilotThread";
import { getProgramState, wrapProgramState } from "@/new/lib/programState";
import type {   ProgramSummary } from "@/new/types";
import { buildCrossPhaseContext } from "@/lib/adamOrchestrator";
import CoPilotSidebar from "@/v3/components/CoPilotSidebar";
import { IntelligenceView } from "@/new/pages/IntelligenceView";
import { useAIStatus } from "@/v3/hooks/useAIStatus";
import { SkeletonShimmer } from "@/v3/components/ui/Skeleton";
import HelpPanel from "@/v3/components/HelpPanel";
import ProgramSetupWizard from "@/v3/components/ProgramSetupWizard";
import FlowShell from "@/v3/components/flow/FlowShell";
import { resolveFlowDecision } from "@/v3/components/flow/flowDecisions";
import { recordShowPass, addFlowTrack } from "@/v3/components/flow/flowTracks";
import { setHaltAll, toggleAgentHalt, setMovementBudget } from "@/v3/components/flow/flowGovernance";
import { mintInterviewPacks, mintDemoInvites, ingestPortalResponse, dismissPortalResponse } from "@/v3/components/flow/flowPortal";
import { applyArtifactEdit } from "@/v3/components/flow/flowArtifactEdit";
import { compileShipLanes, toggleShipItem } from "@/v3/components/flow/flowShip";
import { scheduleFollowUp } from "@/v3/components/flow/flowMeetings";
import { mintFollowUpPack, latestPackFor, portalLinkFor } from "@/v3/components/flow/flowPortal";
import FlowRespond from "@/v3/components/flow/FlowRespond";
import { reportError } from "@/lib/errorReporter";
import { changedInputFields, relatedArtifactsToStale, crossPhaseArtifactsToStale } from "@/v3/lib/artifactStaleness";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { hasSubstantiveProgramData } from "@/v3/lib/programDataGuard";
import { AGENT_ID_ALIASES, RETIRED_AGENT_IDS } from "@/v3/lib/agentMeta";
import { useRelativeTimeTick } from "@/lib/useRelativeTimeTick";
import { useAgentCascadeToasts } from "@/v3/hooks/useAgentCascadeToasts";
import { useCriticalEventAlerts } from "@/v3/hooks/useCriticalEventAlerts";
import { useLocalProgramMigration } from "@/v3/hooks/useLocalProgramMigration";
import { usePhaseAgentState } from "@/v3/hooks/usePhaseAgentState";
import { getPhaseSequence, getPhaseDefinition, buildPhaseOwnershipContext } from "@/v3/lib/methodology";
import type { MethodologyVariant } from "@/v3/lib/methodology";
import { FORMAL_ARTIFACT_FIELD_KEYS } from "@/v3/lib/formalArtifacts";
import { buildPhaseSchedule } from "@/v3/lib/phaseSchedule";
import { deriveProgramConfidence } from "@/v3/lib/programConfidence";
import { getPreviousScore, recordConfidenceSnapshot } from "@/v3/lib/confidenceHistory";
import { artifactReviewFieldKey } from "@/v3/lib/artifactReview";
import { deriveOpenRecommendedActions } from "@/v3/lib/recommendedActions";
import { mergePhaseInputBucket } from "@/v3/lib/phaseInputMerge";
import type { V3CommandMode, V3MoreView, V3ReportId, V3Surface } from "@/v3/types";
import { isDecisionOpen, pushV3Toast } from "@/v3/utils";
import "@/new/styles.css";
import "./v3.css";

const LOCAL_PROGRAM_STORAGE_KEY = "brillio-adam-projects";
const V3_THEME_STORAGE_KEY = "atlas-v3-theme";
const AUTH_RECOVERY_INTENT_STORAGE_KEY = "atlas-auth-recovery-intent";





// ATOS Flow is the only delivery model — the classic stage-gate workspace was
// retired (2026-07). Every programme seeds with, and renders, the Flow spine.
const APP_METHODOLOGY_VARIANT: MethodologyVariant = "atos-flow";
const DEFAULT_PHASE_SEQUENCE = getPhaseSequence(APP_METHODOLOGY_VARIANT);
const ALL_KNOWN_PHASE_IDS = [...new Set(DEFAULT_PHASE_SEQUENCE)];


function buildProgramSeed(name: string) {
  const now = new Date().toISOString();
  return {
    projectMeta: { name },
    objective: "",
    methodology: APP_METHODOLOGY_VARIANT,
    phases: DEFAULT_PHASE_SEQUENCE.map((id) => ({ id, pct: 0 })),
    phasePct: Object.fromEntries(DEFAULT_PHASE_SEQUENCE.map((id) => [id, 0])),
    _syncedAt: now,
    // Immutable creation stamp. Powers the required-ness ratchet: a field the
    // methodology later marks required (with a `requiredSince` cutoff) only gates
    // programmes created on/after that cutoff, so adding a new required input never
    // retroactively blocks an in-flight programme. Programmes seeded before this
    // stamp existed simply lack it and are treated as pre-ratchet (never blocked).
    _createdAt: now,
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
 * Merge a freshly-saved phase-input bucket onto the persisted one. Plain fields
 * are overwritten last-write-wins; the `_provenance` metadata map is deep-merged
 * so a second document import keeps the source traceability the first recorded.
 */
type ShellToast = {
  id: string;
  message: string;
  icon?: string;
  tone?: "info" | "success" | "warning" | "error";
  action?: { label: string; onClick: () => void };
};

const MAX_VISIBLE_TOASTS = 3;






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
  const authRoute = isAuthPath();
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null);
  const [theme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(V3_THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // Respect OS preference if no explicit choice stored
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  // Apply theme to <html> and persist
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(V3_THEME_STORAGE_KEY, theme);
  }, [theme]);





  const [wizardOpen, setWizardOpen] = useState(false);
  // When the wizard is opened immediately after creating a fresh programme,
  // this holds that draft's id so cancelling can discard it (rather than
  // leaving an empty "New Programme" behind). Cleared once setup is saved.
  const [draftProgramId, setDraftProgramId] = useState<string | null>(null);
  const [adamCopilotSidebarOpen, setAdamCopilotSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<ShellToast[]>([]);
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
  const [helpOpen, setHelpOpen] = useState(false);


  const migrated = useLocalProgramMigration(userId);
  const { programs, activeProgram, activeProgramId, setActiveProgramId, refreshPrograms, hydratePrograms, updateProgramData, isLoading: programsLoading, hasResolvedPrograms, canEditActiveProgram } = usePrograms({
    enabled: authChecked && migrated,
    userId,
  });
  const { activeRuns, isRunning: agentIsRunning, runAgent } = useAgentRun(activeProgramId, authed, refreshPrograms);
  // Agent ids with an in-flight run — powers the Flow shell's generation
  // theater (which artifact card is drafting right now). AgentRun rows carry
  // `agent_id`; only queued/running/paused runs are actually in flight.
  const runningAgentIds = useMemo(
    () => new Set(
      activeRuns
        .filter((run) => run.status === "queued" || run.status === "running" || run.status === "paused")
        .map((run) => run.agent_id),
    ),
    [activeRuns],
  );
  // Mission Control's fleet board — the same in-flight runs, with movement.
  const flowFleet = useMemo(
    () => activeRuns
      .filter((run) => run.status === "queued" || run.status === "running" || run.status === "paused")
      .map((run) => ({
        agentId: run.agent_id,
        phaseId: typeof (run as { phase_id?: unknown }).phase_id === "string" ? (run as { phase_id?: string }).phase_id : undefined,
        status: run.status,
      })),
    [activeRuns],
  );
  // Token spend per movement for Mission Control's budget bars — summed from
  // the runs ledger (adam_agent_runs.tokens_used), not the data blob.
  const loadFlowMovementSpend = useCallback(async (): Promise<Record<string, number>> => {
    if (!supabase || !activeProgramId) return {};
    const { data } = await supabase
      .from("adam_agent_runs")
      .select("phase_id, tokens_used")
      .eq("program_id", activeProgramId);
    const spend: Record<string, number> = {};
    for (const row of data ?? []) {
      const phase = typeof row.phase_id === "string" ? row.phase_id : "";
      if (!phase) continue;
      spend[phase] = (spend[phase] ?? 0) + Number(row.tokens_used || 0);
    }
    return spend;
  }, [activeProgramId]);
  // Hydrate the newly active programme's blob — a programme selected
  // mid-session may still be metadata-only. Cheap no-op when already fresh.
  useEffect(() => {
    if (activeProgramId) void hydratePrograms([activeProgramId]);
  }, [activeProgramId, hydratePrograms]);
  const { createSnapshot: createProgramSnapshot } = useProgramSnapshots(activeProgramId || null, { enabled: authChecked && migrated });
  const aiStatus = useAIStatus(true); // status check works without auth since edge function accepts anon key
  const rawData = useMemo(() => activeProgram?.rawData || {}, [activeProgram?.rawData]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      setCurrentUser(null);
      setUserId(null);
      setAuthed(false);
      // Clear programme context so the next user doesn't inherit stale state
      setActiveProgramId(null);
      setActivePhaseId(null);
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

  const copilotWorkspaceId = "home";

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
    if (RETIRED_AGENT_IDS.has(agentId)) return;

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

    // Phase ownership map for formal (document-style) artifacts. Their self-
    // reported `gaps[]` surface straight to the user as quality guidance, so a
    // gap that names later-phase detail (scope atoms owned by Discover, a named
    // roster owned by Mobilise) or already-established upstream content is noise.
    // The edge's phase-scoped gap discipline used hard-coded scope/roster
    // examples to suppress those; feeding the registry's authoritative per-phase
    // input/artifact ownership here lets the discipline generalise to every phase
    // and artifact. No deploy needed — the edge folds crossPhaseContext into
    // prompt.system.
    if (resolvedAgentId in FORMAL_ARTIFACT_FIELD_KEYS) {
      const ownershipMap = buildPhaseOwnershipContext(phaseId, APP_METHODOLOGY_VARIANT);
      if (ownershipMap) {
        crossPhaseContext += `${crossPhaseContext ? "\n\n" : ""}${ownershipMap}`;
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
        // The full-blob upsert can exceed Postgres's statement timeout once a
        // programme's `data` JSONB has grown large (code 57014). That write only
        // exists to guarantee the row exists before the edge function reads it —
        // and the debounced autosave already keeps the cloud copy current. So if
        // the row already exists, a slow/timed-out pre-sync must NOT hard-block
        // the agent run: fall back to a cheap existence check and proceed. Only a
        // genuinely missing row (local-only programme) is a real blocker.
        const ensureRowExists = async (failMsg: string) => {
          const { data: existing, error: existsError } = await supabase
            .from("adam_programs")
            .select("id")
            .eq("id", activeProgramId)
            .maybeSingle();
          if (existsError || !existing) throw new Error(failMsg);
        };
        // DATA-LOSS GUARD. This pre-run sync writes the WHOLE `data` blob. If the
        // blob hasn't hydrated yet, `programData` is empty — writing it would wipe
        // the cloud copy. Only upsert the full blob when we actually hold content;
        // otherwise just verify the row exists and proceed without overwriting it.
        if (!hasSubstantiveProgramData(programData)) {
          await ensureRowExists(
            "Program data hasn't finished loading — open the program and wait a moment before running an agent.",
          );
          return;
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
          await ensureRowExists(`Could not sync programme to cloud before running agent: ${syncError.message}`);
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
  const { approveGate, requestRemediation, reopenGate, raiseChangeRequest, resolveChangeRequest } = useGateReview(activeProgramId || "", rawData, refreshPrograms);
  const { addNote: addProgramNote } = useProgramNotes(activeProgramId || "", rawData, refreshPrograms);
  const { addDecision } = useDecisionQueue(activeProgramId || "", rawData, refreshPrograms);
  const { updatePct: updatePhasePct } = usePhaseProgress(activeProgramId || "", rawData, refreshPrograms);
  const { save: saveSetup, isSaving: wizardSaving } = useProgramSetup(activeProgramId || "", rawData, refreshPrograms);
  const copilotMemoryContext = useMemo(() => {
    if (!activeProgramId) return "";
    return ["narrative", "strategic-roadmap", "risk"]
      .map((agentId) => buildMemoryContext(agentId, activeProgramId))
      .filter(Boolean)
      .join("\n");
  }, [activeProgramId, activeRuns]);

  const { sendMessage: sendCopilotMessage } = useCopilotThread(
    activeProgramId || "",
    copilotWorkspaceId,
    copilotMemoryContext,
  );

  // Proactive triggers exist for the classic surfaces. Flow programmes run on
  // their own decision loop, and every trigger is a full-blob edge write that
  // can collide with a human confirm on the same hot row — so triggers stay
  // off until the hydrated blob says the programme is classic. (A metadata-only
  // beat can't tell us the methodology, and its null generatedAt fields would
  // read as "stale everything" and fire spuriously.)
  const proactiveTriggersEligible =
    Object.keys(rawData).length > 0 && activeProgram?.methodology !== "atos-flow";
  const triggers = useAgentTriggers({
    programId: proactiveTriggersEligible ? activeProgramId : "",
    authed,
    activePhaseId,
    rawData,
    activeRuns,
    onRunAgent: runProgramAgent,
    onInvalidate: refreshPrograms,
    narrativeGeneratedAt: activeProgram?.narrativeGeneratedAt || null,
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
    discoveryGuideGeneratedAt: activeProgram?.discoveryGuideGeneratedAt || null,
    scopePcrGeneratedAt: activeProgram?.scopePcrGeneratedAt || null,
    patternExtractGeneratedAt: activeProgram?.patternExtractGeneratedAt || null,
    patternQueryCachedAt: activeProgram?.patternQueryCachedAt || null,
    gateReviews: activeProgram?.gateReviews || {},
    escalationsLastCheckedAt: activeProgram?.escalationsLastCheckedAt || null,
    openEscalationCount: (activeProgram?.escalations || []).filter(
      (entry) => entry.status === "open" || entry.status === "acknowledged",
    ).length,
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
    // NB: score against the programme's CANONICAL active phase (the helper's
    // default), never the mutable nav-state activePhaseId — otherwise the headline
    // confidence swings as the user drills into different phases (e.g. 66% on Today
    // while pointed at a completed Strategy phase vs 31% on Brief while pointed at
    // the Build frontier), contradicting itself across surfaces.
    // previousScore (prior-day snapshot from local history) turns the model's
    // up/down trend from a permanent "stable" placeholder into a real signal.
    return deriveProgramConfidence(activeProgram, undefined, getPreviousScore(activeProgram.id));
  }, [activeProgram, rawData, openDecisions]);

  const programConfidenceScore = programConfidenceResult?.score ?? null;

  // Persist the active programme's score so tomorrow's trend has a baseline, and
  // project a target date from the accumulated history. Recording lives in an
  // effect (never during render) and is throttled to one snapshot per day inside
  // the helper, so idle re-renders don't churn localStorage.
  useEffect(() => {
    if (activeProgram?.id && programConfidenceScore != null) {
      recordConfidenceSnapshot(activeProgram.id, programConfidenceScore);
    }
  }, [activeProgram?.id, programConfidenceScore]);


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

  const lastLandedProgramIdRef = useRef<string | null>(null);
  // True once the user has explicitly opened a specific phase (clicked a phase
  // pill / opened a phase sheet). While set, auto-landing never yanks them off
  // that phase — even a completed one they chose to review. Reset per programme.
  const explicitPhasePickRef = useRef(false);
  useEffect(() => {
    if (!activeProgram) return;
    // Phase ids are shared across programmes, so a stale phase from the previous
    // programme stays "valid" and would otherwise be kept. Always land on the new
    // programme's frontier phase when the active programme changes.
    const programChanged = lastLandedProgramIdRef.current !== activeProgramId;
    lastLandedProgramIdRef.current = activeProgramId;
    if (programChanged) explicitPhasePickRef.current = false;
    // A phase is finished when its gate is approved (status "complete") or its
    // progress is full. A completed phase can still read pct 0 (approved on
    // imported inputs), so status must be checked too.
    const isComplete = (phase: (typeof activeProgram.phases)[number]) =>
      phase.status === "complete" || (phase.pct ?? 0) >= 100;
    const currentPhase = activeProgram.phases.find((phase) => phase.id === activePhaseId);
    // Keep the current phase when it is a valid, non-completed phase, or when the
    // user explicitly chose it. The completed-phase case is deliberately NOT kept
    // on a programme reload: phase data streams in, so the first pass can land on
    // a phase before its "complete" status arrives; re-running once it completes
    // then advances to the live frontier instead of staying stuck behind it.
    if (currentPhase && !programChanged && (explicitPhasePickRef.current || !isComplete(currentPhase))) return;
    // Prefer the canonical active phase so the landing phase matches what every
    // surface labels "Active phase" — but only while that phase is still open, so
    // landing advances to the frontier instead of reopening a closed-out phase.
    const canonical = activeProgram.activePhaseId;
    const canonicalPhase = canonical ? activeProgram.phases.find((phase) => phase.id === canonical) : null;
    const canonicalUsable = !!canonicalPhase && !isComplete(canonicalPhase);
    const inProgress = activeProgram.phases.find((phase) => (phase.pct ?? 0) > 0 && !isComplete(phase));
    const firstIncomplete = activeProgram.phases.find((phase) => !isComplete(phase));
    setActivePhaseId((canonicalUsable ? canonical : null) || inProgress?.id || firstIncomplete?.id || activeProgram.phases[0]?.id || null);
  }, [activeProgramId, activePhaseId, activeProgram]);

  useEffect(() => {
    if (!activeProgram) return;
    const isEmpty =
      (!activeProgram.name || activeProgram.name === "New Program" || activeProgram.name === "New Programme") &&
      !activeProgram.objective &&
      activeProgram.phases.every((phase) => (phase.pct ?? 0) === 0);
    if (isEmpty) setWizardOpen(true);
  }, [activeProgram?.id]);








  // AI provider status & setup — hosted as an overlay in the Flow shell (the
  // classic "intelligence" surface it used to navigate to is retired).
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [intelligenceInitialTab, setIntelligenceInitialTab] = useState<"Status" | "Setup">("Setup");
  const openAISettings = useCallback((tab?: string) => {
    setIntelligenceInitialTab(tab === "Status" ? "Status" : "Setup");
    setAiSettingsOpen(true);
  }, []);





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
      // from the old inputs is regenerated rather than silently drifting. Pass the
      // dynamic schema store so flow edges for planner-generated/custom artifacts
      // (whose field→artifact map lives in artifactInputFlow, not the static
      // methodology) resolve too — otherwise editing a grounding input on a
      // reopened (PCR) dynamic phase would leave its locked artifacts marked fresh.
      const flowStore = getDynamicSchemaStore(cloned.inner);
      const staled = relatedArtifactsToStale(phaseId, changedFields, phaseBucket, flowStore);
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
      // Cross-phase cascade: downstream artifacts in LATER phases that reference
      // the just-staled upstream deliverables are now built on shifted ground too.
      // Follow the same methodology reference edges (crossPhaseArtifactsToStale)
      // and stale them, so a Design that cited an approved requirements catalog
      // doesn't keep pointing at a version we just invalidated. Skips the origin
      // phase and anything archived/already-stale.
      const crossStaled = allStaled.length
        ? crossPhaseArtifactsToStale(phaseId, allStaled, artifactBuckets, flowStore)
        : [];
      if (crossStaled.length) {
        const nowIso = new Date().toISOString();
        const byPhase = new Map<string, Record<string, Record<string, unknown>>>();
        for (const { phaseId: targetPhase, artifactId } of crossStaled) {
          const bucket = byPhase.get(targetPhase) ?? { ...(artifactBuckets[targetPhase] ?? {}) };
          bucket[artifactId] = { ...(bucket[artifactId] as Record<string, unknown>), status: "stale", staleReason: `Upstream ${phaseId} deliverable changed`, staleAt: nowIso };
          byPhase.set(targetPhase, bucket);
        }
        for (const [targetPhase, bucket] of byPhase) artifactBuckets[targetPhase] = bucket;
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
          if ("suggestedStakeholders" in nextRec) nextRec.suggestedStakeholders = [];
          const pb = nextRec[phaseId];
          if (pb && typeof pb === "object" && !Array.isArray(pb)) {
            nextRec[phaseId] = { ...(pb as Record<string, unknown>), improvements: [], suggestedStakeholders: [] };
          }
          reviewPatch[key] = nextRec;
        }
      }
      const payload = cloned.commit({ ...cloned.inner, phaseInputs: existing, phaseArtifacts: artifactBuckets, ...reviewPatch });
      return { payload, staled: allStaled, crossStaled };
    };

    let { payload, staled, crossStaled } = buildPayload(activeProgram);
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
      crossStaled = rebased.crossStaled;
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
    const totalStaled = staled.length + crossStaled.length;
    if (totalStaled) {
      const downstreamNote = crossStaled.length
        ? ` (${crossStaled.length} downstream in a later phase)`
        : "";
      pushV3Toast(
        `Inputs saved. ${totalStaled} artifact${totalStaled > 1 ? "s" : ""} marked stale${downstreamNote} — regenerate to apply your changes.`,
        { tone: "warning", duration: 5000 },
      );
    } else if (!silent) {
      pushV3Toast("Inputs saved. Ready to run agents.", { tone: "success", duration: 2500 });
    }
  }, [activeProgram, refreshPrograms, updateProgramData]);


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

  // Public async-interview page: a stakeholder holding a response link needs
  // no account — the token IS the access (validated by the flow-portal edge
  // function) and everything they send is quarantined for operator review.
  {
    const respondToken = new URLSearchParams(window.location.search).get("flowRespond");
    if (respondToken) {
      return <FlowRespond token={respondToken} />;
    }
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
                Create a programme and ATOS turns recorded stakeholder conversations into a current-state atlas, an agentic blueprint, and a working system.
              </p>
              <button
                type="button"
                className="v3-welcome-cta"
                onClick={() => void handleCreateProgram()}
              >
                + Create programme
              </button>
            </div>

            {/* The engagement loop — the Flow spine, sourced from the registry */}
            <div className="v3-welcome-journey">
              <div className="v3-welcome-journey-label">The engagement loop</div>
              <div className="v3-welcome-journey-track">
                {getPhaseSequence("atos-flow").map((phaseId, index, all) => (
                  <React.Fragment key={phaseId}>
                    <div className="v3-welcome-journey-phase" title={getPhaseDefinition(phaseId, "atos-flow")?.description}>
                      <span className="v3-welcome-journey-dot">{index + 1}</span>
                      <span className="v3-welcome-journey-name">{getPhaseDefinition(phaseId, "atos-flow")?.displayName ?? phaseId}</span>
                    </div>
                    {index < all.length - 1 ? (
                      <span className="v3-welcome-journey-arrow" aria-hidden="true">→</span>
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Capability tiles */}
            <div className="v3-welcome-tiles">
              {[
                { icon: "◇", title: "Derived gates", body: "Transcripts and documents are first-class inputs. Gates tick themselves as evidence lands — nothing is hand-marked done." },
                { icon: "✦", title: "Propose, then confirm", body: "ATOS generates the atlas, blueprint and demo scripts from what people said; consequential changes wait in your Inbox as decisions." },
                { icon: "⬡", title: "Demonstration gates", body: "Each stakeholder watches their own workflow run — seeded from their own words — and acceptance is recorded pass by pass." },
                { icon: "◫", title: "Governed autonomy", body: "Every action lands on an attested trail; budgets, halts and tiers keep agent work a deliberate, auditable call." },
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

  // Overlays that are identical under both the classic and the Paper & Flow
  // shell — defined once so the two copies can't drift. (The Copilot sidebar
  // differs per shell in its onNavigate, so it stays inline in each branch.)
  const setupWizardOverlay = wizardOpen && activeProgram ? (
    <ProgramSetupWizard
      program={activeProgram}
      onSave={handleSaveSetup}
      onClose={() => void handleCancelSetup()}
      isSaving={wizardSaving}
    />
  ) : null;
  const toastStackOverlay = toasts.length ? (
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
  ) : null;

  // Shared write path for Flow shell mutations (decision resolutions, track
  // passes, manual tracks): pure blob transform + optimistic write, re-based
  // once onto the freshest server copy on a version conflict — Flow rows are
  // hot (agents write between hydration and the click) and a human action
  // must never be silently dropped.
  const persistFlowMutation = async (mutate: (program: NonNullable<typeof activeProgram>) => Record<string, unknown> | null) => {
    if (!activeProgram) return;
    try {
      const blob = mutate(activeProgram);
      if (!blob) return;
      try {
        await updateProgramData(activeProgram.id, blob, activeProgram.updatedAt);
      } catch (err) {
        if (!(err instanceof ConflictError) || !isSupabaseConfigured || !supabase) throw err;
        const { data: fresh } = await supabase
          .from("adam_programs")
          .select("data, updated_at")
          .eq("id", activeProgram.id)
          .single();
        const freshRaw = (fresh?.data as Record<string, unknown> | undefined) ?? activeProgram.rawData ?? {};
        const rebased = mutate({ ...activeProgram, rawData: freshRaw });
        if (!rebased) return;
        await updateProgramData(activeProgram.id, rebased, fresh?.updated_at ?? undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save that action. Please try again.";
      window.dispatchEvent(new CustomEvent("atlas-v3-toast", { detail: { message, tone: "error" } }));
    }
  };

  // ── The Flow workspace — the only workspace ────────────────────────────
  // The classic stage-gate shell was retired (2026-07); every programme
  // renders the Flow chrome. Auth, splash and the no-programme welcome all
  // returned above, so reaching here with an active programme means Flow.
  if (activeProgram) {
    return (
      <div className="v3-shell v3fs-shell">
        <FlowShell
          program={activeProgram}
          programs={programs}
          runningAgentIds={runningAgentIds}
          onSelectProgram={(id) => setActiveProgramId(id)}
          onCreateProgram={() => void handleCreateProgram()}
          onOpenSetup={() => setWizardOpen(true)}
          onOpenCopilot={() => setAdamCopilotSidebarOpen(true)}
          onRunAgent={handleRunAgent}
          onSaveInputs={handleSavePhaseInputs}
          onResolveDecision={async (decisionId, resolution) => {
            const resolvedBy = currentUser?.email || "you";
            await persistFlowMutation((program) => resolveFlowDecision(program, decisionId, resolution, resolvedBy));
          }}
          onRecordShowPass={async (trackId, pass) => {
            await persistFlowMutation((program) => recordShowPass(program, trackId, pass));
          }}
          onAddTrack={async (input) => {
            await persistFlowMutation((program) => addFlowTrack(program, input));
          }}
          fleet={flowFleet}
          loadMovementSpend={loadFlowMovementSpend}
          onSetHaltAll={async (halted) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => setHaltAll(program, halted, actor));
          }}
          onToggleAgentHalt={async (agentId, halted) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => toggleAgentHalt(program, agentId, halted, actor));
          }}
          onSetMovementBudget={async (movementId, tokens) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => setMovementBudget(program, movementId, tokens, actor));
          }}
          onMintPacks={async () => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => mintInterviewPacks(program, actor));
          }}
          onMintDemoInvites={async () => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => mintDemoInvites(program, actor));
          }}
          onCompileShipLanes={async () => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => compileShipLanes(program, actor));
          }}
          onToggleShipItem={async (laneId, itemId) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => toggleShipItem(program, laneId, itemId, actor));
          }}
          onHydratePrograms={async () => {
            await hydratePrograms(programs.map((entry) => entry.id));
          }}
          onScheduleFollowUp={async (movementId, who, date) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => scheduleFollowUp(program, movementId, who, date, actor));
          }}
          onMintFollowUp={async (input) => {
            const actor = currentUser?.email || "you";
            let mintedLink: string | null = null;
            await persistFlowMutation((program) => {
              const blob = mintFollowUpPack(program, input, actor);
              if (blob) {
                // Lift the fresh token out of the blob being persisted so the
                // caller can hand the link over immediately.
                const inner = (typeof blob.data === "object" && blob.data !== null ? blob.data : blob) as Record<string, unknown>;
                const packs = Array.isArray(inner.flowInterviewPacks) ? inner.flowInterviewPacks : [];
                const last = packs[packs.length - 1] as Record<string, unknown> | undefined;
                if (last && typeof last.token === "string") {
                  mintedLink = `${window.location.origin}${window.location.pathname}?flowRespond=${encodeURIComponent(`${program.id}.${last.token}`)}`;
                }
              }
              return blob;
            });
            if (!mintedLink && activeProgram) {
              // Minting was a no-op because the identical pack already exists —
              // hand back the standing link instead of a fresh secret.
              const existing = latestPackFor(activeProgram, input.who);
              if (existing) mintedLink = portalLinkFor(activeProgram.id, existing);
            }
            return mintedLink;
          }}
          onSaveArtifactDoc={async (input) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => applyArtifactEdit(program, input, actor));
          }}
          onIngestPortalItem={async (itemId) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => ingestPortalResponse(program, itemId, actor));
          }}
          onDismissPortalItem={async (itemId) => {
            const actor = currentUser?.email || "you";
            await persistFlowMutation((program) => dismissPortalResponse(program, itemId, actor));
          }}
        />
        {setupWizardOverlay}
        {aiSettingsOpen ? (
          <>
            <div className="v3fs-doc-backdrop" onClick={() => setAiSettingsOpen(false)} aria-hidden="true" />
            <div className="v3fs-docview" role="dialog" aria-modal="true" aria-label="AI intelligence settings">
              <header className="v3fs-docview-h">
                <div>
                  <h2>Intelligence</h2>
                  <span className="v3fs-docview-m">AI provider status &amp; setup</span>
                </div>
                <div className="v3fs-docview-cta">
                  <button type="button" className="v3fs-btn" onClick={() => setAiSettingsOpen(false)}>Close</button>
                </div>
              </header>
              <div className="v3fs-docview-b">
                <IntelligenceView program={activeProgram} onRefreshProgram={refreshPrograms} initialTab={intelligenceInitialTab} onRunAgent={handleRunAgent} />
              </div>
            </div>
          </>
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
        />
        {toastStackOverlay}
      </div>
    );
  }

  // No active programme resolved yet (stale id or list still composing) —
  // a quiet splash; the effects above will land on a programme or the
  // welcome screen momentarily.
  return <div className="v3-splash">Loading…</div>;
}
