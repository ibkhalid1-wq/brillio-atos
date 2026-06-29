import { describe, it, expect } from "vitest";
import {
  bestRaciActivityForTitle,
  mostFrequentAccountableRole,
  resolveOwnerName,
  buildRaciOwnerResolver,
} from "@/v3/lib/raciOwner";
import { readRaciMatrix } from "@/v3/lib/rosterRaci";

/**
 * A primary owner for a RAID item is derived, not stored: match the item's title
 * to the closest RACI activity, read that activity's accountable role, and resolve
 * the role to a person via the roster. With no good activity match the programme's
 * most-frequent accountable role is the sensible default; with neither, no owner.
 */

const raci = readRaciMatrix({
  raciMatrix: {
    activities: [
      { activity: "Define data migration strategy", accountable: "Solution Architect", responsible: ["Engineer"] },
      { activity: "Stakeholder communications plan", accountable: "Programme Manager" },
      { activity: "Approve programme budget", accountable: "Programme Manager" },
    ],
    gaps: [],
  },
});

const roleToName = new Map<string, string>([
  ["solution-architect", "Priya Patel"],
  ["program-manager", "Sam Lee"],
]);

describe("bestRaciActivityForTitle", () => {
  it("matches an item to the activity with the strongest word overlap", () => {
    const match = bestRaciActivityForTitle("Data migration strategy is unclear", raci!.activities);
    expect(match?.accountable).toBe("Solution Architect");
  });

  it("returns null when no activity clears the overlap threshold", () => {
    expect(bestRaciActivityForTitle("Office coffee machine broken", raci!.activities)).toBeNull();
  });

  it("returns null for an empty/meaningless title", () => {
    expect(bestRaciActivityForTitle("a to the", raci!.activities)).toBeNull();
  });
});

describe("mostFrequentAccountableRole", () => {
  it("returns the role accountable across the most activities", () => {
    expect(mostFrequentAccountableRole(raci!)).toBe("Programme Manager");
  });
});

describe("resolveOwnerName", () => {
  it("resolves the matched activity's accountable role to a person", () => {
    expect(resolveOwnerName("Migration strategy risk", raci, roleToName)).toBe("Priya Patel");
  });

  it("falls back to the most-frequent accountable role when nothing matches", () => {
    expect(resolveOwnerName("Office coffee machine broken", raci, roleToName)).toBe("Sam Lee");
  });

  it("returns null when the roster cannot staff the role", () => {
    expect(resolveOwnerName("Migration strategy", raci, new Map())).toBeNull();
  });

  it("returns null when there is no RACI matrix", () => {
    expect(resolveOwnerName("anything", null, roleToName)).toBeNull();
  });
});

describe("buildRaciOwnerResolver", () => {
  const store = {
    inputFields: {
      mobilise: [
        {
          id: "coreTeamRoster",
          label: "Named individuals per core team role",
          type: "grid" as const,
          required: false,
          columns: [
            { key: "role", label: "Role" },
            { key: "name", label: "Name" },
          ],
        },
      ],
    },
  };
  const source = {
    raciMatrix: {
      activities: [
        { activity: "Define data migration strategy", accountable: "Solution Architect" },
        { activity: "Stakeholder communications plan", accountable: "Programme Manager" },
      ],
    },
    phaseInputs: {
      mobilise: {
        coreTeamRoster: JSON.stringify([
          { role: "Solution Architect", name: "Priya Patel" },
          { role: "Programme Manager", name: "Sam Lee" },
        ]),
      },
    },
  };

  it("builds a resolver that bridges RACI accountability to roster names", () => {
    const resolve = buildRaciOwnerResolver(source, store);
    expect(resolve).not.toBeNull();
    expect(resolve!("Data migration strategy gap")).toBe("Priya Patel");
  });

  it("returns null when the RACI matrix is absent", () => {
    expect(buildRaciOwnerResolver({ phaseInputs: source.phaseInputs }, store)).toBeNull();
  });

  it("returns null when the roster has no staffed rows", () => {
    const emptyRoster = { ...source, phaseInputs: { mobilise: { coreTeamRoster: "[]" } } };
    expect(buildRaciOwnerResolver(emptyRoster, store)).toBeNull();
  });
});
