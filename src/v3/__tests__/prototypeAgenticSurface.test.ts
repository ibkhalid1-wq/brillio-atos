/**
 * E4 · AN AGENT NAMED IN THE BLUEPRINT APPEARS ON THE ENTITY IT ACTS ON.
 *
 * The agentic blueprint and the prototype were two surfaces that never met. The
 * blueprint states, per agent, the ontology entities it consumes and produces,
 * how far the damage reaches and whether a human stands in its path — and the
 * application it describes showed none of it. A client walked a prototype in
 * which nothing was agentic and then read a document in which everything was.
 *
 * The acceptance criterion is the first test below and everything else exists
 * to stop it being satisfied dishonestly:
 *
 *   - an entity reference is RESOLVED against the ontology, and one that
 *     resolves to nothing is printed rather than dropped;
 *   - a HITL point belongs to an agent only if it NAMES it — the sibling
 *     surface's token matcher once mapped every agent to the first gate,
 *     because every agent on a real programme is called "<Something> Agent";
 *   - a gate an operator attested reads as an operator decision, not as
 *     something the generator produced;
 *   - the approval queue's controls WORK, because a drawn control that does
 *     nothing is the defect this whole area exists to end;
 *   - and with no blueprint the document is byte-for-byte the one it was.
 */
import { describe, it, expect } from "vitest";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveAgenticSurface, gatedAgents } from "@shared/agenticSurface.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const ontology = {
  entities: [
    { name: "Account", attributes: ["id", "name", "region"] },
    { name: "Opportunity", attributes: ["id", "name", "stage", "amount", "accountId"] },
    { name: "Quote", attributes: ["id", "name", "status", "opportunityId"] },
  ],
  relations: [
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
    { from: "Opportunity", to: "Quote", cardinality: "1:N" },
  ],
} as unknown as Record<string, unknown>;

const atlas = {
  workflows: [{
    name: "Deal Shaping", owner: "Deal Desk",
    steps: [{ action: "Shape the deal", actor: "Deal Desk", system: "CRM", entities: ["Opportunity", "Quote"] }],
  }],
} as unknown as Record<string, unknown>;

const blueprint = {
  agents: [
    {
      name: "Pricing Agent", purpose: "Drafts a quote from the opportunity's shape.",
      replacesWorkflow: "Deal Shaping", inputs: ["Opportunity", "Pricing Book"], outputs: ["Quotes"],
      autonomyLevel: "act", blastRadius: "high", reversibility: "irreversible", requiresHitl: false,
    },
    {
      name: "Enrichment Agent", purpose: "Appends firmographics to an account.",
      inputs: ["Accounts"], outputs: ["Account"], autonomyLevel: "suggest",
      blastRadius: "low", reversibility: "reversible", requiresHitl: true,
    },
    {
      name: "Forecast Agent", purpose: "Rolls opportunities into a forecast.",
      inputs: ["Opportunity"], outputs: ["Forecast Snapshot"], autonomyLevel: "suggest",
    },
  ],
  hitlPoints: [
    { where: "Before a Pricing Agent quote is sent", why: "A wrong price reaches the client", mechanism: "approve" },
    { agent: "Forecast Agent", point: "Ops signs the roll-up", addedBy: "operator", at: "2026-08-01T00:00:00.000Z" },
    { where: "Contract counter-signature", why: "Legal will not accept an automated signature", mechanism: "review" },
    // NAMES NO AGENT, and shares the one token every agent's name carries.
    // A matcher that accepts token overlap hands this to whichever agent is
    // read first — which is how a sibling surface once mapped all of them to
    // the first gate in the list.
    { where: "Nightly agent run summary", why: "Ops reads what the agents did overnight", mechanism: "review" },
  ],
} as unknown as Record<string, unknown>;

const built = assemblePrototype(ontology, atlas, undefined, { blueprint });
const loaded = loadPrototype(built.html);
const doc = loaded.doc;
const screen = (id: string) => doc.querySelector(`[data-screen="${id}"]`);
const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the acceptance criterion", () => {
  it("every agent appears on the detail screen of every entity it acts on", () => {
    // MUTATION: drop `agentBand(name)` from the detail screen → RED.
    const surface = deriveAgenticSurface(blueprint, ["Account", "Opportunity", "Quote"]);
    expect(surface.agents.length).toBe(3);
    const slug: Record<string, string> = { Account: "account", Opportunity: "opportunity", Quote: "quote" };
    for (const a of surface.agents) {
      const touches = [...new Set([...a.reads, ...a.writes])];
      expect(touches.length, `${a.name} resolved to no entity at all`).toBeGreaterThan(0);
      for (const entity of touches) {
        const detail = screen(`detail-${slug[entity]}`);
        expect(textOf(detail), `${a.name} is missing from ${entity}'s detail screen`).toContain(a.name);
      }
    }
    // …and it is not merely somewhere on the page: it is in the agent band,
    // saying what it does to THIS entity.
    const band = screen("detail-quote")!.querySelector(".m-agents")!;
    expect(textOf(band)).toContain("Pricing Agent");
    expect(textOf(band)).toContain("writes");
    expect(textOf(screen("detail-opportunity")!.querySelector(".m-agents")!)).toContain("reads");
  });

  it("resolves the blueprint's names against the ontology — plural and case included", () => {
    const surface = deriveAgenticSurface(blueprint, ["Account", "Opportunity", "Quote"]);
    const pricing = surface.agents.find((a) => a.name === "Pricing Agent")!;
    expect(pricing.writes).toEqual(["Quote"]);              // "Quotes" → Quote
    expect(surface.agents[1].reads).toEqual(["Account"]);   // "Accounts" → Account
  });

  it("a name the ontology does not hold is printed, not dropped", () => {
    // MUTATION: filter `unmapped` out of the band → RED. An agent that claims
    // to read a record type nobody modelled is a finding, and the one thing it
    // may never be is invisible.
    const band = textOf(screen("detail-opportunity")!.querySelector(".m-agents"));
    expect(band).toContain("Pricing Book");
    expect(band).toMatch(/Unmapped/i);
    expect(band).toMatch(/Confirm in Listen/i);
    // Forecast Snapshot is an output with no entity here — same rule.
    expect(band).toContain("Forecast Snapshot");
  });
});

describe("a gate belongs to the agent that is named, and to no other", () => {
  const surface = deriveAgenticSurface(blueprint, ["Account", "Opportunity", "Quote"]);

  it("reads a point by its text, requiresHitl by declaration, and neither by token overlap", () => {
    // Every agent here is called "<Something> Agent". The matcher that mapped
    // all of them to the first HITL point matched exactly that token.
    const by = Object.fromEntries(surface.agents.map((a) => [a.name, a.gate]));
    expect(by["Pricing Agent"]!.why).toContain("wrong price");
    expect(by["Pricing Agent"]!.source).toBe("point");
    expect(by["Enrichment Agent"]!.source).toBe("declared");
    expect(by["Forecast Agent"]!.source).toBe("operator");
    // The last two name no agent in this blueprint and are claimed by none —
    // including the one whose text carries the token "agent".
    expect(surface.unattributedGates.map((g) => g.where))
      .toEqual(["Contract counter-signature", "Nightly agent run summary"]);
  });

  it("an operator's attested gate reads as a decision, not as generated text", () => {
    const q = screen("approvals")!;
    expect(textOf(q)).toContain("Forecast Agent");
    expect(textOf(q)).toMatch(/operator decision/i);
  });

  it("a gate with no agent named is listed, never attached to the first one", () => {
    // MUTATION: attach unattributed points to agents[0] → RED here.
    const q = textOf(screen("approvals"));
    expect(q).toContain("Contract counter-signature");
    expect(q).toMatch(/Unattributed/i);
  });

  it("an ungoverned agent says so on the record it acts on", () => {
    // Nothing in this blueprint gates the entity band's autonomy claim except
    // the blueprint itself; an agent that can act alone must not look like one
    // that cannot.
    const bare = assemblePrototype(ontology, atlas, undefined, {
      blueprint: { agents: [{ name: "Sweeper", inputs: ["Account"], autonomyLevel: "act", blastRadius: "high" }] },
    });
    const band = textOf(loadPrototype(bare.html).doc.querySelector('[data-screen="detail-account"] .m-agents'));
    expect(band).toContain("Sweeper");
    expect(band).toMatch(/No human gate stated/i);
  });
});

describe("the approval queue is a queue, and its controls work", () => {
  it("one card per gated agent, over records of the entity it acts on", () => {
    const gated = gatedAgents(deriveAgenticSurface(blueprint, ["Account", "Opportunity", "Quote"]));
    expect(gated.length).toBe(3);
    const q = screen("approvals")!;
    for (const a of gated) expect(textOf(q), `${a.name} is not on the approval queue`).toContain(a.name);
    const rows = [...q.querySelectorAll('[data-region="approve:pricing-agent"] tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it("approving a row takes it out of the queue and moves the count", () => {
    // MUTATION: make `decide` a no-op → RED. Every control in this application
    // either works or is not drawn.
    const live = loadPrototype(built.html, { url: "https://prototype.test/#approvals" });
    const region = () => live.doc.querySelector('[data-region="approve:pricing-agent"]')!;
    const rowsNow = () => [...region().querySelectorAll("tbody tr")].map((tr) => (tr.textContent ?? "").trim());
    const before = rowsNow();
    expect(before.length).toBeGreaterThan(1);
    const waiting = Number(/(\d+) awaiting/.exec(textOf(region()))![1]);
    const approve = [...region().querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    approve.dispatchEvent(new live.window.Event("click", { bubbles: true }));
    // The decided row is GONE and the queue has refilled from behind it — a
    // queue that shrinks to nothing on its own page would be a different lie.
    const after = rowsNow();
    expect(after).not.toContain(before[0]);
    expect(after[0]).toBe(before[1]);
    expect(textOf(region())).toMatch(/1 decided this session/);
    expect(textOf(region())).toContain(`${waiting - 1} awaiting`);
    expect(live.consoleErrors).toEqual([]);
  });

  it("every control on the agentic screens has a handler", () => {
    const buttons = [
      ...(screen("approvals")?.querySelectorAll("button") ?? []),
      ...doc.querySelectorAll(".m-agents button"),
    ];
    expect(buttons.length).toBeGreaterThan(4);
    const dead = buttons.filter((b) => !(b.getAttribute("onclick") ?? "").trim()).map((b) => b.textContent ?? "");
    expect(dead, `buttons with no handler:\n${dead.join("\n")}`).toEqual([]);
  });

  it("a gated agent whose entity has no screen gets a stated gap, not an empty table", () => {
    const offMenu = assemblePrototype(ontology, atlas, ["Account"], {
      blueprint: {
        agents: [{ name: "Quote Agent", inputs: ["Quote"], outputs: ["Quote"], requiresHitl: true }],
        hitlPoints: [],
      },
    });
    const q = loadPrototype(offMenu.html).doc.querySelector('[data-screen="approvals"]')!;
    expect(textOf(q)).toContain("Quote Agent");
    expect(textOf(q)).toMatch(/No queue/i);
    expect(q.querySelector("table"), "an entity with no screen was queued anyway").toBeNull();
  });
});

describe("no blueprint, no agentic surfaces", () => {
  it("the document is exactly the one it was", () => {
    // The blueprint ADDS surfaces; it may not change the ones the ontology
    // derives. Byte-for-byte, because that is the only version of this claim
    // that cannot be argued with.
    const without = assemblePrototype(ontology, atlas);
    const withEmpty = assemblePrototype(ontology, atlas, undefined, { blueprint: { agents: [] } });
    expect(withEmpty.html).toBe(without.html);
    const d = loadPrototype(without.html).doc;
    expect(d.querySelector('[data-screen="approvals"]')).toBeNull();
    expect(d.querySelector(".m-agents")).toBeNull();
    expect(d.querySelector('[data-nav="approvals"]')).toBeNull();
    expect(without.html.length).toBeLessThan(built.html.length);
  });

  it("a blueprint that names nothing this ontology holds adds no queue", () => {
    const alien = assemblePrototype(ontology, atlas, undefined, {
      blueprint: { agents: [{ name: "Ward Agent", inputs: ["Ward Round"], outputs: ["Discharge"] }] },
    });
    const d = loadPrototype(alien.html).doc;
    expect(d.querySelector(".m-agents"), "an agent that touches nothing was put on a record anyway").toBeNull();
  });
});
