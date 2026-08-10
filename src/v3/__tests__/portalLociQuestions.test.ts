/**
 * ACCEPTANCE — the stakeholder LINKED PAGE drinks from the one question renderer.
 *
 * The linked page was the last question producer off the single-source renderer:
 * its pack carried stored question STRINGS from the generated kit agenda, so a
 * stakeholder could read phrasing no ledger locus backs and answering closed
 * nothing (docs/aura/one-question-renderer.md § Gated/findings).
 *
 *  1. A pack that carries LOCI renders the IDENTICAL question text the operator
 *     side shows for the same locus — one set, two audiences.
 *  2. A legacy string-only pack still renders, unchanged — additive, backward
 *     compatible; and a pack whose loci this store can't resolve degrades to its
 *     stored strings rather than dropping the ask.
 *  3. Counts match: the unit stays QUESTIONS (rendered rows + leftover strings),
 *     and every rendered row resolves to a real OPEN locus in the queue.
 *  4. An answer is attributed: the composed block names the exact locus, and
 *     reading it back yields locus → answer. (The stakeholder ledger WRITE path
 *     is gated — see docs/aura/stakeholder-linked-page-loci.md — so this proves
 *     attribution through the existing capture channel, NOT a closure.)
 *  5. The mint path is additive: no loci in ⇒ no `questionLoci` on the pack.
 *
 * Verified on real Laila AND a synthetic surgery domain (as kitProjection does).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { renderQuestion, affordanceOptions } from "@/v3/lib/ledger/renderQuestion";
import {
  portalQuestionModel, composeLocusAnswers, parseLocusAnswers, answeredLocusCount,
} from "@/v3/components/flow/portalQuestionModel";
import { mintFollowUpPack, listInterviewPacks } from "@/v3/components/flow/flowPortal";
import type { ProgramSummary } from "@/new/types";

const lailaSnap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const laila = () => migrate({ ontology: lailaSnap("domain-ontology.json"), atlas: lailaSnap("current-state-atlas.json"), overrides: lailaSnap("operator-overrides.json") } as Snapshot);

const surgery: Snapshot = {
  ontology: {
    entities: [
      { name: "Case", area: "Surgical Operations", attributes: ["status", "priority"] },
      { name: "Anesthesia Record", area: "Anesthesiology", attributes: ["type"] },
    ],
    relations: [{ from: "Case", to: "Anesthesia Record", relation: "requires", cardinality: "1:1" }],
  },
  atlas: {
    workflows: [
      { name: "Case Cancellation Review", area: "Surgical Operations", trigger: "cancel requested",
        steps: [{ action: "Decide whether to reschedule or cancel", actor: "Surgeon" }] },
    ],
  },
  overrides: [],
};

for (const [name, build] of [["Laila", laila], ["surgery", () => migrate(surgery)]] as const) {
  describe(`stakeholder linked page — locus-backed questions (${name})`, () => {
    const store = build();
    const open = buildUnknownQueue(store).items.filter((i) => i.status === "open");
    const loci = open.slice(0, 8).map((i) => i.about);
    // A pack as the operator mints it: the loci, plus the text rendered AT MINT.
    const pack = {
      questions: loci.map((about) => renderQuestion(store, about, "stakeholder").question),
      questionLoci: loci,
    };

    it("1 — a locus renders the SAME text on the linked page as on the operator side", () => {
      const model = portalQuestionModel(pack, store);
      expect(model.mode).toBe("loci");
      const byAbout = new Map(model.rows.map((r) => [r.about, r]));
      // The kit projection IS the operator queue's phrasing (kitProjection.ts).
      const kit = new Map(projectKitQuestions(store).map((k) => [k.about, k]));
      for (const about of loci) {
        const row = byAbout.get(about);
        expect(row, `locus ${about} rendered`).toBeTruthy();
        // one producer: page === renderQuestion === kit projection
        expect(row!.rendered.question).toBe(renderQuestion(store, about, "stakeholder").question);
        expect(row!.rendered.question).toBe(kit.get(about)!.question);
        // and the affordance the page draws is the one the renderer carries
        expect(row!.rendered.affordance).toEqual(kit.get(about)!.affordance);
      }
    });

    it("2 — every rendered row closes a real OPEN locus (no question that closes nothing)", () => {
      const model = portalQuestionModel(pack, store);
      const openAbouts = new Set(open.map((i) => i.about));
      for (const row of model.rows) {
        expect(row.about).toContain("#");
        expect(openAbouts.has(row.about)).toBe(true);
      }
    });

    it("3 — counts match: rows + leftover strings === the questions the pack carries", () => {
      const model = portalQuestionModel(pack, store);
      expect(model.count).toBe(pack.questions.length);
      expect(model.rows.length + model.strings.length).toBe(model.count);
      // grouped per ELEMENT, and the group counts add back up to the rows
      expect(model.groups.reduce((n, g) => n + g.count, 0)).toBe(model.rows.length);
      for (const g of model.groups) expect(g.rows.length).toBe(g.count);
    });

    it("4 — an answer is attributed to the locus it answers (capture channel, not a closure)", () => {
      const model = portalQuestionModel(pack, store);
      const target = model.rows[0];
      const answers = { [target.about]: "Automate" };
      const whys = { [target.about]: "we already have the data" };
      const block = composeLocusAnswers(model.rows, answers, whys);
      expect(block).toContain(target.rendered.question);
      expect(block).toContain(`[locus: ${target.about}]`);
      const parsed = parseLocusAnswers(block);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].about).toBe(target.about);
      expect(parsed[0].answer).toBe("Automate");
      expect(parsed[0].why).toBe("we already have the data");
      expect(answeredLocusCount(model.rows, answers)).toBe(1);
      // The burn-down did NOT move: a page answer is captured, never self-closing.
      expect(buildUnknownQueue(store).items.filter((i) => i.status === "open").length).toBe(open.length);
    });

    it("5 — picker options are the ledger's own values, or empty (never invented)", () => {
      for (const kind of ["phase", "actorRole"]) {
        const values = new Set(affordanceOptions(store, kind));
        const live = new Set(store.claims()
          .filter((c) => !c.supersededBy && c.value.kind === "scalar" && c.about.endsWith(`#${kind}`))
          .map((c) => String((c.value as { value: unknown }).value).trim()));
        for (const v of values) expect(live.has(v)).toBe(true);
      }
    });
  });
}

describe("backward compatibility — a legacy string-only pack is untouched", () => {
  const store = laila();

  it("no loci ⇒ strings mode, every stored question rendered, indices preserved", () => {
    const questions = ["How long does a renewal take?", "Who signs off on pricing?"];
    const model = portalQuestionModel({ questions }, store);
    expect(model.mode).toBe("strings");
    expect(model.rows).toHaveLength(0);
    expect(model.groups).toHaveLength(0);
    expect(model.strings.map((s) => s.question)).toEqual(questions);
    expect(model.strings.map((s) => s.index)).toEqual([0, 1]);
    expect(model.count).toBe(2);
  });

  it("no store (an old edge, no live artifacts) ⇒ strings mode even WITH loci", () => {
    const model = portalQuestionModel({ questions: ["Q"], questionLoci: ["el:step:x#phase"] }, null);
    expect(model.mode).toBe("strings");
    expect(model.strings.map((s) => s.question)).toEqual(["Q"]);
  });

  it("a locus this store cannot resolve keeps its stored ask — nothing is dropped", () => {
    const real = buildUnknownQueue(store).items.find((i) => i.status === "open")!.about;
    const model = portalQuestionModel({
      questions: ["real one", "the model moved on"],
      questionLoci: [real, "el:entity:no-such-thing#semantics"],
    }, store);
    expect(model.mode).toBe("loci");
    expect(model.rows.map((r) => r.about)).toEqual([real]);
    expect(model.strings.map((s) => s.question)).toEqual(["the model moved on"]);
    expect(model.strings.map((s) => s.index)).toEqual([1]);   // its ORIGINAL index survives
    expect(model.count).toBe(2);                              // unit stays QUESTIONS
  });

  it("the stored string is kept beside the locus — it is what was ASKED", () => {
    const real = buildUnknownQueue(store).items.find((i) => i.status === "open")!.about;
    const model = portalQuestionModel({ questions: ["as we asked it in March"], questionLoci: [real] }, store);
    expect(model.rows[0].stored).toBe("as we asked it in March");
    expect(model.rows[0].rendered.question).not.toBe("as we asked it in March");
  });
});

describe("mint — loci ride the pack additively", () => {
  const program = (packs: unknown[] = []): ProgramSummary =>
    ({ id: "p1", name: "P", rawData: { data: { flowInterviewPacks: packs } } } as unknown as ProgramSummary);

  it("no loci in ⇒ no questionLoci on the pack (byte-identical to before)", () => {
    const blob = mintFollowUpPack(program(), { movementId: "listen", who: "Ada", questions: ["Q1"], captureField: "x" }, "you")!;
    const packs = (blob.data as Record<string, unknown>).flowInterviewPacks as Array<Record<string, unknown>>;
    expect("questionLoci" in packs[0]).toBe(true);        // set, but…
    expect(packs[0].questionLoci).toBeUndefined();        // …undefined ⇒ dropped on serialise
    expect(JSON.parse(JSON.stringify(packs[0]))).not.toHaveProperty("questionLoci");
  });

  it("loci in ⇒ stored index-aligned with the questions, and read back by the reader", () => {
    const blob = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x",
      questions: ["Q1", "Q2"], loci: ["el:step:a#automationDisposition", "el:attr:b.c#valueSet"],
    }, "you")!;
    const read = listInterviewPacks({ rawData: blob } as unknown as ProgramSummary);
    expect(read[0].questionLoci).toEqual(["el:step:a#automationDisposition", "el:attr:b.c#valueSet"]);
    expect(read[0].questions).toEqual(["Q1", "Q2"]);
  });

  it("the 8-question cap trims BOTH arrays together — a locus never drifts off its question", () => {
    const blob = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x",
      questions: Array.from({ length: 12 }, (_, i) => `Q${i}`),
      loci: Array.from({ length: 12 }, (_, i) => `el:step:s${i}#phase`),
    }, "you")!;
    const read = listInterviewPacks({ rawData: blob } as unknown as ProgramSummary);
    expect(read[0].questions).toHaveLength(8);
    expect(read[0].questionLoci).toHaveLength(8);
    expect(read[0].questionLoci![7]).toBe("el:step:s7#phase");
  });

  it("a later loci-less ask CLEARS the old loci — never left pointing at new questions", () => {
    const first = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x", questions: ["Q1"], loci: ["el:step:a#phase"],
    }, "you")!;
    const firstPacks = (first.data as Record<string, unknown>).flowInterviewPacks as unknown[];
    const second = mintFollowUpPack(program(firstPacks), {
      movementId: "listen", who: "Ada", captureField: "x", questions: ["A totally different ask"],
    }, "you")!;
    const read = listInterviewPacks({ rawData: second } as unknown as ProgramSummary);
    expect(read[0].questionLoci).toBeUndefined();
    expect(read[0].questions).toEqual(["A totally different ask"]);
  });

  it("re-sending the identical loci is idempotent — the standing link is reused", () => {
    const first = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x", questions: ["Q1"], loci: ["el:step:a#phase"],
    }, "you")!;
    const firstPacks = (first.data as Record<string, unknown>).flowInterviewPacks as unknown[];
    expect(mintFollowUpPack(program(firstPacks), {
      movementId: "listen", who: "Ada", captureField: "x", questions: ["Q1"], loci: ["el:step:a#phase"],
    }, "you")).toBeNull();
  });
});
