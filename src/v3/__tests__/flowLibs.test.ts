/**
 * The Flow libraries are pure blob transforms — these tests pin the rules
 * the workspace runs on: what a confirm merges, what acceptance requires,
 * where an ingested response routes.
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { resolveFlowDecision, listOpenFlowDecisions, describeDecisionChanges } from "@/v3/components/flow/flowDecisions";
import { trackAcceptance, trackBlockers, recordShowPass, listFlowTracks, type FlowTrack } from "@/v3/components/flow/flowTracks";
import { toggleShipItem, listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { ingestPortalResponse, listPortalInbox } from "@/v3/components/flow/flowPortal";
import { gateChecklist, gateReadiness, flowMovements } from "@/v3/components/flow/flowShellData";

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
    expect(r.headline).toBe("2 of 8 criteria met");
  });

  it("criteria met but a document stale → amber, the record trails", () => {
    const r = verdict(metFrame(), [art({ stale: true }), art({ id: "charter", title: "Transformation Charter" })]);
    expect(r.kind).toBe("trails");
    expect(r.tone).toBe("amber");
    expect(r.detail).toBe("8 of 9 criteria met");
  });

  it("criteria met, record current, but a document declares gaps → open gaps verdict", () => {
    const r = verdict(metFrame(), [art({ gaps: 2 })]);
    expect(r.kind).toBe("gaps");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("The record declares open gaps");
  });

  it("staleness outranks gaps in the verdict cause", () => {
    expect(verdict(metFrame(), [art({ gaps: 2 }), art({ id: "charter", title: "Charter", stale: true })]).kind).toBe("trails");
  });

  it("criteria met but a document never generated → the record trails", () => {
    expect(verdict(metFrame(), [art({ present: false })]).kind).toBe("trails");
  });

  it("record current but a decision parked in the Inbox → judgment waits", () => {
    const p = metFrame({ flowDecisions: [{ id: "d1", movementId: "frame", status: "open" }] });
    const r = verdict(p, [art()]);
    expect(r.kind).toBe("judgment");
    expect(r.tone).toBe("amber");
    expect(r.headline).toBe("A judgment waits in the Inbox");
  });

  it("evidence, record and Inbox all clear → ready, green", () => {
    const r = verdict(metFrame(), [art()]);
    expect(r.kind).toBe("ready");
    expect(r.tone).toBe("green");
    expect(r.detail).toBe("8 criteria met · record current · Inbox clear");
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
    expect(item.label).toBe("Discovery Kit — declares 2 open gaps");
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
    expect(item.label).toBe("1 judgment waiting in the Inbox");
    expect(gateChecklist(programme({}), movement, []).find((c) => c.id === "inbox")!.done).toBe(true);
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
