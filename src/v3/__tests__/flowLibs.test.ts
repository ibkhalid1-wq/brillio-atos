/**
 * The Flow libraries are pure blob transforms — these tests pin the rules
 * the workspace runs on: what a confirm merges, what acceptance requires,
 * where an ingested response routes.
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import { resolveFlowDecision, listOpenFlowDecisions } from "@/v3/components/flow/flowDecisions";
import { trackAcceptance, trackBlockers, recordShowPass, listFlowTracks, type FlowTrack } from "@/v3/components/flow/flowTracks";
import { toggleShipItem, listShipLanes, shipLaneProgress } from "@/v3/components/flow/flowShip";
import { ingestPortalResponse, listPortalInbox } from "@/v3/components/flow/flowPortal";
import { gateChecklist, flowMovements } from "@/v3/components/flow/flowShellData";

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
