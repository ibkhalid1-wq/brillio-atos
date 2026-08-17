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
  portalQuestionModel, composeLocusAnswers, answeredLocusCount,
} from "@/v3/components/flow/portalQuestionModel";
import { deriveStakeholderAnswers } from "@/v3/lib/ledger/stakeholderAnswers";
import { mintFollowUpPack, mintReviewPack, listInterviewPacks } from "@/v3/components/flow/flowPortal";
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

/**
 * Read a composed block the way the product does. `parseLocusAnswers` used to
 * stand in here — a parser with no production caller, deleted 2026-08-17. The
 * real reader is `deriveStakeholderAnswers`, which walks the programme's own
 * evidence, so the round-trip below now proves the thing that actually runs
 * rather than a parallel implementation of it.
 */
const readBack = (block: string) => deriveStakeholderAnswers({
  id: "p", name: "n",
  rawData: { data: { phaseInputs: { listen: { conv: `— Priya Raman, Marketing lead, 2026-08-17 —\n${block}` } } } },
} as never);

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

    it("3 — counts match: `count` is the locus-backed rows, `unbacked` the leftovers", () => {
      const model = portalQuestionModel(pack, store);
      // `count` is what an answer can be ATTRIBUTED to — never the sum.
      expect(model.count).toBe(model.rows.length);
      expect(model.unbacked).toBe(model.strings.length);
      // nothing is lost: the two figures still account for every question asked
      expect(model.count + model.unbacked).toBe(pack.questions.length);
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
      const parsed = readBack(block);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].about).toBe(target.about);
      expect(parsed[0].answer).toBe("Automate");
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
    // No locus cards for these to sit beside — the whole page is one list, so
    // there is no second figure to report and nothing to be folded into.
    expect(model.unbacked).toBe(0);
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
    expect(model.count).toBe(1);        // ONE question can be answered into a point…
    expect(model.unbacked).toBe(1);     // …and the drifted one is reported as such
  });

  it("the stored string is kept beside the locus — it is what was ASKED", () => {
    const real = buildUnknownQueue(store).items.find((i) => i.status === "open")!.about;
    const model = portalQuestionModel({ questions: ["as we asked it in March"], questionLoci: [real] }, store);
    expect(model.rows[0].stored).toBe("as we asked it in March");
    expect(model.rows[0].rendered.question).not.toBe("as we asked it in March");
  });
});

/**
 * REGRESSION — an unbacked question is never counted as an actionable one.
 *
 * A pack's loci are frozen at mint; regenerating the ontology/atlas renames an
 * entity and its slug-based id changes (migrate.ts:110-111,146,158,204), so the
 * still-durable link holds loci this store cannot resolve. Those asks fall
 * through to `strings` and render BESIDE the locus cards — but an answer typed
 * into one composes as a bare `Q:/A:` block with no `[locus: …]` tag, so ingest
 * cannot attribute it and it closes nothing.
 *
 * `count` used to be `rows + leftover`, so the header told the stakeholder "8
 * questions" when only 2 of them could settle anything. That is a fabricated
 * figure by omission — the miss has to stay VISIBLE as its own number.
 */
describe("an unbacked question is reported as unbacked, never folded into the total", () => {
  const store = laila();
  const realLocus = () => buildUnknownQueue(store).items.find((i) => i.status === "open")!.about;

  it("count is the locus-backed rows ONLY; the drifted asks travel as `unbacked`", () => {
    const real = realLocus();
    const model = portalQuestionModel({
      questions: ["backed", "renamed away A", "renamed away B", "renamed away C"],
      questionLoci: [real, "el:entity:gone-a#semantics", "el:step:gone-b#phase", "el:attr:gone.c#valueSet"],
    }, store);
    expect(model.mode).toBe("loci");
    expect(model.count).toBe(1);                       // NOT 4 — one point can be settled
    expect(model.unbacked).toBe(3);                    // and three are visibly unsettleable
    expect(model.count).not.toBe(model.rows.length + model.strings.length);
    expect(model.strings).toHaveLength(3);             // still asked — nothing is dropped
  });

  it("the two figures are exactly the answers that CAN and CANNOT be attributed", () => {
    const real = realLocus();
    const model = portalQuestionModel({
      questions: ["backed", "drifted"], questionLoci: [real, "el:entity:gone#semantics"],
    }, store);
    // Everything `count` covers composes WITH a locus tag…
    const block = composeLocusAnswers(model.rows, { [real]: "Ops owns it" });
    expect(readBack(block).map((a) => a.about)).toEqual([real]);
    expect(readBack(block)).toHaveLength(model.count);
    // …and nothing `unbacked` covers can be parsed back to a locus at all: the
    // string rows compose as bare Q:/A: (FlowRespond.tsx), which the ingest
    // side yields nothing for — no tag, no address, no closure.
    const bare = `Q: ${model.strings[0].question}\nA: whatever they typed`;
    expect(readBack(bare)).toEqual([]);
    expect(model.unbacked).toBe(1);
  });

  it("a pack whose loci ALL drifted is not reported as a page full of answerable points", () => {
    // Every locus gone ⇒ nothing renders through the renderer, so the page falls
    // back to strings mode and its count is the plain list — there are no locus
    // cards for a second figure to disagree with.
    const model = portalQuestionModel({
      questions: ["q1", "q2"], questionLoci: ["el:step:gone-1#phase", "el:step:gone-2#phase"],
    }, store);
    expect(model.mode).toBe("strings");
    expect(model.rows).toHaveLength(0);
    expect(model.count).toBe(2);
    expect(model.unbacked).toBe(0);
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

  it("a BLANK question is dropped from both arrays together — later loci don't shift", () => {
    // A stored pack whose question list carries a blank (an empty agenda string
    // that reached the blob). The reader drops the blank; the contract on
    // `questionLoci` says index alignment survives, so Q2 must keep ITS locus
    // rather than inheriting the dropped row's.
    const read = listInterviewPacks({ rawData: { data: { flowInterviewPacks: [{
      id: "pack-1", token: "t1", stakeholder: "Ada", role: "Ops", createdAt: "2026-01-01T00:00:00.000Z",
      questions: ["Q0", "", "Q2"],
      questionLoci: ["el:step:a#phase", "el:step:blank#phase", "el:step:c#phase"],
    }] } } } as unknown as ProgramSummary);
    expect(read[0].questions).toEqual(["Q0", "Q2"]);
    expect(read[0].questionLoci).toEqual(["el:step:a#phase", "el:step:c#phase"]);
    expect(read[0].questions).toHaveLength(read[0].questionLoci!.length);
  });

  it("a short loci array pads rather than shifting — a question never borrows a neighbour's locus", () => {
    const read = listInterviewPacks({ rawData: { data: { flowInterviewPacks: [{
      id: "pack-2", token: "t2", stakeholder: "Ada", role: "Ops", createdAt: "2026-01-01T00:00:00.000Z",
      questions: ["Q0", "Q1"], questionLoci: ["el:step:a#phase"],
    }] } } } as unknown as ProgramSummary);
    expect(read[0].questionLoci).toEqual(["el:step:a#phase", ""]);   // "" ⇒ falls back to the stored string
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

  /**
   * REGRESSION — a SCRIPTED ask says it is one.
   *
   * `TheLine.tsx:689-692`: a person the ledger owns no loci for still gets a link,
   * falling back to their generated kit script. Every question then carries
   * `about: ""`, which forces `portalQuestionModel` into `mode: "strings"` — and
   * their page rendered IDENTICALLY to a locus-backed one while no answer on it
   * could be attributed to any point in the model.
   */
  it("a scripted ask (no owned loci) is MARKED, and the mark reads back", () => {
    const blob = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x",
      questions: ["From their kit script"], loci: [""], scripted: true,
    }, "you")!;
    const packs = (blob.data as Record<string, unknown>).flowInterviewPacks as Array<Record<string, unknown>>;
    expect(packs[0].scripted).toBe(true);
    expect(JSON.parse(JSON.stringify(packs[0])).scripted).toBe(true);   // survives serialise
    const read = listInterviewPacks({ rawData: blob } as unknown as ProgramSummary);
    expect(read[0].scripted).toBe(true);
    // and it IS the strings-mode page — the two facts are one situation
    expect(portalQuestionModel(read[0], laila()).mode).toBe("strings");
  });

  it("a locus-backed ask carries NO mark — absence is the honest default", () => {
    const blob = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x",
      questions: ["Q1"], loci: ["el:step:a#phase"],
    }, "you")!;
    const packs = (blob.data as Record<string, unknown>).flowInterviewPacks as Array<Record<string, unknown>>;
    expect(JSON.parse(JSON.stringify(packs[0]))).not.toHaveProperty("scripted");
    expect(listInterviewPacks({ rawData: blob } as unknown as ProgramSummary)[0].scripted).toBeUndefined();
  });

  it("a later locus-backed ask CLEARS the mark — the page never calls open unknowns a script", () => {
    const first = mintFollowUpPack(program(), {
      movementId: "listen", who: "Ada", captureField: "x", questions: ["Script q"], scripted: true,
    }, "you")!;
    const firstPacks = (first.data as Record<string, unknown>).flowInterviewPacks as unknown[];
    const second = mintFollowUpPack(program(firstPacks), {
      movementId: "listen", who: "Ada", captureField: "x",
      questions: ["A real open point"], loci: ["el:step:a#phase"],
    }, "you")!;
    const read = listInterviewPacks({ rawData: second } as unknown as ProgramSummary);
    expect(read[0].scripted).toBeUndefined();
    expect(read[0].questionLoci).toEqual(["el:step:a#phase"]);
  });

  // The flag is only worth minting if it reaches the reader and is SAID. The
  // Deno boundary blocks a shared import, so the edge half is text-parsed (the
  // edgeLockstep idiom, as answerCapLockstep.test.ts does for the answer cap).
  it("the mark is DERIVED at the one place that knows — the ledger owned nothing", () => {
    const theLine = readFileSync(resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8");
    // Derived from the owned-loci fallback itself, never a hand-set literal, so
    // the flag cannot drift away from the condition it reports.
    expect(theLine).toMatch(/const scripted = !owned\.length;/);
    expect(theLine).toMatch(/\.\.\.\(scripted \? \{ scripted: true \} : \{\}\)/);
  });

  it("the mark is forwarded by the edge and STATED on the page", () => {
    const edge = readFileSync(resolve(__dirname, "../../../supabase/functions/flow-portal/index.ts"), "utf8");
    expect(edge).toMatch(/hit\.pack\.scripted === true \? \{ scripted: true \}/);
    const page = readFileSync(resolve(__dirname, "../components/flow/FlowRespond.tsx"), "utf8");
    expect(page).toMatch(/state\.pack\.scripted \?/);          // the page branches on it…
    expect(page).toMatch(/prepared questions/);                 // …and says what it means
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

/**
 * REGRESSION — the REVIEW path can carry loci at all.
 *
 * `mintReviewPack` has accepted `loci` since the loci landed, and the edge
 * pass-through is pack-kind-agnostic (`flow-portal/index.ts:526`), but the React
 * hops that reach it declared `questions` and no `loci`. A field a prop type does
 * not name cannot be passed through it: every review link was structurally
 * incapable of carrying a locus, whatever the caller held. That is a HALF-WIRE,
 * and it is invisible at runtime because the mint on the far side looks complete.
 *
 * Both mints write the SAME `questionLoci` field on the SAME durable pack, so the
 * two hops have to declare the same field or the paths silently drift. Pinned by
 * text-parse (the `edgeLockstep` idiom used above for `scripted`) because the gap
 * is in a TYPE — tsc is the only other thing that would see it, and it stays
 * quiet about a field nobody passes.
 */
describe("the review path is wired for loci exactly as the follow-up path is", () => {
  const hops: Array<[string, string]> = [
    ["../components/flow/FlowShell.tsx", "onMintReview"],
    ["../components/flow/CollectBoard.tsx", "onMintReview"],
  ];
  // `onMintReview?: (input: { … })` — the inline input type of each declaration.
  const inputTypesOf = (source: string, prop: string): string[] =>
    [...source.matchAll(new RegExp(`${prop}\\??: \\(input: \\{([^}]*)\\}`, "g"))].map((m) => m[1]);

  it("every hop that reaches mintReviewPack declares `loci?: string[]`", () => {
    for (const [file, prop] of hops) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const declared = inputTypesOf(source, prop);
      expect(declared.length).toBeGreaterThan(0);            // the hop exists to be checked
      for (const input of declared) expect(input).toContain("loci?: string[]");
    }
  });

  it("it MIRRORS the follow-up hop — same name, same optionality, same placement", () => {
    for (const [file] of hops) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const followUp = inputTypesOf(source, "onMintFollowUp");
      const review = inputTypesOf(source, "onMintReview");
      expect(followUp.length).toBe(review.length);           // the paths stay in lockstep
      for (const input of [...followUp, ...review]) {
        // trailing, after `unnamed?`, in both — so a reader comparing the two
        // sees one shape rather than two conventions.
        expect(input).toMatch(/unnamed\?: boolean; loci\?: string\[\]/);
      }
    }
  });

  it("loci in ⇒ stored index-aligned on the REVIEW pack, read back by the same reader", () => {
    const program = ({ id: "p1", name: "P", rawData: { data: { flowInterviewPacks: [] } } } as unknown as ProgramSummary);
    const blob = mintReviewPack(program, {
      movementId: "listen", who: "Ada", role: "Ops", captureField: "x",
      reviewKind: "listen-workflow", review: { kind: "listen-workflow" }, intro: "hello",
      questions: ["Q1", "Q2"], loci: ["el:step:a#automationDisposition", "el:attr:b.c#valueSet"],
    }, "you")!;
    const read = listInterviewPacks({ rawData: blob } as unknown as ProgramSummary);
    expect(read[0].questions).toEqual(["Q1", "Q2"]);
    expect(read[0].questionLoci).toEqual(["el:step:a#automationDisposition", "el:attr:b.c#valueSet"]);
  });

  /**
   * NOT fabricated. Neither review call site has a locus to pass: `CollectBoard`
   * imports no ledger module, and its `linkQuestions` are operator asks plus the
   * kit script — plain strings with no point in the model behind them. The wire
   * is now there; the miss stays VISIBLE as an absent field rather than being
   * filled with a synthesised locus that would mis-attribute an answer.
   */
  it("a review mint with no loci is byte-identical to before — absence is the honest state", () => {
    const program = ({ id: "p1", name: "P", rawData: { data: { flowInterviewPacks: [] } } } as unknown as ProgramSummary);
    const blob = mintReviewPack(program, {
      movementId: "listen", who: "Ada", role: "Ops", captureField: "x",
      reviewKind: "listen-workflow", review: { kind: "listen-workflow" }, intro: "hello",
      questions: ["Q1"],
    }, "you")!;
    const packs = (blob.data as Record<string, unknown>).flowInterviewPacks as Array<Record<string, unknown>>;
    expect("questionLoci" in packs[0]).toBe(true);        // always SET, as on the follow-up…
    expect(packs[0].questionLoci).toBeUndefined();        // …undefined ⇒ dropped on serialise
    expect(JSON.parse(JSON.stringify(packs[0]))).not.toHaveProperty("questionLoci");
    // and the call sites pass none, because they hold none.
    const board = readFileSync(resolve(__dirname, "../components/flow/CollectBoard.tsx"), "utf8");
    expect(board).not.toMatch(/onMintReview\(\{[^}]*loci:/s);
  });
});
