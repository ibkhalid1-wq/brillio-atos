import {
  canonicalize,
  fingerprint,
  decideReuse,
  shouldRegenerate,
  filterFreshDownstream,
} from "@/v3/lib/intelligenceReuse";

describe("intelligenceReuse — fingerprinting", () => {
  it("is order-independent for object keys", () => {
    const a = fingerprint({ risk: "high", phase: "p1" });
    const b = fingerprint({ phase: "p1", risk: "high" });
    expect(a).toBe(b);
  });

  it("ignores cosmetic whitespace and casing changes (semantic-ish)", () => {
    const a = fingerprint({ note: "Sponsor   confirmed" });
    const b = fingerprint({ note: "sponsor confirmed" });
    expect(a).toBe(b);
  });

  it("changes when meaning changes", () => {
    const a = fingerprint({ note: "Sponsor confirmed" });
    const b = fingerprint({ note: "Sponsor not confirmed" });
    expect(a).not.toBe(b);
  });

  it("treats null and undefined as equivalent and sorts arrays positionally", () => {
    expect(fingerprint({ a: null })).toBe(fingerprint({ a: undefined }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });

  it("canonicalize sorts keys and normalizes strings", () => {
    expect(canonicalize({ b: "  X ", a: 1 })).toEqual({ a: 1, b: "x" });
  });
});

describe("intelligenceReuse — decideReuse", () => {
  const base = {
    currentFingerprint: "abc",
    priorFingerprint: "abc",
    hasPriorOutput: true,
  };

  it("reuses when nothing changed", () => {
    const d = decideReuse(base);
    expect(d.action).toBe("reuse");
    expect(shouldRegenerate(base)).toBe(false);
  });

  it("regenerates when evidence fingerprint differs", () => {
    expect(decideReuse({ ...base, currentFingerprint: "xyz" }).action).toBe("regenerate");
  });

  it("regenerates when there is no prior output", () => {
    expect(decideReuse({ ...base, hasPriorOutput: false }).action).toBe("regenerate");
    expect(decideReuse({ ...base, priorFingerprint: null }).action).toBe("regenerate");
  });

  it("regenerates on readiness or confidence change even if fingerprint matches", () => {
    expect(decideReuse({ ...base, readinessChanged: true }).action).toBe("regenerate");
    expect(decideReuse({ ...base, confidenceChanged: true }).action).toBe("regenerate");
  });

  it("regenerates when forced regardless of state", () => {
    const d = decideReuse({ ...base, forced: true });
    expect(d.action).toBe("regenerate");
    expect(d.reason).toMatch(/requested/i);
  });
});

describe("intelligenceReuse — cascade-skip governance", () => {
  const downstream = [
    { agentId: "health-heatmap", phaseId: "program" },
    { agentId: "contradiction-detector", phaseId: "p1" },
    { agentId: "scope-creep-monitor", phaseId: "p1" },
  ];

  it("runs only stale downstream candidates and skips fresh ones", () => {
    const stale = new Set(["health-heatmap"]);
    const { run, skipped } = filterFreshDownstream(downstream, (c) => stale.has(c.agentId));
    expect(run.map((c) => c.agentId)).toEqual(["health-heatmap"]);
    expect(skipped.map((c) => c.agentId)).toEqual([
      "contradiction-detector",
      "scope-creep-monitor",
    ]);
  });

  it("skips the entire cascade when nothing downstream is stale", () => {
    const { run, skipped } = filterFreshDownstream(downstream, () => false);
    expect(run).toHaveLength(0);
    expect(skipped).toHaveLength(3);
  });

  it("runs the entire cascade when everything is stale", () => {
    const { run, skipped } = filterFreshDownstream(downstream, () => true);
    expect(run).toHaveLength(3);
    expect(skipped).toHaveLength(0);
  });
});
