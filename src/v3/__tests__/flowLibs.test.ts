/**
 * The Flow libraries are pure blob transforms — these tests pin the rules
 * the workspace runs on: what a confirm merges, what acceptance requires,
 * where an ingested response routes.
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { resolveFlowDecision, listOpenFlowDecisions, describeDecisionChanges, handledContradictionStatements, isContradictionHandled, pruneFlowDecisionsForStorage } from "@/v3/components/flow/flowDecisions";
import { scriptDocumentRefs, meetingKit, stakeholderEmail, buildMeetingIcs, mailtoLink, kitGaps } from "@/v3/components/flow/flowMeetings";
import { locateQuote, kitPersonas, personasMissingFromAtlas, readContradictions, contradictionLogWithout } from "@/v3/components/flow/flowShellData";
import { mintBrief, buildBriefSnapshot } from "@/v3/components/flow/flowBriefs";
import { buildPrototypePrompt } from "@/v3/components/flow/flowBuildPrompt";
import { validateProgramBlob, migrateProgramBlob, BLOB_VERSION } from "@/v3/lib/blobGuard";
import { unrosteredVoicesProposal, reDemoProposal, ontologyRepairProposal, queueWatcherProposal } from "@/v3/components/flow/flowWatchers";
import { routeAttachedDocument, buildRoutedBlocks } from "@/v3/components/flow/flowDocRouting";
import { retroAttributionProposal, negatedClaimProposal } from "@/v3/components/flow/flowWatchers";
import { rankEvidence, isNoiseEvidence, scoreEvidence } from "@/v3/components/flow/flowEvidenceRank";
import { resolveMovementStakeholders, deliveryRoleDirectory, validateProgramRole, knownProgramRoles, readDirectoryPeople, unresolvedCoverageNames, knownPeopleNames, stripAskAddressee } from "@/v3/components/flow/flowStakeholders";
import { mintFollowUpPack, listInterviewPacks, visibleLinks } from "@/v3/components/flow/flowPortal";
import { trackAcceptance, trackBlockers, recordShowPass, listFlowTracks, type FlowTrack } from "@/v3/components/flow/flowTracks";
import { setShipLane, toggleShipItem, listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { ingestPortalResponse, listPortalInbox } from "@/v3/components/flow/flowPortal";
import { gateChecklist, gateReadiness, flowMovements, movementEvidence, listRebuildActionItems } from "@/v3/components/flow/flowShellData";
import { buildDrilldownFindings, drillRollupTarget, listChildDrilldowns, readDrillAnchor, listDrillAnchors } from "@/v3/components/flow/flowDrilldown";
import { mapTranscriptSpeakers } from "@/v3/components/flow/flowTranscriptMap";
import { gateApprovalIntegrity } from "@/v3/components/flow/flowGovernance";
import { validateOntologyConstraints, hasBlockingOntologyViolations, partitionOntologyViolations } from "@/v3/components/flow/flowOntologyConstraints";
import { readMetricRegistry, metricConsistency, metricById } from "@/v3/components/flow/flowMetricRegistry";
import { readGovernedExceptions, withNewException, withResolvedException, governedExceptionsForInbox } from "@/v3/components/flow/flowExceptions";
import { projectAgentifyReview, projectOntologyAtlasReview, atlasPersonas, composeAgentifyAnswers, projectListenWorkflowReview, composeListenWorkflowAnswers } from "@/v3/components/flow/flowReviews";
import { gateAugmentations } from "@/v3/components/flow/flowCrossValidation";
import { programAreas, workflowArea, inferArea, areaProgress, personaAreas, personaReadyToAdvance, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";

const programme = (inner: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: inner } as unknown as ProgramSummary);

const track = (over: Partial<FlowTrack>): FlowTrack => ({
  id: "t1", name: "T", goal: "", dependsOn: [], slices: [], createdAt: new Date().toISOString(), showPasses: [], ...over,
});

describe("flowDecisions.resolveFlowDecision", () => {
  const base = {
    flowDecisions: [{ id: "d1", status: "open", tier: 2, movementId: "envision", title: "Adopt", payload: {
      dynamicSchema: { inputFields: { envision: [{ id: "x" }] } },
      tracks: [{ id: "tr1", name: "Track One", showPasses: [] }],
      ontologyAlignment: [{ entity: "Quote", standard: "https://schema.org/Quotation" }],
      flowGovernance: { movementBudgets: { envision: 2000 } },
    } }],
  };

  it("confirm merges every payload family additively and attests the human", () => {
    const blob = resolveFlowDecision(programme(structuredClone(base)), "d1", "confirmed", "user@x")!;
    expect((blob.dynamicSchema as Record<string, Record<string, unknown[]>>).inputFields.envision).toHaveLength(1);
    expect((blob.tracks as unknown[])).toHaveLength(1);
    expect((blob.ontologyAlignment as Array<Record<string, unknown>>)[0].adoptedAt).toBeTruthy();
    expect((blob.flowGovernance as Record<string, Record<string, number>>).movementBudgets.envision).toBe(2000);
    const log = blob.flowAttestations as Array<Record<string, unknown>>;
    expect(log[log.length - 1].agentId).toBe("user@x");
  });

  it("decline marks the record and merges nothing", () => {
    const blob = resolveFlowDecision(programme(structuredClone(base)), "d1", "declined", "user@x")!;
    expect(blob.tracks).toBeUndefined();
    expect(listOpenFlowDecisions(programme(blob))).toHaveLength(0);
  });

  it("hides an open track decision whose tracks are all already adopted", () => {
    const noop = { flowDecisions: [{ id: "d9", status: "open", tier: 2, movementId: "envision",
      title: "Adopt the track plan", payload: { tracks: [{ id: "tr1", name: "Track One" }] } }],
      tracks: [{ id: "tr1", name: "Track One", showPasses: [] }] };
    expect(listOpenFlowDecisions(programme(noop))).toHaveLength(0);
    const fresh = { flowDecisions: [{ id: "d9", status: "open", tier: 2, movementId: "envision",
      title: "Adopt the track plan", payload: { tracks: [{ id: "trNEW", name: "New Track" }] } }],
      tracks: [{ id: "tr1", name: "Track One", showPasses: [] }] };
    expect(listOpenFlowDecisions(programme(fresh))).toHaveLength(1);
  });

  it("re-adopting tracks never erases existing pass records", () => {
    const withExisting = structuredClone(base) as Record<string, unknown>;
    withExisting.tracks = [{ id: "tr1", name: "Track One", showPasses: [{ ts: "2026-01-01", verdict: "accepted" }] }];
    const blob = resolveFlowDecision(programme(withExisting), "d1", "confirmed", "u")!;
    const tracks = blob.tracks as Array<Record<string, unknown>>;
    expect(tracks).toHaveLength(1);
    expect((tracks[0].showPasses as unknown[])).toHaveLength(1);
  });
});

describe("flowTracks acceptance rule", () => {
  it("two accepted passes accept the track", () => {
    const t = track({ showPasses: [
      { ts: "a", verdict: "accepted" }, { ts: "b", verdict: "accepted-with-changes" },
    ] });
    expect(trackAcceptance(t).accepted).toBe(true);
  });

  it("one accepted pass over a stable diff accepts; one alone does not", () => {
    expect(trackAcceptance(track({ showPasses: [{ ts: "a", verdict: "accepted" }] })).accepted).toBe(false);
    expect(trackAcceptance(track({ showPasses: [{ ts: "a", verdict: "accepted", stableDiff: true }] })).accepted).toBe(true);
  });

  it("blockers are unaccepted upstream tracks only", () => {
    const done = track({ id: "up", showPasses: [{ ts: "a", verdict: "accepted" }, { ts: "b", verdict: "accepted" }] });
    const dep = track({ id: "down", dependsOn: ["up", "missing"] });
    expect(trackBlockers(dep, [done, dep])).toHaveLength(0);
  });

  it("recordShowPass appends to the right track", () => {
    const blob = recordShowPass(programme({ tracks: [track({})] }), "t1", { verdict: "rework" })!;
    expect(listFlowTracks(programme(blob))[0].showPasses[0].verdict).toBe("rework");
  });
});

describe("flowShip", () => {
  it("gate progress needs validation AND cutover lanes complete", () => {
    const inner = { shipLanes: { lanes: [
      { id: "validation", name: "V", items: [{ id: "v1", label: "x", done: false }] },
      { id: "cutover", name: "C", items: [{ id: "c1", label: "y", done: true }] },
    ] } };
    const before = shipLaneProgress(listShipLanes(programme(inner)));
    expect(before.validationDone && before.cutoverDone).toBe(false);
    const blob = toggleShipItem(programme(inner), "validation", "v1", "u")!;
    const after = shipLaneProgress(listShipLanes(programme(blob)));
    expect(after.validationDone && after.cutoverDone).toBe(true);
  });
});

describe("flowPortal ingest routing", () => {
  it("routes a follow-up response to the pack's movement and field", () => {
    const inner = {
      flowInterviewPacks: [{ id: "pk", stakeholder: "Jane", token: "s", createdAt: "2026-01-01", movementId: "frame", captureField: "sponsorConversation" }],
      flowPortalInbox: [{ id: "i1", kind: "interview", stakeholder: "Jane", role: "COO", receivedAt: "2026-01-02", text: "Answer body" }],
    };
    const blob = ingestPortalResponse(programme(inner), "i1", "u")!;
    const frame = (blob.phaseInputs as Record<string, Record<string, string>>).frame;
    expect(frame.sponsorConversation).toContain("Answer body");
    expect(listPortalInbox(programme(blob))).toHaveLength(0);
  });

  it("defaults to listen and flips the roster to Heard", () => {
    const inner = {
      flowPortalInbox: [{ id: "i1", kind: "interview", stakeholder: "Maria", role: "Ops", receivedAt: "x", text: "Words here" }],
      phaseInputs: { listen: { interviewRoster: JSON.stringify([{ name: "Maria", status: "Booked" }]) } },
    };
    const blob = ingestPortalResponse(programme(inner), "i1", "u")!;
    const listen = (blob.phaseInputs as Record<string, Record<string, string>>).listen;
    expect(listen.interviewTranscripts).toContain("Words here");
    expect(JSON.parse(listen.interviewRoster)[0].status).toBe("Heard");
  });
});

describe("voice watcher — unrostered voices become a Tier-2 proposal", () => {
  const withVoices = (roster: Array<Record<string, string>>, extra: Record<string, unknown> = {}) => programme({
    ...extra,
    phaseInputs: { listen: {
      interviewRoster: JSON.stringify(roster),
      interviewTranscripts: "— Alex Kim, CFO, 2026-07-01 —\nBudget approval takes three weeks because finance re-checks every quote by hand.",
    } },
  });

  it("an attributed voice missing from the roster yields a proposal with the payload", () => {
    const proposal = unrosteredVoicesProposal(withVoices([{ name: "Dan Reyes", status: "Heard" }]))!;
    expect(proposal.tier).toBe(2);
    expect(proposal.agentId).toBe("voice-watcher");
    expect(proposal.payload.rosterAdditions).toEqual([{ name: "Alex Kim", role: "CFO" }]);
  });

  it("the same finding is never proposed twice — declined included", () => {
    const first = unrosteredVoicesProposal(withVoices([]))!;
    const again = unrosteredVoicesProposal(withVoices([], { flowDecisions: [{ ...first, status: "declined" }] }));
    expect(again).toBeNull();
  });

  it("rostered voices propose nothing", () => {
    expect(unrosteredVoicesProposal(withVoices([{ name: "Alex Kim", status: "Heard" }]))).toBeNull();
  });

  it("confirming merges the voices into the roster as Heard, deduped", () => {
    const p = withVoices([{ name: "Dan Reyes", status: "Heard" }]);
    const proposal = unrosteredVoicesProposal(p)!;
    const queued = programme({ ...JSON.parse(JSON.stringify((queueWatcherProposal(p, proposal) as Record<string, unknown>))) });
    const blob = resolveFlowDecision(queued, proposal.id, "confirmed", "you")!;
    const listen = (blob.phaseInputs as Record<string, Record<string, string>>).listen;
    const roster = JSON.parse(listen.interviewRoster);
    expect(roster).toEqual([
      { name: "Dan Reyes", status: "Heard" },
      { name: "Alex Kim", role: "CFO", status: "Heard" },
    ]);
  });
});

describe("track re-adoption — metadata refreshes, demonstrations never erased", () => {
  it("an incoming same-id track updates lead/goal but keeps show passes", () => {
    const p = programme({
      tracks: [{ id: "t1", name: "Quote Automation", goal: "old goal", leadStakeholder: "Sales Lead", showPasses: [{ ts: "x", verdict: "accepted" }], createdAt: "2026-07-01" }],
      flowDecisions: [{
        id: "d1", tier: 2, status: "open", agentId: "agentic-blueprint", movementId: "envision", title: "Adopt",
        payload: { tracks: [
          { id: "t1", name: "Quote Automation", goal: "new goal", leadStakeholder: "Dan Reyes" },
          { id: "t2", name: "New Track", goal: "g", leadStakeholder: "Priya Nair" },
        ] },
      }],
    });
    const blob = resolveFlowDecision(p, "d1", "confirmed", "you")!;
    const tracks = blob.tracks as Array<Record<string, unknown>>;
    const t1 = tracks.find((t) => t.id === "t1")!;
    expect(t1.leadStakeholder).toBe("Dan Reyes");
    expect(t1.goal).toBe("new goal");
    expect((t1.showPasses as unknown[]).length).toBe(1);
    expect(tracks.some((t) => t.id === "t2")).toBe(true);
  });
});

describe("re-demo loop — rework verdicts get a road back to the room", () => {
  const scripts = { scripts: [
    { stakeholder: "Dan Reyes", role: "RevOps", scenario: "Quote flow", steps: [], acceptanceAsk: "Good?" },
  ] };
  const base = (over: Record<string, unknown> = {}) => programme({
    demoScripts: scripts,
    phaseInputs: { show: { demoTour: JSON.stringify([
      { stakeholder: "Dan Reyes", verdict: "Not yet — it needs rework" },
      { stakeholder: "Priya Nair", verdict: "Accepted" },
    ]) } },
    ...over,
  });

  it("a rework verdict with no live link proposes fresh invites", () => {
    const proposal = reDemoProposal(base())!;
    expect(proposal.agentId).toBe("redemo-watcher");
    expect(proposal.payload.reDemoStakeholders).toEqual(["Dan Reyes"]);
  });

  it("no proposal while an unanswered link already waits on them", () => {
    expect(reDemoProposal(base({
      flowDemoInvites: [{ id: "d1", stakeholder: "Dan Reyes", token: "t" }],
    }))).toBeNull();
  });

  it("confirming retires the old unanswered link and mints a fresh one", () => {
    const p = base({
      flowDemoInvites: [
        { id: "old", stakeholder: "Dan Reyes", token: "t-old", createdAt: "2026-07-01" },
        { id: "done", stakeholder: "Priya Nair", token: "t-done", respondedAt: "2026-07-05" },
      ],
      flowDecisions: [{
        id: "rd1", tier: 2, status: "open", agentId: "redemo-watcher", movementId: "show",
        title: "Invite 1 stakeholder to re-demonstrate", payload: { reDemoStakeholders: ["Dan Reyes"] },
      }],
    });
    const blob = resolveFlowDecision(p, "rd1", "confirmed", "you")!;
    const invites = blob.flowDemoInvites as Array<Record<string, string>>;
    expect(invites.some((invite) => invite.id === "old")).toBe(false);
    expect(invites.some((invite) => invite.id === "done")).toBe(true);
    const fresh = invites.find((invite) => invite.stakeholder === "Dan Reyes");
    expect(fresh).toBeTruthy();
    expect(fresh!.token).not.toBe("t-old");
  });
});

describe("contradictionEntries — watcher findings file as open log rows", () => {
  const withDecision = (log?: Array<Record<string, string>>) => programme({
    phaseInputs: { listen: log ? { contradictionLog: JSON.stringify(log) } : {} },
    flowDecisions: [{
      id: "cw1", tier: 2, status: "open", agentId: "contradiction-watcher", movementId: "listen",
      title: "File 1 contradiction to the log",
      payload: { contradictionEntries: [{ statement: "Quote table is the sole record", between: "Dan (demo) vs Marcus", positions: "demo showed CRM notes carrying amendments" }] },
    }],
  });

  it("confirming appends an Open row to Listen's contradiction log", () => {
    const blob = resolveFlowDecision(withDecision([{ statement: "Existing", status: "Resolved" }]), "cw1", "confirmed", "you")!;
    const listen = (blob.phaseInputs as Record<string, Record<string, string>>).listen;
    const rows = JSON.parse(listen.contradictionLog);
    expect(rows).toHaveLength(2);
    expect(rows[1].statement).toBe("Quote table is the sole record");
    expect(rows[1].status).toMatch(/^Open — filed /);
  });

  it("the Inbox preview names the rows and the gate consequence", () => {
    const p = withDecision();
    const decision = listOpenFlowDecisions(p)[0];
    const [change] = describeDecisionChanges(p, decision);
    expect(change.target).toBe("Contradiction log (Listen)");
    expect(change.effect).toContain("1 open row");
    expect(change.rows[0]).toContain("Quote table is the sole record");
  });

  it("declining files nothing", () => {
    const blob = resolveFlowDecision(withDecision(), "cw1", "declined", "you")!;
    const listen = (blob.phaseInputs as Record<string, Record<string, string>> | undefined)?.listen;
    expect(listen?.contradictionLog).toBeUndefined();
  });
});

describe("pruneFlowDecisionsForStorage — the decision log can't balloon the blob", () => {
  const heavy = { artifactDocs: { charter: { body: "x".repeat(500) } }, artifactStubs: [{ record: "y".repeat(500) }] };

  it("keeps OPEN decisions' payload intact (it applies on confirm)", () => {
    const open = [{ id: "o1", status: "open", agentId: "x", payload: heavy }];
    const out = pruneFlowDecisionsForStorage(open) as Array<Record<string, unknown>>;
    expect(out[0].payload).toEqual(heavy);
  });

  it("slims a RESOLVED decision's heavy payload but keeps contradiction rows for dedup", () => {
    const resolved = [{ id: "r1", status: "confirmed", agentId: "x",
      payload: { ...heavy, contradictionEntries: [{ statement: "Quote table disputed" }] } }];
    const [row] = pruneFlowDecisionsForStorage(resolved) as Array<Record<string, unknown>>;
    const payload = row.payload as Record<string, unknown>;
    expect(payload.artifactDocs).toBeUndefined();
    expect(payload.artifactStubs).toBeUndefined();
    expect(payload.contradictionEntries).toEqual([{ statement: "Quote table disputed" }]);
    // A resolved decision with only heavy keys is left with a null payload.
    const [bare] = pruneFlowDecisionsForStorage([{ id: "r2", status: "declined", payload: heavy }]) as Array<Record<string, unknown>>;
    expect(bare.payload).toBeNull();
  });

  it("caps how many resolved decisions are retained, newest kept, order preserved", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `r${i}`, status: "confirmed", payload: {} }));
    const withOpen = [...many, { id: "open1", status: "open", payload: heavy }];
    const out = pruneFlowDecisionsForStorage(withOpen, 60) as Array<Record<string, unknown>>;
    // 60 newest resolved + the open one.
    expect(out).toHaveLength(61);
    expect(out.some((d) => d.id === "r0")).toBe(false); // oldest dropped
    expect(out.some((d) => d.id === "r69")).toBe(true); // newest kept
    expect(out[out.length - 1].id).toBe("open1"); // open decision preserved in place
  });

  it("the slimmed log still answers the contradiction dedup", () => {
    const pruned = pruneFlowDecisionsForStorage([
      { id: "r1", status: "declined", agentId: "contradiction-watcher",
        payload: { artifactDocs: heavy.artifactDocs, contradictionEntries: [{ statement: "Two accounts disagree on the source of record" }] } },
    ]) as unknown[];
    const p = programme({ flowDecisions: pruned });
    expect(handledContradictionStatements(p)).toContain("two accounts disagree on the source of record");
  });
});

describe("contradiction stickiness — a dispute is proposed once, whatever the verdict", () => {
  it("handledContradictionStatements gathers log rows AND every decision's statements, any verdict", () => {
    const p = programme({
      phaseInputs: { listen: { contradictionLog: JSON.stringify([{ statement: "Logged dispute", status: "Open" }]) } },
      flowDecisions: [
        { id: "d1", tier: 2, status: "declined", agentId: "contradiction-watcher", movementId: "listen",
          payload: { contradictionEntries: [{ statement: "Declined dispute" }] } },
        { id: "d2", tier: 2, status: "confirmed", agentId: "current-state-atlas", movementId: "listen",
          payload: { contradictionEntries: [{ statement: "Atlas dispute" }] } },
      ],
    });
    const handled = handledContradictionStatements(p);
    expect(handled).toEqual(expect.arrayContaining(["logged dispute", "declined dispute", "atlas dispute"]));
    expect(isContradictionHandled(handled, "Declined dispute")).toBe(true);
    // Either-direction containment tolerates paraphrase/slicing.
    expect(isContradictionHandled(handled, "the Atlas dispute, restated at length")).toBe(true);
    expect(isContradictionHandled(handled, "a brand new disagreement")).toBe(false);
  });

  it("the negated-claim watcher stays silent when the dispute was already judged by ANOTHER agent (declined)", () => {
    const claim = { transformationCharter: { businessObjective: "Build the CRM on the Twenty open-source foundation, proving it on one pilot." } };
    const evidence = { phaseInputs: { frame: { sponsorConversation: "— Raj, Sponsor, 2026-07-12 —\nWe are no longer using Twenty as the foundation; the team builds from scratch." } } };
    // Fresh: the watcher proposes it.
    expect(negatedClaimProposal(programme({ ...claim, ...evidence }))).not.toBeNull();
    // But a DECLINED atlas decision (different id, different agent) already
    // carried that statement — so it is NOT re-surfaced. Without the per-statement
    // filter the stable-id check would miss this (the ids don't match).
    const alreadyJudged = programme({
      ...claim, ...evidence,
      flowDecisions: [{
        id: "atlas-x", tier: 2, status: "declined", agentId: "current-state-atlas", movementId: "listen",
        title: "File 1 contradiction to the log",
        payload: { contradictionEntries: [{ statement: "We are no longer using Twenty as the foundation", between: "Raj vs Charter", positions: "" }] },
      }],
    });
    expect(negatedClaimProposal(alreadyJudged)).toBeNull();
  });
});

describe("rebuild action items — regenerations owed when auto-build is off", () => {
  const staleInner = { phaseArtifacts: { listen: { "domain-ontology": { inputsFingerprint: "old" } } } };
  it("surfaces a present-and-stale artifact as a rebuild item", () => {
    const items = listRebuildActionItems(programme(staleInner));
    expect(items.some((i) => i.agentId === "domain-ontology" && i.movementId === "listen")).toBe(true);
  });
  it("is empty when auto-build is on — the proactive effect handles rebuilds", () => {
    expect(listRebuildActionItems(programme({ ...staleInner, _autoBuild: true }))).toHaveLength(0);
  });
  it("excludes a gated (approved) movement — its inputs are frozen", () => {
    const p = { ...programme(staleInner), gateReviews: { listen: { status: "approved" } } } as never;
    expect(listRebuildActionItems(p)).toHaveLength(0);
  });
});

describe("durable per-stakeholder link — one token, reused, never retired", () => {
  it("a follow-up rides the person's ONE durable link and folds prior answers into the recap", () => {
    const p = programme({ flowInterviewPacks: [
      // Sarah already holds a review link (earliest token) AND an answered
      // follow-up from another movement — the durable model is one link per
      // person, so both collapse onto the earliest token.
      { id: "old-review", role: "review:agentify", stakeholder: "Sarah Okafor, COO", movementId: "listen", questions: ["Old q"], token: "t1", createdAt: "2026-07-01" },
      { id: "old-answered", role: "Follow-up", stakeholder: "Sarah Okafor, COO", movementId: "frame", questions: ["Answered q"], token: "t2", createdAt: "2026-07-02", respondedAt: "2026-07-03" },
    ] });
    const blob = mintFollowUpPack(p, { movementId: "frame", who: "Sarah Okafor, COO", questions: ["New q"], captureField: "sponsorConversation" }, "you")!;
    const packs = blob.flowInterviewPacks as Array<Record<string, unknown>>;
    // ONE durable pack, on the EARLIEST token (a link already shared keeps working).
    expect(packs).toHaveLength(1);
    expect(packs[0].token).toBe("t1");
    expect(packs[0].questions).toEqual(["New q"]);
    expect(packs[0].role).toBe("Follow-up");
    // Her prior answer is preserved as recap history, not thrown away.
    const subs = packs[0].submissions as Array<{ ts: string }>;
    expect(subs.some((s) => s.ts === "2026-07-03")).toBe(true);
  });

  it("re-sending the identical ask is idempotent — the standing link stands", () => {
    const p = programme({ flowInterviewPacks: [
      { id: "d", role: "Follow-up", stakeholder: "Sarah", movementId: "frame", questions: ["New q"], token: "t", createdAt: "2026-07-01", askUpdatedAt: "2026-07-01" },
    ] });
    expect(mintFollowUpPack(p, { movementId: "frame", who: "Sarah", questions: ["New q"], captureField: "x" }, "you")).toBeNull();
  });

  it("surfaces show one link per person per state — newest wins", () => {
    const packs = listInterviewPacks(programme({ flowInterviewPacks: [
      { id: "old", role: "Follow-up", stakeholder: "Sarah", movementId: "frame", questions: ["a"], token: "t1", createdAt: "2026-07-01" },
      { id: "new", role: "Follow-up", stakeholder: "Sarah", movementId: "frame", questions: ["b"], token: "t2", createdAt: "2026-07-05" },
      { id: "done", role: "Follow-up", stakeholder: "Sarah", movementId: "frame", questions: ["c"], token: "t3", createdAt: "2026-07-02", respondedAt: "2026-07-03" },
    ] }));
    expect(visibleLinks(packs).map((pack) => pack.id).sort()).toEqual(["done", "new"]);
  });

  it("packs expose their movement so channels can scope to their own", () => {
    const p = programme({ flowInterviewPacks: [
      { id: "f", role: "Follow-up", stakeholder: "S", movementId: "frame", questions: ["q"], token: "t" },
      { id: "d", stakeholder: "S", questions: ["q"], token: "t2" },
    ] });
    const packs = listInterviewPacks(p);
    expect(packs.find((pack) => pack.id === "f")?.movementId).toBe("frame");
    expect(packs.find((pack) => pack.id === "d")?.movementId).toBeUndefined();
  });
});

describe("blobGuard — validation and migration at the blob boundary", () => {
  it("a well-formed blob raises no issues", () => {
    expect(validateProgramBlob({
      phaseInputs: { frame: { sponsor: "Sarah" } },
      flowDecisions: [{ id: "d1", status: "open" }],
      flowAttestations: [{ ts: "t", agentId: "a", phaseId: "frame", tier: 1, action: "x" }],
      unknownKeyIsFine: { anything: true },
    })).toEqual([]);
  });

  it("a malformed known key is reported, named, and left in place", () => {
    const inner = { flowDecisions: { not: "an array" } };
    const issues = validateProgramBlob(inner);
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("flowDecisions");
    expect(inner.flowDecisions).toEqual({ not: "an array" });
  });

  it("a partial attestation (append-only log) is NOT flagged — only the array-of-objects shape is enforced", () => {
    expect(validateProgramBlob({ flowAttestations: [{ action: "Minted a link" }, { ts: "x" }] })).toEqual([]);
    // A non-array is still caught.
    expect(validateProgramBlob({ flowAttestations: { not: "an array" } })).toHaveLength(1);
  });

  it("migration stamps the version once and is idempotent", () => {
    const first = migrateProgramBlob({ phaseInputs: {} });
    expect(first.migrated).toBe(true);
    expect(first.inner._blobVersion).toBe(BLOB_VERSION);
    const second = migrateProgramBlob(first.inner);
    expect(second.migrated).toBe(false);
  });
});

describe("Listen gap routing — ontology gaps reach the SME they name, and read clean", () => {
  it("strips the 'Ask the <who>:' address so the card shows a question, not an instruction", () => {
    expect(stripAskAddressee("Ask the Sales SME: What is the deal-shaping process?"))
      .toBe("What is the deal-shaping process?");
    expect(stripAskAddressee("Ask Priya — how do you hand a hire to the bench?"))
      .toBe("How do you hand a hire to the bench?");
    // A question that doesn't open with an address is left untouched.
    expect(stripAskAddressee("Walk us through a typical opportunity.")).toBe("Walk us through a typical opportunity.");
  });

  it("routes each 'Ask the <role> SME' gap to that role's card only — never onto every SME", () => {
    const p = programme({
      discoveryKit: {
        interviews: [
          { stakeholder: "Avantika", role: "Vertical Sales SME", agenda: [] },
          { stakeholder: "Hema", role: "Delivery Manager SME", agenda: [] },
          { stakeholder: "Vimal", role: "Finance SME", agenda: [] },
        ],
      },
      // Listen's artifact gaps live on the Current-State Atlas, phrased
      // "Ask the <role> SME: …" the way the atlas/ontology generator emits them.
      currentStateAtlas: {
        gaps: [
          "Ask the Sales SME: What is the deal-shaping process for cross-practice opportunities?",
          "Ask the Delivery SME: How is resource ramp-up coordinated?",
          "Ask the Finance SME: How is margin reconciled across systems?",
        ],
      },
    });
    const byName = new Map(resolveMovementStakeholders(p, "listen").map((s) => [s.name, s.questions]));
    const avantika = byName.get("Avantika") ?? [];
    const hema = byName.get("Hema") ?? [];
    const vimal = byName.get("Vimal") ?? [];
    // Each SME sees only their own domain's gap …
    expect(avantika.some((q) => /deal-shaping/i.test(q))).toBe(true);
    expect(hema.some((q) => /resource ramp-up/i.test(q))).toBe(true);
    expect(vimal.some((q) => /margin reconciled/i.test(q))).toBe(true);
    // … and NOT the other SMEs' gaps (the reported bug: all four on one card).
    expect(avantika.some((q) => /resource ramp-up|margin reconciled/i.test(q))).toBe(false);
    expect(hema.some((q) => /deal-shaping|margin reconciled/i.test(q))).toBe(false);
    // … and the address prefix never shows on the card.
    expect([...avantika, ...hema, ...vimal].some((q) => /^ask the/i.test(q))).toBe(false);
  });
});

describe("operator asks — a hand-raised question rides on the stakeholder's link", () => {
  it("reads the operator's questions for a person, keyed by name", async () => {
    const { operatorAsksFor, readOperatorAsks } = await import("@/v3/components/flow/flowStakeholders");
    const p = programme({ phaseInputs: { listen: { _operatorAsks: JSON.stringify({
      "avantika sharma": ["How is cross-practice deal shaping governed?"],
    }) } } });
    expect(operatorAsksFor(p, "listen", "Avantika Sharma")).toEqual(["How is cross-practice deal shaping governed?"]);
    expect(operatorAsksFor(p, "listen", "Nobody")).toEqual([]);
    expect(readOperatorAsks(p, "envision")).toEqual({}); // scoped per movement
  });
});

describe("guarded auto-first-generation", () => {
  it("autoBuildEnabled reflects the _autoBuild flag (off by default)", async () => {
    const { autoBuildEnabled } = await import("@/v3/components/flow/flowShellData");
    expect(autoBuildEnabled(programme({}))).toBe(false);
    expect(autoBuildEnabled(programme({ _autoBuild: true }))).toBe(true);
  });
  it("a Listen artifact is input-ready once the Frame mandate is on record, not before", async () => {
    const { artifactInputsReady } = await import("@/v3/components/flow/flowShellData");
    const withMandate = programme({ phaseInputs: { frame: {
      sponsorConversation: "— Sponsor —\nStreamline onboarding and compliance; lift NPS 40 → 60.",
    } } });
    expect(artifactInputsReady(withMandate, "listen", "current-state-atlas")).toBe(true);
    expect(artifactInputsReady(programme({ phaseInputs: { frame: {} } }), "listen", "current-state-atlas")).toBe(false);
  });
});

describe("People → collection mapping — everyone added under People gets a card", () => {
  it("an operator-added person surfaces in THEIR movement's collection, once, with a real script", () => {
    const p = programme({
      phaseInputs: { listen: { _directoryPeople: JSON.stringify([
        { id: "dp1", name: "Maya Chen", role: "Data Steward", movementId: "envision", roleResolved: true },
      ]) } },
    });
    const envision = resolveMovementStakeholders(p, "envision");
    const maya = envision.find((s) => s.name === "Maya Chen");
    expect(maya).toBeTruthy();
    expect(maya!.isRole).toBe(false);
    expect(maya!.questions.length).toBeGreaterThan(0);
    // Listed once, and only under the movement they were added to.
    expect(envision.filter((s) => s.name === "Maya Chen")).toHaveLength(1);
    expect(resolveMovementStakeholders(p, "ship").some((s) => s.name === "Maya Chen")).toBe(false);
  });

  it("a directory role matching a movement template inherits that template's questions", () => {
    const p = programme({
      phaseInputs: { listen: { _directoryPeople: JSON.stringify([
        { id: "dp2", name: "Sam Rao", role: "Solution Architect", movementId: "envision", roleResolved: true },
      ]) } },
    });
    const sam = resolveMovementStakeholders(p, "envision").find((s) => s.name === "Sam Rao");
    expect(sam?.questions.some((q) => /system of record|constraints/i.test(q))).toBe(true);
  });
});

describe("Frame facts on record via the charter — no re-asking what's already provided", () => {
  it("a charted objective / metric / scope falsifies the 'add to inputs' gaps and drops the sponsor re-ask", async () => {
    const { falsifiedGap, frameFactOnRecord, artifactOpenGaps } = await import("@/v3/components/flow/flowShellData");
    const p = programme({
      phaseInputs: { frame: {
        sponsor: "Ibrahim Khalid",
        sponsorConversation: "— Ibrahim Khalid, Executive Sponsor —\nStreamline onboarding and compliance; lift NPS 40 → 60+.",
        targetFirstDemoDate: "2026-08-05",
        // businessObjective / successMetric input fields left blank on purpose
      } },
      transformationCharter: {
        businessObjective: "Streamline customer onboarding and compliance to lift NPS.",
        successCriteria: ["Increase NPS from 40 to 60+ via CSAT surveys."],
        inScope: ["Redesign onboarding workflows."],
        outOfScope: ["Core banking changes unrelated to onboarding."],
      },
      discoveryKit: { gaps: [
        "Add a clear business objective and success metric to the Business objective and Primary success metric inputs.",
        "Add a narrative description of the current onboarding process to the Business objective input.",
        "Add scope inclusions and exclusions to the Scope inclusions inputs.",
      ] },
    });
    // Facts extracted into the charter count as on record even with blank inputs.
    expect(frameFactOnRecord(p, "businessObjective")).toBe(true);
    expect(frameFactOnRecord(p, "successMetric")).toBe(true);
    expect(frameFactOnRecord(p, "scope")).toBe(true);
    // So none of the three "add … to the inputs" gaps survive on the kit card,
    // including the misplaced "current process → business objective" one.
    expect(artifactOpenGaps(p, "discovery-kit")).toEqual([]);
    // The sponsor's Frame script no longer re-asks the objective or the metric.
    const sponsor = resolveMovementStakeholders(p, "frame")[0];
    expect(sponsor.questions.some((q) => /outcome should this system achieve|single measure proves/i.test(q))).toBe(false);
    // Guard: with NO charter and blank inputs, the gap legitimately stays open.
    const bare = programme({ phaseInputs: { frame: { sponsor: "X" } },
      discoveryKit: { gaps: ["Add a clear business objective to the Business objective input."] } });
    expect(falsifiedGap(bare, "Add a clear business objective to the Business objective input.")).toBe(false);
  });
});

describe("meetingKit follow-up — only askable gaps become script questions", () => {
  const framed = (gaps: string[]) => programme({
    phaseInputs: { frame: {
      sponsorConversation: "— Sarah Okafor, COO —\nplenty of words on record here",
      businessObjective: "obj", sponsor: "Sarah Okafor", industry: "Banking",
      successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
    }, listen: { interviewRoster: JSON.stringify([{ name: "Dan", status: "To book" }]) } },
    discoveryKit: { gaps },
  });

  it("a gap about a STAKEHOLDER-OWNED fact rephrases into a sponsor ask — never operator phrasing, never dropped", () => {
    // "…to the Objective input" is operator wording, but the objective is the
    // sponsor's fact: the script asks the sponsor for it in their language.
    const kit = meetingKit(framed(["Add a concise, outcome-oriented statement to the Objective input."]), "frame")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions.some((q) => /what outcome must this programme achieve/i.test(q))).toBe(true);
    expect(kit.questions.some((q) => /\binputs?\b/i.test(q))).toBe(false); // no plumbing phrasing on any script
  });

  it("a field-demand gap with NO bespoke rephrase still reaches the script — the generic fallback asks for the fact", () => {
    // Regression: "Add a quantified budget envelope … to the Budget input."
    // used to die in the askable filter (contains "input", no budget rule) —
    // the charter card said "→ Collect" but Collect never asked. Now a budget
    // rule exists, and unknown field-demands fall back to a generic ask.
    const kit = meetingKit(framed(["Add a quantified budget envelope and tracking approach to the Budget input."]), "frame")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions.some((q) => /budget envelope/i.test(q))).toBe(true);
    const kit2 = meetingKit(framed(["Add the launch region details to the Rollout Regions input."]), "frame")!;
    expect(kit2.questions.some((q) => /rollout regions/i.test(q))).toBe(true);
    expect(kit2.questions.some((q) => /\binputs?\b/i.test(q))).toBe(false);
  });

  it("a 'dispute' that restates a filled frame field is agreement — suppressed, never asked", () => {
    // The watcher can file the newest answer against the very field it
    // satisfies ("Raj (newest evidence) vs Charter (businessObjective)" where
    // the statement IS the objective). The record falsifies it — drop it.
    const objective = "Improve sales velocity, rep productivity, and employee satisfaction — measured against current baselines — delivered within 12 months.";
    const p = programme({ phaseInputs: {
      frame: { businessObjective: objective },
      listen: { contradictionLog: JSON.stringify([
        { statement: objective, between: "Raj Mamodia (newest evidence) vs Transformation Charter (businessObjective)", positions: "", status: "Open" },
        { statement: "We are no longer using 20 CRM as a foundation", between: "Raj vs Charter", positions: "", status: "Open" },
      ]) },
    } });
    const rows = readContradictions(p, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).toBe("We are no longer using 20 CRM as a foundation");
  });

  it("closing a dispute removes its paraphrase VARIANTS from the log too — nothing resurfaces", () => {
    const p = programme({ phaseInputs: { listen: { contradictionLog: JSON.stringify([
      { statement: "A: We are no longer using 20 CRM as a foundation", between: "a vs b", positions: "", status: "Open" },
      { statement: "no longer using 20 CRM as a foundation.", between: "a vs b", positions: "", status: "Open" },
      { statement: "We are no longer using 20 CRM as a foundation", between: "c vs d", positions: "", status: "Open" },
      { statement: "The pilot must exclude the EMEA region entirely", between: "e vs f", positions: "", status: "Open" },
    ]) } } });
    const next = JSON.parse(contradictionLogWithout(p, "A: We are no longer using 20 CRM as a foundation"));
    expect(next).toHaveLength(1);
    expect(next[0].statement).toMatch(/EMEA/);
  });

  it("watchers never mine the operator's resolution notes — no refiling, no phantom voice", () => {
    const note = "— Operator resolution, 2026-07-13 —\nDispute (Raj vs Charter): \"We are no longer using 20 CRM as a foundation\"\nSettled: the newer account stands. Recorded as evidence; the dispute is closed.";
    const p = programme({
      transformationCharter: { businessObjective: "A CRM foundation programme improving sales velocity across teams" },
      phaseInputs: { listen: { interviewTranscripts: note, interviewRoster: JSON.stringify([{ name: "Raj Mamodia", status: "Heard" }]) } },
    });
    // the negation inside the quoted dispute must not refile a contradiction
    expect(negatedClaimProposal(p)).toBeNull();
    // and "Operator resolution" must not be proposed as a roster voice
    const voices = unrosteredVoicesProposal(p);
    expect(voices === null || !JSON.stringify(voices.payload).includes("Operator")).toBe(true);
  });

  it("a doc-vs-evidence dispute settles itself once the document adopts the statement (regeneration arbitrated)", () => {
    const claim = "Improve sales velocity, rep productivity, and employee satisfaction across the sales organisation";
    const p = programme({
      transformationCharter: { businessObjective: claim },
      phaseInputs: { listen: { contradictionLog: JSON.stringify([
        { statement: claim, between: "Raj Mamodia vs Transformation Charter (businessObjective)", positions: "", status: "Open" },
        { statement: "The pilot must exclude the EMEA region entirely", between: "Raj Mamodia vs Transformation Charter (businessObjective)", positions: "", status: "Open" },
      ]) } },
    });
    const rows = readContradictions(p, true);
    // the adopted statement settles; the unadopted conflict survives
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).toMatch(/EMEA/);
  });

  it("a routed dispute leaves the sponsor's script and lands on the routed person's card", () => {
    const p = programme({
      phaseInputs: {
        frame: {
          sponsor: "Raj Mamodia",
          sponsorConversation: "— Raj Mamodia —\nplenty of words on the record here for the kit trigger",
          businessObjective: "obj", industry: "Banking", successMetric: "cycle", targetFirstDemoDate: "2026-07-25",
        },
        listen: { contradictionLog: JSON.stringify([
          { statement: "Quotes go through legal twice", between: "Ops vs Finance", positions: "", status: "Open", routedTo: "Prakash TM" },
        ]) },
      },
      discoveryKit: { interviews: [{ stakeholder: "Prakash TM", role: "Sales SME", agenda: [] }] },
    });
    // sponsor's frame kit: routed dispute is NOT among its gaps
    expect(kitGaps(p, "frame", { gateLabels: false }).some((g) => /legal twice/.test(g))).toBe(false);
    // the routed person's listen card asks it
    const prakash = resolveMovementStakeholders(p, "listen").find((s2) => /Prakash/.test(s2.name));
    expect(prakash?.questions.some((q) => /legal twice/.test(q))).toBe(true);
  });

  it("a persona spoken-for by someone NOT interviewed still gets a Listen collect card", () => {
    const p = programme({
      phaseInputs: { frame: { sponsor: "Raj" } },
      discoveryKit: {
        interviews: [{ stakeholder: "Dana Ops", role: "Sales Ops", agenda: [] }],
        personas: [
          // "spoken for" by someone who is NOT an interviewee → must get a card.
          { name: "Patient Experience and Enrollment", kind: "internal", spokenForBy: ["Nobody Interviewed"] },
          // genuinely represented by an interviewee → no separate card needed.
          { name: "Sales Persona", kind: "internal", spokenForBy: ["Dana Ops"] },
        ],
      },
    });
    const cards = resolveMovementStakeholders(p, "listen");
    expect(cards.some((c) => /Patient Experience and Enrollment/i.test(c.role) || /Patient Experience and Enrollment/i.test(c.name))).toBe(true);
    // The one genuinely covered by an interviewee is NOT duplicated as a card.
    expect(cards.some((c) => /Sales Persona/i.test(c.role))).toBe(false);
  });

  it("governed exceptions: log, read back per movement, and resolve — fingerprint-safe under _governedExceptions", () => {
    const added = withNewException([], { scope: "Cutover before Legal sign-off", justification: "Deadline immovable; risk accepted", basis: "Sponsor decision", reviewBy: "2026-08-01" }, "you");
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe("open");
    // Invalid (missing scope/justification) is a no-op — returns the SAME array.
    expect(withNewException(added, { scope: "", justification: "", basis: "" }, "you")).toBe(added);
    const p = programme({ phaseInputs: { envision: { _governedExceptions: JSON.stringify(added) } } });
    const read = readGovernedExceptions(p, "envision");
    expect(read).toHaveLength(1);
    expect(read[0].scope).toBe("Cutover before Legal sign-off");
    expect(readGovernedExceptions(p, "listen")).toHaveLength(0);  // scoped per movement
    // Resolve flips status and stamps a resolution; open sorts before resolved.
    const resolved = withResolvedException(added, added[0].id, "Legal signed the next day", "you");
    expect(resolved[0].status).toBe("resolved");
    expect(resolved[0].resolution).toMatch(/Legal signed/);
  });

  it("governedExceptionsForInbox: routes open deviations needing action, defers future-dated, skips resolved", () => {
    const p = programme({ phaseInputs: {
      listen: { _governedExceptions: JSON.stringify([
        { id: "e1", scope: "standing waiver", justification: "j", status: "open", createdAt: "2026-07-01" },
        { id: "e2", scope: "deferred", justification: "j", status: "open", reviewBy: "2999-01-01", createdAt: "2026-07-01" },
        { id: "e3", scope: "overdue", justification: "j", status: "open", reviewBy: "2000-01-01", createdAt: "2026-07-01" },
        { id: "e4", scope: "closed", justification: "j", status: "resolved", createdAt: "2026-07-01" },
      ]) },
      envision: { _governedExceptions: JSON.stringify([
        { id: "e5", scope: "another movement", justification: "j", status: "open", createdAt: "2026-07-02" },
      ]) },
    } });
    const inbox = governedExceptionsForInbox(p);
    const ids = inbox.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["e1", "e3", "e5"])); // open + due, across movements
    expect(ids).not.toContain("e2"); // future review → deferred out of the inbox
    expect(ids).not.toContain("e4"); // resolved → not surfaced
    expect(inbox[0].id).toBe("e3");  // overdue sorts first
    expect(inbox.find((e) => e.id === "e3")?.overdue).toBe(true);
    expect(inbox.find((e) => e.id === "e1")?.overdue).toBe(false);
    expect(inbox.find((e) => e.id === "e5")?.movementId).toBe("envision");
  });

  it("the Frame gate carries a charter sign-off criterion, satisfied once the sponsor approves", () => {
    const evidence = `— Raj Mamodia, Executive Sponsor, 2026-07-10 —\n${"the sponsor set the mandate in plenty of detail here. ".repeat(8)}`;
    const base = {
      phaseInputs: { frame: { sponsor: "Raj Mamodia", sponsorConversation: evidence } },
      transformationCharter: { title: "Transformation Charter", summary: "Automate quote-to-cash across the sales org.", generatedAt: "2026-07-10T00:00:00Z" },
    };
    const pack = { id: "ap1", token: "t", artifactId: "charter", movementId: "frame",
      approver: { name: "Raj Mamodia", role: "Executive Sponsor" }, createdAt: "2026-07-11T00:00:00Z", respondedAt: "2026-07-12T00:00:00Z" };
    // Before sign-off: the criterion exists on Frame (it did NOT before) and is open.
    const pending = programme({ ...base, flowApprovalPacks: [pack] });
    const openItem = gateAugmentations(pending, "frame").find((i) => i.id === "signoff-charter");
    expect(openItem).toBeTruthy();
    expect(openItem?.done).toBe(false);
    // After the sponsor approves: the same criterion is satisfied.
    const approved = programme({ ...base, flowApprovalPacks: [{ ...pack, verdict: "approved" }] });
    expect(gateAugmentations(approved, "frame").find((i) => i.id === "signoff-charter")?.done).toBe(true);
  });

  it("a present artifact nobody was asked to sign off does NOT gate the movement", () => {
    // Charter present + a contributor (the sponsor), but no sign-off was ever
    // requested for it → the gate must not invent a blocker.
    const p = programme({
      phaseInputs: { frame: { sponsor: "Raj Mamodia", sponsorConversation: `— Raj Mamodia, Executive Sponsor, 2026-07-10 —\n${"the sponsor set the mandate in detail here. ".repeat(8)}` } },
      transformationCharter: { title: "Charter", summary: "Automate quote-to-cash.", generatedAt: "2026-07-10T00:00:00Z" },
      // no flowApprovalPacks at all
    });
    expect(gateAugmentations(p, "frame").some((i) => i.id === "signoff-charter")).toBe(false);
  });

  it("agentify review projects a persona's own workflow with their steps flagged, and composes dispositions", () => {
    const p = programme({ data: { currentStateAtlas: { workflows: [
      { name: "Quote-to-Cash", trigger: "RFQ arrives", steps: [
        { actor: "Sales Rep", action: "drafts the quote", system: "CRM", entities: ["Quote"] },
        { actor: "Finance", action: "checks margin", system: "ERP" },
      ] },
      { name: "Onboarding", steps: [{ actor: "HR", action: "collects docs" }] },
    ] } } });
    expect(atlasPersonas(p)).toContain("Sales Rep");
    const review = projectAgentifyReview(p, "Sales Rep");
    expect(review).not.toBeNull();
    // Only the workflow the persona acts in rides along.
    expect(review!.workflows.map((w) => w.name)).toEqual(["Quote-to-Cash"]);
    expect(review!.workflows[0].steps[0].mine).toBe(true);   // "Sales Rep" == actor
    expect(review!.workflows[0].steps[1].mine).toBe(false);  // Finance's step
    const text = composeAgentifyAnswers(review!, { "0.0": { disposition: "agentify", comment: "auto-price it" } });
    expect(text).toMatch(/\[Agentify\] drafts the quote — auto-price it/);
  });

  it("areas: explicit area wins; otherwise inferred from the workflow name; distinct set with General last", () => {
    expect(inferArea("Quote-to-Cash pipeline")).toBe("Sales");
    expect(inferArea("Campaign nurture")).toBe("Marketing");
    expect(inferArea("Widget assembly")).toBeNull();
    expect(workflowArea({ name: "Anything", area: "Custom Area" })).toBe("Custom Area"); // explicit wins
    expect(workflowArea({ name: "Lead qualification", steps: [] })).toBe("Sales"); // inferred
    const p = programme({ data: { currentStateAtlas: { workflows: [
      { name: "Quote-to-Cash", steps: [] },
      { name: "Campaign build", steps: [] },
      { name: "Widget assembly", steps: [] }, // no keyword → General
    ] } } });
    const areas = programAreas(p);
    expect(areas).toContain("Sales");
    expect(areas).toContain("Marketing");
    expect(areas[areas.length - 1]).toBe("General"); // General sorts last
  });

  it("stakeholderPrimaryArea files a role-named area even when only the ontology has it — Talent Acquisition SME → Talent, not General", () => {
    const p = programme({ data: {
      currentStateAtlas: { workflows: [
        { name: "Quote-to-Cash", area: "Sales", steps: [{ actor: "Vertical Sales SME", action: "prices" }] },
      ] },
      // "Talent" exists ONLY via the ontology — the atlas has no Talent workflow.
      domainOntology: { entities: [
        { name: "Requisition", area: "Talent" },
        { name: "Quote", area: "Sales" },
      ] },
    } });
    expect(programAreas(p)).toContain("Talent");
    // The kit role names the domain → routes to Talent (so it gets its own lane),
    // rather than falling into General because the atlas lacks the workflow.
    expect(stakeholderPrimaryArea(p, "Ahmed", "Talent Acquisition SME")).toBe("Talent");
    // A role that matches an atlas actor still resolves there.
    expect(stakeholderPrimaryArea(p, "Avantika", "Vertical Sales SME")).toBe("Sales");
  });

  it("areaProgress marks an area ready to envision once its voices are heard — independently of other areas", () => {
    const p = programme({ data: {
      phaseInputs: { listen: { interviewTranscripts: "— Priya, Marketing Lead, 2026-07-14 —\nplenty of words about campaigns and the nurture flow here and more detail besides." } },
      currentStateAtlas: { workflows: [
        { name: "Campaign build", area: "Marketing", steps: [{ actor: "Priya", action: "drafts" }] },
        { name: "Quote-to-Cash", area: "Sales", steps: [{ actor: "Dana", action: "prices" }] },
      ] },
    } });
    const rows = areaProgress(p);
    const marketing = rows.find((r) => r.area === "Marketing");
    const sales = rows.find((r) => r.area === "Sales");
    expect(marketing?.listenReady).toBe(true);   // Priya heard
    expect(sales?.listenReady).toBe(false);       // Dana not heard yet
  });

  it("per-area gate: a persona can advance only once their area's voices are heard", () => {
    const p = programme({ data: {
      phaseInputs: { listen: { interviewTranscripts: "— Priya, Marketing Lead, 2026-07-14 —\nlots of detail about the campaign build and nurture flow here and more besides." } },
      currentStateAtlas: { workflows: [
        { name: "Campaign build", area: "Marketing", steps: [{ actor: "Priya", action: "drafts" }] },
        { name: "Quote-to-Cash", area: "Sales", steps: [{ actor: "Dana", action: "prices" }] },
      ] },
    } });
    expect(personaAreas(p, "Priya")).toEqual(["Marketing"]);
    expect(personaReadyToAdvance(p, "Priya")).toBe(true);   // Marketing heard
    expect(personaReadyToAdvance(p, "Dana")).toBe(false);   // Sales not heard
    // Single-area (or unknown persona) is never gated.
    const single = programme({ data: { currentStateAtlas: { workflows: [{ name: "Only flow", steps: [{ actor: "Sam", action: "does" }] }] } } });
    expect(personaReadyToAdvance(single, "Sam")).toBe(true);
  });

  it("listen-workflow review projects the persona's workflow and composes an edit diff", () => {
    const p = programme({ data: {
      currentStateAtlas: { workflows: [{ name: "Quote-to-Cash", steps: [
        { actor: "Sales Rep", action: "drafts the quote", entities: ["Quote"] },
      ] }] },
      domainOntology: { entities: [{ name: "Quote", definition: "a priced offer" }] },
    } });
    const review = projectListenWorkflowReview(p, "Sales Rep");
    expect(review).not.toBeNull();
    expect(review!.workflows[0].name).toBe("Quote-to-Cash");
    expect(review!.terms.some((t) => t.name === "Quote")).toBe(true);
    expect(review!.questions.length).toBeGreaterThan(0); // non-structural questions below
    const text = composeListenWorkflowAnswers(review!, {
      workflows: [{ name: "Quote-to-Cash", steps: [
        { action: "drafts the quote", original: "drafts the quote" },
        { action: "legal reviews it", added: true },
      ] }],
      narration: "legal reviews twice",
      termNotes: {}, answers: { "0": "GDPR applies" },
    });
    expect(text).toMatch(/\+ \[ADDED\] legal reviews it/);
    expect(text).toMatch(/legal reviews twice/);
    expect(text).toMatch(/GDPR applies/);
  });

  it("ontology+atlas review projects the terms and mapped workflows to share", () => {
    const p = programme({ data: {
      domainOntology: { entities: [{ name: "Quote", definition: "a priced offer", aliases: ["Estimate"] }] },
      currentStateAtlas: { workflows: [{ name: "Quote-to-Cash", owner: "Sales", steps: [{ action: "drafts" }] }] },
    } });
    const review = projectOntologyAtlasReview(p);
    expect(review).not.toBeNull();
    expect(review!.terms[0].name).toBe("Quote");
    expect(review!.workflows[0].name).toBe("Quote-to-Cash");
    expect(review!.workflows[0].steps).toEqual(["drafts"]);
  });

  it("ontology map projects relations whose endpoints both exist; dangling edges drop", () => {
    const p = programme({ data: {
      domainOntology: {
        entities: [{ name: "Quote" }, { name: "Order" }],
        relations: [
          { from: "Quote", relation: "converts to", to: "Order" },  // both present → kept
          { from: "Quote", relation: "references", to: "Customer" }, // Customer absent → dropped
        ],
      },
      currentStateAtlas: { workflows: [{ name: "Q2C", steps: [{ action: "x" }] }] },
    } });
    const review = projectOntologyAtlasReview(p);
    expect(review!.relations).toHaveLength(1);
    expect(review!.relations[0]).toEqual({ from: "Quote", relation: "converts to", to: "Order" });
  });

  it("the Listen sponsor card disappears when there are no conflicts to arbitrate", () => {
    // Sponsor listed as a Listen interviewee, but NO open contradictions.
    const p = programme({
      phaseInputs: { frame: { sponsor: "Raj Mamodia" } },
      discoveryKit: { interviews: [
        { stakeholder: "Raj Mamodia", role: "Executive Sponsor", agenda: [] },
        { stakeholder: "Dana Ops", role: "Sales Ops", agenda: [{ questions: ["walk me through it"] }] },
      ] },
    });
    const cards = resolveMovementStakeholders(p, "listen");
    expect(cards.some((c) => /Raj/.test(c.name))).toBe(false); // no conflicts → no sponsor card
    expect(cards.some((c) => /Dana/.test(c.name))).toBe(true);  // operational voice stays
  });

  it("in Listen the sponsor's card carries ONLY conflicts to resolve; discovery routes to the stakeholders", () => {
    const agendaQ = "Walk me through how a quote is drafted end to end";
    const p = programme({
      phaseInputs: {
        frame: { sponsor: "Raj Mamodia" },
        listen: { contradictionLog: JSON.stringify([
          { statement: "Quotes go through legal twice", between: "Ops vs Finance", positions: "", status: "Open" },
        ]) },
      },
      discoveryKit: { interviews: [
        // The sponsor is also listed as a Listen interviewee with a discovery agenda…
        { stakeholder: "Raj Mamodia", role: "Executive Sponsor", agenda: [{ questions: [agendaQ] }] },
        { stakeholder: "Dana Ops", role: "Sales Ops", agenda: [{ questions: ["What do you hand off?"] }] },
      ] },
    });
    const cards = resolveMovementStakeholders(p, "listen");
    const sponsorCard = cards.find((s2) => /Raj/.test(s2.name));
    // Sponsor: conflicts only — the discovery agenda is NOT on their script.
    expect(sponsorCard?.questions.every((q) => /Conflict to resolve/.test(q))).toBe(true);
    expect(sponsorCard?.questions.some((q) => q === agendaQ)).toBe(false);
    expect(sponsorCard?.questions.some((q) => /legal twice/.test(q))).toBe(true);
    // The operational stakeholder still carries their own discovery agenda.
    const ops = cards.find((s2) => /Dana/.test(s2.name));
    expect(ops?.questions.some((q) => /hand off/.test(q))).toBe(true);
    // …and never gets handed a "resolve this conflict" arbiter ask.
    expect(ops?.questions.some((q) => /Conflict to resolve/.test(q))).toBe(false);
  });

  it("a dispute quoted from a TRANSCRIPT field is genuine — the record-match check ignores long captures", () => {
    const claim = "We are no longer using 20 CRM as a foundation";
    const transcript = `— Raj Mamodia —\n${"filler words here ".repeat(60)}${claim} and much more was said afterwards.`;
    const p = programme({ phaseInputs: {
      frame: { sponsorConversation: transcript },
      listen: { contradictionLog: JSON.stringify([
        { statement: claim, between: "Raj vs Charter", positions: "", status: "Open" },
      ]) },
    } });
    expect(readContradictions(p, true)).toHaveLength(1);
  });

  it("self-referential contradiction rows (script echoes) never surface anywhere", () => {
    // A follow-up pack echoes its own question ("Q: Two accounts disagree…")
    // into evidence; the watcher once filed a contradiction ABOUT that echo.
    // readContradictions is the single reader — it drops such rows.
    const p = programme({ phaseInputs: { listen: { contradictionLog: JSON.stringify([
      { statement: "Nothing should be dropped", between: "Raj vs Raj", positions: "", status: "Open" },
      { statement: 'Q: Two accounts disagree (X vs Y): "Instead of like what we do now" — which is right, and what settles it?', between: "Raj vs Charter", positions: "", status: "Open" },
    ]) } } });
    const rows = readContradictions(p, true);
    expect(rows).toHaveLength(1);
    expect(rows[0].statement).toBe("Nothing should be dropped");
  });

  it("the CHARTER's open gaps reach the Frame kit (its classic phase home is retired) and rephrase for the sponsor", () => {
    const p = programme({
      phaseInputs: { frame: {
        sponsorConversation: "— Sarah Okafor, COO —\nplenty of words on record here",
        businessObjective: "obj", sponsor: "Sarah Okafor", industry: "Banking",
        successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
      } },
      transformationCharter: { gaps: ["Add a concise, outcome-oriented statement to the Objective input."] },
    });
    const kit = meetingKit(p, "frame")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions.some((q) => /what outcome must this programme achieve/i.test(q))).toBe(true);
  });

  it("a recorded sponsor conversation clears gate-checklist bookkeeping from the follow-up (#75)", () => {
    // The conversation is on record; the structured fields the gate tracks are
    // still empty and no artifact has been generated. The old behaviour
    // replayed raw gate labels ("Business objective captured") as questions the
    // sponsor had just answered in prose — now the script clears entirely,
    // rather than re-asking bookkeeping.
    const p = programme({ phaseInputs: { frame: {
      sponsor: "Raj Mamodia",
      sponsorConversation: "— Raj Mamodia —\nimprove sales velocity, rep productivity and satisfaction, measured against baseline, in 12 months",
    } } });
    const kit = meetingKit(p, "frame")!;
    expect(kit.done).toBe(true);
    expect(kit.followUp).toBe(false);
    expect(kit.questions).toHaveLength(0);
  });

  it("gate labels stay in the OPERATOR gap set but never in a stakeholder-facing script (#75)", async () => {
    const { kitGaps, askableMovementGaps } = await import("@/v3/components/flow/flowMeetings");
    const p = programme({ phaseInputs: { frame: {
      sponsor: "Raj Mamodia",
      sponsorConversation: "— Raj Mamodia —\nplenty of words on the record about the plan and the direction",
    } } });
    // Operator view keeps the bookkeeping — it gates whether a follow-up matters.
    expect(kitGaps(p, "frame").some((g) => /captured|measure set/i.test(g))).toBe(true);
    // Stakeholder-facing views drop it: no bookkeeping, and here nothing genuine
    // is open, so the script is empty.
    expect(kitGaps(p, "frame", { gateLabels: false }).some((g) => /captured|measure set/i.test(g))).toBe(false);
    expect(askableMovementGaps(p, "frame")).toHaveLength(0);
  });

  it("attestHeardRoster proposes flipping ONLY collection-heard, un-attested rows — waived and unknown voices untouched", async () => {
    const { attestHeardRoster } = await import("@/v3/components/flow/flowShellData");
    const roster = [
      { name: "Vimal Pandey", role: "Finance SME", status: "To book" },     // heard → flips
      { name: "Hema Panneerselvam", status: "Waived" },                      // already judged → untouched
      { name: "Prakash TM", status: "Heard" },                               // already attested → untouched
      { name: "Sripad", status: "To book" },                                 // no evidence → untouched
    ];
    const p = programme({ phaseInputs: { listen: { interviewRoster: JSON.stringify(roster) } } });
    const proposal = attestHeardRoster(p, ["Vimal Pandey, Finance SME", "Prakash TM"])!;
    expect(proposal.attested).toEqual(["Vimal Pandey"]);
    const next = JSON.parse(proposal.value) as Array<Record<string, string>>;
    expect(next.find((r) => r.name === "Vimal Pandey")?.status).toBe("Heard");
    expect(next.find((r) => r.name === "Vimal Pandey")?.role).toBe("Finance SME"); // other fields survive
    expect(next.find((r) => r.name === "Hema Panneerselvam")?.status).toBe("Waived");
    expect(next.find((r) => r.name === "Sripad")?.status).toBe("To book");
    // Nothing to attest → no proposal (the queue item never appears).
    expect(attestHeardRoster(p, ["Sripad-less Nobody"])).toBeNull();
    expect(attestHeardRoster(programme({ phaseInputs: { listen: { interviewRoster: "Name | Status" } } }), ["Vimal"])).toBeNull();
  });

  it("the coverage-ledger criterion says what it counts — roster attestation, not collected evidence", () => {
    // The gate counts roster rows the operator MARKED heard/waived; the People
    // board counts collected evidence. Same fact-family, different judgments —
    // the labels must name their source so 2/8 vs 3/12 reads as two measures,
    // not a bug.
    const p = programme({ phaseInputs: { listen: { interviewRoster: JSON.stringify([
      { name: "Vimal", status: "Heard" }, { name: "Hema", status: "To book" },
    ]) } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const heard = gateChecklist(p, listen, []).find((c) => c.id === "heard")!;
    expect(heard.label).toMatch(/Coverage ledger — 1\/2 voices attested heard or waived/);
    expect(heard.anchor).toBe("input:interviewRoster"); // the click opens where attesting happens
  });

  it("EVERY required artifact's gaps reach its movement's script — verified across the whole flow spine", async () => {
    const { getPhaseSequence, getPhaseDefinition } = await import("@/v3/lib/methodology");
    const { FORMAL_ARTIFACT_FIELD_KEYS } = await import("@/v3/lib/formalArtifacts");
    const { askableMovementGaps } = await import("@/v3/components/flow/flowMeetings");
    let checked = 0;
    for (const movementId of getPhaseSequence("atos-flow") as readonly string[]) {
      for (const artifactId of getPhaseDefinition(movementId, "atos-flow")?.requiredArtifacts ?? []) {
        const fieldKey = FORMAL_ARTIFACT_FIELD_KEYS[artifactId];
        if (!fieldKey) continue; // artifact with no stored doc — nothing to carry gaps
        // Plain-language marker: gaps phrased in modelling jargon (the raw
        // "domain-ontology" id trips the \bontolog net) stay operator-side by
        // design — this test asserts the STAKEHOLDER-phrased path routes.
        const marker = `Ask the stakeholder which systems feed the ${fieldKey} work?`;
        const p = programme({ [fieldKey]: { gaps: [marker] } });
        expect(askableMovementGaps(p, movementId), `${movementId}/${artifactId} gap must reach the script`).toContain(marker);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(10); // the spine's formal documents are all covered
  });

  it("an unrepresented internal persona surfaces as a Listen role-placeholder card (2026-07-14 regression pin)", async () => {
    const { resolveMovementStakeholders } = await import("@/v3/components/flow/flowStakeholders");
    const p = programme({
      discoveryKit: {
        interviews: [{ stakeholder: "Dan Reyes", role: "Sales Lead", agenda: [] }],
        personas: [
          // The Pharma case: a role inventoried as a persona with NO matching
          // interview entry — it must still surface as a to-reach card.
          { name: "Recruitment Operations Staff", kind: "internal", spokenForBy: [], unrepresented: true },
          // External personas can't be interviewed — never a card.
          { name: "End Customer", kind: "external", spokenForBy: [], unrepresented: true },
          // A spoken-for persona is covered by its interviewee — no extra card.
          { name: "Sales Lead", kind: "internal", spokenForBy: ["Dan Reyes"], unrepresented: false },
        ],
      },
    });
    const cards = resolveMovementStakeholders(p, "listen");
    const placeholder = cards.find((card) => card.role === "Recruitment Operations Staff");
    expect(placeholder, "persona-only role must become a card").toBeTruthy();
    expect(placeholder?.isRole).toBe(true);
    expect(cards.filter((card) => card.name === "End Customer")).toHaveLength(0);
    expect(cards.filter((card) => card.role === "Sales Lead")).toHaveLength(1); // Dan only, no duplicate
  });

  it("coverage-map edits steer discovery-kit regeneration — thin domains become deepen-instructions", async () => {
    const { discoveryKitCoverageGuidance } = await import("@/v3/components/flow/flowMeetings");
    // A clean map steers nothing.
    expect(discoveryKitCoverageGuidance(programme({ discoveryKit: { coverageMap: [{ domain: "RevOps", coveredBy: ["Dan"], thin: false }] } }))).toBeNull();
    // Marking a domain thin (and leaving a persona unrepresented) becomes guidance
    // the regeneration prompt receives.
    const g = discoveryKitCoverageGuidance(programme({ discoveryKit: {
      coverageMap: [{ domain: "Legal & Compliance", coveredBy: [], thin: true }, { domain: "RevOps", coveredBy: ["Dan"], thin: false }],
      personas: [{ name: "End Customer", spokenForBy: [], unrepresented: true }],
    } }))!;
    expect(g).toMatch(/THINLY covered/);
    expect(g).toMatch(/Legal & Compliance/);
    expect(g).not.toMatch(/RevOps/); // well-covered domain isn't flagged
    expect(g).toMatch(/no voice yet[\s\S]*End Customer/);
  });

  it("a gap demanding a FILLED field is falsified by the record — dropped from cards and scripts alike", async () => {
    const { artifactOpenGaps, falsifiedGap } = await import("@/v3/components/flow/flowShellData");
    const { kitGaps } = await import("@/v3/components/flow/flowMeetings");
    const gap = "Add a concise, outcome-oriented statement to the Objective input.";
    const filled = programme({
      transformationCharter: { gaps: [gap, "Who owns the pilot vertical end to end?"] },
      phaseInputs: { frame: { businessObjective: "Improve sales velocity, rep productivity, and satisfaction in 12 months." } },
    });
    // The objective field IS filled: the demand is falsified everywhere…
    expect(falsifiedGap(filled, gap)).toBe(true);
    expect(artifactOpenGaps(filled, "charter")).toEqual(["Who owns the pilot vertical end to end?"]);
    expect(kitGaps(filled, "frame").some((g) => /Objective input/i.test(g))).toBe(false);
    // …but with the field empty the gap is real and stays.
    const empty = programme({ transformationCharter: { gaps: [gap] }, phaseInputs: { frame: {} } });
    expect(falsifiedGap(empty, gap)).toBe(false);
    expect(artifactOpenGaps(empty, "charter")).toEqual([gap]);
  });

  it("bindings OUTRANK a kit-document email — one contact store, the kit is legacy", () => {
    const p = programme({
      discoveryKit: { interviews: [{ stakeholder: "Raj Mamodia", email: "stale@old.com" }] },
      phaseInputs: { frame: { _roleBindings: JSON.stringify({ "Raj Mamodia": { name: "Raj Mamodia", email: "raj@current.com" } }) } },
    });
    expect(stakeholderEmail(p, "Raj Mamodia")).toBe("raj@current.com");
    // kit email still resolves when no binding exists (legacy data keeps working)
    const legacy = programme({ discoveryKit: { interviews: [{ stakeholder: "Raj Mamodia", email: "stale@old.com" }] } });
    expect(stakeholderEmail(legacy, "Raj Mamodia")).toBe("stale@old.com");
  });

  it("a name-keyed binding carries an address the senders and the gate can resolve — the card's 'Save address' path", () => {
    // The card writes { [person's name]: { name, email } } into the
    // movement's _roleBindings; stakeholderEmail matches by the bound NAME,
    // so the key never collides with role templates.
    const p = programme({ phaseInputs: {
      frame: { _roleBindings: JSON.stringify({ "Raj Mamodia": { name: "Raj Mamodia", email: "raj@laila.com" } }) },
    } });
    expect(stakeholderEmail(p, "Raj Mamodia")).toBe("raj@laila.com");
  });

  it("deliveryRoleDirectory lists every Envision-onward role with its binding state — the kit studio's people hub", () => {
    const p = programme({ phaseInputs: {
      frame: { sponsor: "Raj Mamodia" },
      envision: { _roleBindings: JSON.stringify({ "Solution Architect": { name: "Priya Nair", email: "priya@x.com" } }) },
    } });
    const dir = deliveryRoleDirectory(p);
    // Every templated movement contributes; bound, unbound and sponsor rows are distinguishable.
    expect(dir.some((r) => r.movementId === "envision" && r.role === "Solution Architect" && r.bound?.name === "Priya Nair" && r.bound?.email === "priya@x.com")).toBe(true);
    expect(dir.some((r) => r.movementId === "envision" && r.role === "Product Owner" && r.bound === null)).toBe(true);
    expect(dir.some((r) => r.movementId === "ship" && r.isSponsor && r.bound?.name === "Raj Mamodia")).toBe(true);
    expect(dir.some((r) => r.movementId === "evolve" && r.role === "Operating Owner")).toBe(true);
  });

  it("role bindings name Envision's personas — real person, real email, and the evidence fingerprint never moves", async () => {
    const { movementInputsFingerprint } = await import("@/v3/components/flow/flowShellData");
    const { readRoleBindings } = await import("@/v3/components/flow/flowStakeholders");
    const before = movementInputsFingerprint(programme({ phaseInputs: { envision: {} } }), "envision");
    const p = programme({ phaseInputs: { envision: {
      _roleBindings: JSON.stringify({ "Solution Architect": { name: "Priya Nair", email: "priya@brillio.com" } }),
    } } });
    // Naming a person is an org fact, not evidence: `_`-prefixed keys are
    // excluded from the fingerprint, so binding flags nothing stale.
    expect(movementInputsFingerprint(p, "envision")).toBe(before);
    expect(readRoleBindings(p, "envision")["Solution Architect"]).toEqual({ name: "Priya Nair", email: "priya@brillio.com" });
    const people = resolveMovementStakeholders(p, "envision");
    const priya = people.find((s) => s.name === "Priya Nair")!;
    expect(priya.role).toBe("Solution Architect");
    expect(priya.isRole).toBe(false); // a bound role IS a person
    expect(people.filter((s) => s.isRole).length).toBeGreaterThan(0); // unbound roles stay placeholders
    expect(stakeholderEmail(p, "Priya Nair")).toBe("priya@brillio.com");
  });

  it("once a stakeholder is HEARD, their agenda clears from the follow-up — only open gaps remain", () => {
    const agendaQ = "What systems feed a quote today?";
    const base = {
      domainOntology: { gaps: ["Ask who owns the Bench entity end to end?"] },
      discoveryKit: { interviews: [{ stakeholder: "Vimal Pandey", role: "Architect", agenda: [{ questions: [agendaQ] }] }] },
    };
    // Not heard yet → the full agenda is the script.
    const unheard = resolveMovementStakeholders(programme(base), "listen")[0];
    expect(unheard.questions).toContain(agendaQ);
    // Heard (a transcript block attributed to them exists) → agenda drops, only
    // the still-open artifact gap remains.
    const heard = resolveMovementStakeholders(programme({
      ...base,
      phaseInputs: { listen: { interviewTranscripts: "— Vimal Pandey, Architect, 2026-07-13 —\nWe pull quote data from three systems and reconcile by hand each week." } },
    }), "listen")[0];
    expect(heard.questions).not.toContain(agendaQ); // already asked — cleared
    expect(heard.questions.some((q) => /Bench entity/.test(q))).toBe(true); // open gap stays
  });

  it("listen artifact gaps land on every interviewee's script", () => {
    const p = programme({
      domainOntology: { gaps: ["Ask the stakeholder who owns the Bench entity end to end?"] },
      discoveryKit: { interviews: [
        { stakeholder: "Vimal Pandey", role: "Architect", agenda: [{ questions: ["What systems feed a quote?"] }] },
      ] },
    });
    const vimal = resolveMovementStakeholders(p, "listen")[0];
    expect(vimal.questions).toContain("Ask the stakeholder who owns the Bench entity end to end?");
    expect(vimal.questions).toContain("What systems feed a quote?"); // agenda kept
  });

  it("with a coverage map, an atlas open question routes to the domain owner — not every SME", () => {
    const p = programme({
      currentStateAtlas: { openQuestions: [
        "How are partner opportunities attributed today?",
        "What is the marketing lead hand-off SLA?",
      ] },
      discoveryKit: {
        coverageMap: [
          { domain: "Alliances and partner management", coveredBy: ["Tara Alliance"] },
          { domain: "Marketing and lead generation", coveredBy: ["Sam Marketer"] },
        ],
        interviews: [
          { stakeholder: "Tara Alliance", role: "Alliances SME", agenda: [{ questions: ["Alliance agenda q"] }] },
          { stakeholder: "Sam Marketer", role: "Marketing SME", agenda: [{ questions: ["Marketing agenda q"] }] },
        ],
      },
    });
    const people = resolveMovementStakeholders(p, "listen");
    const tara = people.find((s) => /Tara/.test(s.name))!;
    const sam = people.find((s) => /Sam/.test(s.name))!;
    // The partner question reaches Alliances only — NOT the Marketing SME.
    expect(tara.questions.some((q) => /partner/i.test(q))).toBe(true);
    expect(sam.questions.some((q) => /partner/i.test(q))).toBe(false);
    // The marketing/lead question reaches Marketing only — NOT the Alliances SME.
    expect(sam.questions.some((q) => /marketing lead hand-off/i.test(q))).toBe(true);
    expect(tara.questions.some((q) => /marketing lead hand-off/i.test(q))).toBe(false);
  });

  it("genuine plumbing gaps (ledger/regenerate) still never reach a stakeholder script", () => {
    const kit = meetingKit(framed(["Regenerate the artifact ledger after the evidence changed."]), "frame")!;
    expect(kit.followUp).toBe(false);
    expect(kit.questions.some((q) => /ledger|regenerat/i.test(q))).toBe(false);
  });

  it("an open contradiction routes to the SPONSOR — Frame's follow-up asks it", () => {
    const p = programme({
      phaseInputs: {
        frame: {
          sponsorConversation: "— Sarah Okafor, COO —\nplenty of words on record here",
          businessObjective: "obj", sponsor: "Sarah Okafor", industry: "Banking",
          successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
        },
        listen: {
          interviewRoster: JSON.stringify([{ name: "Dan", status: "To book" }]),
          contradictionLog: JSON.stringify([
            { statement: "Quote table is the sole record", between: "Dan vs Marcus", status: "Open — filed 2026-07-11" },
            { statement: "Old dispute", status: "Resolved 2026-07-01" },
          ]),
        },
      },
    });
    const kit = meetingKit(p, "frame")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions.some((q) => q.includes("Quote table is the sole record") && /which is right/i.test(q))).toBe(true);
    expect(kit.questions.some((q) => q.includes("Old dispute"))).toBe(false);
  });

  it("askable gaps become the follow-up's questions", () => {
    const ask = "Which regions does the discount approval flow cover today?";
    const kit = meetingKit(framed([ask]), "frame")!;
    expect(kit.followUp).toBe(true);
    expect(kit.questions).toEqual([ask]);
  });
});

describe("scriptDocumentRefs — documents the script asks for", () => {
  it("extracts quoted names and document-word phrases, deduped", () => {
    expect(scriptDocumentRefs([
      'Bring the "Q2 pricing export" to the session.',
      "Walk us through the discount approval policy and who signs it.",
      'Confirm the "Q2 pricing export" covers EMEA.',
    ])).toEqual(["Q2 pricing export", "discount approval policy"]);
  });

  it("returns nothing when no document is referenced", () => {
    expect(scriptDocumentRefs(["What outcome should this system achieve?"])).toEqual([]);
  });
});

describe("describeDecisionChanges — the confirm preview mirrors the resolver", () => {
  const decision = (payload: Record<string, unknown>) => ({
    id: "d1", tier: 2 as const, status: "open" as const, agentId: "a", movementId: "listen",
    title: "t", summary: "", blocking: "", recommendation: null, payload, createdAt: "2026-07-11",
  });

  it("ontology mappings: additive rows, already-adopted entities skipped", () => {
    const p = programme({ ontologyAlignment: [{ entity: "Quote", standard: "https://schema.org/Quotation" }] });
    const [change] = describeDecisionChanges(p, decision({ ontologyAlignment: [
      { entity: "Quote", relation: "skos:closeMatch", standard: "https://schema.org/Quotation", confidence: 0.95 },
      { entity: "Approval", relation: "skos:closeMatch", standard: "https://schema.org/Action", confidence: 0.8 },
    ] }));
    expect(change.effect).toBe("1 mapping merges additively · 1 already adopted, untouched");
    expect(change.rows).toEqual(["Approval → schema.org/Action (closeMatch · 80%)"]);
  });

  it("document payloads: per-section diff against the current mirror, meta ignored", () => {
    const p = programme({ discoveryKit: { scope: "old", interviews: ["a"], confidence: 20, generatedAt: "x" } });
    const [change] = describeDecisionChanges(p, decision({ artifactDocs: {
      discoveryKit: { scope: "new", interviews: ["a"], coverageMap: {}, confidence: 90, generatedAt: "y" },
    } }));
    expect(change.target).toBe("Discovery Kit");
    expect(change.rows).toEqual(["Scope — rewritten", "Coverage Map — added"]);
  });

  it("a removed section warns that hand edits go with it", () => {
    const p = programme({ discoveryKit: { scope: "old", notes: "hand-written" } });
    const [change] = describeDecisionChanges(p, decision({ artifactDocs: { discoveryKit: { scope: "old" } } }));
    expect(change.rows).toEqual(["Notes — removed (the current section, hand edits included, goes)"]);
  });

  it("no payload → no preview", () => {
    expect(describeDecisionChanges(programme({}), { ...decision({}), payload: null })).toEqual([]);
  });
});

describe("gateReadiness — one composed verdict over the closed loop", () => {
  const movement = (id: string) => flowMovements().find((m) => m.id === id)!;
  const art = (over: Record<string, unknown> = {}) => ({
    id: "discovery-kit", movementId: "frame", title: "Discovery Kit", description: "",
    excerpt: null, confidence: 80, present: true, stale: false, gaps: 0, ...over,
  });
  const metFrame = (extra: Record<string, unknown> = {}) => programme({ ...extra, phaseInputs: { frame: {
    sponsorConversation: "— Sarah Okafor, COO —\ntext", businessObjective: "obj", sponsor: "Sarah",
    industry: "Banking", successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
  } } });
  const verdict = (p: ReturnType<typeof programme>, artifacts: ReturnType<typeof art>[]) => {
    const m = movement("frame");
    return gateReadiness(p, m, artifacts, gateChecklist(p, m, artifacts));
  };

  it("criteria open → the open count, never green", () => {
    const r = verdict(programme({}), [art()]);
    expect(r.kind).toBe("open");
    expect(r.tone).toBe("dim");
    // Advisory rows (open questions) are excluded from the gating count.
    expect(r.headline).toBe("2 of 8 criteria met");
  });

  it("criteria met but a document stale → amber, the record trails", () => {
    const r = verdict(metFrame(), [art({ stale: true }), art({ id: "charter", title: "Transformation Charter" })]);
    expect(r.kind).toBe("trails");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("8 of 9 criteria met");
    expect(r.detail).toBe("Documents are out of date — evidence changed");
  });

  it("criteria met, record current, but a document declares gaps → open gaps verdict, naming the document", () => {
    const r = verdict(metFrame(), [art({ gaps: 2 })]);
    expect(r.kind).toBe("gaps");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("7 of 8 criteria met");
    // The detail names the actual open row — a specific document's gaps.
    expect(r.detail).toBe("Discovery Kit — 2 open gaps");
  });

  it("staleness outranks gaps in the verdict cause", () => {
    expect(verdict(metFrame(), [art({ gaps: 2 }), art({ id: "charter", title: "Charter", stale: true })]).kind).toBe("trails");
  });

  it("criteria met but a document never generated → not yet written, never 'out of date'", () => {
    const r = verdict(metFrame(), [art({ present: false })]);
    expect(r.kind).toBe("gaps");
    expect(r.detail).toBe("A document has not been generated yet");
  });

  it("criteria met and a document trails its evidence → out of date", () => {
    expect(verdict(metFrame(), [art({ present: true, stale: true })]).kind).toBe("trails");
  });

  it("record current but a decision parked in the Inbox → judgment waits", () => {
    const p = metFrame({ flowDecisions: [{ id: "d1", movementId: "frame", status: "open" }] });
    const r = verdict(p, [art()]);
    expect(r.kind).toBe("judgment");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("7 of 8 criteria met");
    expect(r.detail).toBe("A decision is waiting in the Inbox");
  });

  it("evidence, record and Inbox all clear → ready, green", () => {
    const r = verdict(metFrame(), [art()]);
    expect(r.kind).toBe("ready");
    expect(r.tone).toBe("green");
    expect(r.detail).toBe("8 criteria met · documents current · Inbox clear");
  });

  it("advisory rows never gate — structural criteria met + an open advisory row → still ready", () => {
    const m = movement("frame");
    const checks = [
      { id: "fact", label: "Sponsor named", done: true },
      { id: "art-charter", label: "Charter generated", done: true, group: "record" as const },
      { id: "kit-emails", label: "Stakeholder emails on file — 2 missing", done: false, group: "record" as const, advisory: true },
      { id: "issues", label: "Open questions & ambiguities — 3 to resolve", done: false, group: "record" as const, advisory: true },
      { id: "inbox", label: "Inbox clear", done: true, group: "judgment" as const },
    ];
    const r = gateReadiness(programme({}), m, [], checks);
    expect(r.kind).toBe("ready");
    expect(r.tone).toBe("green");
  });

  it("an approved gate outranks everything", () => {
    const p = { ...programme({}), gateReviews: { frame: { status: "approved" } } } as never;
    const r = gateReadiness(p, movement("frame"), [art({ stale: true })], []);
    expect(r.kind).toBe("demonstrated");
    expect(r.tone).toBe("green");
  });
});

describe("gateChecklist — record and judgment rows close the loop", () => {
  const movement = flowMovements().find((m) => m.id === "frame")!;
  const art = {
    id: "discovery-kit", movementId: "frame", title: "Discovery Kit", description: "",
    excerpt: null, confidence: 80, present: true, stale: false, gaps: 0,
  };

  it("a current document is a met record row with its confidence", () => {
    const item = gateChecklist(programme({}), movement, [art]).find((c) => c.id === "art-discovery-kit")!;
    expect(item.group).toBe("record");
    expect(item.artifactId).toBe("discovery-kit");
    expect(item.done).toBe(true);
    expect(item.why).toBe("confidence 80%");
  });

  it("a document with declared gaps is an unmet record row naming the count", () => {
    const item = gateChecklist(programme({}), movement, [{ ...art, gaps: 2 }]).find((c) => c.id === "art-discovery-kit")!;
    expect(item.done).toBe(false);
    expect(item.label).toBe("Discovery Kit — 2 open gaps");
    expect(item.why).toBeUndefined();
  });

  it("a stale document is an unmet record row in the card's vocabulary", () => {
    const item = gateChecklist(programme({}), movement, [{ ...art, stale: true }]).find((c) => c.id === "art-discovery-kit")!;
    expect(item.done).toBe(false);
    expect(item.label).toBe("Discovery Kit — evidence changed since generation");
  });

  it("the judgment row counts open decisions for this movement only", () => {
    const p = programme({ flowDecisions: [
      { id: "d1", movementId: "frame", status: "open" },
      { id: "d2", movementId: "listen", status: "open" },
      { id: "d3", movementId: "frame", status: "confirmed" },
    ] });
    const item = gateChecklist(p, movement, []).find((c) => c.id === "inbox")!;
    expect(item.group).toBe("judgment");
    expect(item.done).toBe(false);
    expect(item.label).toBe("1 decision waiting in the Inbox");
    expect(gateChecklist(programme({}), movement, []).find((c) => c.id === "inbox")!.done).toBe(true);
  });

  it("the Listen-plan row appears once there's a kit or ontology, and closes on confirmation", () => {
    // Nothing to confirm yet — no plan row.
    expect(gateChecklist(programme({}), movement, []).find((c) => c.id === "listen-plan")).toBeUndefined();
    // A kit exists but the plan isn't confirmed — the row is present and unmet.
    const unconfirmed = gateChecklist(programme({ discoveryKit: { title: "k" } }), movement, []).find((c) => c.id === "listen-plan")!;
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed.done).toBe(false);
    // Confirming (the fingerprint-safe frame flag) closes it.
    const confirmed = gateChecklist(
      programme({ discoveryKit: { title: "k" }, phaseInputs: { frame: { _listenCoverageConfirmed: "2026-07-14T00:00:00Z" } } }),
      movement, [],
    ).find((c) => c.id === "listen-plan")!;
    expect(confirmed.done).toBe(true);
  });
});

describe("track attribution — evidence carries its track", () => {
  const movement = (id: string) => flowMovements().find((m) => m.id === id)!;

  it("a header naming a track in parentheses parses onto the entry", () => {
    const p = programme({ phaseInputs: { show: {
      demoFeedback: "— Dan Reyes, RevOps Lead, Demo session (Quote Automation), 2026-07-24 —\nCleared in under an hour.\n\n— Sarah Okafor, COO, 2026-07-25 —\nProof, not promises.",
    } } });
    const entries = movementEvidence(p, movement("show"));
    expect(entries[0].track).toBe("Quote Automation");
    expect(entries[1].track).toBeUndefined();
  });

  it("a demo verdict ingest names the matched track in the evidence header", () => {
    const p = programme({
      tracks: [{ id: "t1", name: "Quote Automation", leadStakeholder: "Dan Reyes", showPasses: [] }],
      flowPortalInbox: [{ id: "i1", kind: "demo-verdict", stakeholder: "Dan Reyes", role: "RevOps", verdict: "accepted", text: "Ship it", receivedAt: "x" }],
    });
    const blob = ingestPortalResponse(p, "i1", "you")!;
    const show = (blob.phaseInputs as Record<string, Record<string, string>>).show;
    expect(show.demoFeedback).toContain("Demo session (Quote Automation)");
  });
});

describe("gateChecklist provenance", () => {
  const movement = (id: string) => flowMovements().find((m) => m.id === id)!;

  it("a captured conversation carries its attributed voice and size", () => {
    const p = programme({ phaseInputs: { frame: {
      sponsorConversation: "— Marcus Webb, Head of Data, 2026-07-10 —\nWe reconcile CPQ and the ledger by hand every week.",
    } } });
    const item = gateChecklist(p, movement("frame"), []).find((c) => c.id === "conv")!;
    expect(item.done).toBe(true);
    expect(item.why).toContain("Marcus Webb");
    expect(item.why).toMatch(/\d+ words$/);
  });

  it("a scalar fact excerpts its value and truncates long ones", () => {
    const p = programme({ phaseInputs: { frame: { businessObjective: "cut ".repeat(40) } } });
    const item = gateChecklist(p, movement("frame"), []).find((c) => c.id === "objective")!;
    expect(item.done).toBe(true);
    expect(item.why!.endsWith("…")).toBe(true);
    expect(item.why!.length).toBeLessThanOrEqual(57);
  });

  it("an adopted track plan states the count and the human confirm", () => {
    const p = programme({ tracks: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const item = gateChecklist(p, movement("envision"), []).find((c) => c.id === "tracks")!;
    expect(item.done).toBe(true);
    expect(item.why).toBe("3 tracks, confirmed by you");
  });

  it("a resolved contradiction's provenance names the ruling, arbiter and date", () => {
    const p = programme({ phaseInputs: { listen: { contradictionLog: JSON.stringify([
      { statement: "Where amendments live", status: "Resolved", resolution: "Quote table confirmed as the system of record", resolvedBy: "Sarah Okafor, COO", resolvedAt: "2026-07-11" },
    ]) } } });
    const item = gateChecklist(p, flowMovements().find((m) => m.id === "listen")!, []).find((c) => c.id === "contradictions")!;
    expect(item.done).toBe(true);
    expect(item.why).toContain("Quote table confirmed as the system of record");
    expect(item.why).toContain("Sarah Okafor, COO");
    expect(item.why).toContain("2026-07-11");
  });

  it("an unmet criterion carries no provenance", () => {
    const item = gateChecklist(programme({}), movement("frame"), []).find((c) => c.id === "conv")!;
    expect(item.done).toBe(false);
    expect(item.why).toBeUndefined();
  });
});

describe("flowArtifactEdit.applyArtifactEdit", () => {
  it("merges the edit over the stored doc, stamps it, and attests tier 1", async () => {
    const { applyArtifactEdit, readArtifactDoc } = await import("@/v3/components/flow/flowArtifactEdit");
    const p = programme({
      domainOntology: { entities: [{ name: "Quote" }], confidence: 0.8, generatedAt: "2026-07-01" },
    });
    const blob = applyArtifactEdit(p, {
      fieldKey: "domainOntology", movementId: "listen", title: "Domain Ontology",
      doc: { entities: [{ name: "Quote" }, { name: "Order" }] },
    }, "user@x")!;
    const doc = (blob as Record<string, Record<string, unknown>>).domainOntology;
    expect((doc.entities as unknown[])).toHaveLength(2);
    expect(doc.confidence).toBe(0.8);            // untouched generator metadata survives
    expect(doc.generatedAt).toBe("2026-07-01");
    expect(doc.editedBy).toBe("user@x");
    expect(typeof doc.editedAt).toBe("string");
    const trail = (blob as Record<string, unknown[]>).flowAttestations as Array<Record<string, unknown>>;
    expect(trail[trail.length - 1]).toMatchObject({ tier: 1, agentId: "user@x", phaseId: "listen", action: "Edited: Domain Ontology" });
    expect(readArtifactDoc(programme(blob as Record<string, unknown>), "domainOntology")!.editedBy).toBe("user@x");
  });

  it("returns null for a malformed edit", async () => {
    const { applyArtifactEdit } = await import("@/v3/components/flow/flowArtifactEdit");
    expect(applyArtifactEdit(programme({}), { fieldKey: "", movementId: "listen", title: "x", doc: {} }, "u")).toBeNull();
  });

  it("rejects an ontology edit that would leave a relation dangling (F-004 backstop)", async () => {
    const { applyArtifactEdit } = await import("@/v3/components/flow/flowArtifactEdit");
    const p = programme({ domainOntology: { entities: [{ name: "Quote" }] } });
    // "Order" is never declared — the relation dangles, so no path may persist it.
    const blocked = applyArtifactEdit(p, {
      fieldKey: "domainOntology", movementId: "listen", title: "Domain Ontology",
      doc: { entities: [{ name: "Quote" }], relations: [{ from: "Quote", relation: "becomes", to: "Order", cardinality: "1:N" }] },
    }, "user@x");
    expect(blocked).toBeNull();
    // Add the missing entity and the same edit now persists.
    const ok = applyArtifactEdit(p, {
      fieldKey: "domainOntology", movementId: "listen", title: "Domain Ontology",
      doc: { entities: [{ name: "Quote" }, { name: "Order" }], relations: [{ from: "Quote", relation: "becomes", to: "Order", cardinality: "1:N" }] },
    }, "user@x");
    expect(ok).not.toBeNull();
  });
});

describe("flowOntologyConstraints — write-time grounding gate (F-004)", () => {
  it("passes a well-formed ontology", () => {
    const doc = {
      entities: [{ name: "Quote" }, { name: "Order", aliases: ["Sales Order"] }],
      relations: [{ from: "Quote", relation: "converts to", to: "Order", cardinality: "1:1" }],
      standardAlignment: [{ entity: "Order", standard: "https://schema.org/Order" }],
    };
    expect(validateOntologyConstraints(doc)).toEqual([]);
    expect(hasBlockingOntologyViolations(doc)).toBe(false);
  });

  it("flags a relation pointing at an undeclared entity as blocking", () => {
    const v = validateOntologyConstraints({ entities: [{ name: "Quote" }], relations: [{ from: "Quote", relation: "x", to: "Ghost", cardinality: "1:1" }] });
    expect(v.some((x) => x.kind === "dangling-relation" && x.severity === "blocking")).toBe(true);
    expect(hasBlockingOntologyViolations({ entities: [{ name: "Quote" }], relations: [{ from: "Quote", relation: "x", to: "Ghost", cardinality: "1:1" }] })).toBe(true);
  });

  it("resolves an endpoint through an alias, not just the canonical name", () => {
    const v = validateOntologyConstraints({
      entities: [{ name: "Order", aliases: ["SO"] }, { name: "Quote" }],
      relations: [{ from: "Quote", relation: "becomes", to: "SO", cardinality: "1:1" }],
    });
    expect(v.filter((x) => x.kind === "dangling-relation")).toEqual([]);
  });

  it("rejects a malformed cardinality but accepts every side:side form the generator emits", () => {
    const rel = (cardinality: string) => ({ entities: [{ name: "A" }, { name: "B" }], relations: [{ from: "A", relation: "r", to: "B", cardinality }] });
    expect(validateOntologyConstraints(rel("many")).some((x) => x.kind === "bad-cardinality" && x.severity === "blocking")).toBe(true);
    // The generator legitimately writes N:1 (converse of 1:N) and optionality forms 0:1 / 0:N —
    // the gate must never flag real data (the bug that fired on the live Laila ontology).
    for (const ok of ["N:1", "0:1", "0:N", "M:N", "n:m", "1:1", "1:N", "unknown", ""]) {
      expect(validateOntologyConstraints(rel(ok)).filter((x) => x.kind === "bad-cardinality"), `cardinality ${ok || "(empty)"} should be valid`).toEqual([]);
    }
  });

  it("carries the missing entity name on a dangling relation so the UI can one-click declare it", () => {
    const v = validateOntologyConstraints({ entities: [{ name: "Agent" }], relations: [{ from: "Agent", relation: "acts on", to: "Workflow", cardinality: "1:N" }] });
    const dangling = v.find((x) => x.kind === "dangling-relation");
    expect(dangling?.missing).toBe("Workflow");
  });
});

describe("ontology repair watcher — evidence-grounded propose, never silent apply", () => {
  const withOntology = (doc: Record<string, unknown>, evidence = "") => programme({
    domainOntology: doc,
    phaseInputs: { listen: { interviewNotes: evidence } },
  });

  it("stays silent when the ontology is structurally clean", () => {
    expect(ontologyRepairProposal(withOntology({
      entities: [{ name: "Quote" }, { name: "Order" }],
      relations: [{ from: "Quote", relation: "becomes", to: "Order", cardinality: "N:1" }],
    }))).toBeNull();
  });

  it("declares a dangling entity WITH its evidence quote when the corpus names it", () => {
    const evidence = "Sarah Okafor: every Workflow starts from an approved quote.\nMore context here to pass the length gate for corpus lines.";
    const proposal = ontologyRepairProposal(withOntology({
      entities: [{ name: "Agent" }],
      relations: [{ from: "Agent", relation: "runs", to: "Workflow", cardinality: "1:N" }],
    }, evidence))!;
    expect(proposal).not.toBeNull();
    expect(proposal.tier).toBe(2);
    const repaired = (proposal.payload.artifactDocs as Record<string, Record<string, unknown>>).domainOntology;
    const added = (repaired.entities as Array<Record<string, unknown>>).find((e) => e.name === "Workflow")!;
    expect(added).toBeTruthy();
    expect(String(added.evidence)).toContain("every Workflow starts");
    expect(repaired.relations as unknown[]).toHaveLength(1); // relation kept — it resolves now
    expect(validateOntologyConstraints(repaired).filter((v) => v.severity === "blocking")).toEqual([]);
  });

  it("removes a dangling relation when the missing entity appears nowhere in the evidence", () => {
    const proposal = ontologyRepairProposal(withOntology({
      entities: [{ name: "Agent" }],
      relations: [{ from: "Agent", relation: "runs", to: "Ghost", cardinality: "1:N" }],
    }, "Long enough evidence text that never mentions that word anywhere at all."))!;
    const repaired = (proposal.payload.artifactDocs as Record<string, Record<string, unknown>>).domainOntology;
    expect(repaired.relations as unknown[]).toHaveLength(0);
    expect((repaired.entities as unknown[])).toHaveLength(1); // nothing invented
    expect(proposal.summary).toMatch(/appears nowhere in the evidence/);
  });

  it("resets a malformed cardinality to unknown and merges duplicate entities", () => {
    const proposal = ontologyRepairProposal(withOntology({
      entities: [{ name: "Order", aliases: ["SO"] }, { name: "order", aliases: ["Sales Order"] }, { name: "Quote" }],
      relations: [{ from: "Quote", relation: "becomes", to: "Order", cardinality: "lots" }],
    }))!;
    const repaired = (proposal.payload.artifactDocs as Record<string, Record<string, unknown>>).domainOntology;
    const entities = repaired.entities as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(2); // duplicate folded
    expect(entities[0].aliases).toEqual(expect.arrayContaining(["SO", "Sales Order"]));
    expect((repaired.relations as Array<Record<string, unknown>>)[0].cardinality).toBe("unknown");
  });

  it("is one-shot per finding: the same violations never re-propose once a decision exists", () => {
    const doc = { entities: [{ name: "Agent" }], relations: [{ from: "Agent", relation: "runs", to: "Ghost", cardinality: "1:N" }] };
    const first = ontologyRepairProposal(withOntology(doc))!;
    const withDecision = programme({
      domainOntology: doc,
      phaseInputs: { listen: { interviewNotes: "" } },
      flowDecisions: [{ id: first.id, status: "declined" }],
    });
    expect(ontologyRepairProposal(withDecision)).toBeNull();
  });

  it("library doc routing — reads the document, matches rosters, routes the evidence", () => {
    const base = {
      phaseInputs: { frame: { sponsor: "Raj Mamodia" } },
      // Listen's roster is the discovery kit's interview list.
      discoveryKit: { interviews: [
        { stakeholder: "Sarah Okafor", role: "COO", agenda: [] },
        { stakeholder: "Dan Reyes", role: "RevOps Lead", agenda: [] },
      ] },
    };
    const p = programme(base);

    // A meeting transcript whose speakers are on the Listen roster routes to
    // Listen with per-speaker attribution ready to write.
    const transcript = [
      "Sarah Okafor: The quote cycle takes nine days end to end.",
      "Dan Reyes: The exceptions queue has no owner today.",
      "Sarah Okafor: We reconcile by hand every Friday.",
      "Dan Reyes: Agreed, that is the bottleneck.",
    ].join("\n");
    const route = routeAttachedDocument(p, transcript);
    expect(route.kind).toBe("transcript");
    expect(route.movementId).toBe("listen");
    expect(route.matched).toEqual(expect.arrayContaining(["Sarah Okafor", "Dan Reyes"]));
    expect(route.speakerBlocks.length).toBeGreaterThanOrEqual(2);
    expect(route.summary).toMatch(/transcript/i);

    // A MIXED conversation (sponsor + interviewee) must NOT route to Show just
    // because Show's roster is the superset of everyone — Listen is discovery's
    // home; the sponsor surfaces as unmatched there (and the unrostered-voices
    // watcher takes it from there). The operator can retarget via forceMovement.
    const mixed = [
      "Sarah Okafor: We reconcile quotes by hand every week.",
      "Raj Mamodia: The mandate is to stop exactly that.",
      "Sarah Okafor: It takes three systems to build one quote.",
      "Raj Mamodia: Capture it in the charter.",
    ].join("\n");
    const mixedRoute = routeAttachedDocument(p, mixed);
    expect(mixedRoute.movementId).toBe("listen");
    expect(mixedRoute.matched).toEqual(["Sarah Okafor"]);
    expect(mixedRoute.unmatched).toContain("Raj Mamodia");
    const retargeted = routeAttachedDocument(p, mixed, "frame");
    expect(retargeted.movementId).toBe("frame");
    expect(retargeted.captureField).toBe("sponsorConversation");
    expect(retargeted.matched).toEqual(["Raj Mamodia"]);

    // Source material that only MENTIONS a roster name files as that
    // movement's context — document, not transcript.
    const memo = "Q3 planning memo. Dan Reyes owns the reconciliation workstream and reports weekly. Budget attached for review by finance.";
    const memoRoute = routeAttachedDocument(p, memo);
    expect(memoRoute.kind).toBe("document");
    expect(memoRoute.movementId).toBe("listen");
    expect(memoRoute.matched).toEqual(["Dan Reyes"]);
    expect(memoRoute.speakerBlocks).toEqual([]);

    // Nothing matches: still routes (unattributed Listen source), says so honestly.
    const alien = "Generic industry report about CRM market trends and vendor comparisons across regions.";
    const alienRoute = routeAttachedDocument(p, alien);
    expect(alienRoute.kind).toBe("document");
    expect(alienRoute.matched).toEqual([]);
    expect(alienRoute.summary).toMatch(/no roster names/i);

    // The written blocks carry the canonical doc header, the [source:] pointer,
    // the full text, and each speaker's own attributed block.
    const written = buildRoutedBlocks(route, "weekly-sync", transcript, "PRIOR", "docs/abc123");
    expect(written).toContain("PRIOR");
    expect(written).toContain("— Document: weekly-sync, provided by the programme team");
    expect(written).toContain("[source: docs/abc123]");
    expect(written).toContain("The quote cycle takes nine days");
    expect(written).toMatch(/— Sarah Okafor, COO, \d{4}-\d{2}-\d{2}( \d{2}:\d{2})? —/); // capture stamp carries time
    // ...and attribution can be declined, keeping the document whole.
    const plain = buildRoutedBlocks(route, "weekly-sync", transcript, "", "docs/abc123", false);
    expect(plain).not.toMatch(/— Sarah Okafor, COO,/);
  });

  it("retro-attribution: a late-added stakeholder's words lift out of attached documents on confirm", () => {
    // The transcript was attached BEFORE Priya joined the roster — her turns
    // sit inside the document block, unattributed.
    const captured = [
      "— Document: weekly-sync, provided by the programme team, 2026-07-10 —",
      "Sarah Okafor: The quote cycle takes nine days.",
      "Priya Nair: Onboarding new reps takes six weeks because nothing is written down.",
      "Sarah Okafor: And we reconcile by hand.",
      "Priya Nair: The copilot should answer rep questions from the record.",
    ].join("\n");
    const p = programme({
      phaseInputs: { listen: { interviewTranscripts: captured } },
      discoveryKit: { interviews: [
        { stakeholder: "Sarah Okafor", role: "COO", agenda: [] },
        { stakeholder: "Priya Nair", role: "Enablement Lead", agenda: [] },
      ] },
    });
    const proposal = retroAttributionProposal(p)!;
    expect(proposal).not.toBeNull();
    expect(proposal.tier).toBe(2);
    // Sarah AND Priya are both unattributed (no "— Name," headers) — both lift.
    expect(proposal.title).toMatch(/Attribute/);
    const appends = proposal.payload.evidenceAppends as Array<Record<string, string>>;
    expect(appends.some((a) => a.block.includes("Priya Nair, Enablement Lead"))).toBe(true);
    expect(appends.every((a) => a.movementId === "listen" && a.field === "interviewTranscripts")).toBe(true);
    // Confirm applies through the standard resolver; the watcher then goes silent.
    const queued = queueWatcherProposal(p, proposal)!;
    const blob = resolveFlowDecision(programme(queued), proposal.id, "confirmed", "user@x")!;
    const nextText = ((blob.phaseInputs as Record<string, Record<string, string>>).listen).interviewTranscripts;
    expect(nextText).toMatch(/— Priya Nair, Enablement Lead, \d{4}-\d{2}-\d{2}( \d{2}:\d{2})? —/);
    expect(nextText).toContain("Onboarding new reps takes six weeks");
    const after = programme({ ...blob, discoveryKit: (p.rawData as Record<string, unknown>).discoveryKit });
    expect(retroAttributionProposal(after)).toBeNull();
  });

  it("evidence ranking: claim-tagged and substantive voices lead; boilerplate sinks", () => {
    const entries = [
      { excerpt: "©2026 Brillio | Proprietary & Confidential", kind: "document", who: "Document: strategy", fieldLabel: "Transcripts" },
      { excerpt: "The quote cycle takes 9 days and costs $400 per quote end to end.", kind: "transcript", who: "Sarah Okafor, COO", fieldLabel: "Transcripts" },
      { excerpt: "Thanks, talk soon.", kind: "transcript", who: "Dan Reyes", fieldLabel: "Transcripts" },
      { excerpt: "We are no longer using Twenty CRM as a foundation.", kind: "transcript", who: "Raj Mamodia", fieldLabel: "Transcripts" },
    ];
    const ranked = rankEvidence(entries, ["we are no longer using twenty crm as a foundation"]);
    expect(ranked[0].who).toBe("Raj Mamodia"); // claim-tagged wins
    expect(ranked[1].who).toBe("Sarah Okafor, COO"); // measurable + attributed next
    expect(ranked[ranked.length - 1].excerpt).toMatch(/Proprietary/); // boilerplate last
    expect(isNoiseEvidence(entries[0])).toBe(true);
    expect(isNoiseEvidence(entries[1])).toBe(false);
    expect(scoreEvidence(entries[2], [])).toBeLessThan(scoreEvidence(entries[1], []));
  });

  it("evidence ranking dedupes the same quote captured twice (and containment)", () => {
    const entries = [
      { excerpt: "We are no longer using Twenty CRM as a foundation.", kind: "transcript", who: "Raj Mamodia · doc A", fieldLabel: "T" },
      { excerpt: "We are no longer using Twenty CRM as a foundation.", kind: "transcript", who: "Raj Mamodia · doc B", fieldLabel: "T" }, // exact dup
      { excerpt: "No longer using Twenty CRM as a foundation", kind: "transcript", who: "Raj Mamodia · pullquote", fieldLabel: "T" }, // contained
      { excerpt: "The quote cycle takes nine days.", kind: "transcript", who: "Sarah Okafor", fieldLabel: "T" },
    ];
    const ranked = rankEvidence(entries, []);
    // The three Twenty-CRM variants collapse to one; Sarah's distinct quote stays.
    expect(ranked).toHaveLength(2);
    expect(ranked.some((e) => /nine days/.test(e.excerpt))).toBe(true);
  });

  it("design rec 3: the fact/program graph populates from a FLOW programme's own phases", async () => {
    const { buildFactGraph } = await import("@/v3/lib/factGraph");
    const { buildProgramGraph } = await import("@/v3/lib/programGraph");
    const p = {
      ...programme({ phaseInputs: { frame: {
        businessObjective: "Replace Salesforce with an agentic CRM",
        successMetric: "Cost to serve",
        kpis: JSON.stringify([{ name: "Cycle time", baseline: "9d", target: "2d", unit: "days" }]),
      } } }),
      methodology: "atos-flow" as const,
      phases: [{ id: "frame" }, { id: "listen" }] as never,
    };
    const facts = buildFactGraph(p);
    // Previously 0 for flow programmes — the derivation iterated the retired
    // classic phase list. Now the programme's own methodology names the spine.
    expect(facts.facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.facts.some((f) => f.factText.includes("Replace Salesforce"))).toBe(true);
    const graph = buildProgramGraph(p, []);
    expect(graph.nodes.some((n) => n.type === "fact")).toBe(true);
    expect(graph.stats.nodeCount).toBeGreaterThan(2);
  });

  it("design rec 1: evidence entries carry stable content-derived ids", () => {
    const p = programme({ phaseInputs: { listen: { interviewTranscripts:
      "— A Voice, Analyst, 2026-07-10 —\nSaid a full sentence about the process worth keeping on the record." } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const first = movementEvidence(p, listen);
    const second = movementEvidence(p, listen);
    expect(first[0].id).toMatch(/^ev-[0-9a-f]+$/);
    expect(first[0].id).toBe(second[0].id); // stable across re-parses
    const other = programme({ phaseInputs: { listen: { interviewTranscripts:
      "— A Voice, Analyst, 2026-07-10 —\nSaid something entirely different this time around, so the identity changes." } } });
    expect(movementEvidence(other, listen)[0].id).not.toBe(first[0].id);
  });

  it("evidence excerpt skips recording-header noise and surfaces a real spoken line", () => {
    const p = programme({ phaseInputs: { listen: { interviewTranscripts: [
      "— Discovery Session, Ops, 2026-07-13 —",
      "Agentic CRM - Discovery Session - Alliances-20260512_190022UTC-Meeting Recording",
      "Prasoon Gupta 0:27 Hey, hi everyone, thanks for joining today.",
      "We reconcile quotes by hand every single week and it costs us three days.",
    ].join("\n") } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const entry = movementEvidence(p, listen).find((e) => /Discovery Session/.test(e.who));
    expect(entry?.excerpt).not.toMatch(/Meeting Recording|UTC/i);
    expect(entry?.excerpt).toMatch(/reconcile quotes by hand/);
  });

  it("excerpt honesty: date-stamp lines and transcription-system messages never become pull-quotes", () => {
    const p = programme({ phaseInputs: { listen: { interviewTranscripts: [
      "— Document: Discovery Session- Alliances, provided by the programme team, 2026-07-13 —",
      "May 7, 2026, 3:31PM",
      "Prasoon Gupta started transcription",
      "The alliances team loses two days every month re-keying partner quotes.",
      "Prasoon Gupta stopped transcription",
    ].join("\n") } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const entry = movementEvidence(p, listen).find((e) => /Alliances/.test(e.who));
    expect(entry?.excerpt).not.toMatch(/3:31PM|transcription/i);
    expect(entry?.excerpt).toMatch(/loses two days/);
  });

  it("excerpt honesty: glued speaker-turn transcripts quote the SPEECH, stripped of the turn marker", () => {
    // Teams-style exports glue the timestamp to the words ("0:20Hey") — every
    // line is a turn, so filtering lines would leave nothing. The prefix is
    // stripped instead and the real speech judged on its own.
    const p = programme({ phaseInputs: { listen: { interviewTranscripts: [
      "— Vimal Pandey, Finance SME, 2026-07-13 —",
      "Prasoon Gupta   0:20Hey, hi, good morning.",
      "Vimal Pandey   0:41The forecast roll-up takes nine days because every region keys it differently.",
    ].join("\n") } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const entry = movementEvidence(p, listen).find((e) => /Vimal/.test(e.who));
    expect(entry?.excerpt).not.toMatch(/0:20|0:41|good morning/);
    expect(entry?.excerpt).toMatch(/forecast roll-up takes nine days/);
  });

  it("evidence entries parse their capture stamp — date-only and date+time headers", () => {
    const p = programme({ phaseInputs: { listen: { interviewTranscripts: [
      "— Old Voice, Analyst, 2026-07-10 —\nSpoke about the process at length in this earlier conversation.",
      "— New Voice, Manager, 2026-07-13 09:45 —\nSpoke later, with a time-stamped header on the record.",
      "— Document: pricing-export, provided by Dan Reyes, 2026-07-12 14:20 —\nColumns and figures from the export worth keeping on record.",
    ].join("\n\n") } } });
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const entries = movementEvidence(p, listen);
    expect(entries.find((e) => /Old Voice/.test(e.who))?.capturedAt).toBe("2026-07-10");
    expect(entries.find((e) => /New Voice/.test(e.who))?.capturedAt).toBe("2026-07-13 09:45");
    expect(entries.find((e) => /pricing-export/.test(e.who))?.capturedAt).toBe("2026-07-12 14:20");
  });

  it("negated-claim detector: evidence negating a charter claim lands in the Inbox and files to the log", () => {
    const p = programme({
      transformationCharter: { businessObjective: "Replace Salesforce with an Azure-hosted agentic CRM built on an open-source foundation (Twenty), proving it on one pilot vertical." },
      phaseInputs: { frame: { sponsorConversation: [
        "— Raj Mamodia, Executive Sponsor, 2026-07-12 —",
        "Q: What is the platform direction? A: We are no longer using Twenty CRM as a foundation. The team builds from scratch on Azure.",
      ].join("\n") } },
    });
    const proposal = negatedClaimProposal(p)!;
    expect(proposal).not.toBeNull();
    expect(proposal.tier).toBe(2); // an Inbox decision — the operator judges
    const entries = proposal.payload.contradictionEntries as Array<Record<string, string>>;
    expect(entries[0].statement).toMatch(/no longer using Twenty CRM/i);
    expect(entries[0].between).toMatch(/Raj Mamodia vs Transformation Charter/);
    // Confirm files it to the log through the standard resolver...
    const queued = queueWatcherProposal(p, proposal)!;
    const blob = resolveFlowDecision(programme(queued), proposal.id, "confirmed", "user@x")!;
    const log = JSON.parse(((blob.phaseInputs as Record<string, Record<string, string>>).listen).contradictionLog) as Array<Record<string, string>>;
    expect(log[0].statement).toMatch(/no longer using Twenty/i);
    expect(log[0].status).toMatch(/^Open/);
    // ...and once open it routes onward (sponsor script picks it up via kitGaps; involved people via their cards).
    const after = programme({ ...blob, transformationCharter: (p.rawData as Record<string, unknown>).transformationCharter });
    expect(negatedClaimProposal(after)).toBeNull(); // one-shot — never re-asked
  });

  it("negated-claim detector stays silent without a negation or without claim overlap", () => {
    const charter = { transformationCharter: { businessObjective: "Build an agentic CRM on an open-source foundation." } };
    expect(negatedClaimProposal(programme({
      ...charter,
      phaseInputs: { frame: { sponsorConversation: "— Raj, Sponsor, 2026-07-12 —\nEverything proceeds as planned with the foundation approach." } },
    }))).toBeNull();
    expect(negatedClaimProposal(programme({
      ...charter,
      phaseInputs: { frame: { sponsorConversation: "— Raj, Sponsor, 2026-07-12 —\nWe are no longer serving breakfast at the town-hall meetings." } },
    }))).toBeNull();
  });

  it("readContradictions dedupes near-identical rows so a dispute is asked once", async () => {
    const { readContradictions } = await import("@/v3/components/flow/flowShellData");
    const p = programme({ phaseInputs: { listen: { contradictionLog: JSON.stringify([
      { statement: "A: We are no longer using 20 CRM as a foundation", between: "Raj vs Charter", status: "Open" },
      { statement: "A: We are no longer using 20 CRM as a foundation", between: "Raj vs Charter", status: "Open" }, // exact dup
      { statement: "no longer using 20 CRM as a foundation.", between: "Raj vs Charter", status: "Open" }, // near dup
      { statement: "Cycle time target is 2 days not 5", between: "Sarah vs plan", status: "Open" }, // distinct
      { statement: "An old resolved thing", between: "x", status: "Resolved" },
    ]) } } });
    const open = readContradictions(p, true);
    expect(open).toHaveLength(2); // the three 20-CRM variants collapse to one; the cycle-time one stays
    expect(open.some((r) => /20 CRM/.test(r.statement))).toBe(true);
    expect(open.some((r) => /Cycle time/.test(r.statement))).toBe(true);
    expect(open.some((r) => /resolved/i.test(r.statement))).toBe(false); // openOnly filtered it
    // The Frame sponsor's script now carries ONE disagree question, not three.
    const listen = resolveMovementStakeholders(programme({
      phaseInputs: { listen: { contradictionLog: (p.rawData as { phaseInputs: { listen: { contradictionLog: string } } }).phaseInputs.listen.contradictionLog } },
      discoveryKit: { interviews: [{ stakeholder: "Raj", role: "Sponsor", agenda: [] }] },
    }), "listen");
    expect(listen[0].questions.filter((q) => /disagree/i.test(q))).toHaveLength(1);
  });

  it("open contradictions route to the PEOPLE named in them as follow-up questions", () => {
    const p = programme({
      phaseInputs: { listen: { contradictionLog: JSON.stringify([
        { statement: "Fork Twenty CRM as the foundation vs build from scratch", between: "Raj Mamodia, Vimal Pandey", status: "Open — filed 2026-07-12" },
        { statement: "Already resolved thing", between: "Vimal Pandey", status: "Resolved" },
      ]) } },
      discoveryKit: { interviews: [
        { stakeholder: "Vimal Pandey", role: "Architect", agenda: [{ questions: ["What systems feed a quote?"] }] },
        { stakeholder: "Avantika Sharma", role: "Sales Ops", agenda: [] },
      ] },
    });
    const listen = resolveMovementStakeholders(p, "listen");
    const vimal = listen.find((s) => s.name === "Vimal Pandey")!;
    // The OPEN conflict leads his follow-up; the resolved one doesn't appear.
    expect(vimal.questions[0]).toMatch(/Two accounts disagree: "Fork Twenty CRM/);
    expect(vimal.questions[0]).toMatch(/your account vs Raj Mamodia/);
    expect(vimal.questions.join(" ")).not.toMatch(/Already resolved/);
    expect(vimal.questions).toContain("What systems feed a quote?"); // agenda kept
    const avantika = listen.find((s) => s.name === "Avantika Sharma")!;
    expect(avantika.questions.join(" ")).not.toMatch(/disagree/); // not her conflict
  });

  it("confirming the proposal applies the repaired document through the standard resolver", () => {
    const doc = { entities: [{ name: "Agent" }], relations: [{ from: "Agent", relation: "runs", to: "Ghost", cardinality: "1:N" }] };
    const p = withOntology(doc);
    const proposal = ontologyRepairProposal(p)!;
    const queued = queueWatcherProposal(p, proposal)!;
    const blob = resolveFlowDecision(programme(queued), proposal.id, "confirmed", "user@x")!;
    const repaired = blob.domainOntology as Record<string, unknown>;
    expect(repaired.relations as unknown[]).toHaveLength(0);
    expect(validateOntologyConstraints(repaired).filter((v) => v.severity === "blocking")).toEqual([]);
  });

  it("catches the same edge declared with two different cardinalities", () => {
    const v = validateOntologyConstraints({
      entities: [{ name: "A" }, { name: "B" }],
      relations: [
        { from: "A", relation: "owns", to: "B", cardinality: "1:1" },
        { from: "A", relation: "owns", to: "B", cardinality: "1:N" },
      ],
    });
    expect(v.some((x) => x.kind === "cardinality-conflict" && x.severity === "blocking")).toBe(true);
  });

  it("flags a duplicate entity name as blocking (ambiguous resolution)", () => {
    const v = validateOntologyConstraints({ entities: [{ name: "Order" }, { name: "order" }] });
    expect(v.some((x) => x.kind === "duplicate-entity" && x.severity === "blocking")).toBe(true);
  });

  it("treats a self-relation and a dangling standard mapping as warnings, not blocking", () => {
    const { blocking, warnings } = partitionOntologyViolations({
      entities: [{ name: "A" }],
      relations: [{ from: "A", relation: "loops", to: "A", cardinality: "1:1" }],
      standardAlignment: [{ entity: "Nowhere", standard: "https://schema.org/Thing" }],
    });
    expect(blocking).toEqual([]);
    expect(warnings.some((x) => x.kind === "self-relation")).toBe(true);
    expect(warnings.some((x) => x.kind === "dangling-alignment")).toBe(true);
  });

  it("treats unknown cardinality as valid (the generator's default)", () => {
    expect(hasBlockingOntologyViolations({ entities: [{ name: "A" }, { name: "B" }], relations: [{ from: "A", relation: "r", to: "B", cardinality: "unknown" }] })).toBe(false);
  });
});

describe("flowMetricRegistry — governed semantic layer (F-002)", () => {
  const withKpis = (rows: Array<Record<string, string>>) => programme({ phaseInputs: { frame: { kpis: JSON.stringify(rows) } } });

  it("reads one canonical metric list with stable ids and a definition", () => {
    const p = withKpis([{ id: "m1", name: "Cost to serve", definition: "Fully-loaded cost per transaction", baseline: "$4.50", target: "$2.25", unit: "$" }]);
    const reg = readMetricRegistry(p);
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ id: "m1", name: "Cost to serve", definition: "Fully-loaded cost per transaction", baseline: "$4.50", target: "$2.25", unit: "$" });
    expect(metricById(p, "m1")?.name).toBe("Cost to serve");
  });

  it("derives a slug id when a row carries none, and keeps ids unique", () => {
    const reg = readMetricRegistry(withKpis([{ name: "Cycle time" }, { name: "Cycle time" }]));
    expect(reg[0].id).toBe("cycle-time");
    expect(reg[1].id).toBe("cycle-time-2");
    expect(reg[0].id).not.toBe(reg[1].id);
  });

  it("reports a fully-governed programme as healthy", () => {
    const health = metricConsistency(withKpis([
      { name: "Cost to serve", definition: "Cost per txn", baseline: "$4.50", target: "$2.25", unit: "$" },
      { name: "Cycle time", definition: "Days quote→cash", baseline: "12", target: "5", unit: "days" },
    ]));
    expect(health.governed).toBe(true);
    expect(health.total).toBe(2);
    expect(health.defined).toBe(2);
    expect(health.issues).toEqual([]);
  });

  it("flags a duplicate metric name as an error — a measure needs one definition", () => {
    const health = metricConsistency(withKpis([
      { name: "Adoption", definition: "a", baseline: "0", target: "1" },
      { name: "adoption", definition: "b", baseline: "0", target: "1" },
    ]));
    expect(health.governed).toBe(false);
    expect(health.issues.some((i) => i.kind === "duplicate-name" && i.severity === "error")).toBe(true);
  });

  it("flags an undefined metric as a warning and an unverifiable one as an error", () => {
    const health = metricConsistency(withKpis([{ name: "Vague", baseline: "", target: "" }]));
    expect(health.issues.some((i) => i.kind === "undefined" && i.severity === "warning")).toBe(true);
    expect(health.issues.some((i) => i.kind === "unverifiable" && i.severity === "error")).toBe(true);
    expect(health.governed).toBe(false);
  });

  it("board pack, brief and drill-down picker all read through the one registry", async () => {
    const p = withKpis([{ name: "Cost to serve", definition: "Cost per txn", baseline: "$4.50", target: "$2.25", unit: "$" }]);
    const snapKpis = buildBriefSnapshot(p).kpis as Array<Record<string, string>>;
    expect(snapKpis[0]).toMatchObject({ name: "Cost to serve", baseline: "$4.50", target: "$2.25" });
    expect(listDrillAnchors(p, "kpi")[0].label).toBe("Cost to serve");
  });
});

describe("artifact studio registry", () => {
  it("covers every atos-flow required artifact with a resolvable field key", async () => {
    const { STUDIO_REGISTRY } = await import("@/v3/components/flow/studio/studios");
    const { getPhaseSequence, getPhaseDefinition } = await import("@/v3/lib/methodology");
    const required = getPhaseSequence("atos-flow")
      .flatMap((phaseId) => getPhaseDefinition(phaseId, "atos-flow")?.requiredArtifacts ?? []);
    expect(required.length).toBeGreaterThanOrEqual(13);
    for (const artifactId of required) {
      const entry = STUDIO_REGISTRY[artifactId];
      expect(entry, `no studio for ${artifactId}`).toBeTruthy();
      expect(entry.fieldKey, `no field key for ${artifactId}`).toBeTruthy();
    }
  });
});

describe("regeneration guard — artifactDocs decision payload", () => {
  const base = {
    domainOntology: { entities: [{ name: "Quote" }], editedAt: "2026-07-11", editedBy: "user@x" },
    phaseArtifacts: { listen: { "domain-ontology": { title: "Domain Ontology", status: "draft", inputsFingerprint: "old" } } },
    flowDecisions: [{
      id: "d-regen", status: "open", tier: 2, movementId: "listen",
      title: "Accept the regenerated Domain Ontology",
      payload: {
        artifactDocs: { domainOntology: { entities: [{ name: "Quote" }, { name: "Order" }], generatedAt: "2026-07-12" } },
        artifactStubs: [{ phaseId: "listen", artifactId: "domain-ontology", record: { status: "draft", agentDraftedAt: "2026-07-12", inputsFingerprint: "fresh" } }],
      },
    }],
  };

  it("confirm replaces the mirror and lands the fresh ledger stub", () => {
    const blob = resolveFlowDecision(programme(structuredClone(base)), "d-regen", "confirmed", "user@x")!;
    const doc = blob.domainOntology as Record<string, unknown>;
    expect((doc.entities as unknown[])).toHaveLength(2);
    expect(doc.editedAt).toBeUndefined();          // accepting the regeneration supersedes the hand edit
    const stub = (blob.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>).listen["domain-ontology"];
    expect(stub.inputsFingerprint).toBe("fresh");
    expect(stub.title).toBe("Domain Ontology");    // untouched stub fields survive the merge
  });

  it("decline keeps the hand-edited mirror and the old stub", () => {
    const blob = resolveFlowDecision(programme(structuredClone(base)), "d-regen", "declined", "user@x")!;
    expect((blob.domainOntology as Record<string, unknown>).editedAt).toBe("2026-07-11");
    const stub = (blob.phaseArtifacts as Record<string, Record<string, Record<string, unknown>>>).listen["domain-ontology"];
    expect(stub.inputsFingerprint).toBe("old");
  });
});

describe("frame baseline", () => {
  it("industry is a frame gate criterion with provenance", () => {
    const movement = flowMovements().find((m) => m.id === "frame")!;
    const p = programme({ phaseInputs: { frame: { industry: "Financial Services" } } });
    const item = gateChecklist(p, movement, []).find((c) => c.id === "industry")!;
    expect(item.done).toBe(true);
    expect(item.why).toBe("Financial Services");
    expect(gateChecklist(programme({}), movement, []).find((c) => c.id === "industry")!.done).toBe(false);
  });
});

describe("industry segments", () => {
  it("every forked industry is a real dropdown option with 2+ segments", async () => {
    const { INDUSTRY_OPTIONS, INDUSTRY_SEGMENTS } = await import("@/v3/lib/methodology");
    for (const [industry, segments] of Object.entries(INDUSTRY_SEGMENTS)) {
      expect(INDUSTRY_OPTIONS, `${industry} not in dropdown`).toContain(industry);
      expect(segments.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("locateQuote — span grounding's fuzzy match", () => {
  const transcript = "We looked at the numbers together. The team said \u201cquote-to-cash takes nine days,   sometimes more\u201d and nobody disputed it. Then we moved on.";

  it("finds a straight-quoted claim inside curly-quoted, respaced source text", () => {
    const hit = locateQuote(transcript, '"quote-to-cash takes nine days, sometimes more"');
    expect(hit).not.toBeNull();
    expect(transcript.slice(hit!.start, hit!.end)).toContain("quote-to-cash takes nine days");
  });

  it("strips a trailing em-dash attribution before matching", () => {
    const hit = locateQuote(transcript, "quote-to-cash takes nine days, sometimes more \u2014 Dan Reyes");
    expect(hit).not.toBeNull();
  });

  it("falls back to a shrinking prefix when the tail was paraphrased", () => {
    const hit = locateQuote(transcript, "quote-to-cash takes nine days, sometimes more or less depending on the quarter and the rep");
    expect(hit).not.toBeNull();
  });

  it("refuses to match short fragments or absent claims", () => {
    expect(locateQuote(transcript, "nine days")).toBeNull();
    expect(locateQuote(transcript, "the invoice reconciliation backlog is cleared nightly")).toBeNull();
  });
});

describe("sponsor briefs — dated, token-gated board-pack snapshots", () => {
  const program = {
    id: "prog-1", name: "Flow Pilot", client: "Acme",
    rawData: { data: { phaseInputs: { frame: { businessObjective: "Cut quote-to-cash from nine days to two", sponsor: "Sarah Chen" } } } },
  } as never;

  it("the snapshot freezes the derived numbers and gate states", () => {
    const snapshot = buildBriefSnapshot(program);
    expect(snapshot.objective).toContain("quote-to-cash");
    expect(snapshot.sponsor).toBe("Sarah Chen");
    expect(Array.isArray(snapshot.gates)).toBe(true);
    expect((snapshot.gates as unknown[]).length).toBeGreaterThan(0);
    expect(snapshot.numbers).toMatchObject({ waiting: 0 });
  });

  it("minting appends a tokened brief and attests the share", () => {
    const blob = mintBrief(program, "operator@brillio.com");
    expect(blob).not.toBeNull();
    const inner = (blob as { data: Record<string, unknown> }).data;
    const briefs = inner.flowBriefs as Array<Record<string, unknown>>;
    expect(briefs).toHaveLength(1);
    expect(String(briefs[0].token)).toMatch(/^[0-9a-f]{36}$/);
    expect((briefs[0].snapshot as Record<string, unknown>).sponsor).toBe("Sarah Chen");
    const log = inner.flowAttestations as Array<Record<string, unknown>>;
    expect(log.some((entry) => String(entry.action).includes("sponsor brief"))).toBe(true);
  });
});

describe("buildPrototypePrompt — the pack compiled into a coding-agent brief", () => {
  const program = {
    id: "prog-1", name: "Flow Pilot",
    rawData: { data: {
      agenticBlueprint: { targetFramework: "LangGraph" },
      prototypePack: {
        title: "Prototype Build Pack — Flow Pilot",
        scaffold: { runtime: "Node 18", framework: "React + FastAPI", structure: ["backend/", "frontend/"] },
        buildSlices: [
          { name: "Cycle-time dashboard", demonstrates: "COO review of cycle time", steps: ["panel", "board view"] },
          { name: "Exception queue", demonstrates: "Ops triage with age filters" },
        ],
        seedScenarios: [ { stakeholder: "Dan Reyes", scenario: "Triages the exception queue", data: ["47 open exceptions"] } ],
        stubbing: { netsuite: "fake the sync with fixtures" },
        demoEnvironment: "single docker-compose",
      },
    } },
  } as never;

  it("compiles slices in order, seeds verbatim, stubs and scaffold", () => {
    const prompt = buildPrototypePrompt(program)!;
    expect(prompt).toContain("# Build brief");
    expect(prompt.indexOf("1. Cycle-time dashboard")).toBeLessThan(prompt.indexOf("2. Exception queue"));
    expect(prompt).toContain("Agentic framework: LangGraph");
    expect(prompt).toContain("Dan Reyes — Triages the exception queue");
    expect(prompt).toContain("47 open exceptions");
    expect(prompt).toContain("fake the sync with fixtures");
    expect(prompt).toContain("TIME TO FIRST DEMO");
  });

  it("returns null when no pack exists", () => {
    expect(buildPrototypePrompt({ id: "x", name: "y", rawData: {} } as never)).toBeNull();
  });
});

describe("setShipLane — the whole lane at once", () => {
  const program = () => ({
    id: "p1", name: "P",
    rawData: { data: { shipLanes: { lanes: [
      { id: "l1", name: "Validation & evals", items: [
        { id: "a", label: "run evals", done: false },
        { id: "b", label: "review guardrails", done: true },
      ] },
    ] } } },
  }) as never;

  it("checks every item and attests the lane", () => {
    const blob = setShipLane(program(), "l1", true, "op@x.com")!;
    const inner = (blob as { data: Record<string, unknown> }).data;
    const lane = (inner.shipLanes as { lanes: Array<{ items: Array<{ done: boolean }> }> }).lanes[0];
    expect(lane.items.every((entry) => entry.done)).toBe(true);
    const log = inner.flowAttestations as Array<{ action: string }>;
    expect(log.some((entry) => entry.action === "Ship lane checked off — Validation & evals")).toBe(true);
  });

  it("reset unchecks everything; a no-op change returns null", () => {
    const checked = setShipLane(program(), "l1", true, "op@x.com")!;
    const reset = setShipLane({ id: "p1", name: "P", rawData: checked } as never, "l1", false, "op@x.com")!;
    const lane = ((reset as { data: Record<string, unknown> }).data.shipLanes as { lanes: Array<{ items: Array<{ done: boolean }> }> }).lanes[0];
    expect(lane.items.some((entry) => entry.done)).toBe(false);
    expect(setShipLane({ id: "p1", name: "P", rawData: reset } as never, "l1", false, "op@x.com")).toBeNull();
  });
});

describe("discovery kit requires stakeholder emails", () => {
  const frameMovement = flowMovements().find((m) => m.id === "frame")!;
  const withKit = (interviews: Array<Record<string, unknown>>) => ({
    id: "p1", name: "P",
    rawData: { data: { discoveryKit: { title: "Kit", interviews } } },
  }) as never;

  it("missing addresses hold the gate with a count and an operator hint", () => {
    const checks = gateChecklist(withKit([
      { stakeholder: "Dan Reyes", email: "dan@acme.com" },
      { stakeholder: "Priya Nair" },
      { stakeholder: "Marcus Webb", email: "not-an-email" },
    ]), frameMovement, []);
    const row = checks.find((c) => c.id === "kit-emails")!;
    expect(row.done).toBe(false);
    expect(row.label).toBe("Stakeholder emails on file — 2 missing");
    expect(row.group).toBe("record");
    expect(row.why).toContain("add emails in the Discovery Kit");
  });

  it("all addresses on file → met; no kit → no row", () => {
    const checks = gateChecklist(withKit([
      { stakeholder: "Dan Reyes", email: "dan@acme.com" },
    ]), frameMovement, []);
    expect(checks.find((c) => c.id === "kit-emails")!.done).toBe(true);
    const bare = gateChecklist({ id: "p2", name: "P", rawData: {} } as never, frameMovement, []);
    expect(bare.find((c) => c.id === "kit-emails")).toBeUndefined();
  });
});

describe("meeting invites and emailed links ride the kit's roster", () => {
  const program = {
    id: "p1", name: "Flow Pilot",
    rawData: { data: { discoveryKit: { interviews: [
      { stakeholder: "Dan Reyes", email: "dan@acme.com" },
      { stakeholder: "Priya Nair", email: "not-valid" },
    ] } } },
  } as never;

  it("stakeholderEmail matches the roster and rejects invalid shapes", () => {
    expect(stakeholderEmail(program, "Dan Reyes")).toBe("dan@acme.com");
    expect(stakeholderEmail(program, "dan reyes, RevOps Lead")).toBe("dan@acme.com");
    expect(stakeholderEmail(program, "Priya Nair")).toBeNull();
    expect(stakeholderEmail(program, "Nobody")).toBeNull();
  });

  it("the sponsor's address comes from Frame's setup inputs when the roster has none", () => {
    const p = {
      id: "p2", name: "P",
      rawData: { data: { phaseInputs: { frame: { sponsor: "Sarah Okafor, COO", sponsorEmail: "sarah@acme.com" } } } },
    } as never;
    expect(stakeholderEmail(p, "Sarah Okafor, COO")).toBe("sarah@acme.com");
    expect(stakeholderEmail(p, "Sarah Okafor")).toBe("sarah@acme.com");
    expect(stakeholderEmail(p, "Dan Reyes")).toBeNull();
  });

  it("the .ics carries the script as its agenda and the attendee when known", () => {
    const ics = buildMeetingIcs({
      who: "Dan Reyes", email: "dan@acme.com", date: "2026-07-20",
      programmeName: "Flow Pilot", intro: "Walk his workflow.", questions: ["Where does the queue stall?", "Who owns exceptions?"],
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20260720T100000");
    expect(ics).toContain("ATTENDEE;CN=Dan Reyes:mailto:dan@acme.com");
    expect(ics).toContain("SUMMARY:Flow Pilot — discovery with Dan Reyes");
    expect(ics).toContain("1. Where does the queue stall?");
    expect(buildMeetingIcs({ who: "X", email: null, date: "2026-07-20", programmeName: "P", questions: [] })).not.toContain("ATTENDEE");
  });

  it("mailtoLink addresses the person and carries the response link", () => {
    const href = mailtoLink("dan@acme.com", { stakeholder: "Dan Reyes", programmeName: "Flow Pilot", link: "https://x/y?flowRespond=t" });
    expect(href.startsWith("mailto:dan@acme.com?subject=")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Hi Dan,");
    expect(decodeURIComponent(href)).toContain("https://x/y?flowRespond=t");
  });
});

describe("personas ≠ stakeholders — every workflow role needs a voice, then acts", () => {
  const frameMovement = flowMovements().find((m) => m.id === "frame")!;
  const listenMovement = flowMovements().find((m) => m.id === "listen")!;
  const kit = (personas: Array<Record<string, unknown>>) => ({ title: "Kit", interviews: [], personas });
  const prog = (data: Record<string, unknown>) => ({ id: "p", name: "P", rawData: { data } }) as never;

  it("an unrepresented persona holds Frame's gate and names itself", () => {
    const p = prog({ discoveryKit: kit([
      { name: "Sales Rep", kind: "internal", spokenForBy: ["Priya Nair"] },
      { name: "End Customer", kind: "external", spokenForBy: [], unrepresented: true },
    ]) });
    const row = gateChecklist(p, frameMovement, []).find((c) => c.id === "kit-personas")!;
    expect(row.done).toBe(false);
    expect(row.label).toBe("Every persona has a voice — 1 unrepresented");
    expect(row.why).toContain("End Customer");
    // and the sponsor's follow-up script asks who can speak for them
    expect(kitPersonas(p)!.find((persona) => persona.name === "End Customer")!.unrepresented).toBe(true);
  });

  it("all personas voiced → met; a legacy kit without the section shows no row", () => {
    const voiced = prog({ discoveryKit: kit([{ name: "Sales Rep", spokenForBy: ["Priya Nair"] }]) });
    expect(gateChecklist(voiced, frameMovement, []).find((c) => c.id === "kit-personas")!.done).toBe(true);
    const legacy = prog({ discoveryKit: { title: "Kit", interviews: [] } });
    expect(gateChecklist(legacy, frameMovement, []).find((c) => c.id === "kit-personas")).toBeUndefined();
  });

  it("a persona who never acts in the Atlas holds Listen's gate — token-tolerant", () => {
    const p = prog({
      discoveryKit: kit([
        { name: "Sales Rep", spokenForBy: ["Priya"] },
        { name: "End Customer", spokenForBy: ["Dan"] },
      ]),
      currentStateAtlas: { workflows: [
        { name: "Quote", steps: [{ actor: "Sales Representative", action: "drafts" }] },
      ] },
    });
    const gap = personasMissingFromAtlas(p)!;
    expect(gap.missing).toEqual(["End Customer"]);
    const row = gateChecklist(p, listenMovement, []).find((c) => c.id === "personas-act")!;
    expect(row.done).toBe(false);
    expect(row.label).toBe("Every persona acts in the Atlas — 1 of 2 missing");
    expect(row.why).toContain("End Customer");
  });

  it("all personas acting → met; no atlas or no personas → no row", () => {
    const p = prog({
      discoveryKit: kit([{ name: "Sales Rep", spokenForBy: ["Priya"] }]),
      currentStateAtlas: { workflows: [{ name: "Quote", steps: [{ actor: "sales rep", action: "drafts" }] }] },
    });
    expect(gateChecklist(p, listenMovement, []).find((c) => c.id === "personas-act")!.done).toBe(true);
    const bare = prog({ discoveryKit: kit([{ name: "Sales Rep", spokenForBy: ["Priya"] }]) });
    expect(gateChecklist(bare, listenMovement, []).find((c) => c.id === "personas-act")).toBeUndefined();
  });
});

describe("uploaded documents are evidence — named, not shredded", () => {
  const prog = {
    id: "p", name: "P",
    rawData: { data: { phaseInputs: { frame: { sponsorConversation: [
      "— Sarah Okafor, COO, 2026-07-11 —",
      "We need the cycle down to two days.",
      "— Document: Team Roster — SME responsibilities and long-title padding for realism, provided by the programme team, 2026-07-12 —",
      "Line one of the document.",
      "— INPUT SIGNALS —",
      "Interior dash-wrapped heading that must NOT become a voice.",
      "More document content here.",
    ].join("\n") } } } },
  } as never;

  it("a Document block is kind=document, named by its title, body intact", () => {
    const frame = flowMovements().find((m) => m.id === "frame")!;
    const entries = movementEvidence(prog, frame);
    expect(entries.map((entry) => [entry.kind, entry.who])).toEqual([
      ["transcript", "Sarah Okafor, COO, 2026-07-11"],
      ["document", "Team Roster — SME responsibilities and long-title padding for realism"],
    ]);
    const doc = entries[1];
    expect(doc.meta).toContain("document · the programme team · 2026-07-12");
    // the interior heading stayed INSIDE the document body
    expect(doc.text).toContain("INPUT SIGNALS");
    expect(doc.text).toContain("More document content here.");
  });
});

describe("a respondent's original file lands as a downloadable reference, no text dup", () => {
  const prog = () => ({
    id: "p", name: "P",
    rawData: { data: {
      flowInterviewPacks: [{ id: "k1", stakeholder: "Dan Reyes", movementId: "listen", captureField: "interviewTranscripts", token: "t", createdAt: "2026-07-01T00:00:00Z" }],
      flowPortalInbox: [{
        id: "item1", kind: "interview", stakeholder: "Dan Reyes", role: "RevOps Lead",
        receivedAt: "2026-07-12T00:00:00Z",
        // The extracted content is IN the answer (the respondent saw it in the field).
        text: "Q: Whose day changes?\nA: From \"impact.txt\":\nSales ops and Finance.",
        // The document rides as a text-less original reference only.
        documents: [{ name: "impact.txt", text: "", question: 1, sourceKey: "p/abc-impact.txt" }],
      }],
    } },
  }) as never;

  it("ingest writes a pointer Document block with the source marker, not the extract twice", () => {
    const blob = ingestPortalResponse(prog(), "item1", "op@x.com")!;
    const inner = (blob as { data: Record<string, unknown> }).data;
    const transcripts = (inner.phaseInputs as Record<string, Record<string, string>>).listen.interviewTranscripts;
    // the answer carries the content once
    expect(transcripts).toContain("Sales ops and Finance.");
    // the document block is a downloadable pointer, not a second copy
    expect(transcripts).toContain("— Document: impact.txt (re: question 1), provided by Dan Reyes,");
    expect(transcripts).toContain("[source: p/abc-impact.txt]");
    expect(transcripts).toContain("its content is captured in the response above");
    // the Library reads it as a document with a downloadable original
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const doc = movementEvidence({ id: "p", name: "P", rawData: blob } as never, listen).find((e) => e.kind === "document")!;
    expect(doc.sourceKey).toBe("p/abc-impact.txt");
  });
});

describe("respondent attachments ride quarantine and land as named evidence", () => {
  const prog = () => ({
    id: "p", name: "P",
    rawData: { data: {
      flowInterviewPacks: [{ id: "k1", stakeholder: "Dan Reyes", movementId: "listen", captureField: "interviewTranscripts", token: "t", createdAt: "2026-07-01T00:00:00Z" }],
      flowPortalInbox: [{
        id: "item1", kind: "interview", stakeholder: "Dan Reyes", role: "RevOps Lead",
        receivedAt: "2026-07-12T00:00:00Z", text: "Q: Where does it stall?\nA: In the exception queue.",
        documents: [{ name: "Exception export — May", text: "row1 stuck 9 days\nrow2 stuck 12 days", question: 1 }],
      }],
    } },
  }) as never;

  it("listPortalInbox surfaces the attachments", () => {
    const item = listPortalInbox(prog())[0];
    expect(item.documents).toHaveLength(1);
    expect(item.documents![0].name).toBe("Exception export — May");
  });

  it("ingest writes the answers AND a named Document block; the Library reads it as a document", () => {
    const blob = ingestPortalResponse(prog(), "item1", "op@x.com")!;
    const inner = (blob as { data: Record<string, unknown> }).data;
    const transcripts = (inner.phaseInputs as Record<string, Record<string, string>>).listen.interviewTranscripts;
    expect(transcripts).toContain("— Dan Reyes, RevOps Lead,");
    expect(transcripts).toContain("— Document: Exception export — May (re: question 1), provided by Dan Reyes,");
    const listen = flowMovements().find((m) => m.id === "listen")!;
    const entries = movementEvidence({ id: "p", name: "P", rawData: blob } as never, listen);
    const doc = entries.find((entry) => entry.kind === "document")!;
    expect(doc.who).toBe("Exception export — May (re: question 1)");
    expect(doc.text).toContain("row2 stuck 12 days");
  });
});

describe("source documents carry their original-file pointer", () => {
  it("[source: key] is metadata — stripped from the text, exposed as sourceKey", () => {
    const prog = {
      id: "p", name: "P",
      rawData: { data: { phaseInputs: { frame: { sponsorConversation: [
        "— Document: Strategy deck, provided by the team, 2026-07-12 —",
        "[source: prog-1/abc-strategy.pptx]",
        "Slide one content.",
      ].join("\n") } } } },
    } as never;
    const frame = flowMovements().find((m) => m.id === "frame")!;
    const doc = movementEvidence(prog, frame).find((entry) => entry.kind === "document")!;
    expect(doc.sourceKey).toBe("prog-1/abc-strategy.pptx");
    expect(doc.text).not.toContain("[source:");
    expect(doc.text).toContain("Slide one content.");
    expect(doc.words).toBe(3);
  });
});

describe("blob migration v2 — seed folds into the People roster", () => {
  it("moves frame.stakeholderSeed rows into listen.interviewRoster, deduped, then drops the seed", () => {
    const inner = {
      _blobVersion: 1,
      phaseInputs: {
        frame: { stakeholderSeed: JSON.stringify([{ name: "Dan Reyes", role: "RevOps" }, { name: "Priya", domain: "Sales Enablement" }]) },
        listen: { interviewRoster: JSON.stringify([{ name: "Dan Reyes", role: "RevOps Lead", status: "Heard" }]) },
      },
    };
    const { inner: out, migrated } = migrateProgramBlob(inner);
    expect(migrated).toBe(true);
    const frame = (out.phaseInputs as Record<string, Record<string, unknown>>).frame;
    expect(frame.stakeholderSeed).toBeUndefined();
    const roster = JSON.parse((out.phaseInputs as Record<string, Record<string, string>>).listen.interviewRoster);
    // Dan already on the roster (Heard) stays untouched; Priya folds in as "To book"
    expect(roster).toHaveLength(2);
    expect(roster.find((r: Record<string, unknown>) => r.name === "Dan Reyes").status).toBe("Heard");
    const priya = roster.find((r: Record<string, unknown>) => r.name === "Priya");
    expect(priya.role).toBe("Sales Enablement");
    expect(priya.status).toBe("To book");
  });
});

describe("evidence-collection flow — every movement captures into a real evidence field", () => {
  // A stakeholder card captures into meetingKit(movement).captureField. If that
  // field is not a transcript/document input on the movement, the capture never
  // renders as attributed evidence and the card's status never flips. Pin it.
  it("each movement's captureField is a transcript field on that movement", () => {
    const program = { id: "p", name: "P", rawData: { data: { phaseInputs: {} } } } as never;
    for (const movement of flowMovements()) {
      const kit = meetingKit(program, movement.id);
      if (!kit) continue;
      const field = (movement.inputFields ?? []).find((f) => f.id === kit.captureField);
      expect(field, `${movement.id}: captureField "${kit.captureField}" must be a real input field`).toBeTruthy();
      expect(["transcript", "document"], `${movement.id}: captureField "${kit.captureField}" is ${field?.type}, not evidence`).toContain(field?.type);
    }
  });

  it("a capture into the movement's field renders as attributed evidence", () => {
    const ship = flowMovements().find((m) => m.id === "ship")!;
    const captureField = "shipConversations";
    const program = {
      id: "p", name: "P",
      rawData: { data: { phaseInputs: { ship: { [captureField]: "— Hardening / SRE Owner, 2026-07-12 —\nRollback is a blue-green swap; failure modes are covered." } } } },
    } as never;
    const evidence = movementEvidence(program, ship);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].who).toContain("Hardening / SRE Owner");
  });
});

describe("flowDrilldown — lineage, anchors, and finding roll-up", () => {
  const parent = { id: "par", name: "Parent", rawData: {
    ontologyAlignment: [{ entity: "Order" }, { entity: "Quote" }],
    currentStateAtlas: { workflows: [{ name: "CPQ", steps: [{ actor: "Rep", action: "quote" }] }] },
  } } as unknown as ProgramSummary;
  const child = { id: "kid", name: "CPQ — deep dive", gateReviews: { listen: { status: "approved" } }, rawData: {
    lineage: { parentId: "par", parentName: "Parent", anchor: { kind: "workflow", refId: "wf-0", label: "CPQ" } },
    ontologyAlignment: [{ entity: "Order" }, { entity: "Credit Memo" }],
    domainOntology: { summary: "Nine entities in the CPQ slice." },
  } } as unknown as ProgramSummary;

  it("reads the child's anchor and nests it under the parent", () => {
    expect(readDrillAnchor(child)).toEqual({ kind: "workflow", refId: "wf-0", label: "CPQ" });
    const kids = listChildDrilldowns(parent, [parent, child]);
    expect(kids).toHaveLength(1);
    expect(kids[0].child.id).toBe("kid");
    expect(kids[0].anchor?.label).toBe("CPQ");
  });

  it("lists real anchors from the parent's data", () => {
    expect(listDrillAnchors(parent, "workflow").map((o) => o.label)).toEqual(["CPQ"]);
    expect(listDrillAnchors(parent, "process").map((o) => o.label)).toEqual(["Order", "Quote"]);
  });

  it("routes roll-ups to the movement that owns the anchor kind", () => {
    expect(drillRollupTarget("workflow")).toEqual({ movementId: "listen", captureField: "interviewTranscripts" });
    expect(drillRollupTarget("track")).toEqual({ movementId: "show", captureField: "demoFeedback" });
    expect(drillRollupTarget("kpi")).toEqual({ movementId: "evolve", captureField: "opsConversations" });
  });

  it("composes findings: gates, artifact summaries, and only NEW vocabulary", () => {
    const findings = buildDrilldownFindings(child, parent);
    expect(findings).toContain("Gates demonstrated: listen");
    expect(findings).toContain("Domain Ontology: Nine entities in the CPQ slice.");
    expect(findings).toContain("Credit Memo");
    expect(findings).not.toContain("New vocabulary discovered: Order");
  });

  it("returns null when the child has nothing substantive yet", () => {
    const empty = { id: "e", name: "Empty", rawData: { lineage: { parentId: "par" } } } as unknown as ProgramSummary;
    expect(buildDrilldownFindings(empty, parent)).toBeNull();
  });
});

describe("flowTranscriptMap — speakers auto-map to the roster", () => {
  const roster = [
    { name: "Sarah Okafor", role: "COO" },
    { name: "Dan Reyes", role: "RevOps Lead" },
  ];
  const transcript = [
    "Meeting notes — quote review, 10am",
    "Sarah Okafor: The board version is one line.",
    "Dan: The exception queue is where everything stalls.",
    "It runs fourteen items deep most weeks.",
    "Sarah Okafor: Then that is the first slice.",
    "Priya N: I can build the ramp guide.",
    "Dan: Agreed.",
  ].join("\n");

  it("maps full names and first names; continuation lines stay with the turn", () => {
    const mapping = mapTranscriptSpeakers(transcript, roster);
    expect(mapping).not.toBeNull();
    expect(mapping!.matched.sort()).toEqual(["Dan", "Sarah Okafor"]);
    expect(mapping!.unmatched).toEqual(["Priya N"]);
    const dan = mapping!.blocks.find((b) => b.name === "Dan Reyes");
    expect(dan?.text).toContain("fourteen items deep");
    expect(dan?.text).toContain("Agreed.");
    const sarah = mapping!.blocks.find((b) => b.name === "Sarah Okafor");
    expect(sarah?.text).toContain("first slice");
  });

  it("returns null for ordinary documents (not enough speaker turns)", () => {
    expect(mapTranscriptSpeakers("A plain report.\nWith paragraphs of prose.", roster)).toBeNull();
    expect(mapTranscriptSpeakers("Sarah Okafor: only one speaker\nSarah Okafor: twice", roster)).toBeNull();
  });
});

describe("gateApprovalIntegrity — read-time backstop for forged approvals (F-001)", () => {
  const check = (done: boolean, id: string) => ({ id, label: id, done, group: "evidence" } as unknown as import("@/v3/components/flow/flowShellData").GateCheckItem);
  const prog = (status?: string) => ({ id: "p", name: "T", rawData: {}, gateReviews: status ? { frame: { status } } : {} } as unknown as ProgramSummary);

  it("no recorded approval → defensible, no warning", () => {
    const r = gateApprovalIntegrity(prog(), "frame", [check(false, "a")]);
    expect(r).toEqual({ approved: false, defensible: true, unmet: 0 });
  });
  it("approved with all criteria met → defensible", () => {
    const r = gateApprovalIntegrity(prog("approved"), "frame", [check(true, "a"), check(true, "b")]);
    expect(r.approved).toBe(true); expect(r.defensible).toBe(true); expect(r.unmet).toBe(0);
  });
  it("approved with unmet criteria (the T6 forgery) → indefensible, with reason", () => {
    const r = gateApprovalIntegrity(prog("approved"), "frame", [check(true, "a"), check(false, "b"), check(false, "c")]);
    expect(r.approved).toBe(true);
    expect(r.defensible).toBe(false);
    expect(r.unmet).toBe(2);
    expect(r.reason).toContain("not met");
  });
});

describe("People directory — operator-added roles validate against the programme", () => {
  it("a template role (or close variant) validates as known; an unfamiliar role does not", () => {
    const p = programme({});
    expect(validateProgramRole(p, "Solution Architect").known).toBe(true);
    expect(validateProgramRole(p, "Executive Sponsor").known).toBe(true);
    // a close variant sharing the significant tokens resolves by overlap
    expect(validateProgramRole(p, "Lead Solution Architect").known).toBe(true);
    // an unfamiliar role is unresolved and offers suggestions
    const unknown = validateProgramRole(p, "Data Steward");
    expect(unknown.known).toBe(false);
    expect(Array.isArray(unknown.suggestions)).toBe(true);
  });

  it("a role already accepted in the directory becomes a KNOWN role for the next person", () => {
    const p = programme({ phaseInputs: { listen: { _directoryPeople: JSON.stringify([
      { id: "dp-1", name: "Nadia Okonkwo", role: "Data Steward", movementId: "listen", roleResolved: true },
    ]) } } });
    expect(knownProgramRoles(p).some((r) => /Data Steward/i.test(r))).toBe(true);
    expect(validateProgramRole(p, "Data Steward").known).toBe(true);
  });

  it("readDirectoryPeople round-trips and reports unresolved roles", () => {
    const p = programme({ phaseInputs: { listen: { _directoryPeople: JSON.stringify([
      { id: "dp-1", name: "Nadia", role: "Data Steward", movementId: "listen", roleResolved: false },
      { id: "dp-2", name: "Omar", role: "Solution Architect", movementId: "envision", roleResolved: true },
    ]) } } });
    const people = readDirectoryPeople(p);
    expect(people).toHaveLength(2);
    expect(people.filter((x) => !x.roleResolved).map((x) => x.name)).toEqual(["Nadia"]);
  });
});

describe("Discovery Kit coverage names that aren't people → Inbox", () => {
  it("flags a coverage name not on the programme, and clears it once added/roster-known or dismissed", () => {
    const base = {
      discoveryKit: { coverageMap: [
        { domain: "Sales", coveredBy: "Raj Mamodia, Nadia Okonkwo" },
        { domain: "Ops", coveredBy: ["Team Ops"] },
      ] },
      phaseInputs: { frame: { sponsor: "Raj Mamodia" }, listen: { interviewRoster: JSON.stringify([{ name: "Raj Mamodia", status: "Heard" }]) } },
    };
    // Raj is known (roster + sponsor); Nadia + Team Ops are not.
    const p = programme(base);
    const flagged = unresolvedCoverageNames(p).map((x) => x.name);
    expect(flagged).toContain("Nadia Okonkwo");
    expect(flagged).toContain("Team Ops");
    expect(flagged).not.toContain("Raj Mamodia");
    // Add Nadia to the directory → she's known now.
    const withNadia = programme({ ...base, phaseInputs: { ...base.phaseInputs, listen: { ...base.phaseInputs.listen,
      _directoryPeople: JSON.stringify([{ id: "dp-1", name: "Nadia Okonkwo", role: "Sales", movementId: "listen", roleResolved: true }]) } } });
    expect(unresolvedCoverageNames(withNadia).map((x) => x.name)).not.toContain("Nadia Okonkwo");
    // Dismiss "Team Ops" → it stops prompting.
    const dismissed = programme({ ...base, phaseInputs: { ...base.phaseInputs, listen: { ...base.phaseInputs.listen,
      _dismissedCoverageNames: JSON.stringify(["Team Ops"]) } } });
    expect(unresolvedCoverageNames(dismissed).map((x) => x.name)).not.toContain("Team Ops");
    // knownPeopleNames includes roster + sponsor.
    expect(knownPeopleNames(p).has("raj mamodia")).toBe(true);
  });
});
