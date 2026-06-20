import { useState } from "react";

const DOMAIN_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  stakeholder_engagement: { label: "Stakeholder Engagement", color: "bg-blue-50 border-blue-200", icon: "👥" },
  team_dynamics: { label: "Team Dynamics", color: "bg-purple-50 border-purple-200", icon: "🤝" },
  risk_culture: { label: "Risk Culture", color: "bg-red-50 border-red-200", icon: "⚠️" },
  meeting_effectiveness: { label: "Meeting Effectiveness", color: "bg-yellow-50 border-yellow-200", icon: "📅" },
  decision_velocity: { label: "Decision Velocity", color: "bg-orange-50 border-orange-200", icon: "⚡" },
  artifact_quality: { label: "Artifact Quality", color: "bg-green-50 border-green-200", icon: "📄" },
  delivery_cadence: { label: "Delivery Cadence", color: "bg-indigo-50 border-indigo-200", icon: "🚀" },
  benefits_focus: { label: "Benefits Focus", color: "bg-teal-50 border-teal-200", icon: "📈" },
};

interface Tip {
  id: string;
  domain: string;
  tip: string;
  evidence: string;
  createdAt: number;
  dismissed: boolean;
}

interface Props {
  tips: Tip[];
  enabled: boolean;
  lastCoachedAt: number | null;
  onDismiss: (id: string) => void;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
}

export function CoachingView({
  tips,
  enabled,
  lastCoachedAt,
  onDismiss,
  onToggle,
  onRefresh,
}: Props) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("all");

  const domains = ["all", ...Array.from(new Set(tips.map((tip) => tip.domain)))];
  const active = tips.filter((tip) => !tip.dismissed);
  const visible = tips
    .filter((tip) => showDismissed || !tip.dismissed)
    .filter((tip) => selectedDomain === "all" || tip.domain === selectedDomain)
    .sort((left, right) => right.createdAt - left.createdAt);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">AI Coaching Mode</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Personalised coaching tips based on program behaviour, focused on how the work is being led.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
            Coaching enabled
          </label>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-4 text-sm items-center">
        <span className="text-gray-500">{active.length} active tip{active.length !== 1 ? "s" : ""}</span>
        {lastCoachedAt ? (
          <span className="text-xs text-gray-400">Last updated {new Date(lastCoachedAt).toLocaleDateString()}</span>
        ) : null}
      </div>

      <div className="flex gap-2 flex-wrap text-xs">
        {domains.map((domain) => (
          <button
            key={domain}
            type="button"
            onClick={() => setSelectedDomain(domain)}
            className={`px-2 py-0.5 rounded border ${
              selectedDomain === domain ? "bg-indigo-600 text-white border-indigo-600" : "border-gray-300"
            }`}
          >
            {domain === "all" ? "All Domains" : (DOMAIN_CONFIG[domain]?.label || domain)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowDismissed((value) => !value)}
          className={`px-2 py-0.5 rounded border ${
            showDismissed ? "bg-gray-600 text-white border-gray-600" : "border-gray-300 text-gray-400"
          }`}
        >
          {showDismissed ? "Hide dismissed" : "Show dismissed"}
        </button>
      </div>

      {!enabled ? (
        <div className="border rounded p-4 text-center text-gray-400 text-sm">
          Coaching mode is disabled. Enable it above to receive personalised guidance.
        </div>
      ) : null}

      {enabled && visible.length === 0 ? (
        <div className="border rounded p-6 text-center text-gray-400 text-sm">
          <p>No coaching tips yet.</p>
          <p className="text-xs mt-1">Tips are generated automatically every 3 days, or you can refresh on demand.</p>
        </div>
      ) : null}

      <div className="space-y-3">
        {visible.map((tip) => {
          const config = DOMAIN_CONFIG[tip.domain] || {
            label: tip.domain,
            color: "bg-gray-50 border-gray-200",
            icon: "💡",
          };
          return (
            <div
              key={tip.id}
              className={`border rounded p-4 space-y-2 transition-opacity ${tip.dismissed ? "opacity-50" : ""} ${config.color}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{config.icon}</span>
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{config.label}</span>
                </div>
                <div className="flex gap-1 items-center shrink-0">
                  <span className="text-xs text-gray-400">{new Date(tip.createdAt).toLocaleDateString()}</span>
                  {!tip.dismissed ? (
                    <button
                      type="button"
                      onClick={() => onDismiss(tip.id)}
                      className="text-xs px-2 py-0.5 rounded bg-white border border-gray-300 hover:bg-gray-50 text-gray-500"
                    >
                      Dismiss
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="text-sm text-gray-800 leading-relaxed">{tip.tip}</p>
              <div className="flex items-start gap-1.5 bg-white/70 rounded px-2 py-1.5 text-xs text-gray-500">
                <span className="shrink-0">📊</span>
                <span>{tip.evidence}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
