import { useState } from "react";

const ADAM_PHASES = ["strategy", "mobilise", "discover", "design", "build", "operate", "govern", "optimize", "valuerealize"];

interface SimReport {
  templateId: string;
  templateLabel: string;
  simulatedAt: string;
  phases: Record<string, {
    simulatedReadiness: number;
    missingArtifactCount: number;
    predictedBlockingQuestions: string[];
    predictedRisks: string;
    recommendedPrework: string | null;
  }>;
  predictedConflicts: string;
}

interface SimulationViewProps {
  templates: Record<string, { label: string }>;
  onRun: (templateId: string) => Promise<SimReport>;
}

export function SimulationView({ templates, onRun }: SimulationViewProps) {
  const [selected, setSelected] = useState(Object.keys(templates)[0] || "");
  const [report, setReport] = useState<SimReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!selected) return;
    setRunning(true);
    try {
      setReport(await onRun(selected));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>Program Pre-flight Simulation</h2>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 13 }}>
        Run all 9 phase agents against a template to predict blockers, questions, and risks before your program starts.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {Object.entries(templates).map(([id, template]) => (
          <button
            key={id}
            onClick={() => setSelected(id)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "2px solid",
              borderColor: selected === id ? "#2563eb" : "#e5e7eb",
              background: selected === id ? "#eff6ff" : "#ffffff",
              color: selected === id ? "#1d4ed8" : "#374151",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: selected === id ? 600 : 400,
            }}
          >
            {template.label}
          </button>
        ))}
        <button
          onClick={run}
          disabled={running || !selected}
          style={{
            marginLeft: "auto",
            padding: "8px 20px",
            borderRadius: 8,
            background: running ? "#93c5fd" : "#2563eb",
            color: "#ffffff",
            border: "none",
            cursor: running ? "wait" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {running ? "Simulating…" : "Run Pre-flight"}
        </button>
      </div>

      {report ? (
        <div>
          <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 8, border: "1px solid #e5e7eb" }}>
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              Simulated {new Date(report.simulatedAt).toLocaleString()} · {report.templateLabel}
            </span>
            {report.predictedConflicts ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "#92400e", background: "#fef3c7", padding: "6px 10px", borderRadius: 6 }}>
                <strong>Predicted cross-phase conflicts:</strong> {report.predictedConflicts}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {ADAM_PHASES.map((phaseId) => {
              const phase = report.phases?.[phaseId];
              if (!phase) return null;
              const color = phase.simulatedReadiness >= 60 ? "#16a34a" : phase.simulatedReadiness >= 35 ? "#d97706" : "#dc2626";
              return (
                <div key={phaseId} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{phaseId}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color }}>{phase.simulatedReadiness}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "#e5e7eb", marginBottom: 10 }}>
                    <div style={{ width: `${phase.simulatedReadiness}%`, height: "100%", background: color, borderRadius: 2 }} />
                  </div>
                  {phase.missingArtifactCount > 0 ? (
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                      {phase.missingArtifactCount} artifact(s) will need drafting
                    </div>
                  ) : null}
                  {phase.predictedBlockingQuestions.length > 0 ? (
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 3 }}>Likely questions</div>
                      {phase.predictedBlockingQuestions.map((question, index) => (
                        <div key={`${phaseId}-question-${index}`} style={{ fontSize: 11, color: "#374151", marginBottom: 2 }}>• {question}</div>
                      ))}
                    </div>
                  ) : null}
                  {phase.predictedRisks ? (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", marginBottom: 3 }}>Top risks</div>
                      <div style={{ fontSize: 11, color: "#6b7280", whiteSpace: "pre-line" }}>{phase.predictedRisks}</div>
                    </div>
                  ) : null}
                  {phase.recommendedPrework ? (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#1d4ed8", background: "#eff6ff", padding: "4px 8px", borderRadius: 4 }}>
                      💡 {phase.recommendedPrework}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
