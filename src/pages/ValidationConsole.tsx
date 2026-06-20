import React, { useEffect, useMemo, useRef, useState } from "react";
import { VALIDATION_SEED_PROGRAM } from "@/lib/adamValidationSeed";
import { runAllWorkstreams, type ValidationCheck, type WorkstreamResult } from "@/lib/adamValidationEngine";

type ValidationConsoleProps = {
  onNavigateToScreen?: (target: string) => void;
  onOpenSeedWorkspace?: () => void;
  onReturnHome?: () => void;
};

type RemediationEvent = {
  id: string;
  kind: "found" | "fixed";
  timestamp: string;
  workstreamId: string;
  workstreamName: string;
  checkId: string;
  checkName: string;
  severity: string;
  status: string;
  detail: string;
  remediationHint?: string;
};

type ActiveIssue = ValidationCheck & {
  workstreamId: string;
  workstreamName: string;
};

const PHASE_SEQUENCE = [
  { id: "strategy", label: "Strategy", icon: "🎯" },
  { id: "mobilise", label: "Mobilise", icon: "👥" },
  { id: "discover", label: "Discover", icon: "🔍" },
  { id: "design", label: "Design", icon: "🏗️" },
  { id: "build", label: "Build", icon: "🔨" },
  { id: "govern", label: "Govern", icon: "🏛️" },
  { id: "operate", label: "Operate", icon: "⚙️" },
  { id: "optimize", label: "Optimize", icon: "📈" },
  { id: "valuerealize", label: "Value Realize", icon: "💰" },
];

const PHASE_TO_WORKSTREAM_MAP: Record<string, string[]> = {
  strategy: ["methodology"],
  mobilise: ["methodology", "copilot"],
  discover: ["methodology", "document-intelligence", "input-generation"],
  design: ["methodology", "dependencies"],
  build: ["methodology", "manual-edit", "versioning"],
  govern: ["governance"],
  operate: ["production", "twin"],
  optimize: ["readiness"],
  valuerealize: ["value", "copilot", "visual"],
};

const STATUS_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  pass: { bg: "#DCFCE7", text: "#166534", border: "#86EFAC" },
  warn: { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" },
  fail: { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" },
  skip: { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" },
};

const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  warn: "⚠️",
  fail: "❌",
  skip: "⏭",
};

const SEVERITY_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "#FEE2E2", text: "#B91C1C", border: "#FCA5A5" },
  high: { bg: "#FFEDD5", text: "#C2410C", border: "#FDBA74" },
  medium: { bg: "#FEF3C7", text: "#A16207", border: "#FCD34D" },
  low: { bg: "#F3F4F6", text: "#4B5563", border: "#D1D5DB" },
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function cardStyle(extra = {}) {
  return {
    background: "rgba(255,255,255,0.98)",
    border: "1px solid #E5E7EB",
    borderRadius: 18,
    boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
    ...extra,
  };
}

function pillStyle(tone: { bg: string; text: string; border: string }) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: `1px solid ${tone.border}`,
    background: tone.bg,
    color: tone.text,
    fontSize: 11,
    fontWeight: 700,
  };
}

function smallButtonStyle(active = false) {
  return {
    padding: "7px 12px",
    borderRadius: 999,
    border: active ? "1px solid #0F172A" : "1px solid #D1D5DB",
    background: active ? "#0F172A" : "#FFFFFF",
    color: active ? "#FFFFFF" : "#4B5563",
    fontSize: 11.5,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function issueKey(issue: { workstreamId: string; id: string }) {
  return `${issue.workstreamId}:${issue.id}`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function flattenIssues(results: WorkstreamResult[]): ActiveIssue[] {
  return results.flatMap((result) =>
    (result.checks ?? [])
      .filter(Boolean)
      .filter((check) => check.status !== "pass")
      .map((check) => ({
        ...check,
        workstreamId: result.id,
        workstreamName: result.name,
      })),
  );
}

export function ValidationConsole({
  onNavigateToScreen,
  onOpenSeedWorkspace,
  onReturnHome,
}: ValidationConsoleProps) {
  const [activeWs, setActiveWs] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [runTick, setRunTick] = useState(0);
  const [lastRunAt, setLastRunAt] = useState(() => new Date().toISOString());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [remediationTimeline, setRemediationTimeline] = useState<RemediationEvent[]>([]);
  const previousIssuesRef = useRef<Map<string, ActiveIssue>>(new Map());

  const seedData = useMemo(() => VALIDATION_SEED_PROGRAM, []);
  const results = useMemo(() => {
    try {
      return runAllWorkstreams(seedData).map((result) => ({
        ...result,
        checks: (result.checks ?? []).filter(Boolean),
      }));
    } catch (err) {
      console.error("runAllWorkstreams failed:", err);
      return [];
    }
  }, [seedData, runTick]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRunTick((value) => value + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLastRunAt(new Date().toISOString());
  }, [results]);

  useEffect(() => {
    const currentIssues = flattenIssues(results);
    const nextIssueMap = new Map(currentIssues.map((issue) => [issueKey(issue), issue]));
    const previousIssueMap = previousIssuesRef.current;
    const events: RemediationEvent[] = [];

    for (const issue of currentIssues) {
      const key = issueKey(issue);
      if (!previousIssueMap.has(key)) {
        events.push({
          id: `${key}:found:${Date.now()}`,
          kind: "found",
          timestamp: new Date().toISOString(),
          workstreamId: issue.workstreamId,
          workstreamName: issue.workstreamName,
          checkId: issue.id,
          checkName: issue.name,
          severity: issue.severity,
          status: issue.status,
          detail: issue.detail,
          remediationHint: issue.remediationHint,
        });
      }
    }

    for (const [key, issue] of previousIssueMap.entries()) {
      if (!nextIssueMap.has(key)) {
        events.push({
          id: `${key}:fixed:${Date.now()}`,
          kind: "fixed",
          timestamp: new Date().toISOString(),
          workstreamId: issue.workstreamId,
          workstreamName: issue.workstreamName,
          checkId: issue.id,
          checkName: issue.name,
          severity: issue.severity,
          status: "pass",
          detail: issue.detail,
          remediationHint: issue.remediationHint,
        });
      }
    }

    if (events.length > 0) {
      setRemediationTimeline((previous) => [...events.reverse(), ...previous].slice(0, 200));
    }

    previousIssuesRef.current = nextIssueMap;
  }, [results]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const overallScore = Math.round(results.reduce((sum, result) => sum + result.score, 0) / Math.max(results.length, 1));
  const totalChecks = results.flatMap((result) => result.checks ?? []).length;
  const failCount = results.flatMap((result) => result.checks ?? []).filter((check) => check.status === "fail").length;
  const warnCount = results.flatMap((result) => result.checks ?? []).filter((check) => check.status === "warn").length;
  const passCount = results.flatMap((result) => result.checks ?? []).filter((check) => check.status === "pass").length;
  const attentionCount = failCount + warnCount;

  const activeWorkstream = activeWs === "all" ? null : results.find((result) => result.id === activeWs);
  const visibleChecks = (activeWorkstream ? activeWorkstream.checks : results.flatMap((result) => result.checks ?? []))
    .filter(Boolean)
    .filter((check) => filterStatus === "all" || check.status === filterStatus)
    .filter((check) => filterSeverity === "all" || check.severity === filterSeverity)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  const verdict = failCount > 0
    ? { label: "ISSUES FOUND", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" }
    : warnCount > 5
      ? { label: "APPROVE WITH CHANGES", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" }
      : { label: "APPROVE", color: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" };

  const remediationBySeverity = (["critical", "high", "medium", "low"] as const).map((severity) => ({
    severity,
    items: flattenIssues(results).filter((check) => check.severity === severity),
  }));

  const copyRemediationLog = async () => {
    const log = flattenIssues(results)
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
      .map((check) => [
        `[${check.severity.toUpperCase()}] [${check.status.toUpperCase()}] ${check.workstreamName} > ${check.name}`,
        `Detail: ${check.detail}`,
        `Fix: ${check.remediationHint ?? "N/A"}`,
      ].join("\n"))
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(log);
      setCopyState("copied");
    } catch (err) {
      console.error("Failed to copy remediation log:", err);
      setCopyState("failed");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "24px 20px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 28 }}>🧪</span>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "#111827", margin: 0 }}>ADAM Validation Console</h1>
            </div>
            <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 0 38px" }}>
              Hello World Program: <strong style={{ color: "#374151" }}>Agentic Meeting Summary Assistant</strong>
            </p>
            <div style={{ marginLeft: 38, marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={pillStyle({ bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" })}>
                Live auto-refresh every 15s
              </span>
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                Last run {formatTimestamp(lastRunAt)}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setRunTick((value) => value + 1)} style={smallButtonStyle(false)}>
              Re-run Validation
            </button>
            {onOpenSeedWorkspace ? (
              <button type="button" onClick={onOpenSeedWorkspace} style={{ ...smallButtonStyle(true), background: "#1D4ED8", borderColor: "#1D4ED8" }}>
                Open Seeded Workspace
              </button>
            ) : null}
            {onReturnHome ? (
              <button type="button" onClick={onReturnHome} style={smallButtonStyle(false)}>
                Back To ADAM
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
          <div style={cardStyle()}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 34, fontWeight: 900, color: "#111827", lineHeight: 1 }}>{overallScore}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>Overall Score</div>
            </div>
          </div>
          <div style={cardStyle()}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#16A34A", lineHeight: 1 }}>{passCount}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>Passed</div>
            </div>
          </div>
          <div style={cardStyle()}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#D97706", lineHeight: 1 }}>{warnCount}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>Warnings</div>
            </div>
          </div>
          <div style={cardStyle()}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#DC2626", lineHeight: 1 }}>{failCount}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>Failures</div>
            </div>
          </div>
          <div style={cardStyle({ border: `2px solid ${verdict.border}`, background: verdict.bg })}>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: verdict.color }}>{verdict.label}</div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6 }}>{totalChecks} checks</div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={cardStyle({ padding: "16px 14px" })}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
                Phase Simulation Progress
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {PHASE_SEQUENCE.map((phase) => {
                  const relatedWsIds = PHASE_TO_WORKSTREAM_MAP[phase.id] ?? [];
                  const phaseChecks = results
                    .filter((workstream) => relatedWsIds.includes(workstream.id))
                    .flatMap((workstream) => workstream.checks ?? [])
                    .filter(Boolean);
                  const hasCriticalFailure = phaseChecks.some((check) => check.status === "fail" && check.severity === "critical");
                  const hasWarning = phaseChecks.some((check) => check.status === "fail" || check.status === "warn");
                  const isComplete = phaseChecks.length > 0;
                  const statusIcon = !isComplete ? "⬜" : hasCriticalFailure ? "❌" : hasWarning ? "⚠️" : "✅";
                  const statusColor = !isComplete ? "#9CA3AF" : hasCriticalFailure ? "#DC2626" : hasWarning ? "#D97706" : "#16A34A";
                  const passRate = isComplete
                    ? Math.round((phaseChecks.filter((check) => check.status === "pass").length / Math.max(phaseChecks.length, 1)) * 100)
                    : 0;

                  return (
                    <button
                      key={phase.id}
                      type="button"
                      onClick={() => setActiveWs(relatedWsIds[0] ?? "all")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: 12,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{statusIcon}</span>
                      <span style={{ fontSize: 13.5, color: "#374151", flex: 1 }}>{phase.icon} {phase.label}</span>
                      {isComplete ? (
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor }}>{passRate}%</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setActiveWs("all")}
              style={{
                ...cardStyle(),
                padding: "12px 14px",
                cursor: "pointer",
                textAlign: "left",
                border: activeWs === "all" ? "1px solid #0F172A" : "1px solid #E5E7EB",
                background: activeWs === "all" ? "#0F172A" : "#FFFFFF",
                color: activeWs === "all" ? "#FFFFFF" : "#374151",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>All Workstreams</div>
            </button>

            {results.map((workstream) => (
              <button
                key={workstream.id}
                type="button"
                onClick={() => setActiveWs(workstream.id)}
                style={{
                  ...cardStyle({
                    padding: "12px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    border: activeWs === workstream.id ? "1px solid #0F172A" : "1px solid #E5E7EB",
                    background: activeWs === workstream.id ? "#0F172A" : "#FFFFFF",
                    color: activeWs === workstream.id ? "#FFFFFF" : "#374151",
                  }),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span>{workstream.icon}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {workstream.name}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 900,
                      color: activeWs === workstream.id ? "#FFFFFF" : workstream.status === "pass" ? "#16A34A" : workstream.status === "fail" ? "#DC2626" : "#D97706",
                    }}
                  >
                    {workstream.score}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: activeWs === workstream.id ? "rgba(255,255,255,0.18)" : "#E5E7EB", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${workstream.score}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: workstream.status === "pass" ? "#22C55E" : workstream.status === "fail" ? "#EF4444" : "#F59E0B",
                    }}
                  />
                </div>
              </button>
            ))}
          </div>

          <div>
            <div style={{ ...cardStyle({ padding: "14px 16px", marginBottom: 16 }) }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Live Remediation Timeline</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={pillStyle({ bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" })}>{attentionCount} open issues</span>
                  <span style={{ fontSize: 12, color: "#9CA3AF" }}>{remediationTimeline.length} events tracked</span>
                </div>
              </div>
              {remediationTimeline.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#6B7280" }}>No issue changes recorded yet. Re-run validation or fix a check to see the live timeline update.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {remediationTimeline.slice(0, 8).map((event) => (
                    <div
                      key={event.id}
                      style={{
                        borderRadius: 14,
                        border: `1px solid ${event.kind === "fixed" ? "#BBF7D0" : SEVERITY_STYLE[event.severity]?.border ?? "#E5E7EB"}`,
                        background: event.kind === "fixed" ? "#F0FDF4" : event.status === "fail" ? "#FEF2F2" : "#FFFBEB",
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={pillStyle(event.kind === "fixed"
                            ? { bg: "#DCFCE7", text: "#166534", border: "#86EFAC" }
                            : event.status === "fail"
                              ? { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" }
                              : { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" })}>
                            {event.kind === "fixed" ? "✅ FIXED" : event.status === "fail" ? "❌ FOUND" : "⚠️ FOUND"}
                          </span>
                          <span style={{ fontSize: 11.5, color: "#6B7280" }}>{event.workstreamName}</span>
                        </div>
                        <span style={{ fontSize: 11, color: "#9CA3AF" }}>{formatTimestamp(event.timestamp)}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginBottom: 2 }}>{event.checkName}</div>
                      <div style={{ fontSize: 12.5, color: "#4B5563", lineHeight: 1.55 }}>{event.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {["all", "pass", "warn", "fail"].map((status) => (
                <button key={status} type="button" onClick={() => setFilterStatus(status)} style={smallButtonStyle(filterStatus === status)}>
                  {status === "all" ? "All Status" : `${STATUS_ICON[status]} ${status.toUpperCase()}`}
                </button>
              ))}
              <div style={{ width: 1, background: "#D1D5DB", margin: "0 4px" }} />
              {["all", "critical", "high", "medium", "low"].map((severity) => (
                <button key={severity} type="button" onClick={() => setFilterSeverity(severity)} style={smallButtonStyle(filterSeverity === severity)}>
                  {severity === "all" ? "All Severity" : severity.charAt(0).toUpperCase() + severity.slice(1)}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 12 }}>{visibleChecks.length} checks shown</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {visibleChecks.length === 0 ? (
                <div style={cardStyle({ padding: 18 })}>
                  <div style={{ fontSize: 13.5, color: "#4B5563" }}>No checks match the current filters.</div>
                </div>
              ) : null}

              {visibleChecks.map((check) => {
                const tone = STATUS_COLOR[check.status];
                const severityTone = SEVERITY_STYLE[check.severity];

                return (
                  <div
                    key={check.id}
                    style={cardStyle({
                      padding: "16px 16px 14px",
                      borderLeft: `4px solid ${check.status === "pass" ? "#4ADE80" : check.status === "fail" ? "#F87171" : "#F59E0B"}`,
                    })}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <span style={pillStyle(tone)}>{STATUS_ICON[check.status]} {check.status.toUpperCase()}</span>
                          <span style={pillStyle(severityTone)}>{check.severity.toUpperCase()}</span>
                          {check.screen ? (
                            <span style={pillStyle({ bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" })}>📍 {check.screen}</span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", marginBottom: 4 }}>{check.name}</div>
                        <div style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.65 }}>{check.description}</div>
                      </div>
                      <span style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "nowrap" }}>
                        {check.id}
                      </span>
                    </div>
                    <div style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.7, marginBottom: check.remediationHint ? 10 : 12 }}>{check.detail}</div>
                    {check.remediationHint ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: "#EFF6FF", border: "1px solid #BFDBFE", marginBottom: 12 }}>
                        <span style={{ color: "#2563EB", flexShrink: 0 }}>🔧</span>
                        <div style={{ fontSize: 12, color: "#1D4ED8", lineHeight: 1.6 }}>{check.remediationHint}</div>
                      </div>
                    ) : null}
                    {check.navigateTo ? (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => onNavigateToScreen?.(check.navigateTo || "/")}
                          style={{ ...smallButtonStyle(false), borderColor: "#BFDBFE", color: "#1D4ED8" }}
                        >
                          Open Screen
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 28, borderTop: "1px solid #E5E7EB", paddingTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: "#374151", margin: 0 }}>
              Full Remediation Log ({attentionCount} items requiring attention)
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {copyState === "copied" ? <span style={{ fontSize: 12, color: "#16A34A" }}>Copied</span> : null}
              {copyState === "failed" ? <span style={{ fontSize: 12, color: "#DC2626" }}>Copy failed</span> : null}
              <button type="button" onClick={copyRemediationLog} style={{ ...smallButtonStyle(false), borderColor: "#BFDBFE", color: "#1D4ED8" }}>
                Copy to clipboard
              </button>
            </div>
          </div>

          {attentionCount === 0 ? (
            <div style={{ ...cardStyle({ padding: "28px 20px", textAlign: "center" }) }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#166534", marginBottom: 4 }}>All checks passing — ADAM is production ready</div>
              <div style={{ fontSize: 13, color: "#6B7280" }}>No remediation items remain open in the current validation run.</div>
            </div>
          ) : (
            remediationBySeverity.map(({ severity, items }) => {
              if (items.length === 0) return null;
              const headingColor = severity === "critical" ? "#DC2626" : severity === "high" ? "#EA580C" : severity === "medium" ? "#D97706" : "#6B7280";
              const dot = severity === "critical" ? "🔴" : severity === "high" ? "🟠" : severity === "medium" ? "🟡" : "⚪";

              return (
                <div key={severity} style={{ marginBottom: 22 }}>
                  <h3 style={{ fontSize: 12, fontWeight: 900, color: headingColor, textTransform: "uppercase", letterSpacing: 0.9, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{dot}</span>
                    {severity.toUpperCase()} — {items.length} item{items.length !== 1 ? "s" : ""}
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {items.map((item) => (
                      <div
                        key={`${item.workstreamId}:${item.id}`}
                        style={cardStyle({
                          padding: "14px 16px",
                          background: item.status === "fail" ? "#FEF2F2" : "#FFFBEB",
                          border: `1px solid ${item.status === "fail" ? "#FECACA" : "#FDE68A"}`,
                        })}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{item.id}</span>
                              <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>· {item.workstreamName}</span>
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#111827", marginBottom: 4 }}>{item.name}</div>
                            <div style={{ fontSize: 12.5, color: "#4B5563", lineHeight: 1.65 }}>{item.detail}</div>
                            {item.remediationHint ? (
                              <div style={{ fontSize: 12, color: "#1D4ED8", lineHeight: 1.6, marginTop: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
                                <span>🔧</span>
                                <span>{item.remediationHint}</span>
                              </div>
                            ) : null}
                          </div>
                          <span
                            style={{
                              ...pillStyle(item.status === "fail"
                                ? { bg: "#FEE2E2", text: "#991B1B", border: "#FCA5A5" }
                                : { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D" }),
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
