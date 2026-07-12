/**
 * The Flow libraries are pure blob transforms — these tests pin the rules
 * the workspace runs on: what a confirm merges, what acceptance requires,
 * where an ingested response routes.
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { resolveFlowDecision, listOpenFlowDecisions, describeDecisionChanges } from "@/v3/components/flow/flowDecisions";
import { scriptDocumentRefs, meetingKit } from "@/v3/components/flow/flowMeetings";
import { locateQuote } from "@/v3/components/flow/flowShellData";
import { mintBrief, buildBriefSnapshot } from "@/v3/components/flow/flowBriefs";
import { buildPrototypePrompt } from "@/v3/components/flow/flowBuildPrompt";
import { validateProgramBlob, migrateProgramBlob, BLOB_VERSION } from "@/v3/lib/blobGuard";
import { unrosteredVoicesProposal, reDemoProposal, queueWatcherProposal } from "@/v3/components/flow/flowWatchers";
import { mintFollowUpPack, listInterviewPacks, visibleLinks } from "@/v3/components/flow/flowPortal";
import { trackAcceptance, trackBlockers, recordShowPass, listFlowTracks, type FlowTrack } from "@/v3/components/flow/flowTracks";
import { setShipLane, toggleShipItem, listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { ingestPortalResponse, listPortalInbox } from "@/v3/components/flow/flowPortal";
import { gateChecklist, gateReadiness, flowMovements, movementEvidence } from "@/v3/components/flow/flowShellData";

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

describe("follow-up packs — one live ask per person per movement", () => {
  it("a new follow-up retires the old unanswered one; answered packs stay", () => {
    const p = programme({ flowInterviewPacks: [
      { id: "old-unanswered", role: "Follow-up", stakeholder: "Sarah Okafor, COO", movementId: "frame", questions: ["Old q"], token: "t1", createdAt: "2026-07-01" },
      { id: "old-answered", role: "Follow-up", stakeholder: "Sarah Okafor, COO", movementId: "frame", questions: ["Answered q"], token: "t2", createdAt: "2026-07-02", respondedAt: "2026-07-03" },
      { id: "discovery", stakeholder: "Sarah Okafor, COO", questions: ["Discovery q"], token: "t3", createdAt: "2026-07-01" },
    ] });
    const blob = mintFollowUpPack(p, { movementId: "frame", who: "Sarah Okafor, COO", questions: ["New q"], captureField: "sponsorConversation" }, "you")!;
    const ids = (blob.flowInterviewPacks as Array<{ id: string }>).map((pack) => pack.id);
    expect(ids).not.toContain("old-unanswered");
    expect(ids).toContain("old-answered");
    expect(ids).toContain("discovery");
    expect(ids).toHaveLength(3); // answered + discovery + the new pack
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

  it("migration stamps the version once and is idempotent", () => {
    const first = migrateProgramBlob({ phaseInputs: {} });
    expect(first.migrated).toBe(true);
    expect(first.inner._blobVersion).toBe(BLOB_VERSION);
    const second = migrateProgramBlob(first.inner);
    expect(second.migrated).toBe(false);
  });
});

describe("meetingKit follow-up — only askable gaps become script questions", () => {
  const framed = (gaps: string[]) => programme({
    phaseInputs: { frame: {
      sponsorConversation: "— Sarah Okafor, COO —\nplenty of words on record here",
      businessObjective: "obj", sponsor: "Sarah Okafor", industry: "Banking",
      successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
      stakeholderSeed: JSON.stringify([{ name: "Dan" }]),
    } },
    discoveryKit: { gaps },
  });

  it("operator gaps (input/artifact/regenerate plumbing) never reach a stakeholder script", () => {
    const kit = meetingKit(framed(["Add a clear objective to the Objective input to resolve the blocker."]), "frame")!;
    expect(kit.followUp).toBe(false);
    expect(kit.questions.some((q) => /input/i.test(q))).toBe(false);
  });

  it("an open contradiction routes to the SPONSOR — Frame's follow-up asks it", () => {
    const p = programme({
      phaseInputs: {
        frame: {
          sponsorConversation: "— Sarah Okafor, COO —\nplenty of words on record here",
          businessObjective: "obj", sponsor: "Sarah Okafor", industry: "Banking",
          successMetric: "cycle time", targetFirstDemoDate: "2026-07-25",
          stakeholderSeed: JSON.stringify([{ name: "Dan" }]),
        },
        listen: {
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
    expect(r.headline).toBe("3 of 9 criteria met");
  });

  it("criteria met but a document stale → amber, the record trails", () => {
    const r = verdict(metFrame(), [art({ stale: true }), art({ id: "charter", title: "Transformation Charter" })]);
    expect(r.kind).toBe("trails");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("9 of 10 criteria met");
    expect(r.detail).toBe("Documents are out of date — evidence changed");
  });

  it("criteria met, record current, but a document declares gaps → open gaps verdict", () => {
    const r = verdict(metFrame(), [art({ gaps: 2 })]);
    expect(r.kind).toBe("gaps");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("8 of 9 criteria met");
    expect(r.detail).toBe("A document still lists open gaps");
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
    expect(r.headline).toBe("8 of 9 criteria met");
    expect(r.detail).toBe("A decision is waiting in the Inbox");
  });

  it("evidence, record and Inbox all clear → ready, green", () => {
    const r = verdict(metFrame(), [art()]);
    expect(r.kind).toBe("ready");
    expect(r.tone).toBe("green");
    expect(r.detail).toBe("9 criteria met · documents current · Inbox clear");
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
