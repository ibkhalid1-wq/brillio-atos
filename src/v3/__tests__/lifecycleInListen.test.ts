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
import { lifecycleEntities, lifecycleLoci, lifecycleReason } from "@/v3/lib/ledger/lifecycle";
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
