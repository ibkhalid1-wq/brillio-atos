import React, { useMemo, useState } from "react";
import type { Escalation } from "@/new/types";

interface EscalationBannerProps {
  escalations: Escalation[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}

function severityBadge(severity: Escalation["severity"]) {
  return severity === "critical" ? "red" : "amber";
}

function typeLabel(type: Escalation["type"]) {
  if (type === "stale-decision") return "Stale decision";
  if (type === "phase-stalled") return "Phase stalled";
  if (type === "critical-blocker") return "Critical blocker";
  return "Milestone slipping";
}

export function EscalationBanner({
  escalations,
  onAcknowledge,
  onResolve,
}: EscalationBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const openEscalations = useMemo(
    () => escalations.filter((entry) => entry.status === "open"),
    [escalations],
  );
  const acknowledgedEscalations = useMemo(
    () => escalations.filter((entry) => entry.status === "acknowledged"),
    [escalations],
  );
  const resolvedEscalations = useMemo(
    () => escalations.filter((entry) => entry.status === "resolved"),
    [escalations],
  );

  if (!openEscalations.length) return null;

  const bannerSeverity = openEscalations.some((entry) => entry.severity === "critical") ? "critical" : "high";
  const visibleEscalations = expanded
    ? [
        ...openEscalations,
        ...acknowledgedEscalations,
        ...(showResolved ? resolvedEscalations : []),
      ]
    : [];

  return (
    <section className={`adam-escalation-banner ${bannerSeverity === "critical" ? "critical" : "high"}`}>
      <button
        type="button"
        className="adam-escalation-toggle"
        onClick={() => setExpanded((current) => !current)}
      >
        <div className="adam-row adam-space-between" style={{ width: "100%" }}>
          <div className="adam-row" style={{ gap: 10 }}>
            <span className={`adam-badge ${bannerSeverity === "critical" ? "red" : "amber"}`}>
              {bannerSeverity === "critical" ? "Critical" : "High"}
            </span>
            <span className="adam-title">
              {openEscalations.length} escalation{openEscalations.length === 1 ? "" : "s"} require your attention
            </span>
          </div>
          <span className="adam-micro adam-muted">{expanded ? "Hide details" : "Show details"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="adam-stack mt-4" style={{ gap: 10 }}>
          {visibleEscalations.map((entry) => (
            <div
              key={entry.id}
              className={`adam-escalation-row ${entry.status === "acknowledged" ? "is-acknowledged" : ""} ${entry.status === "resolved" ? "is-resolved" : ""}`}
            >
              <div className="adam-row" style={{ alignItems: "flex-start", gap: 14, flex: 1 }}>
                <div className="adam-stack" style={{ gap: 6, minWidth: 128 }}>
                  <span className={`adam-badge ${severityBadge(entry.severity)}`}>{entry.severity}</span>
                  <div className="adam-micro adam-muted">{typeLabel(entry.type)}</div>
                </div>
                <div className="adam-stack" style={{ gap: 6, flex: 1 }}>
                  <div className="adam-body" style={{ fontWeight: 600 }}>{entry.title}</div>
                  <div className="adam-micro adam-muted">{entry.summary}</div>
                  <div className="adam-micro" style={{ fontStyle: "italic", color: "#dbe4f7" }}>{entry.costOfDelay}</div>
                </div>
              </div>
              {entry.status !== "resolved" ? (
                <div className="adam-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {entry.status === "open" ? (
                    <button
                      type="button"
                      className="adam-button-ghost"
                      onClick={() => onAcknowledge(entry.id)}
                    >
                      Acknowledge
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="adam-button-ghost"
                    onClick={() => onResolve(entry.id)}
                  >
                    Resolve
                  </button>
                </div>
              ) : (
                <span className="adam-badge slate">Resolved</span>
              )}
            </div>
          ))}

          {resolvedEscalations.length ? (
            <div className="adam-row" style={{ justifyContent: "space-between" }}>
              <span className="adam-micro adam-muted">
                {acknowledgedEscalations.length} acknowledged · {resolvedEscalations.length} resolved
              </span>
              <button
                type="button"
                className="adam-button-ghost"
                onClick={() => setShowResolved((current) => !current)}
              >
                {showResolved ? "Hide resolved" : "Show resolved"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
