/**
 * ACCEPTANCE — questions are locus+kind projections through ONE renderer.
 *
 *  · Three surfaces (kit projection / owner queue / burn-down drill) project the SAME
 *    set; counts equal; every question id resolves to an open ledger locus.
 *  · No truncation in any rendered string (the old wordSafe/slice artifacts are gone);
 *    a step question quotes the FULL action verbatim even though the element name is a
 *    60-char migration cut.
 *  · Entity names keep ORIGINAL casing; relations render plain language, never "→".
 *  · Kind-specific affordances; chip answer → attributed assertion → locus closes →
 *    burn-down moves → the projection regenerates without it. One set, end to end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue, buildKitView } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { renderQuestion, groupQuestions } from "@/v3/lib/ledger/renderQuestion";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = () => migrate({ ontology: snap("domain-ontology.json"), atlas: snap("current-state-atlas.json"), overrides: snap("operator-overrides.json") } as Snapshot);

const LONG_ACTION = "Review the pre-authorization request against the payer's clinical criteria and the surgeon's documented plan before scheduling can proceed";
const surgery: Snapshot = {
  ontology: {
    entities: [
      { name: "Anesthesia Record", area: "Anesthesiology", systemOfRecord: "EHR", attributes: ["type", "status"] },
      { name: "Case", area: "Surgical Operations", systemOfRecord: "EHR", attributes: ["priority"] },
    ],
    relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
  },
  atlas: {
    workflows: [{ name: "Pre-op Authorization", area: "Surgical Operations", owner: "Chief of Surgery", trigger: "case booked",
      steps: [{ action: LONG_ACTION, actor: "Pre-Auth Coordinator" }] }],
  },
  overrides: [],
};

const ARTIFACTS = [" the be ", " to pre be", " and u —", "…", "..."];

for (const [name, build] of [["Laila", laila], ["surgery", () => migrate(surgery)]] as const) {
  describe(`one renderer — ${name}`, () => {
    const store = build();
    const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");

    it("three surfaces, one set: kit === queue === drill; counts equal; ids resolve to open loci", () => {
      const kit = projectKitQuestions(store);
      const queueRendered = open.map((i) => renderQuestion(store, i.about, "operator"));
      expect(new Set(kit.map((k) => k.about))).toEqual(new Set(open.map((i) => i.about)));
      expect(kit.length).toBe(open.length);
      expect(queueRendered.length).toBe(open.length);
      const openSet = new Set(open.map((i) => i.about));
      for (const k of kit) expect(openSet.has(k.about)).toBe(true);
    });

    it("no truncation artifacts in ANY rendered question, either audience", () => {
      for (const i of open) {
        for (const audience of ["stakeholder", "operator"] as const) {
          const q = renderQuestion(store, i.about, audience).question;
          for (const bad of ARTIFACTS) expect(q.includes(bad), `"${q}" contains "${bad}"`).toBe(false);
          expect(q.includes("→"), `arrow notation in "${q}"`).toBe(false);
          expect(q.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });
}

describe("rendering rules — full data, verbatim quoting, casing, plain relations", () => {
  const store = migrate(surgery);
  const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");

  it("a step question quotes the FULL action verbatim (element name is a 60-char cut — must be recovered)", () => {
    const disp = open.find((i) => i.slot === "automationDisposition")!;
    const q = renderQuestion(store, disp.about, "stakeholder").question;
    expect(q).toContain(`"${LONG_ACTION}."`);                      // the whole thing, quoted
    expect(q).toContain("One step in your process is:");
    expect(q).toContain("Should this be automated, assisted, or stay manual?");
    // operator audience: same deterministic text, third person
    expect(renderQuestion(store, disp.about, "operator").question).toContain("One step in the process is:");
  });

  it("entity names keep ORIGINAL casing — never lowercased mid-template", () => {
    const rel = open.find((i) => i.about.startsWith("el:rel") && i.slot === "optionality")!;
    const q = renderQuestion(store, rel.about, "stakeholder").question;
    expect(q).toContain("Case");
    expect(q).toContain("Anesthesia Record");   // FHIR-derived name survives, cased as sourced
    expect(q.includes("anesthesia record")).toBe(false);
  });

  it("relations render plain language, never arrow notation", () => {
    const rel = open.find((i) => i.about.startsWith("el:rel"))!;
    const q = renderQuestion(store, rel.about, "stakeholder").question;
    expect(q.includes("→")).toBe(false);
    expect(q.includes("Case")).toBe(true);
  });

  it("kind-specific affordances + plain labels", () => {
    const byKind = (k: string) => open.find((i) => i.slot === k);
    const disp = renderQuestion(store, byKind("automationDisposition")!.about, "stakeholder");
    expect(disp.affordance).toEqual({ kind: "chips", options: ["Automate", "Assist", "Keep manual"], whyOptional: true });
    expect(disp.label).toBe("Automate this?");
    const phase = renderQuestion(store, byKind("phase")!.about, "stakeholder");
    expect(phase.affordance.kind).toBe("phase-picker");
    expect(phase.label).toBe("When it happens");   // was "Which phase" — methodology word, on a client's page
    const actor = renderQuestion(store, byKind("actorRole")!.about, "stakeholder");
    expect(actor.affordance).toEqual({ kind: "role-picker", freeText: true });
    expect(actor.label).toBe("Who does this");
  });

  it("stakeholder grouping: one step card, its unknowns as sub-questions, unit stays QUESTIONS", () => {
    const stepAbouts = open.filter((i) => i.about.startsWith("el:step")).map((i) => i.about);
    const groups = groupQuestions(store, stepAbouts, "stakeholder");
    expect(groups).toHaveLength(1);                       // one card for the one step
    expect(groups[0].header).toBe(LONG_ACTION);           // full action as the header
    expect(groups[0].count).toBe(groups[0].questions.length);
    expect(groups[0].count).toBeGreaterThan(1);           // its unknowns as sub-questions
  });
});

/**
 * The meaning question carries the RIVAL READINGS — the half this template used to drop.
 *
 * A terminology collision reached the record as a plain string composed in
 * flowShellData ("Two teams use X differently (…)"), a second producer whose answer
 * closed nothing. It is a `#semantics` locus now, with the readings beside it as
 * `semantics.reading.*` claims. If this template ignored them the migrated question
 * would be WEAKER than the string it replaced, so both halves are pinned here: named
 * when the ledger holds them, and never invented when it does not.
 */
describe("meaning questions name the readings the LEDGER holds — and invent none", () => {
  const collided: Snapshot = {
    ontology: {
      entities: [
        { name: "Case", area: "Surgical Operations", attributes: ["priority"] },
        { name: "Anesthesia Record", area: "Anesthesiology" },
      ],
      ambiguities: [
        { term: "Case", conflictingMeanings: ["a surgical booking", "a billing episode"], resolution: "unresolved" },
        { term: "Anesthesia Record", conflictingMeanings: ["the intra-op chart"], resolution: "unresolved" },
        { term: "Chart", conflictingMeanings: [], resolution: "unresolved" },
      ],
    },
    atlas: {}, overrides: [],
  };
  const store = migrate(collided);

  it("two recorded readings → BOTH are named, verbatim, inside the one question", () => {
    const q = renderQuestion(store, "el:entity:case#semantics", "stakeholder").question;
    expect(q).toContain("What does Case mean, exactly?");            // the plain ask survives
    expect(q).toContain("a surgical booking");
    expect(q).toContain("a billing episode");
    expect(q).toContain("which meaning should it adopt?");
    // operator audience is the SAME deterministic text — readings are data, not tone
    expect(renderQuestion(store, "el:entity:case#semantics", "operator").question).toBe(q);
  });

  it("ONE recorded reading is not a collision — the plain ask, with no invented rival", () => {
    const q = renderQuestion(store, "el:entity:anesthesia-record#semantics", "stakeholder").question;
    expect(q).toBe("What does Anesthesia Record mean, exactly?");
  });

  it("a term with NO recorded meanings still asks honestly — nothing is fabricated to fill the template", () => {
    // "Chart" names no entity, so the collision hangs on its own `el:term:` element
    // instead of being dropped — but the ledger records no readings for it, and none
    // are supplied.
    const q = renderQuestion(store, "el:term:chart#semantics", "stakeholder").question;
    expect(q).toBe("What does Chart mean, exactly?");
    expect(q).not.toContain("ways —");
  });
});

describe("end to end — a chip answer closes the locus, burn-down moves, projection regenerates", () => {
  it("chip → attributed assertion → closed → count-1 → gone from the kit", () => {
    const store = migrate(surgery);
    const before = projectKitQuestions(store);
    const target = before.find((k) => k.slot === "automationDisposition")!;
    const bdBefore = buildKitView(store).burnDown;
    // the one-tap chip answer IS an attributed assertion
    store.assert({
      about: target.about, value: { kind: "scalar", value: "assist" },
      world: "to-be", layer: "configuration", source: "asserted", ownerWhileOpen: { kind: "unowned" },
      status: "closed", closedBy: { method: "assertion", by: "stakeholder:pre-auth-coordinator", verbatim: "Assist" },
    });
    const after = projectKitQuestions(store);
    expect(after.length).toBe(before.length - 1);
    expect(after.some((k) => k.about === target.about)).toBe(false);   // kit regenerated without it
    const bdAfter = buildKitView(store).burnDown;
    expect(bdAfter.closed).toBe(bdBefore.closed + 1);                  // burn-down moved (real closure)
    expect(bdAfter.open).toBe(bdBefore.open - 1);
  });
});
