/**
 * THE QUESTION WHOSE ANSWER CHANGES A SCREEN (2026-08-16).
 *
 * A relation's cardinality decides what the prototype draws: a list, a set of
 * chips, or a link. The provisional ontology writes the STRING "unknown" on
 * every relation deliberately — cardinality is precisely what interviews
 * confirm — and `migrate` read `if (r.cardinality)`, so that truthy string
 * filled the slot with a WEAK claim whose value was the word "unknown". The
 * ledger recorded "we know: the answer is unknown", the locus never reached the
 * unknown queue, and the one question worth asking was the one never asked.
 * `optionality`, opened on the very next line, is why its questions did appear.
 *
 * Nothing else needed changing: the queue is slot-agnostic, `renderQuestion`
 * already phrases relations in plain language, and `SLOT_INTENT` already knew
 * the slot. No frozen-core (`projections.ts`) edit — the defect was one writer
 * branch treating an absent answer as a present one.
 */
import { describe, it, expect } from "vitest";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { projectKitQuestions } from "@/v3/lib/ledger/kitProjection";
import { slotOf } from "@/v3/lib/ledger/types";
import { renderQuestion } from "@/v3/lib/ledger/renderQuestion";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** A provisional CRM chain as the generators actually emit it: every relation
 *  "unknown", most carrying the standard's prior alongside. */
const provisional: Snapshot = {
  ontology: {
    entities: [
      { name: "Campaign", area: "Marketing", attributes: ["campaignName"] },
      { name: "Lead", area: "Sales", attributes: ["leadName"] },
      { name: "Opportunity", area: "Sales", attributes: ["opportunityName"] },
      { name: "Account", area: "Sales", attributes: ["accountName"] },
    ],
    relations: [
      { from: "Campaign", to: "Lead", relation: "produces", cardinality: "unknown", standardPrior: "1:N" },
      { from: "Lead", to: "Opportunity", relation: "leads to", cardinality: "unknown", standardPrior: "N:1" },
      { from: "Opportunity", to: "Account", relation: "applies to", cardinality: "unknown" },
      // …and one the team HAS answered: it must stay answered.
      { from: "Account", to: "Campaign", relation: "participates in", cardinality: "N:M" },
    ],
  },
  atlas: { workflows: [] },
  overrides: [],
} as Snapshot;

const store = migrate(provisional);
const cardinalityLoci = buildUnknownQueue(store).items.filter((i) => i.slot === "cardinality");

describe("an unconfirmed cardinality is an open question, not a settled 'unknown'", () => {
  it("every unknown-cardinality relation reaches the unknown queue", () => {
    expect(cardinalityLoci).toHaveLength(3);          // the three "unknown" ones
    expect(cardinalityLoci.every((i) => i.status === "open")).toBe(true);
  });

  it("a cardinality the team DID state stays stated — it is not re-asked", () => {
    const asked = cardinalityLoci.map((i) => i.about).join(" ");
    expect(asked).not.toMatch(/account-campaign/);
  });

  it("the prior does NOT ride along as a claim — it would supersede the question it grounds", () => {
    // store.assert: a substantive value supersedes an open unknown on the same
    // locus. A prior written as a claim would silently close the very question
    // it is evidence for. It shapes the prototype; the ledger keeps asking.
    const about = cardinalityLoci.find((i) => i.about.includes("campaign-lead"))!.about;
    const live = store.liveClaimsAbout(about);
    expect(live).toHaveLength(1);
    expect(live[0].value.kind).toBe("unknown");
    expect(live[0].status).toBe("open");
  });
});

describe("it reaches the stakeholder as a plain-language question", () => {
  const kit = projectKitQuestions(store).filter((k) => slotOf(k.about) === "cardinality");

  it("one question per unconfirmed relation, phrased in the business's own nouns", () => {
    expect(kit).toHaveLength(3);
    const campaignLead = kit.find((k) => k.about.includes("campaign-lead"))!;
    expect(campaignLead.question).toBe("Can one Campaign have many Lead, or just one?");
  });

  it("and never in methodology vocabulary — the prompt's own ban, enforced on the rendering", () => {
    for (const k of kit) {
      expect(k.question).not.toMatch(/cardinalit|ontolog|relation\b|entity|1:N|N:M|→/i);
    }
  });

  it("each carries the locus it closes, so answering it moves the burn-down", () => {
    for (const k of kit) {
      expect(k.about).toMatch(/^el:rel:/);
      expect(k.ownerLabel.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The three copy defects observed on the live stakeholder link, fixed with the
 * questions they sit beside.
 */
describe("the page states its subject once, and never in methodology vocabulary", () => {
  const stepStore = migrate({
    ontology: { entities: [{ name: "Deal", area: "Sales", attributes: ["stage"] }], relations: [] },
    atlas: {
      workflows: [{
        name: "Qualify", area: "Sales", owner: "Sales SME",
        steps: [{ actor: "", action: "Review pipeline, forecast, and performance reports; monitor commit, most likely, and stretch buckets.", entities: ["Deal"] }],
      }],
    },
    overrides: [],
  } as Snapshot);

  it("a step's questions carry the step ONCE — the rows drop the stem the card's header holds", () => {
    const stepLoci = buildUnknownQueue(stepStore).items.filter((i) => i.about.startsWith("el:step:"));
    expect(stepLoci.length).toBeGreaterThan(1);          // several unknowns on one step
    const rendered = stepLoci.map((i) => renderQuestion(stepStore, i.about, "stakeholder"));
    // the full text still states the subject — a standalone surface needs it
    for (const r of rendered) expect(r.question).toContain("One step in your process is:");
    // …and the grouped form does not restate it
    for (const r of rendered) {
      expect(r.short).not.toContain("One step in your process is:");
      expect(r.short.length).toBeLessThan(r.question.length);
      expect(r.short.trim().length).toBeGreaterThan(0);
    }
  });

  it("the phase question asks in business language, not the methodology's", () => {
    const phase = buildUnknownQueue(stepStore).items.find((i) => i.slot === "phase");
    if (!phase) return;
    const r = renderQuestion(stepStore, phase.about, "stakeholder");
    expect(r.question).not.toMatch(/which phase/i);
    expect(r.label).not.toMatch(/phase/i);
    expect(r.question).toContain("At what point in your work");
  });

  it("no type label shouts — the tag is styled quietly, not uppercased", () => {
    const css = readFileSync(resolve(__dirname, "../../../src/v3/v3.css"), "utf8");
    const rule = css.split("\n").find((l) => l.startsWith(".v3fs-pq-type "))!;
    expect(rule, "the stakeholder question tag rule went missing").toBeTruthy();
    expect(rule).not.toContain("text-transform:uppercase");
  });
});
