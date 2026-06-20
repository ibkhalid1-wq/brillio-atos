import { useState } from "react";
import { FormattedDocument } from "@/components/FormattedDocument";

const ROLES: Record<string, string> = {
  delivery_lead: "Delivery Lead",
  architect: "Architect",
  business_lead: "Business Lead",
  risk_officer: "Risk Officer",
  programme_manager: "Programme Manager",
};

interface OnboardingBriefing {
  roleLabel: string;
  content: string;
  generatedAt: string;
}

interface OnboardingViewProps {
  onGenerate: (roleId: string) => Promise<OnboardingBriefing | null>;
}

export function OnboardingView({ onGenerate }: OnboardingViewProps) {
  const [selected, setSelected] = useState("delivery_lead");
  const [briefing, setBriefing] = useState<OnboardingBriefing | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setBriefing(await onGenerate(selected));
    } finally {
      setLoading(false);
    }
  };

  const exportBriefing = () => {
    if (!briefing) return;
    const blob = new Blob([briefing.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `onboarding-${briefing.roleLabel.replace(/\s/g, "-").toLowerCase()}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>New Team Member Onboarding</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>
        Generate a role-specific briefing for someone joining this program mid-flight.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {Object.entries(ROLES).map(([roleId, label]) => (
          <button
            key={roleId}
            type="button"
            onClick={() => setSelected(roleId)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "2px solid",
              borderColor: selected === roleId ? "#2563eb" : "#e5e7eb",
              background: selected === roleId ? "#eff6ff" : "white",
              color: selected === roleId ? "#1d4ed8" : "#374151",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: selected === roleId ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          style={{
            padding: "9px 20px",
            borderRadius: 8,
            background: loading ? "#93c5fd" : "#2563eb",
            color: "white",
            border: "none",
            cursor: loading ? "wait" : "pointer",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {loading ? "Generating…" : "Generate Briefing"}
        </button>
        {briefing ? (
          <button type="button" onClick={exportBriefing} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, cursor: "pointer", background: "white" }}>
            Export .md
          </button>
        ) : null}
      </div>

      {briefing ? (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: "#1e3a5f", color: "white", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>Onboarding Briefing — {briefing.roleLabel}</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>{new Date(briefing.generatedAt).toLocaleString()}</span>
          </div>
          <div style={{ padding: 20, background: "white" }}>
            <FormattedDocument content={briefing.content} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
