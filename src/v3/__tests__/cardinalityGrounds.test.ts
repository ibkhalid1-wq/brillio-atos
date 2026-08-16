/**
 * AN UNCONFIRMED CARDINALITY IS NOT A ONE-TO-MANY.
 *
 * The ontology generator writes `cardinality: "unknown"` on every relation of a
 * provisional draft, deliberately — "cardinality is precisely what interviews
 * confirm; never guess 1:N" (run-agent prompt). Downstream, `unknown` then fell
 * through to `collection`, so a prototype built before a single interview drew
 * every relation as a child table and asserted a shape nobody had confirmed.
 * Seen on the live board: every relation on the Domain Ontology screen reading
 * "unknown", while the built prototype showed confident one-to-many lists.
 *
 * The rule now: `unknown` becomes `undetermined` — a list, because the screen
 * must stay usable, that SAYS it is provisional. It is raised to a real shape
 * only on evidence, and the evidence's GROUND travels with it so nothing
 * downstream can mistake a standard's claim for the client's answer.
 */
import { describe, it, expect } from "vitest";
import { relationshipRolesFor } from "@shared/semanticRoles.ts";
import { groundedCardinality, deriveOntologyGraph } from "@shared/ontologyGraph.ts";

describe("unknown is its own role", () => {
  it("does NOT become a collection", () => {
    // MUTATION: restore the `else parentRole = "collection"` fallthrough → RED.
    // This is the defect: a provisional draft rendered as confident lists.
    expect(relationshipRolesFor("unknown").parentRole).toBe("undetermined");
    expect(relationshipRolesFor("").parentRole).toBe("undetermined");
  });

  it("leaves every declared cardinality exactly as it was", () => {
    // The change must not move a relation anybody actually stated.
    expect(relationshipRolesFor("1:N").parentRole).toBe("collection");
    expect(relationshipRolesFor("N:1").parentRole).toBe("parent-ref");
    expect(relationshipRolesFor("1:1").parentRole).toBe("parent-ref");
    expect(relationshipRolesFor("N:M").parentRole).toBe("multi-select");
  });
});

describe("grounds: evidence raises the shape, never the status", () => {
  const holds = (pairs: Array<[string, string]>) =>
    (e: string, t: string) => pairs.some(([a, b]) => a === e && b === t);

  it("a declared cardinality is declared, and evidence cannot override it", () => {
    const g = groundedCardinality("Account", "Opportunity", "N:M", holds([["Opportunity", "Account"]]), "1:N");
    expect(g).toEqual({ cardinality: "N:M", ground: "declared" });
  });

  it("infers 1:N when the CHILD holds the parent's key and the parent holds nothing", () => {
    expect(groundedCardinality("Account", "Opportunity", "unknown", holds([["Opportunity", "Account"]])))
      .toEqual({ cardinality: "1:N", ground: "inferred" });
  });

  it("infers N:1 in the mirror case", () => {
    expect(groundedCardinality("Opportunity", "Account", "unknown", holds([["Opportunity", "Account"]])))
      .toEqual({ cardinality: "N:1", ground: "inferred" });
  });

  it("refuses to infer when BOTH sides or NEITHER hold a key", () => {
    // A coin-flip is the thing this function exists to refuse.
    expect(groundedCardinality("A", "B", "unknown", holds([["A", "B"], ["B", "A"]])).ground).toBe("unknown");
    expect(groundedCardinality("A", "B", "unknown", holds([])).ground).toBe("unknown");
  });

  it("falls to a standard prior only when the document itself offers nothing", () => {
    // MUTATION: check the prior before the FK → the standard would outrank the
    // client's own attributes, which is exactly backwards.
    expect(groundedCardinality("A", "B", "unknown", holds([]), "1:N"))
      .toEqual({ cardinality: "1:N", ground: "standard" });
    expect(groundedCardinality("A", "B", "unknown", holds([["B", "A"]]), "N:M").ground).toBe("inferred");
  });

  it("never promotes evidence to `declared`", () => {
    // The whole point: the shape changes, the question stays open.
    for (const g of [
      groundedCardinality("A", "B", "unknown", holds([["B", "A"]])),
      groundedCardinality("A", "B", "unknown", holds([]), "1:N"),
    ]) expect(g.ground).not.toBe("declared");
  });
});

describe("the graph carries the ground, and an unknown stays unknown", () => {
  const ontology = {
    entities: [
      { name: "Account", attributes: ["id", "name"] },
      { name: "Opportunity", attributes: ["id", "name", "accountId"] },
      { name: "Territory", attributes: ["id", "name"] },
    ],
    relations: [
      // The attributes carry accountId → inferable.
      { from: "Account", to: "Opportunity", relation: "produces", cardinality: "unknown" },
      // Nothing carries a key either way, no prior → stays unknown.
      { from: "Territory", to: "Account", relation: "is part of", cardinality: "unknown" },
    ],
  };
  const g = deriveOntologyGraph(ontology);

  it("marks the inferable edge inferred, and the bare one unknown", () => {
    const opp = g.edges.find((e) => e.child === "Opportunity")!;
    expect(opp.ground).toBe("inferred");
    expect(opp.parentToChild).toBe("1:N");
    const bare = g.edges.find((e) => e.child === "Account")!;
    expect(bare.ground).toBe("unknown");
    // MUTATION: let an ungrounded edge keep `parentToChild: cardinality` and
    // fall through to 1:N → RED. An unconfirmed relation must not read as one.
    expect(bare.parentToChild).toBe("UNKNOWN");
    expect(relationshipRolesFor(bare.parentToChild).parentRole).toBe("undetermined");
  });

  it("still nests the child, because the screen has to be drawable", () => {
    // `undetermined` is a caveat, not an omission: drop the relation and a
    // pre-interview programme shows a detail page with no related records.
    expect(g.byName["Account"].children).toContain("Opportunity");
    expect(g.byName["Territory"].children).toContain("Account");
  });
});
