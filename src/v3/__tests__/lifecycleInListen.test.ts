/**
 * ENTITY LIFECYCLES ARE FOUND FROM THE RECORD, AND CONFIRMED IN LISTEN.
 *
 * Operator direction (2026-08-12): "entity lifecycle stages should be confirmed
 * during listen" — with workflow machines removed from Experience Design, where the
 * delivery team had been re-drawing by hand what the people who live the process
 * could simply state.
 *
 * The risk in any detector like this is a confident wrong answer, so the cases below
 * are weighted toward what it must NOT claim: `Account.state` is a postal address,
 * and a name on its own is a suggestion rather than a finding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lifecycleEntities, lifecycleLoci, lifecycleReason, lifecycleQuestionOverlay } from "@/v3/lib/ledger/lifecycle";
import { createLedgerStore } from "@/v3/lib/ledger/store";
import { aboutOf } from "@/v3/lib/ledger/types";

/** A store with the elements named, and nothing else asserted. */
function storeWith(spec: {
  entity: string;
  attributes: string[];
  steps?: string[];
  values?: { attribute: string; text: string };
}) {
  const store = createLedgerStore();
  const entityId = `el:ent:${spec.entity.toLowerCase().replace(/\s+/g, "-")}`;
  store.addElement({ id: entityId, kind: "entity", name: spec.entity });
  const ids: Record<string, string> = {};
  for (const attr of spec.attributes) {
    const id = `el:attr:${spec.entity.toLowerCase()}.${attr.toLowerCase().replace(/\s+/g, "-")}`;
    ids[attr] = id;
    store.addElement({ id, kind: "attribute", name: attr, of: entityId });
  }
  for (const [i, step] of (spec.steps ?? []).entries()) {
    store.addElement({ id: `el:step:s${i}`, kind: "step", name: step });
  }
  if (spec.values) {
    store.assert({
      about: aboutOf(ids[spec.values.attribute], "valueSet"),
      value: { kind: "scalar", value: spec.values.text },
      world: "as-is", layer: "domain", source: "asserted",
      ownerWhileOpen: { kind: "role", role: "Claims Operations" },
    });
  }
  return { store, ids, entityId };
}

describe("what has a lifecycle", () => {
  it("finds one where the record shows stages, a span and motion", () => {
    const { store } = storeWith({
      entity: "Claim",
      attributes: ["status", "opened date", "closed date", "reserve amount"],
      steps: ["Adjuster approves the Claim"],
      values: { attribute: "status", text: "Open; Under Review; Settled; Closed" },
    });
    const [found, ...rest] = lifecycleEntities(store);
    expect(rest, "more than one lifecycle on a one-lifecycle entity").toHaveLength(0);
    expect(found.entity).toBe("Claim");
    expect(found.attribute).toBe("status");
    expect(found.stages).toEqual(["Open", "Under Review", "Settled", "Closed"]);
    expect(found.signals.sort()).toEqual(["motion", "name", "span", "values"]);
    expect(found.confident).toBe(true);
  });

  it("does NOT call Account.state a lifecycle", () => {
    // The trap this detector exists to survive. "state" matches the stage-name
    // pattern exactly, and on an address it means nothing of the kind.
    // MUTATION: drop the `looksPostal` guard → this is RED.
    const { store } = storeWith({
      entity: "Account",
      attributes: ["street", "city", "state", "postcode"],
    });
    expect(lifecycleEntities(store)).toHaveLength(0);
  });

  it("still finds Account.status when the address fields are right beside it", () => {
    // The postal guard must cut the ambiguous word ONLY. An account genuinely has a
    // status, and it does not stop having one because the entity also has a city.
    const { store } = storeWith({
      entity: "Account",
      attributes: ["street", "city", "state", "postcode", "status"],
    });
    expect(lifecycleEntities(store).map((l) => l.attribute)).toEqual(["status"]);
  });

  it("treats a name with nothing behind it as a suggestion, not a finding", () => {
    // One signal. Aura may raise it; it may not act on it.
    const { store } = storeWith({ entity: "Ticket", attributes: ["stage", "title"] });
    const [found] = lifecycleEntities(store);
    expect(found.signals).toEqual(["name"]);
    // MUTATION: `confident: signals.length >= 1` → RED.
    expect(found.confident, "a name alone was promoted to a finding").toBe(false);
    // …and it is excluded from the set that reroutes questions.
    expect(lifecycleLoci(store).has(found.about)).toBe(false);
  });

  it("a span alone is not a lifecycle either", () => {
    // Dates without a stage attribute: a thing with a beginning and an end, but
    // nothing on the record saying what it passes through.
    const { store } = storeWith({ entity: "Contract", attributes: ["effective date", "expiry date"] });
    expect(lifecycleEntities(store)).toHaveLength(0);
  });

  it("the strongest reading comes first", () => {
    // The surface shows the top of this list, so the order IS the recommendation.
    const store = createLedgerStore();
    for (const [entity, attrs] of [["Ticket", ["stage"]], ["Claim", ["status", "opened date", "closed date"]]] as const) {
      const eid = `el:ent:${entity.toLowerCase()}`;
      store.addElement({ id: eid, kind: "entity", name: entity });
      for (const a of attrs) {
        store.addElement({ id: `el:attr:${entity}.${a}`, kind: "attribute", name: a, of: eid });
      }
    }
    expect(lifecycleEntities(store).map((l) => l.entity)).toEqual(["Claim", "Ticket"]);
  });
});

describe("the reason is stated, not implied", () => {
  it("names the signals that fired", () => {
    const { store } = storeWith({
      entity: "Claim",
      attributes: ["status", "opened date", "closed date"],
      values: { attribute: "status", text: "Open; Closed" },
    });
    const reason = lifecycleReason(lifecycleEntities(store)[0]);
    expect(reason).toContain("2 values already on the record");
    expect(reason).toContain("start and an end date");
  });

  it("says so plainly when the name is all there is", () => {
    const { store } = storeWith({ entity: "Ticket", attributes: ["stage"] });
    expect(lifecycleReason(lifecycleEntities(store)[0])).toContain("from its name alone");
  });
});

describe("the confirmation writes through the path a schema writes through", () => {
  it("Discover confirms stages as a dictionary row, not a new mechanism", () => {
    // A lifecycle a person confirmed and one a schema stated must be
    // indistinguishable to the merge — same columns, same call, same precedence.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../components/flow/TheLine.tsx"), "utf8") as string;
    expect(src).toContain("entity,field,values");
    expect(src, "a bespoke write path would sit outside the ledger's precedence")
      .toContain("commits.commitDictionary(csv, null)");
  });

  it("Experience Design no longer authors workflow machines", () => {
    const ed = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../components/flow/studio/ExperienceDesignStudio.tsx"), "utf8") as string;
    // MUTATION: restore the card → RED.
    expect(ed).not.toContain('EdCard label="Workflow machines"');
    expect(ed, "the field must stay on the document — removal is from the STUDIO, not the record")
      .toContain("workflowMachines");
  });
});

describe("a lifecycle's stages are a person's question", () => {
  /**
   * The defect the Discover strip made visible: it listed seven findings and every
   * row said "stages not stated yet" with no control on it — informational text on
   * the surface for stakeholder questions.
   *
   * The cause was one line up the stack. Every `#valueSet` locus went to the
   * dictionary bucket, which is excluded from `soloByOwner`, so "what stages does an
   * Opportunity go through" sat on NOBODY's card, waiting on a schema export. The
   * whole point of confirming lifecycles in Listen is that the people who move the
   * thing state the stages — including their ORDER, which no dictionary carries.
   */
  it("a confident lifecycle's value-set locus is not in the dictionary bucket", () => {
    const { store, ids } = storeWith({
      entity: "Claim",
      attributes: ["status", "opened date", "closed date"],
    });
    const about = aboutOf(ids["status"], "valueSet");
    // MUTATION: drop the `!lifecycleAsks.has(...)` filter in useProgramLedger → the
    // locus goes back to the dictionary and off every person's card.
    expect(lifecycleLoci(store).has(about),
      "the stage question is still routed to a schema, not a person").toBe(true);
  });

  it("a one-signal guess does NOT get put on someone's link", () => {
    // The floor earns its keep here: a name-only reading must not mint a question
    // for a person, because being asked about a lifecycle that isn't one is worse
    // than not being asked.
    const { store, ids } = storeWith({ entity: "Ticket", attributes: ["stage"] });
    expect(lifecycleLoci(store).has(aboutOf(ids["stage"], "valueSet"))).toBe(false);
  });

  it("the routing and the question text read the SAME set", () => {
    // Two readers of one rule: if they ever diverge, a person is asked "what values
    // can X take" about a locus routed to them as a lifecycle, or the reverse.
    const hook = readFileSync(resolve(__dirname, "../lib/ledger/useProgramLedger.ts"), "utf8");
    const render = readFileSync(resolve(__dirname, "../lib/ledger/renderQuestion.ts"), "utf8");
    expect(hook).toContain("lifecycleLoci(store)");
    expect(render).toContain("lifecycleAbouts(store).has(about)");
  });

  it("the question asks for the ORDER, which is the part only a person has", () => {
    const render = readFileSync(resolve(__dirname, "../lib/ledger/renderQuestion.ts"), "utf8");
    // MUTATION: restore the single "What values can X take?" → RED.
    expect(render).toContain("move through, in order?");
    // …and it names the FIELD, not just the entity. Opportunity carries three
    // lifecycle attributes on Laila New (stage, forecast status, MSA status), so a
    // question naming only the entity goes out three times, identically, with
    // nothing to tell the recipient which field each is about.
    expect(render, "the question dropped the field name").toContain("${name} — what stages");
    expect(render, "the schema question must survive for everything that is NOT a lifecycle")
      .toContain("What values can ${name} take?");
  });
});

describe("the stage question exists at all", () => {
  /**
   * The defect behind "what is the call to action here": five of Laila New's seven
   * confident lifecycles had ZERO claims on their `#valueSet` locus — not closed,
   * never born. The ontology only opens a value-set slot for an attribute it typed
   * as a picklist, so a lifecycle it found any other way produced a finding nobody
   * could act on: no card, no bucket, no question anywhere.
   */
  const claimsFor = (store: ReturnType<typeof createLedgerStore>, about: string) =>
    lifecycleQuestionOverlay(store).filter((c) => c.about === about);

  it("is born when the ontology never opened it", () => {
    const { store, ids } = storeWith({
      entity: "Claim", attributes: ["status", "opened date", "closed date"],
    });
    const about = aboutOf(ids["status"], "valueSet");
    expect(store.claims().filter((c) => c.about === about), "the fixture already has one — nothing to prove").toHaveLength(0);
    // MUTATION: return [] from lifecycleQuestionOverlay → RED, and the finding is
    // inert again.
    const born = claimsFor(store, about);
    expect(born).toHaveLength(1);
    expect(born[0].status).toBe("open");
    expect(born[0].value, "a question must not assert anything about the world").toEqual({ kind: "unknown" });
  });

  it("is NOT born twice when the ontology already opened it", () => {
    const { store, ids } = storeWith({
      entity: "Claim",
      attributes: ["status", "opened date", "closed date"],
      values: { attribute: "status", text: "Open; Closed" },
    });
    // MUTATION: drop the `existing.has(lc.about)` guard → 1, and the locus carries
    // two claims where the ledger allows one question.
    expect(claimsFor(store, aboutOf(ids["status"], "valueSet"))).toHaveLength(0);
  });

  it("is not born for a one-signal guess", () => {
    const { store, ids } = storeWith({ entity: "Ticket", attributes: ["stage"] });
    expect(claimsFor(store, aboutOf(ids["stage"], "valueSet"))).toHaveLength(0);
  });

  it("inherits the owner the entity's other questions already have", () => {
    // Ownership is inherited, never invented — the whole point of the owner-binding
    // work. A question minted with a guessed owner would put it on a stranger's link.
    const { store, ids } = storeWith({
      entity: "Claim", attributes: ["status", "opened date", "closed date", "reserve amount"],
    });
    store.assert({
      about: aboutOf(ids["reserve amount"], "dataType"), value: { kind: "unknown" },
      world: "as-is", layer: "domain", source: "generated",
      ownerWhileOpen: { kind: "role", role: "Claims Operations" },
    });
    const born = claimsFor(store, aboutOf(ids["status"], "valueSet"));
    expect(born[0].ownerWhileOpen).toEqual({ kind: "role", role: "Claims Operations" });
  });

  it("is born UNOWNED when the record names nobody, rather than guessing", () => {
    const { store, ids } = storeWith({
      entity: "Claim", attributes: ["status", "opened date", "closed date"],
    });
    expect(claimsFor(store, aboutOf(ids["status"], "valueSet"))[0].ownerWhileOpen).toEqual({ kind: "unowned" });
  });

  it("keeps the same id across renders, so it is one question and not a new one each time", () => {
    // Content-addressed: a wall-clock stamp would mint a fresh id every render, and
    // the same question would read as newly born on every keystroke.
    const { store, ids } = storeWith({
      entity: "Claim", attributes: ["status", "opened date", "closed date"],
    });
    const about = aboutOf(ids["status"], "valueSet");
    expect(claimsFor(store, about)[0].id).toBe(claimsFor(store, about)[0].id);
    expect(lifecycleQuestionOverlay(store)[0].id).toBe(lifecycleQuestionOverlay(store)[0].id);
  });
});
