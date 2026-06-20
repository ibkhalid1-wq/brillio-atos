type AutonomyDecision = {
  actAutonomously: boolean;
  applyWriteBack: boolean;
  shouldQueueReview: boolean;
};

function evaluateAutonomyGate(
  agentId: string,
  confidence: number | null,
  settings?: { enabled: boolean; trustThreshold: number } | null,
): AutonomyDecision {
  const alwaysHuman = new Set(["closure", "escalation"]);
  if (alwaysHuman.has(agentId)) {
    return { actAutonomously: false, applyWriteBack: true, shouldQueueReview: false };
  }

  if (!settings) {
    return { actAutonomously: false, applyWriteBack: true, shouldQueueReview: false };
  }

  const actAutonomously = settings.enabled && typeof confidence === "number" && confidence >= settings.trustThreshold;
  return {
    actAutonomously,
    applyWriteBack: actAutonomously || !settings.enabled,
    shouldQueueReview: settings.enabled && !actAutonomously,
  };
}

describe("autonomyGate", () => {
  it("blocks closure at any confidence", () => {
    expect(evaluateAutonomyGate("closure", 0.99)).toEqual({
      actAutonomously: false,
      applyWriteBack: true,
      shouldQueueReview: false,
    });
  });

  it("allows narrative at high confidence", () => {
    expect(evaluateAutonomyGate("narrative", 0.9, { enabled: true, trustThreshold: 0.85 })).toEqual({
      actAutonomously: true,
      applyWriteBack: true,
      shouldQueueReview: false,
    });
  });
});
