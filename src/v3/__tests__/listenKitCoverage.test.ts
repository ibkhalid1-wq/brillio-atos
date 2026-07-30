/**
 * The Discovery Kit → Listen coverage binding.
 *
 * The kit's matrix is where coverage is DECLARED ("Vimal Pandey covers
 * Finance"). Listen used to ignore it and re-derive the answer by scoring
 * people against Atlas workflows, so anyone the Atlas had not placed made
 * their area read "no one covers this area" — which is exactly what Finance
 * did on Laila CRM during a live demo while the kit plainly assigned it.
 *
 * These tests drive the real listenAreaCoverage with a programme whose Atlas
 * is deliberately EMPTY, so the only way coverage can be found is by reading
 * the kit.
 */
import { describe, expect, it } from "vitest";
import { listenAreaCoverage, listenCoverageAreas, type CoverageRole } from "@/v3/components/flow/listenCoverage";
import type { ProgramSummary } from "@/new/types";

/** A programme with a kit that assigns Finance, and no Atlas at all. */
const program = (coverageMap: Array<Record<string, unknown>>): ProgramSummary => ({
  id: "p1", name: "Laila CRM",
  rawData: {
    data: {
      discoveryKit: { coverageMap },
      // No atlas workflows and no ontology: stakeholderPrimaryArea can only
      // return General, so an inference-only path finds nobody.
    },
  },
} as unknown as ProgramSummary);

const ROLES: CoverageRole[] = [
  { label: "Head of Finance", name: "Vimal Pandey", added: false },
  { label: "Head of Sales", name: "Avantika Sharma", added: false },
];
const AREAS = [{ label: "Finance", added: false }, { label: "Sales", added: false }];

const coverageFor = (p: ProgramSummary, area: string) => {
  const plan = { coverage: {}, areas: [], roles: [], dismissedAreas: [], dismissedRoles: [] } as never;
  return listenAreaCoverage(p, plan, ROLES, AREAS).find((r) => r.area === area);
};

describe("discovery kit → listen coverage", () => {
  it("an area the kit assigns is covered, even with an empty atlas", () => {
    const p = program([{ domain: "Finance", coveredBy: ["Vimal Pandey"] }]);
    expect(coverageFor(p, "Finance")?.roles).toEqual(["Head of Finance"]);
  });

  it("reads coveredBy as a comma string as well as an array", () => {
    const p = program([{ domain: "Finance", coveredBy: "Vimal Pandey, Avantika Sharma" }]);
    expect(coverageFor(p, "Finance")?.roles.sort()).toEqual(["Head of Finance", "Head of Sales"]);
  });

  it("a compound domain covers every area it spans", () => {
    // The kit writes spanning people as "Finance / Sales / Practices".
    const p = program([{ domain: "Finance / Sales / Practices", coveredBy: ["Avantika Sharma"] }]);
    expect(coverageFor(p, "Finance")?.roles).toEqual(["Head of Sales"]);
    expect(coverageFor(p, "Sales")?.roles).toEqual(["Head of Sales"]);
  });

  it("strips a TBC suffix so the label still resolves to the person", () => {
    const p = program([{ domain: "Finance", coveredBy: ["Vimal Pandey — TBC"] }]);
    expect(coverageFor(p, "Finance")?.roles).toEqual(["Head of Finance"]);
  });

  it("the kit does not invent coverage for an area it never mentions", () => {
    // "Sales" is still covered here, but by the role-label inference, NOT by
    // the kit — the kit only spoke about Finance. Asserting the kit's own
    // contribution keeps this test about the binding rather than the fallback.
    const p = program([{ domain: "Finance", coveredBy: ["Vimal Pandey"] }]);
    expect(coverageFor(p, "Finance")?.roles).toEqual(["Head of Finance"]);
    expect(coverageFor(p, "Sales")?.roles).not.toContain("Head of Finance");
  });

  it("the operator's explicit override still outranks the kit", () => {
    const p = program([{ domain: "Finance", coveredBy: ["Vimal Pandey"] }]);
    const plan = { coverage: { Finance: ["Head of Sales"] }, areas: [], roles: [], dismissedAreas: [], dismissedRoles: [] } as never;
    const row = listenAreaCoverage(p, plan, ROLES, AREAS).find((r) => r.area === "Finance");
    expect(row?.roles).toEqual(["Head of Sales"]);
    expect(row?.explicit).toBe(true);
  });

  it("a name the roster does not know contributes nothing from the kit", () => {
    // Head of Finance still self-covers by role label; the point is that the
    // unknown name adds no one, rather than minting a phantom participant.
    const p = program([{ domain: "Finance", coveredBy: ["Someone Not On The Programme"] }]);
    expect(coverageFor(p, "Finance")?.roles).not.toContain("Someone Not On The Programme");
  });

  it("the kit's domains still surface as areas", () => {
    const p = program([{ domain: "Finance", coveredBy: ["Vimal Pandey"] }]);
    expect(listenCoverageAreas(p).map((a) => a.label)).toContain("Finance");
  });
});
