import React from "react";

type SetupCardProps = {
  variant?: "setup";
  programName: string;
  onSetup: () => void;
  onUploadDoc: () => void;
  onRunDemo: () => void;
};

type ChecklistItem = {
  label: string;
  done: boolean;
  /** Optional "why this matters" context shown below the label */
  why?: string;
};

type ChecklistCardProps = {
  variant: "checklist";
  title: string;
  subtitle?: string;
  items: ChecklistItem[];
  ctaLabel?: string;
  onCtaClick?: () => void;
  onDismiss?: () => void;
};

type OnboardingCardProps = SetupCardProps | ChecklistCardProps;

export default function OnboardingCard(props: OnboardingCardProps) {
  if (props.variant === "checklist") {
    const completedCount = props.items.filter((item) => item.done).length;
    const allDone = completedCount === props.items.length;

    return (
      <div className="v3-onboarding-card">
        <div className="v3-onboarding-card-top">
          <div>
            <div className="v3-onboarding-card-title">{props.title}</div>
            <div className="v3-onboarding-card-subtitle">
              {props.subtitle || `${completedCount} of ${props.items.length} complete`}
            </div>
          </div>
          {props.onDismiss ? (
            <button type="button" className="v3-sheet-close" onClick={props.onDismiss} aria-label="Dismiss guide">
              ×
            </button>
          ) : null}
        </div>

        <div className="v3-onboarding-card-progress">
          <div
            className="v3-onboarding-card-progress-fill"
            style={{ width: `${props.items.length ? (completedCount / props.items.length) * 100 : 0}%` }}
          />
        </div>

        <div className="v3-onboarding-card-items">
          {props.items.map((item, index) => (
            <div key={`${item.label}-${index}`} className={`v3-onboarding-card-item ${item.done ? "done" : ""}`}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="v3-onboarding-card-item-index" aria-hidden="true" style={{ flexShrink: 0 }}>
                  {item.done ? "✓" : index + 1}
                </span>
                <span style={{ fontWeight: item.done ? 400 : 500 }}>{item.label}</span>
              </div>
              {!item.done && item.why && (
                <div style={{
                  fontSize: 11,
                  color: "var(--v3-text-muted)",
                  lineHeight: 1.5,
                  paddingLeft: 26,
                  fontStyle: "italic",
                }}>
                  Why: {item.why}
                </div>
              )}
            </div>
          ))}
        </div>

        {!allDone && props.ctaLabel && props.onCtaClick ? (
          <button type="button" className="v3-button primary" style={{ width: "100%", marginTop: 14 }} onClick={props.onCtaClick}>
            {props.ctaLabel}
          </button>
        ) : null}

        {allDone ? (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "color-mix(in srgb, var(--v3-green) 10%, transparent)", borderRadius: "var(--v3-radius)", border: "1px solid color-mix(in srgb, var(--v3-green) 25%, transparent)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-green)", marginBottom: 6 }}>✓ Phase setup complete</div>
            <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5 }}>This gate is ready for approval. Head to Governance to run the formal gate review, or continue working in this phase.</div>
            {props.onDismiss ? (
              <button type="button" style={{ marginTop: 10, fontSize: 12, color: "var(--v3-text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }} onClick={props.onDismiss}>
                Dismiss this guide
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const { programName, onSetup, onUploadDoc, onRunDemo } = props;

  return (
    <div className="v3-section" style={{ paddingTop: 40 }}>
      <div className="v3-card" style={{ textAlign: "center", padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>◎</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--v3-text-primary)", marginBottom: 8 }}>
          {programName === "New Program" || !programName ? "Let's set up your program" : `Set up ${programName}`}
        </div>
        <div style={{ fontSize: 14, color: "var(--v3-text-muted)", lineHeight: 1.7, maxWidth: 380, margin: "0 auto 24px" }}>
          ADAM needs a few details to get started — the program objective, which phases you're in, and any existing documents.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 280, margin: "0 auto" }}>
          <button type="button" className="v3-button primary" onClick={onSetup}>
            Set up program details
          </button>
          <button type="button" className="v3-button ghost" onClick={onUploadDoc}>
            Upload a document instead
          </button>
          <button type="button" className="v3-button ghost" onClick={onRunDemo}>
            Load demo program
          </button>
        </div>
      </div>

      <div className="v3-card-sm" style={{ marginTop: 8 }}>
        <div className="v3-card-title">What ADAM will do once set up</div>
        {[
          { icon: "◎", text: "Generate a programme narrative from your objective and documents" },
          { icon: "⋯", text: "Build a prioritised action plan for each ATOS phase" },
          { icon: "⬡", text: "Surface risks, decisions, and gate readiness checks automatically" },
          { icon: "◫", text: "Produce an executive status deck and closure report" },
        ].map((item) => (
          <div key={item.text} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--v3-border-soft)", alignItems: "flex-start" }}>
            <span style={{ color: "var(--v3-accent)", fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
            <span style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
