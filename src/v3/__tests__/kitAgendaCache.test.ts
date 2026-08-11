/**
 * ACCEPTANCE — the kit agenda is a CACHE, not a source.
 *
 * The generated discovery kit stores agenda question STRINGS on
 * `interviews[].agenda[].questions` — a rival producer of question text, in a
 * field that reads like the plan itself. This demotes them to a VERSIONED cache
 * (`interviews[].agendaCache`) behind ONE accessor, and proves the two things
 * that make that safe:
 *   · nothing regresses — every reader returns the SAME questions for a legacy
 *     kit and for its demoted twin (the whole point of "backward-compatible");
 *   · the demoted shape is honest — version + origin are reported, an empty
 *     cache is not silently refilled from the legacy strings, and demotion is
 *     idempotent.
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  readKitAgendaCache, kitAgendaQuestions, demoteInterviewAgenda, demoteKitAgendas,
  KIT_AGENDA_CACHE_VERSION, KIT_AGENDA_CACHE_FIELD, KIT_AGENDA_CACHE_NOTE,
} from "@/v3/lib/ledger/kitAgendaCache";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { meetingKit } from "@/v3/components/flow/flowMeetings";
import { mintInterviewPacks } from "@/v3/components/flow/flowPortal";

const Q1 = "Walk us through how a quote is drafted end to end";
const Q2 = "Where does a quote wait the longest?";

/** The legacy shape the generator still emits. */
const legacyInterview = () => ({
  stakeholder: "Dana Ops", role: "Sales Ops", email: "dana@x.com",
  agenda: [{ topic: "Their workflow today", minutes: 45, questions: [Q1, Q2] }],
});

const programme = (kit: Record<string, unknown>): ProgramSummary =>
  ({ id: "p1", name: "Test", rawData: { discoveryKit: kit, phaseInputs: { listen: {} } } } as unknown as ProgramSummary);

describe("the agenda strings are a cache — read through ONE accessor", () => {
  it("a legacy kit reads exactly as before, and says so: origin legacy-inline, version 0", () => {
    const cache = readKitAgendaCache(legacyInterview());
    expect(cache.questions).toEqual([Q1, Q2]);
    expect(cache.origin).toBe("legacy-inline");
    expect(cache.version).toBe(0);      // never dressed up as a fresh cache
    expect(cache.at).toBeNull();        // nobody recorded when — we do not invent it
  });

  it("demotion moves the strings to the versioned cache and keeps the PLAN (topic + minutes)", () => {
    const demoted = demoteInterviewAgenda(legacyInterview(), { at: "2026-08-10T00:00:00Z" });
    // the strings no longer live where they read like the source…
    expect((demoted.agenda as Array<Record<string, unknown>>)[0]).toEqual({ topic: "Their workflow today", minutes: 45 });
    // …they live in a named, versioned cache
    const cache = readKitAgendaCache(demoted);
    expect(cache.questions).toEqual([Q1, Q2]);
    expect(cache.origin).toBe("cache");
    expect(cache.version).toBe(KIT_AGENDA_CACHE_VERSION);
    expect(cache.at).toBe("2026-08-10T00:00:00Z");
  });

  it("an EMPTY cache is authoritative — a cleared question list is not refilled from the legacy strings", () => {
    const cleared = { ...legacyInterview(), [KIT_AGENDA_CACHE_FIELD]: { version: 1, questions: [], at: null } };
    expect(kitAgendaQuestions(cleared)).toEqual([]);
  });

  it("demoting a whole kit is idempotent — a migrated kit re-saves as a no-op", () => {
    const kit = { interviews: [legacyInterview(), legacyInterview()] };
    const first = demoteKitAgendas(kit, "2026-08-10T00:00:00Z");
    expect(first.demoted).toBe(2);
    const second = demoteKitAgendas(first.doc, "2026-08-11T00:00:00Z");
    expect(second.demoted).toBe(0);
    expect(second.doc).toBe(first.doc);   // same object — nothing rewritten
    expect(readKitAgendaCache((second.doc.interviews as unknown[])[0]).at).toBe("2026-08-10T00:00:00Z");
  });

  it("loci ride the cache when the mint knew them — the way back to the source", () => {
    const demoted = demoteInterviewAgenda(legacyInterview(), { loci: ["el:attr:quote.status#valueSet"] });
    expect(readKitAgendaCache(demoted).loci).toEqual(["el:attr:quote.status#valueSet"]);
  });

  // The note is a PROVENANCE CLAIM — "the ledger's open unknowns are the source"
  // — and the loci are the only evidence for it. Written unconditionally, an
  // operator's own keystrokes in the kit studio (studios.tsx:161-169, which
  // demotes with `questions` and no `loci`) landed stamped as a rendering of the
  // ledger, with nothing anyone could check that against.
  it("the note and the loci travel together — a hand-typed question claims no ledger source", () => {
    const typed = demoteInterviewAgenda(legacyInterview(), { questions: ["Something the operator typed"] });
    const cache = (typed[KIT_AGENDA_CACHE_FIELD] ?? {}) as Record<string, unknown>;
    expect(cache.loci).toBeUndefined();
    expect(cache.note).toBeUndefined();            // no evidence ⇒ no claim
    expect(cache.questions).toEqual(["Something the operator typed"]);   // still cached
    expect(cache.version).toBe(KIT_AGENDA_CACHE_VERSION);
  });

  it("with loci, the note IS written — the claim stands where it is checkable", () => {
    const rendered = demoteInterviewAgenda(legacyInterview(), { loci: ["el:attr:quote.status#valueSet"] });
    const cache = (rendered[KIT_AGENDA_CACHE_FIELD] ?? {}) as Record<string, unknown>;
    expect(cache.note).toBe(KIT_AGENDA_CACHE_NOTE);
    expect(cache.loci).toEqual(["el:attr:quote.status#valueSet"]);
  });

  it("no reader depends on the note — dropping it changes nothing anyone reads", () => {
    const withNote = demoteInterviewAgenda(legacyInterview(), { loci: ["el:step:a#phase"], at: "2026-08-10T00:00:00Z" });
    const stripped = { ...withNote };
    const cache = { ...(stripped[KIT_AGENDA_CACHE_FIELD] as Record<string, unknown>) };
    delete cache.note;
    stripped[KIT_AGENDA_CACHE_FIELD] = cache;
    expect(readKitAgendaCache(stripped)).toEqual(readKitAgendaCache(withNote));
  });

  it("a non-interview / empty input is honest rather than throwing", () => {
    expect(readKitAgendaCache(null).origin).toBe("none");
    expect(readKitAgendaCache({ stakeholder: "X" }).origin).toBe("none");
    expect(kitAgendaQuestions(undefined)).toEqual([]);
  });
});

describe("BACKWARD COMPATIBLE: every reader gives the same answer for legacy and demoted", () => {
  const legacyKit = { interviews: [legacyInterview()] };
  const demotedKit = demoteKitAgendas(structuredClone(legacyKit), "2026-08-10T00:00:00Z").doc;

  it("Listen stakeholder cards carry the same questions", () => {
    const a = resolveMovementStakeholders(programme(legacyKit), "listen").find((c) => /Dana/.test(c.name));
    const b = resolveMovementStakeholders(programme(demotedKit), "listen").find((c) => /Dana/.test(c.name));
    expect(a?.questions).toEqual(b?.questions);
    expect(a?.questions).toContain(Q1);
  });

  it("the Listen meeting kit runs the same script", () => {
    const a = meetingKit(programme(legacyKit), "listen");
    const b = meetingKit(programme(demotedKit), "listen");
    expect(a?.questions).toEqual(b?.questions);
    expect(a?.questions).toEqual([Q1, Q2]);
  });

  it("a minted stakeholder link asks the same questions", () => {
    const packsOf = (kit: Record<string, unknown>) => {
      const blob = mintInterviewPacks(programme(kit), "op@x") as Record<string, unknown> | null;
      return ((blob?.flowInterviewPacks ?? []) as Array<Record<string, unknown>>).map((p) => p.questions);
    };
    expect(packsOf(legacyKit)).toEqual(packsOf(demotedKit));
    expect(packsOf(demotedKit)[0]).toEqual([Q1, Q2]);
  });
});
