import React, { useState } from "react";

interface LiteGateModalProps {
  open: boolean;
  phaseId: string;
  phaseLabel: string;
  onComplete: (passed: boolean, answers: Record<string, boolean>) => void;
  onClose: () => void;
}

interface Question {
  id: string;
  text: string;
}

const QUESTIONS: Question[] = [
  { id: "capacity", text: "Does the team have enough capacity to proceed to the next phase?" },
  { id: "artifacts", text: "Are all required outputs and artifacts complete or in progress?" },
  { id: "blockers", text: "Have all critical blockers and open issues been addressed?" },
  { id: "stakeholders", text: "Have key stakeholders been informed of the transition?" },
  { id: "risk", text: "Is the risk posture acceptable for moving forward?" },
];

export default function LiteGateModal({
  open,
  phaseLabel,
  onComplete,
  onClose,
}: LiteGateModalProps) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [showResult, setShowResult] = useState(false);

  if (!open) return null;

  const answered = Object.keys(answers).length;
  const allPassed = QUESTIONS.every((q) => answers[q.id] === true);
  const failedQuestions = QUESTIONS.filter((q) => answers[q.id] === false);

  function handleAnswer(value: boolean) {
    const question = QUESTIONS[currentQ];
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    if (currentQ < QUESTIONS.length - 1) {
      setCurrentQ((p) => p + 1);
    } else {
      setShowResult(true);
    }
  }

  function handleClose() {
    const passed = QUESTIONS.every((q) => answers[q.id] === true);
    onComplete(passed, answers);
    resetState();
    onClose();
  }

  function handleProceed() {
    onComplete(true, answers);
    resetState();
    onClose();
  }

  function resetState() {
    setCurrentQ(0);
    setAnswers({});
    setShowResult(false);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "var(--v3-font)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: "var(--v3-surface)",
          borderRadius: 16,
          padding: 28,
          width: "100%",
          maxWidth: 480,
          boxShadow: "0 16px 48px rgba(0,0,0,0.22)",
          border: "1px solid var(--v3-border)",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                color: "var(--v3-accent)",
                marginBottom: 4,
              }}
            >
              Lite Gate Check
            </p>
            <h2
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: "var(--v3-text-primary)",
              }}
            >
              {phaseLabel}
            </h2>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              color: "var(--v3-text-muted)",
              lineHeight: 1,
              padding: "2px 4px",
              fontFamily: "var(--v3-font)",
              marginLeft: 12,
            }}
          >
            ×
          </button>
        </div>

        {!showResult ? (
          <>
            {/* Progress */}
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                  Question {currentQ + 1} of {QUESTIONS.length}
                </span>
                <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
                  {Math.round((answered / QUESTIONS.length) * 100)}%
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  background: "var(--v3-surface-3)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${(answered / QUESTIONS.length) * 100}%`,
                    background: "var(--v3-accent)",
                    borderRadius: 999,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>

            {/* Question */}
            <div style={{ marginBottom: 32 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  color: "var(--v3-text-primary)",
                  lineHeight: 1.45,
                }}
              >
                {QUESTIONS[currentQ].text}
              </p>
            </div>

            {/* Yes / No buttons */}
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => handleAnswer(true)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  fontSize: 15,
                  fontWeight: 700,
                  background: "var(--v3-green)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--v3-radius)",
                  cursor: "pointer",
                  fontFamily: "var(--v3-font)",
                }}
              >
                ✓ Yes
              </button>
              <button
                onClick={() => handleAnswer(false)}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  fontSize: 15,
                  fontWeight: 700,
                  background: "var(--v3-red)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--v3-radius)",
                  cursor: "pointer",
                  fontFamily: "var(--v3-font)",
                }}
              >
                ✗ No
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Result panel */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>
                {allPassed ? "✓" : "⚠"}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: allPassed ? "var(--v3-green)" : "var(--v3-amber)",
                  marginBottom: 6,
                }}
              >
                {allPassed ? "Passed" : "Review needed"}
              </div>
              <div style={{ fontSize: 13, color: "var(--v3-text-secondary)" }}>
                {allPassed
                  ? "All 5 readiness checks passed."
                  : `${failedQuestions.length} area${failedQuestions.length > 1 ? "s" : ""} need attention.`}
              </div>
            </div>

            {failedQuestions.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--v3-text-muted)",
                  }}
                >
                  Items marked No
                </p>
                <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                  {failedQuestions.map((q) => (
                    <li
                      key={q.id}
                      style={{
                        fontSize: 13,
                        color: "var(--v3-text-secondary)",
                        marginBottom: 4,
                        lineHeight: 1.45,
                      }}
                    >
                      {q.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p
              style={{
                margin: "0 0 20px",
                fontSize: 11,
                color: "var(--v3-text-muted)",
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              This is not a formal gate approval. It's a quick readiness sense-check.
            </p>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleClose}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "var(--v3-surface-2)",
                  color: "var(--v3-text-secondary)",
                  border: "1px solid var(--v3-border)",
                  borderRadius: "var(--v3-radius)",
                  cursor: "pointer",
                  fontFamily: "var(--v3-font)",
                }}
              >
                Close
              </button>
              {allPassed && (
                <button
                  onClick={handleProceed}
                  style={{
                    flex: 2,
                    padding: "10px 0",
                    fontSize: 13,
                    fontWeight: 700,
                    background: "var(--v3-accent)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--v3-radius)",
                    cursor: "pointer",
                    fontFamily: "var(--v3-font)",
                  }}
                >
                  Proceed to Full Gate Approval
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
