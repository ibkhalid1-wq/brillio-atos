import { buildDecisionQueue } from "@/lib/adamDecisionUtils";

/**
 * "Review agent draft: {artifact}" is the queue's most concrete next step, but it
 * used to be emitted only inside the loop that skips any phase whose agentState is
 * absent. After a state reset (the 2026-06-28 data-loss window) the agent-drafted
 * drafts still sit in phaseArtifacts unread, yet no review action surfaced — the
 * Actions queue went empty despite obvious work. These tests pin that the review
 * action derives from the artifact record alone, and that a signed-off (gate-
 * approved) phase's lingering drafts are NOT re-surfaced.
 */
describe("draft-review actions survive a missing agentState", () => {
  // Both phases have NO agentState — mirrors a program whose phaseAgentStates was
  // wiped. strategy's gate is approved (signed off); build is the active frontier.
  const phaseAgents = {
    strategy: { agentState: null },
    build: { agentState: null },
  };
  function projectData() {
    return {
      gateReviews: { strategy: { status: "approved" } },
      phaseArtifacts: {
        strategy: { "strategic-roadmap": { agentDrafted: true, status: "draft" } },
        build: {
          "sprint-planner": { agentDrafted: true, status: "draft" },
          "capacity-assessor": { agentDrafted: true, status: "draft" },
        },
      },
    };
  }

  it("surfaces a draft_review for each agent-drafted draft on an active phase", () => {
    const ids = buildDecisionQueue(phaseAgents, projectData(), "all")
      .filter((d) => d.type === "draft_review")
      .map((d) => d.id);
    expect(ids).toContain("draft_build_sprint-planner");
    expect(ids).toContain("draft_build_capacity-assessor");
  });

  it("does not re-surface drafts on a gate-approved phase", () => {
    const ids = buildDecisionQueue(phaseAgents, projectData(), "all").map((d) => d.id);
    expect(ids).not.toContain("draft_strategy_strategic-roadmap");
  });
});
