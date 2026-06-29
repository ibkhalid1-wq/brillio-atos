import { describe, it, expect } from "vitest";
import {
  readRaciMatrix,
  raciDeliveryRoles,
  rosterColumnKeys,
  missingRosterRoles,
  rosterRoleToNameMap,
  rosterSeniorityRank,
  sortRosterRowsBySeniority,
} from "@/v3/lib/rosterRaci";

/**
 * The roster and the RACI matrix describe the same programme roles from two
 * angles. These helpers reconcile them — read the structured matrix, derive the
 * delivery roles it names, and find which of those roles the roster does not yet
 * staff — so the Mobilise quality flow can seed placeholder rows deterministically.
 */

describe("readRaciMatrix", () => {
  it("returns null when no matrix is present or it is malformed", () => {
    expect(readRaciMatrix(null)).toBeNull();
    expect(readRaciMatrix({})).toBeNull();
    expect(readRaciMatrix({ raciMatrix: [] })).toBeNull();
    expect(readRaciMatrix({ raciMatrix: "x" })).toBeNull();
  });

  it("normalises activities and gaps, dropping blanks and non-strings", () => {
    const m = readRaciMatrix({
      raciMatrix: {
        activities: [
          { activity: "Plan", responsible: ["PM", "", 5], accountable: " Sponsor ", consulted: ["Legal"], informed: [] },
          "junk",
          { responsible: "not-an-array" },
        ],
        gaps: ["No security lead", "", 3],
      },
    })!;
    expect(m.activities).toHaveLength(2);
    expect(m.activities[0]).toEqual({
      activity: "Plan",
      responsible: ["PM"],
      accountable: "Sponsor",
      consulted: ["Legal"],
      informed: [],
    });
    expect(m.activities[1].responsible).toEqual([]);
    expect(m.gaps).toEqual(["No security lead"]);
  });
});

describe("raciDeliveryRoles", () => {
  it("collects accountable + responsible roles, deduped by canonical family, excludes consulted/informed", () => {
    const m = readRaciMatrix({
      raciMatrix: {
        activities: [
          { activity: "A", accountable: "Programme Manager", responsible: ["Product Owner"], consulted: ["Legal Advisor"], informed: ["Sponsor"] },
          { activity: "B", accountable: "Project Manager", responsible: ["PO"] },
        ],
      },
    });
    const roles = raciDeliveryRoles(m);
    // Programme Manager / Project Manager collapse to one family; Product Owner / PO collapse to one.
    expect(roles).toEqual(["Programme Manager", "Product Owner"]);
    expect(roles).not.toContain("Legal Advisor");
    expect(roles).not.toContain("Sponsor");
  });

  it("returns an empty array for a null matrix", () => {
    expect(raciDeliveryRoles(null)).toEqual([]);
  });
});

describe("rosterColumnKeys", () => {
  it("resolves role and name keys from grid columns", () => {
    const { roleKey, nameKey } = rosterColumnKeys([
      { key: "position", label: "Position", type: "text" },
      { key: "person", label: "Name", type: "text" },
    ]);
    expect(roleKey).toBe("position");
    expect(nameKey).toBe("person");
  });
});

describe("missingRosterRoles", () => {
  const roleKey = "role";
  it("returns roles that have no matching roster row (by role family)", () => {
    const rows = [{ id: "1", role: "Project Manager", name: "Jane" }];
    const missing = missingRosterRoles(rows, roleKey, ["Programme Manager", "Product Owner"]);
    // Programme Manager matches the existing Project Manager row → only Product Owner is missing.
    expect(missing).toEqual(["Product Owner"]);
  });

  it("returns all roles when the role column key is unknown", () => {
    expect(missingRosterRoles([], undefined, ["A", "B"])).toEqual([]);
  });

  it("treats a RACI role with the person named in parentheses as already staffed", () => {
    const rows = [{ id: "1", role: "Executive Sponsor", name: "Raj Mamodia" }];
    // RACI names the same seat as "Executive Sponsor (Raj Mamodia)" — the
    // parenthetical is a qualifier, not a distinct role, so nothing is missing.
    expect(missingRosterRoles(rows, roleKey, ["Executive Sponsor (Raj Mamodia)"])).toEqual([]);
  });
});

describe("rosterSeniorityRank", () => {
  it("ranks governance/exec roles above programme leadership above ICs", () => {
    expect(rosterSeniorityRank("Program Sponsor")).toBeLessThan(rosterSeniorityRank("Project Manager"));
    expect(rosterSeniorityRank("Project Manager")).toBeLessThan(rosterSeniorityRank("Product Owner"));
    expect(rosterSeniorityRank("Product Owner")).toBeLessThan(rosterSeniorityRank("Engineering Lead / Architect"));
    expect(rosterSeniorityRank("Engineering Lead / Architect")).toBeLessThan(rosterSeniorityRank("Integration Lead"));
    expect(rosterSeniorityRank("Integration Lead")).toBeLessThan(rosterSeniorityRank("Finance Controller"));
    expect(rosterSeniorityRank("Finance Controller")).toBeLessThan(rosterSeniorityRank("Business Analyst"));
  });

  it("ranks an architect ahead of a generic lead despite both keywords appearing", () => {
    expect(rosterSeniorityRank("Engineering Lead / Architect")).toBe(3);
  });

  it("sinks unknown roles below ranked ones and empty roles last", () => {
    expect(rosterSeniorityRank("Office Cat")).toBeGreaterThan(rosterSeniorityRank("QA Lead"));
    expect(rosterSeniorityRank("")).toBeGreaterThan(rosterSeniorityRank("Office Cat"));
  });
});

describe("sortRosterRowsBySeniority", () => {
  it("orders rows top-down by role, stable within a rank", () => {
    const rows = [
      { id: "1", role: "QA Lead", name: "A" },
      { id: "2", role: "Program Sponsor", name: "B" },
      { id: "3", role: "Project Manager", name: "C" },
      { id: "4", role: "Integration Lead", name: "D" },
    ];
    const ordered = sortRosterRowsBySeniority(rows, "role").map((r) => r.role);
    expect(ordered).toEqual(["Program Sponsor", "Project Manager", "QA Lead", "Integration Lead"]);
  });

  it("returns rows unchanged when the role key is unknown", () => {
    const rows = [{ id: "1", role: "QA Lead", name: "A" }];
    expect(sortRosterRowsBySeniority(rows, undefined)).toBe(rows);
  });
});

describe("rosterRoleToNameMap", () => {
  it("maps canonical role family to the first named person, skipping unnamed rows", () => {
    const map = rosterRoleToNameMap(
      [
        { id: "1", role: "Programme Manager", name: "Jane" },
        { id: "2", role: "Project Manager", name: "Ignored" },
        { id: "3", role: "Product Owner", name: "" },
      ],
      "role",
      "name",
    );
    expect(map.get("program-manager")).toBe("Jane");
    expect(map.has("product-owner")).toBe(false);
  });
});
