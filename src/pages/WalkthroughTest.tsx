import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WALKTHROUGH_PHASES, WALKTHROUGH_STEPS } from "@/lib/adamWalkthroughScript";
import {
  buildWalkthroughSummary,
  createInitialWalkthroughProgramState,
  createPendingWalkthroughResults,
  executeWalkthroughStep,
  runWalkthrough,
  type StepResult,
} from "@/lib/adamWalkthroughRunner";

type SpeedMode = "slow" | "normal" | "fast";

const SPEEDS: Record<SpeedMode, { label: string; stepDelayMs: number; runMs: number; phasePauseMs: number }> = {
  slow: { label: "Slow", stepDelayMs: 900, runMs: 500, phasePauseMs: 2200 },
  normal: { label: "Normal", stepDelayMs: 420, runMs: 220, phasePauseMs: 1200 },
  fast: { label: "Fast", stepDelayMs: 120, runMs: 100, phasePauseMs: 500 },
};

function wait(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function cardStyle(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    background: "rgba(255,255,255,0.98)",
    border: "1px solid #E5E7EB",
    borderRadius: 18,
    boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
    ...extra,
  };
}

function buttonStyle(active = false): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 12,
    border: active ? "1px solid #2563EB" : "1px solid #D1D5DB",
    background: active ? "#EFF6FF" : "#FFFFFF",
    color: active ? "#1D4ED8" : "#374151",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function phaseAccent(status: string) {
  if (status === "pass") return "#22C55E";
  if (status === "fail") return "#EF4444";
  if (status === "running") return "#2563EB";
  return "#CBD5E1";
}

function statusIcon(status: string) {
  return ({ pass: "✅", fail: "❌", running: "⏳", pending: "⬜", skipped: "⏭️" } as Record<string, string>)[status] ?? "⬜";
}

function statusSurface(status: string): React.CSSProperties {
  if (status === "pass") return { background: "#F0FDF4", borderColor: "#BBF7D0" };
  if (status === "fail") return { background: "#FEF2F2", borderColor: "#FECACA" };
  if (status === "running") return { background: "#EFF6FF", borderColor: "#BFDBFE" };
  return { background: "#F8FAFC", borderColor: "#E5E7EB" };
}

function typeIcon(type: string) {
  return ({ input: "📝", artifact: "📋", gate: "🔒", advance: "➡️", verify: "✅" } as Record<string, string>)[type] ?? "•";
}

function summarizePhaseState(programState: any, phaseId: string) {
  return JSON.stringify(programState?.[phaseId] ?? {}, null, 2);
}

type WalkthroughLaunchMode = "phase-tour" | "action-queue";

interface WalkthroughTestProps {
  onLaunchLiveApp?: (mode?: WalkthroughLaunchMode) => void;
}

export function WalkthroughTest({ onLaunchLiveApp }: WalkthroughTestProps) {
  const [programState, setProgramState] = useState(() => createInitialWalkthroughProgramState());
  const [results, setResults] = useState(() => createPendingWalkthroughResults());
  const [activePhase, setActivePhase] = useState<string>("strategy");
  const [expandedStep, setExpandedStep] = useState<string | null>("step-001");
  const [showFinalState, setShowFinalState] = useState(false);
  const [speed, setSpeed] = useState<SpeedMode>("normal");
  const [paused, setPaused] = useState(false);
  const [inspectionPause, setInspectionPause] = useState(true);
  const [phaseHold, setPhaseHold] = useState<{ from: string; to: string } | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const currentIndexRef = useRef(-1);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const skipPhaseHoldRef = useRef(false);
  const programStateRef = useRef(programState);
  const resultsRef = useRef(results);

  const expectedRun = useMemo(() => runWalkthrough(), []);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    programStateRef.current = programState;
  }, [programState]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    currentIndexRef.current = -1;
    const freshState = createInitialWalkthroughProgramState();
    const freshResults = createPendingWalkthroughResults();
    programStateRef.current = freshState;
    resultsRef.current = freshResults;
    setProgramState(freshState);
    setResults(freshResults);
    setActivePhase("strategy");
    setExpandedStep("step-001");
    setPhaseHold(null);
    setPaused(false);
  }, [replayKey]);

  useEffect(() => {
    let cancelled = false;

    async function waitWithControls(ms: number) {
      let elapsed = 0;
      while (!cancelled && elapsed < ms) {
        if (skipPhaseHoldRef.current) {
          skipPhaseHoldRef.current = false;
          return true;
        }
        if (pausedRef.current) {
          await wait(80);
          continue;
        }
        const slice = Math.min(80, ms - elapsed);
        await wait(slice);
        elapsed += slice;
      }
      return !cancelled;
    }

    async function drive() {
      while (!cancelled) {
        const nextIndex = currentIndexRef.current + 1;
        if (nextIndex >= WALKTHROUGH_STEPS.length) {
          break;
        }

        const currentStep = WALKTHROUGH_STEPS[currentIndexRef.current] || null;
        const nextStep = WALKTHROUGH_STEPS[nextIndex];
        const phaseBreak = !!currentStep && currentStep.phase !== nextStep.phase;

        if (phaseBreak && inspectionPause) {
          setPhaseHold({ from: currentStep.phaseLabel, to: nextStep.phaseLabel });
          const held = await waitWithControls(SPEEDS[speedRef.current].phasePauseMs);
          if (!held || cancelled) return;
          setPhaseHold(null);
        } else {
          const delayed = await waitWithControls(SPEEDS[speedRef.current].stepDelayMs);
          if (!delayed || cancelled) return;
        }

        while (!cancelled && pausedRef.current) {
          await wait(80);
        }
        if (cancelled) return;

        const optimistic = resultsRef.current.slice();
        optimistic[nextIndex] = {
          step: nextStep,
          status: "running",
          verifyPassed: false,
          durationMs: 0,
        };
        resultsRef.current = optimistic;
        setResults(optimistic);
        setActivePhase(nextStep.phase);
        setExpandedStep(nextStep.id);

        const ran = await waitWithControls(SPEEDS[speedRef.current].runMs);
        if (!ran || cancelled) return;

        const executed = executeWalkthroughStep(programStateRef.current, nextStep);
        programStateRef.current = executed.programState;
        setProgramState(executed.programState);

        const completed = resultsRef.current.slice();
        completed[nextIndex] = executed.result;
        resultsRef.current = completed;
        setResults(completed);
        currentIndexRef.current = nextIndex;
      }
    }

    drive().catch((error) => {
      console.error(error);
    });

    return () => {
      cancelled = true;
    };
  }, [inspectionPause, replayKey]);

  const summary = useMemo(() => buildWalkthroughSummary(results), [results]);

  const byPhase = useMemo(() => {
    const grouped: Record<string, StepResult[]> = {};
    results.forEach((result) => {
      if (!grouped[result.step.phase]) grouped[result.step.phase] = [];
      grouped[result.step.phase].push(result);
    });
    return grouped;
  }, [results]);

  const artifactSteps = useMemo(() => (
    results.filter((result) => result.step.type === "artifact" && result.status === "pass")
  ), [results]);

  const phaseStatus = useCallback((phaseId: string) => {
    const steps = byPhase[phaseId] ?? [];
    if (!steps.length) return "pending";
    if (steps.some((step) => step.status === "fail")) return "fail";
    if (steps.some((step) => step.status === "running")) return "running";
    if (steps.every((step) => step.status === "pass")) return "pass";
    return "pending";
  }, [byPhase]);

  const activeSteps = byPhase[activePhase] ?? [];
  const currentStep = results.find((result) => result.status === "running")?.step || null;
  const canReplay = summary.passed === WALKTHROUGH_STEPS.length || summary.failed > 0;

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "24px 20px 96px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ ...cardStyle({ marginBottom: 18, padding: 20, background: "linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 100%)", color: "#F8FAFC", border: "1px solid rgba(148,163,184,0.28)" }) }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 28 }}>🎬</span>
                <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>ADAM End-to-End Walkthrough</h1>
              </div>
              <div style={{ fontSize: 13, color: "rgba(226,232,240,0.86)", lineHeight: 1.7 }}>
                Program: <strong style={{ color: "#FFFFFF" }}>Invoice Processing Automation</strong>
                <span style={{ margin: "0 8px", color: "rgba(148,163,184,0.6)" }}>·</span>
                L2 agent, 4-person team, 3 KPIs, {summary.artifacts}/9 artifacts generated
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                {onLaunchLiveApp ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onLaunchLiveApp("phase-tour")}
                      style={{ ...buttonStyle(false), borderColor: "rgba(74,222,128,0.55)", background: "rgba(34,197,94,0.18)", color: "#DCFCE7" }}
                    >
                      Launch phase tour
                    </button>
                    <button
                      type="button"
                      onClick={() => onLaunchLiveApp("action-queue")}
                      style={{ ...buttonStyle(false), borderColor: "rgba(96,165,250,0.55)", background: "rgba(37,99,235,0.18)", color: "#DBEAFE" }}
                    >
                      Launch from action queue
                    </button>
                  </>
                ) : null}
                {(["slow", "normal", "fast"] as SpeedMode[]).map((mode) => (
                  <button key={mode} type="button" onClick={() => setSpeed(mode)} style={{ ...buttonStyle(speed === mode), borderColor: speed === mode ? "#60A5FA" : "rgba(148,163,184,0.45)", background: speed === mode ? "rgba(30,64,175,0.35)" : "rgba(255,255,255,0.06)", color: "#F8FAFC" }}>
                    {SPEEDS[mode].label}
                  </button>
                ))}
                <button type="button" onClick={() => setPaused((value) => !value)} style={{ ...buttonStyle(paused), borderColor: "rgba(148,163,184,0.45)", background: paused ? "rgba(245,158,11,0.22)" : "rgba(255,255,255,0.06)", color: "#F8FAFC" }}>
                  {paused ? "Resume" : "Pause"}
                </button>
                <button type="button" onClick={() => setReplayKey((value) => value + 1)} style={{ ...buttonStyle(false), borderColor: "rgba(148,163,184,0.45)", background: "rgba(255,255,255,0.06)", color: "#F8FAFC" }}>
                  {canReplay ? "Replay walkthrough" : "Restart"}
                </button>
                <button type="button" onClick={() => setInspectionPause((value) => !value)} style={{ ...buttonStyle(inspectionPause), borderColor: "rgba(148,163,184,0.45)", background: inspectionPause ? "rgba(34,197,94,0.22)" : "rgba(255,255,255,0.06)", color: "#F8FAFC" }}>
                  Phase pauses {inspectionPause ? "on" : "off"}
                </button>
              </div>
              {onLaunchLiveApp ? (
                <div style={{ fontSize: 11.5, color: "rgba(191,219,254,0.88)", lineHeight: 1.6, marginTop: 12 }}>
                  Each live debug launch clears the seeded walkthrough program first, then reloads it from scratch. Use the action queue path to work the full methodology from the inbox instead of jumping phase to phase.
                </div>
              ) : null}
            </div>
            <div style={{ ...cardStyle({ minWidth: 240, padding: 18, background: summary.failed === 0 && summary.passed === summary.total ? "#F0FDF4" : "#FEF2F2", border: `2px solid ${summary.failed === 0 && summary.passed === summary.total ? "#BBF7D0" : "#FECACA"}` }) }}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: summary.failed === 0 && summary.passed === summary.total ? "#166534" : "#991B1B", marginBottom: 6 }}>
                Verdict
              </div>
              <div style={{ fontSize: 20, fontWeight: 900, color: summary.failed === 0 && summary.passed === summary.total ? "#15803D" : "#DC2626", marginBottom: 6 }}>
                {summary.verdict}
              </div>
              <div style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6 }}>
                {summary.passed}/{summary.total} steps passing · {summary.artifacts} artifact{summary.artifacts === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </div>

        {phaseHold ? (
          <div style={{ ...cardStyle({ marginBottom: 18, padding: "14px 16px", border: "1px solid #FDE68A", background: "#FFFBEB" }) }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#92400E", marginBottom: 4 }}>Phase inspection pause</div>
                <div style={{ fontSize: 12.5, color: "#78350F", lineHeight: 1.6 }}>
                  Completed <strong>{phaseHold.from}</strong>. Pausing briefly so a reviewer can inspect before continuing to <strong>{phaseHold.to}</strong>.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  skipPhaseHoldRef.current = true;
                  setPhaseHold(null);
                }}
                style={{ ...buttonStyle(false), borderColor: "#F59E0B", color: "#92400E", background: "#FFFFFF" }}
              >
                Continue now
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...cardStyle({ padding: 14 }) }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 10 }}>Phases</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {WALKTHROUGH_PHASES.map((phase) => {
                  const status = phaseStatus(phase.id);
                  const steps = byPhase[phase.id] ?? [];
                  const passing = steps.filter((step) => step.status === "pass").length;
                  return (
                    <button
                      key={phase.id}
                      type="button"
                      onClick={() => setActivePhase(phase.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: `1px solid ${activePhase === phase.id ? "#2563EB" : "#E5E7EB"}`,
                        background: activePhase === phase.id ? "#EFF6FF" : "#FFFFFF",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <span style={{ fontSize: 18 }}>{phase.icon}</span>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{phase.label}</span>
                        </div>
                        <span style={{ fontSize: 16 }}>{statusIcon(status)}</span>
                      </div>
                      <div style={{ marginTop: 9, height: 6, borderRadius: 999, background: "#E2E8F0", overflow: "hidden" }}>
                        <div style={{ width: `${steps.length ? (passing / steps.length) * 100 : 0}%`, height: "100%", borderRadius: 999, background: phaseAccent(status) }} />
                      </div>
                      <div style={{ fontSize: 11, color: "#64748B", marginTop: 7 }}>{passing}/{steps.length || 0} steps passing</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ ...cardStyle({ padding: 14 }) }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#94A3B8", marginBottom: 10 }}>Artifacts Generated</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {WALKTHROUGH_PHASES.map((phase) => {
                  const phaseArtifacts = artifactSteps.filter((result) => result.step.phase === phase.id);
                  if (!phaseArtifacts.length) return null;
                  return (
                    <div key={`artifact-${phase.id}`}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: "#334155", marginBottom: 6 }}>{phase.icon} {phase.label}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {phaseArtifacts.map((result) => (
                          <button
                            key={result.step.id}
                            type="button"
                            onClick={() => {
                              setActivePhase(result.step.phase);
                              setExpandedStep(result.step.id);
                            }}
                            style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 12, border: "1px solid #E5E7EB", background: "#FFFFFF", cursor: "pointer" }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>{result.step.artifactType}</div>
                            <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>{result.step.phaseLabel}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ ...cardStyle({ padding: 16 }) }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#111827", marginBottom: 6 }}>
                    {(WALKTHROUGH_PHASES.find((phase) => phase.id === activePhase)?.icon) || "•"} {(WALKTHROUGH_PHASES.find((phase) => phase.id === activePhase)?.label) || activePhase}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
                    {currentStep
                      ? `Running: ${currentStep.action}`
                      : summary.passed === summary.total
                        ? "Walkthrough complete. Final state shown below."
                        : "Waiting for the next scripted step."}
                  </div>
                </div>
                <button type="button" onClick={() => setShowFinalState((value) => !value)} style={buttonStyle(showFinalState)}>
                  {showFinalState ? "Hide" : "Show"} final program state
                </button>
              </div>

              {showFinalState ? (
                <div style={{ marginTop: 14, background: "#0F172A", borderRadius: 16, padding: 14, overflow: "auto", maxHeight: 320 }}>
                  <pre style={{ margin: 0, fontSize: 11.5, color: "#86EFAC", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap" }}>
                    {summarizePhaseState(programState, activePhase)}
                  </pre>
                </div>
              ) : null}

              {!showFinalState ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
                  <div style={{ padding: 12, borderRadius: 14, background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#2563EB", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Expected</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#1D4ED8" }}>{expectedRun.summary.total}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>scripted steps</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 14, background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#15803D", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Passed</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#166534" }}>{summary.passed}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>successful steps</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 14, background: summary.failed ? "#FEF2F2" : "#F8FAFC", border: `1px solid ${summary.failed ? "#FECACA" : "#E5E7EB"}` }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: summary.failed ? "#DC2626" : "#64748B", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Failed</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: summary.failed ? "#991B1B" : "#475569" }}>{summary.failed}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>failed steps</div>
                  </div>
                  <div style={{ padding: 12, borderRadius: 14, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                    <div style={{ fontSize: 10, fontWeight: 900, color: "#D97706", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Artifacts</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#B45309" }}>{summary.artifacts}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>generated outputs</div>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeSteps.map((result) => (
                <div key={result.step.id} style={{ ...cardStyle({ overflow: "hidden", borderColor: result.status === "pass" ? "#BBF7D0" : result.status === "fail" ? "#FECACA" : result.status === "running" ? "#BFDBFE" : "#E5E7EB" }) }}>
                  <button
                    type="button"
                    onClick={() => setExpandedStep(expandedStep === result.step.id ? null : result.step.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "14px 16px",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      ...statusSurface(result.status),
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{statusIcon(result.status)}</span>
                    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: "#64748B", minWidth: 88 }}>
                      {typeIcon(result.step.type)} {result.step.type.toUpperCase()}
                    </span>
                    <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: "#111827" }}>{result.step.action}</span>
                    <span style={{ fontSize: 11, color: "#64748B" }}>{result.durationMs}ms</span>
                  </button>
                  {expandedStep === result.step.id ? (
                    <div style={{ padding: "14px 16px", background: "#FFFFFF", borderTop: "1px solid #E5E7EB" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
                        <span style={{ fontSize: 11.5, color: "#64748B" }}>
                          Expected: <span style={{ color: "#111827" }}>{result.step.expectedOutcome}</span>
                        </span>
                        {result.step.field ? (
                          <span style={{ fontSize: 11.5, color: "#64748B" }}>
                            Field: <span style={{ color: "#111827", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{result.step.field}</span>
                          </span>
                        ) : null}
                      </div>

                      {result.step.type === "input" && result.step.value !== undefined ? (
                        <div style={{ background: "#F8FAFC", border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Value Applied</div>
                          <pre style={{ margin: 0, fontSize: 11.5, color: "#334155", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 220 }}>
                            {typeof result.step.value === "string" ? result.step.value : JSON.stringify(result.step.value, null, 2)}
                          </pre>
                        </div>
                      ) : null}

                      {result.step.type === "artifact" && result.step.artifactContent ? (
                        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 12, marginBottom: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>📋 {result.step.artifactType}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "#166534", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 999, padding: "4px 8px" }}>Generated ✓</span>
                          </div>
                          <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 12, border: "1px solid #E5E7EB", maxHeight: 360, overflow: "auto" }}>
                            <pre style={{ margin: 0, fontSize: 11.5, color: "#334155", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap" }}>
                              {result.step.artifactContent}
                            </pre>
                          </div>
                        </div>
                      ) : null}

                      {result.error ? (
                        <div style={{ padding: "10px 12px", borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12, color: "#991B1B" }}>
                          ❌ {result.error}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.98)", borderTop: "1px solid #E5E7EB", boxShadow: "0 -10px 24px rgba(15,23,42,0.06)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#15803D" }}>✅ {summary.passed} passed</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: summary.failed ? "#DC2626" : "#94A3B8" }}>❌ {summary.failed} failed</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#1D4ED8" }}>📋 {summary.artifacts} artifacts</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {WALKTHROUGH_PHASES.map((phase) => {
              const status = phaseStatus(phase.id);
              return (
                <button
                  key={phase.id}
                  type="button"
                  onClick={() => setActivePhase(phase.id)}
                  title={phase.label}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    border: `1px solid ${phaseAccent(status)}`,
                    background: phaseAccent(status),
                    color: "#FFFFFF",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {phase.icon}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
