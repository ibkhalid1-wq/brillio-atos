/**
 * THE DISCOVERY KIT MAY PROPOSE. IT MAY NOT DELETE PEOPLE.
 *
 * The defect (found on the validation programme): "Reconcile with the Discovery
 * Kit" was a single button whose summary read "− 3 to remove: Priya
 * Raghunathan, João Álvares, Finance SME — TBC". Three humans an operator had
 * typed in, proposed for deletion in one click, for one reason: a GENERATED
 * document didn't list them. That inverts the ledger's own precedence —
 * asserted reality outranks generated artifacts — and it inverts it in the
 * direction that destroys the assertion.
 *
 * The kit's silence about a person is a fact about the KIT (generated before
 * they were added, or their role was never inventoried). It is not evidence
 * they left the programme, so it cannot be spent as if it were.
 *
 * What is pinned here:
 *   • absences come back FLAGGED, one at a time, each carrying its reason;
 *   • the one-click write CONSERVES — it has no path that drops anybody;
 *   • a confirmed removal is keyed on id, so a shared name can't take the
 *     wrong human with it (see peopleNameCollision.test.ts).
 */
import { describe, it, expect } from "vitest";
import type { ProgramSummary } from "@/new/types";
import {
  reconcilePeopleWithKit, reconcileDirectoryWrite, removeDirectoryPerson,
  kitCastIdentity, readDirectoryPeople, labelIdentity, KIT_ABSENCE_REASON,
} from "@/v3/components/flow/flowStakeholders";

const person = (id: string, name: string, role: string, movementId = "listen") =>
  ({ id, name, role, movementId, roleResolved: true, email: undefined });

const programme = (opts: {
  interviews?: Array<Record<string, string>>;
  personas?: Array<Record<string, unknown>>;
  planRoles?: string[];
  people?: ReturnType<typeof person>[];
}): ProgramSummary => ({
  id: "p1", name: "Validation", rawData: {
    data: {
      discoveryKit: { interviews: opts.interviews ?? [], personas: opts.personas ?? [] },
      phaseInputs: {
        frame: { listenPlan: JSON.stringify({ roles: opts.planRoles ?? [], areas: [], coverage: {}, dismissedAreas: [] }) },
        listen: { _directoryPeople: JSON.stringify(opts.people ?? []) },
      },
    },
  },
} as unknown as ProgramSummary);

describe("kitCastIdentity — what the generated kit actually knows", () => {
  it("reads interview roles and stakeholders, persona names, and the kit's coverage matrix", () => {
    const kit = kitCastIdentity(programme({
      interviews: [{ stakeholder: "Priya Raghunathan", role: "Finance" }],
      personas: [{ name: "Recruitment Operations Staff" }],
      planRoles: ["Fulfilment SME"],
    }));
    for (const label of ["Priya Raghunathan", "Finance", "Recruitment Operations Staff", "Fulfilment SME"]) {
      expect(kit.has(labelIdentity(label))).toBe(true);
    }
    expect(kit.has(labelIdentity("João Álvares"))).toBe(false);
  });
});

describe("reconcilePeopleWithKit", () => {
  const seeded = programme({
    interviews: [{ stakeholder: "Asha Rao", role: "Sales" }],
    personas: [{ name: "Recruitment Operations Staff", kind: "internal" }],
    people: [
      person("dp-1", "Priya Raghunathan", "Finance"),
      person("dp-2", "João Álvares", "Fulfilment"),
      person("dp-3", "Finance SME — TBC", "Finance SME"),
      person("dp-4", "Asha Rao", "Sales"),
    ],
  });
  const personas = [
    { name: "Recruitment Operations Staff", kind: "internal" },
    { name: "Patients", kind: "external" },
  ];

  it("has no bundled removal list at all — absences are FLAGGED, with the reason", () => {
    const out = reconcilePeopleWithKit(seeded, personas, readDirectoryPeople(seeded));
    expect("toRemove" in out).toBe(false);
    expect(out.flagged.map((f) => f.person.name).sort())
      .toEqual(["Finance SME — TBC", "João Álvares", "Priya Raghunathan"]);
    // The reason names the kit as the thing with the gap, and explicitly
    // refuses the inference the old copy invited.
    for (const { reason } of out.flagged) {
      expect(reason).toBe(KIT_ABSENCE_REASON);
      expect(reason).toMatch(/gap in the kit/i);
      expect(reason).toMatch(/not evidence/i);
    }
    // Someone the kit DOES name is never flagged.
    expect(out.flagged.some((f) => f.person.name === "Asha Rao")).toBe(false);
  });

  it("keeps additions one-gesture — internal personas only, externals stay display-only", () => {
    const out = reconcilePeopleWithKit(seeded, personas, readDirectoryPeople(seeded));
    expect(out.toAdd.map((p) => p.name)).toEqual(["Recruitment Operations Staff"]);
  });
});

describe("reconcileDirectoryWrite — the one-click write cannot subtract", () => {
  it("CONSERVATION: every person already on the record survives the reconcile", () => {
    const existing = [
      person("dp-1", "Priya Raghunathan", "Finance"),
      person("dp-2", "João Álvares", "Fulfilment"),
      person("dp-3", "Finance SME — TBC", "Finance SME"),
    ];
    const next = reconcileDirectoryWrite(existing, [{ name: "Recruitment Operations Staff" }], {
      stamp: "abc", roleResolved: () => false,
    });
    for (const before of existing) expect(next).toContainEqual(before);
    expect(next).toHaveLength(4);
    expect(next[3].name).toBe("Recruitment Operations Staff");
    expect(next[3].roleResolved).toBe(false);
  });

  it("with nothing to add it is a no-op, not a purge", () => {
    const existing = [person("dp-1", "Priya Raghunathan", "Finance")];
    expect(reconcileDirectoryWrite(existing, [], { stamp: "abc", roleResolved: () => true })).toEqual(existing);
  });
});

describe("removeDirectoryPerson — one confirmed person, keyed on identity not name", () => {
  it("removes exactly the confirmed row and leaves their namesake standing", () => {
    const existing = [
      person("dp-1", "A. Kumar", "Sales"),
      person("dp-2", "A. Kumar", "Finance"),
      person("dp-3", "Priya Raghunathan", "Finance"),
    ];
    const next = removeDirectoryPerson(existing, "dp-2");
    expect(next.map((p) => p.id)).toEqual(["dp-1", "dp-3"]);
  });
});

/**
 * The rule above only holds if the PAGE reads it. These two source checks exist
 * because the failure was never in the arithmetic — it was a bundled button —
 * and a pure function can't stop a view from re-deriving one. FlowShell mounts
 * the whole app graph (Supabase client, lazy studios), so rendering it here
 * would test the mocks; the source is read instead, as elsewhere in this suite.
 */
describe("the People page wires the proposal, not a diff-and-apply", () => {
  const shell = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../components/flow/FlowShell.tsx"), "utf8") as string;

  it("has no removal list left in the reconcile path", () => {
    expect(shell).not.toMatch(/toRemove/);
  });

  it("removes a flagged person only behind a per-person confirm", () => {
    expect(shell).toMatch(/armedDrop/);
    expect(shell).toMatch(/dropFlaggedPerson/);
    expect(shell).toMatch(/removeDirectoryPerson\(readDirectoryPeople\(program\), person\.id\)/);
    // …and the one-click button writes only what reconcileDirectoryWrite built.
    expect(shell).toMatch(/reconcileDirectoryWrite\(readDirectoryPeople\(program\), reconcile\.toAdd/);
  });
});
