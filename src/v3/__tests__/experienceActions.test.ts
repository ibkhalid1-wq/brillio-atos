/**
 * THE DESIGNED VERBS — grounded, drawn, and performed (2026-08-16).
 *
 * Experience Design authors what the business DOES with a record; the assembler
 * rendered Open/Edit/Delete/New on every screen regardless, so the one part of
 * the design that says what the product is FOR was the part the prototype
 * dropped. These cases pin both halves of the answer: a verb the ontology can
 * carry becomes a control that acts, and a verb it cannot is refused into gaps
 * rather than drawn as a button that shrugs.
 *
 * The fixture is the shape measured on a real programme — including the trap
 * that shaped the design: the state machine's own vocabulary (Lead Accepted →
 * Offer Sent) is NOT the ontology's (New / Qualifying / Converted), so
 * grounding must resolve against the ontology, never the machine.
 */
import { describe, expect, it } from "vitest";
import { deriveScreenActions } from "@shared/experienceActions.ts";
import { assemblePrototype, screenOptionsFor } from "@shared/prototypeAssembly.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ontology = {
  entities: [
    { name: "Lead", attributes: [
      { name: "leadName", kind: "string" },
      { name: "leadStage", kind: "enum", values: ["New", "Qualifying", "Converted", "Disqualified"] },
      { name: "owner", kind: "person" },
    ] },
    { name: "Opportunity", attributes: [
      { name: "opportunityName", kind: "string" },
      { name: "opportunityStage", kind: "enum", values: ["Prospecting", "Proposal", "Closed Won"] },
    ] },
    { name: "Campaign", attributes: [
      { name: "campaignName", kind: "string" },
      { name: "campaignStatus", kind: "enum", values: ["Planned", "Live", "Paused", "Completed"] },
    ] },
  ],
  relations: [
    { from: "Campaign", to: "Lead", cardinality: "1:N" },
    { from: "Lead", to: "Opportunity", cardinality: "unknown", standardPrior: "N:1" },
  ],
};
const atlas = { workflows: [{ name: "Qualify", owner: "Sales", steps: [{ action: "Score the lead", entities: ["Lead"] }] }] };

const design = {
  screens: [
    {
      id: "lead-board",
      entities: ["Lead", "Opportunity"],
      primaryActions: ["Convert to Opportunity", "Assign Sales Rep", "Accept Lead", "Update Pipeline"],
      states: { empty: "No leads yet." },
      wireframe: [
        { region: "main", blocks: [
          { kind: "table", label: "Leads", entity: "Lead", fields: ["leadName", "leadStage", "owner"] },
          { kind: "table", label: "Opportunities", entity: "Opportunity", fields: ["opportunityName", "opportunityStage"] },
        ] },
      ],
    },
    {
      id: "campaigns",
      entities: ["Campaign"],
      primaryActions: ["End Campaign"],
      wireframe: [{ region: "header", blocks: [{ kind: "action", label: "End Campaign", entity: null, fields: [] }] }],
    },
  ],
  workflowMachines: [
    // The machine's states are its OWN vocabulary — none of these strings is a
    // leadStage value, which is exactly why "Accept Lead" cannot be wired.
    { name: "Lead to Opportunity", states: ["Lead Accepted", "Offer Sent", "Closed"], transitions: [
      { from: "Lead Accepted", to: "Offer Sent", on: "Send Offer", actor: "Sales SME" },
    ] },
    { name: "Campaign", states: ["Planned", "Live", "Completed"], transitions: [
      { from: "Live", to: "Completed", on: "End Campaign", actor: "Marketing SME" },
    ] },
  ],
};

const deps = {
  hasScreen: (e: string) => ["Lead", "Opportunity", "Campaign"].includes(e),
  isPersonAttr: (entity: string, attribute: string) => entity === "Lead" && attribute === "owner",
};

describe("§1 grounding — a verb is resolved against the ontology, never the machine", () => {
  const { byEntity, refused } = deriveScreenActions(design, ontology, deps);

  it("a machine transition wires ONLY where its target state is a value the record can hold", () => {
    const campaign = byEntity.Campaign ?? [];
    const end = campaign.find((a) => a.label === "End Campaign")!;
    expect(end.kind).toBe("set");
    expect(end.attribute).toBe("campaignStatus");
    expect(end.value).toBe("Completed");
    expect(end.basis).toMatch(/state machine/);
  });

  it("a verb naming another entity opens that entity's form", () => {
    const convert = (byEntity.Lead ?? []).find((a) => a.label === "Convert to Opportunity")!;
    expect(convert.kind).toBe("create");
    expect(convert.target).toBe("Opportunity");
    expect(convert.scope).toBe("list");
  });

  it("an assignment verb wires to the record's person field", () => {
    const assign = (byEntity.Lead ?? []).find((a) => a.label === "Assign Sales Rep")!;
    expect(assign.kind).toBe("assign");
    expect(assign.attribute).toBe("owner");
    expect(assign.scope).toBe("record");
  });

  it("THE REFUSALS: a state no attribute holds, and an entity the model lacks", () => {
    // "Accept Lead" — the machine has a "Lead Accepted" STATE but no transition
    // triggered by this label, and no leadStage value is "Accept Lead".
    expect((byEntity.Lead ?? []).some((a) => a.label === "Accept Lead")).toBe(false);
    // "Update Pipeline" — this ontology holds no Pipeline at all.
    expect((byEntity.Lead ?? []).some((a) => a.label === "Update Pipeline")).toBe(false);
    expect(refused.join(" ")).toMatch(/"Accept Lead" on Lead is not drawn/);
    expect(refused.join(" ")).toMatch(/"Update Pipeline" on Lead is not drawn/);
    expect(refused.join(" ")).toMatch(/ask in Listen/i);
  });

  it("a design with no verbs, or an ontology with nothing to carry them, yields nothing", () => {
    expect(deriveScreenActions({}, ontology, deps).byEntity).toEqual({});
    expect(deriveScreenActions(design, {}, deps).byEntity).toEqual({});
  });
});

describe("§2 the wireframe directs the build", () => {
  it("table blocks become that entity's columns, and the screen's other tables its collections", () => {
    const opts = screenOptionsFor(design);
    expect(opts.Lead?.columns).toEqual(["leadName", "leadStage", "owner"]);
    expect(opts.Opportunity?.columns).toEqual(["opportunityName", "opportunityStage"]);
    expect(opts.Lead?.collections).toEqual(["Opportunity"]);
  });

  it("an operator's own screenOptions still win over the design's wireframe", () => {
    const authored = { ...design, screenOptions: { Lead: { columns: ["owner"] } } };
    expect(screenOptionsFor(authored).Lead?.columns).toEqual(["owner"]);
  });
});

describe("§3 the build draws them, and they act", () => {
  const built = assemblePrototype(ontology, atlas, undefined, {
    experienceDesign: design,
    screenOptions: screenOptionsFor(design),
  });

  it("record verbs sit on the detail page and list verbs in the list toolbar", () => {
    const doc = loadPrototype(built.html, { entities: ["Lead", "Opportunity", "Campaign"], url: "https://p.test/#lead" }).window.document;
    const detail = doc.querySelector('[data-screen="detail-lead"]')!;
    expect(detail.textContent).toContain("Assign Sales Rep");
    const list = doc.querySelector('[data-screen="list-lead"]')!;
    expect(list.textContent).toContain("Convert to Opportunity");
    // …and never a control for a verb that was refused.
    expect(built.html).not.toContain("Update Pipeline");
    expect(built.html).not.toContain(">Accept Lead<");
  });

  it("a refused verb is declared in the build's coverage gaps", () => {
    expect(built.coverageGaps.join(" ")).toMatch(/"Update Pipeline" on Lead is not drawn/);
  });

  it("clicking a state verb moves the record to the state the design named", async () => {
    const page = loadPrototype(built.html, { entities: ["Lead", "Opportunity", "Campaign"], url: "https://p.test/#campaign/campaign-0001" });
    const doc = page.window.document;
    const detail = doc.querySelector('[data-screen="detail-campaign"]')!;
    const btn = [...detail.querySelectorAll("button")].find((b) => b.textContent?.trim() === "End Campaign") as HTMLButtonElement;
    expect(btn, "the wired verb was not drawn").toBeTruthy();
    btn.click();
    expect(detail.textContent).toContain("Completed");
  });

  it("a build whose design authors no verb carries no action renderer at all", () => {
    const bare = assemblePrototype(ontology, atlas);
    expect(bare.html).not.toContain("function doAct");
    expect(built.html).toContain("function doAct");
  });
});

describe("§4 the design's metric blocks become validated widgets", () => {
  const withMetrics = {
    ...design,
    screens: [
      {
        ...design.screens[0],
        wireframe: [
          { region: "header", blocks: [
            { kind: "metric", label: "Open leads", entity: "Lead", fields: [] },
            { kind: "metric", label: "Pipeline value", entity: "Opportunity", fields: ["dealValue"] },
            { kind: "metric", label: "Nonsense", entity: "Lead", fields: ["fieldTheModelDoesNotHold"] },
          ] },
          ...design.screens[0].wireframe,
        ],
      },
      design.screens[1],
    ],
  };
  const ontologyWithMoney = {
    ...ontology,
    entities: ontology.entities.map((e) => e.name !== "Opportunity" ? e : {
      ...e, attributes: [...e.attributes, { name: "dealValue", kind: "money" }],
    }),
  };

  it("a metric lands on its own entity's list — as a count, or over the field it names", () => {
    const built = assemblePrototype(ontologyWithMoney, atlas, undefined, { experienceDesign: withMetrics });
    const doc = loadPrototype(built.html, { entities: ["Lead", "Opportunity", "Campaign"], url: "https://p.test/#lead" }).window.document;
    const leadBand = doc.querySelector('[data-screen="list-lead"]')!.textContent ?? "";
    expect(leadBand).toMatch(/Lead/);
    // the money metric went to the OPPORTUNITY list, not the screen that drew it
    const oppBand = doc.querySelector('[data-screen="list-opportunity"]')!.textContent ?? "";
    expect(oppBand).toMatch(/Deal Value|deal value/i);
  });

  it("a metric naming a field the entity does not hold is REFUSED by name", () => {
    const built = assemblePrototype(ontologyWithMoney, atlas, undefined, { experienceDesign: withMetrics });
    expect(built.specViolations.join(" ")).toMatch(/fieldTheModelDoesNotHold/);
  });

  it("a spec a previous round accepted still wins over the design's metrics", () => {
    const carried = { screens: [{ screen: "list-lead", widgets: [{ kind: "stat", entity: "Lead" }] }] };
    const built = assemblePrototype(ontologyWithMoney, atlas, undefined, { experienceDesign: withMetrics, spec: carried });
    // the carried spec drew Lead's tile and the design's Opportunity metric never arrived
    expect(built.specViolations.join(" ")).not.toMatch(/fieldTheModelDoesNotHold/);
  });

  it("a design with no metric blocks assembles byte-for-byte as before", () => {
    const a = assemblePrototype(ontologyWithMoney, atlas, undefined, { experienceDesign: design }).html;
    const b = assemblePrototype(ontologyWithMoney, atlas, undefined, {
      experienceDesign: design, spec: null as unknown as undefined,
    }).html;
    expect(a).toBe(b);
  });
});
