import React, { useMemo, useState } from "react";
import { getSanityVerdict, runSanityTest } from "@/lib/adamSanityEngine";

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

function statusIcon(status: string) {
  return ({ pass: "✅", fail: "❌", warn: "⚠️" } as Record<string, string>)[status] ?? "⬜";
}

function statusSurface(status: string): React.CSSProperties {
  if (status === "pass") return { background: "#F0FDF4", borderColor: "#BBF7D0" };
  if (status === "fail") return { background: "#FEF2F2", borderColor: "#FECACA" };
  if (status === "warn") return { background: "#FFFBEB", borderColor: "#FDE68A" };
  return { background: "#F9FAFB", borderColor: "#E5E7EB" };
}

export function SanityTest() {
  const results = useMemo(() => {
    try {
      return runSanityTest();
    } catch (error) {
      console.error(error);
      return [];
    }
  }, []);
  const verdict = useMemo(() => getSanityVerdict(results), [results]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const allChecks = results.flatMap((result) => result.checks ?? []);
  const passingCount = allChecks.filter((check) => check.status === "pass").length;
  const failingChecks = results.flatMap((result) =>
    (result.checks ?? [])
      .filter((check) => check.status === "fail")
      .map((check) => ({ ...check, phaseLabel: result.label, phaseIcon: result.icon })),
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "24px 20px 40px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 28 }}>🧪</span>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: "#111827", margin: 0 }}>ADAM Sanity Test</h1>
          </div>
          <p style={{ margin: "0 0 0 38px", fontSize: 13, color: "#6B7280" }}>
            Use case: <strong style={{ color: "#374151" }}>Email Auto-Responder</strong>
            <span style={{ color: "#D1D5DB", margin: "0 8px" }}>·</span>
            L2 capability, 3-person team, single KPI
          </p>
        </div>

        <div
          style={cardStyle({
            marginBottom: 24,
            border: `2px solid ${verdict.border}`,
            background: verdict.background,
            padding: 20,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          })}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: verdict.color }}>{verdict.label}</div>
            <div style={{ fontSize: 13, color: "#4B5563", marginTop: 6, lineHeight: 1.6 }}>{verdict.description}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: "#111827", lineHeight: 1 }}>{passingCount}/{verdict.totalChecks}</div>
            <div style={{ fontSize: 11.5, color: "#6B7280", marginTop: 6 }}>gates passing</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", paddingBottom: 10, marginBottom: 24 }}>
          {results.map((result, index) => (
            <React.Fragment key={result.phase}>
              <button
                type="button"
                onClick={() => setExpanded(expanded === result.phase ? null : result.phase)}
                style={{
                  ...buttonStyle(expanded === result.phase),
                  minWidth: 90,
                  borderColor: result.passed ? "#BBF7D0" : "#FECACA",
                  background: result.passed ? "#F0FDF4" : "#FEF2F2",
                  color: result.passed ? "#166534" : "#991B1B",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 18 }}>{result.icon}</span>
                <span style={{ whiteSpace: "nowrap" }}>{result.label}</span>
                <span>{result.passed ? "✅" : "❌"}</span>
              </button>
              {index < results.length - 1 ? (
                <span style={{ fontSize: 18, color: result.passed ? "#4ADE80" : "#D1D5DB", flexShrink: 0 }}>→</span>
              ) : null}
            </React.Fragment>
          ))}
        </div>

        {results.map((result) => (
          expanded === result.phase ? (
            <div key={result.phase} style={{ ...cardStyle(), marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", background: result.passed ? "#F0FDF4" : "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>{result.icon} {result.label} Phase Gates</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: result.passed ? "#16A34A" : "#DC2626" }}>
                  {result.checks.filter((check) => check.status === "pass").length}/{result.checks.length} passing
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {result.checks.map((check) => (
                  <div
                    key={check.id}
                    style={{
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      borderTop: "1px solid rgba(229,231,235,0.7)",
                      ...statusSurface(check.status),
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{statusIcon(check.status)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{check.gate}</div>
                      <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4, lineHeight: 1.6 }}>{check.description}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
                        <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>
                          Expected: <span style={{ color: "#4B5563" }}>{check.expected}</span>
                        </span>
                        <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>
                          Actual: <span style={{ color: check.status === "pass" ? "#166534" : "#991B1B", fontWeight: 700 }}>{check.actual}</span>
                        </span>
                      </div>
                      {check.status !== "pass" && check.fix ? (
                        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 10px", borderRadius: 12, background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                          <span style={{ color: "#2563EB", flexShrink: 0 }}>🔧</span>
                          <span style={{ fontSize: 12, color: "#1D4ED8", lineHeight: 1.6 }}>{check.fix}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        ))}

        {!expanded ? (
          <div style={{ ...cardStyle(), overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #E5E7EB", background: "#F9FAFB" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>All Gate Results — click a phase above to expand</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {allChecks.map((check) => (
                <div
                  key={check.id}
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    borderTop: "1px solid rgba(229,231,235,0.7)",
                    background: check.status !== "pass" ? "#FEF2F2" : "#FFFFFF",
                  }}
                >
                  <span>{statusIcon(check.status)}</span>
                  <span style={{ flex: 1, fontSize: 13, color: check.status !== "pass" ? "#991B1B" : "#374151", fontWeight: check.status !== "pass" ? 700 : 500 }}>
                    {check.gate}
                  </span>
                  <span style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{check.id}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {failingChecks.length > 0 ? (
          <div style={{ ...cardStyle({ marginTop: 24, border: "1px solid #FECACA", background: "#FEF2F2", padding: 18 }) }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: "#991B1B", margin: "0 0 12px" }}>Failed Gates — Fix Required</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {failingChecks.map((check) => (
                <div key={check.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ color: "#DC2626", flexShrink: 0 }}>❌</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#991B1B" }}>{check.phaseIcon} {check.phaseLabel} → {check.gate}</div>
                    {check.fix ? (
                      <div style={{ fontSize: 12, color: "#1D4ED8", marginTop: 4 }}>🔧 {check.fix}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
