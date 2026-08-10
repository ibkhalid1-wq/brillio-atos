import { describe, it, expect } from "vitest";
import { dedupePeopleRows, labelIdentity, personKey } from "@/v3/components/flow/flowStakeholders";

/**
 * The People page merges FOUR independent lists (Listen roster, delivery roles,
 * operator-added people, kit personas). This is the ONE rule that decides who is
 * who across them. The bug it fixes: the same human was listed twice because
 * identity was keyed on the ROLE, so a person whose row echoed their own name as
 * their role (the kit writes an interview with no `role`, and the reader falls
 * back to the stakeholder string) never collided with their own named row.
 *
 * The opposite failure is WORSE: merging two different humans. So every case
 * below that must stay two rows is asserted too.
 */

type Roster = { isRole: boolean; name: string; role: string };
type Roles = { name: string; role: string };
type Added = { name: string; role: string };

const rows = (roster: Roster[], roles: Roles[], added: Added[]) => {
  const d = dedupePeopleRows(roster, roles, added);
  return [
    ...d.addedD.map((r) => `added:${r.name}|${r.role}`),
    ...d.rosterD.map((r) => `roster:${r.name}|${r.role}`),
    ...d.rolesD.map((r) => `roles:${r.name}|${r.role}`),
  ];
};

describe("labelIdentity — the loose key, for ROLES/slots", () => {
  it("treats the stored '— TBC' placeholder token and its resolved label as ONE identity", () => {
    expect(labelIdentity("End Patient — TBC")).toBe(labelIdentity("End Patient"));
    expect(labelIdentity("Fulfilment SME – TBC")).toBe("fulfilment sme");
  });
  it("collapses punctuation spellings of one role label", () => {
    expect(labelIdentity("Sales / Head of Sales")).toBe(labelIdentity("Sales Head of Sales"));
    expect(labelIdentity("Sales (Head of Sales)")).toBe("sales");
  });
  it("keeps two different labels apart — it never edits the words themselves", () => {
    expect(labelIdentity("Head of Sales")).not.toBe(labelIdentity("Head of Sales, Markets"));
  });
});

describe("personKey — the strict key, for HUMANS", () => {
  it("treats the stored '— TBC' placeholder token and its resolved label as ONE identity", () => {
    expect(personKey("End Patient — TBC")).toBe(personKey("End Patient"));
  });
  it("ignores case and punctuation spacing, nothing more", () => {
    expect(personKey("prakash t m")).toBe(personKey("Prakash T M"));
    expect(personKey("Asha  Rao")).toBe(personKey("Asha Rao"));
  });
  it("NEVER discards words — the property that stops two humans fusing", () => {
    // labelIdentity drops parentheticals, which is right for roles and fatal for
    // people: these two DIFFERENT humans share one loose identity. personKey is
    // separate precisely so that can never decide who gets dropped.
    expect(labelIdentity("Sales Lead (Asha Rao)")).toBe(labelIdentity("Sales Lead (Prakash T M)"));
    expect(personKey("Sales Lead (Asha Rao)")).not.toBe(personKey("Sales Lead (Prakash T M)"));
    expect(personKey("Asha Rao")).not.toBe(personKey("Prakash T M"));
  });
});

describe("dedupePeopleRows", () => {
  it("(a) lists ONE row for the same person under two role spellings", () => {
    expect(rows(
      [{ isRole: false, name: "Prakash T M", role: "Head of Sales" }],
      [],
      [{ name: "Prakash T M", role: "Head of Sales, Markets" }],
    )).toHaveLength(1);
    // …from any pair of sources, including roster + delivery-role binding.
    expect(rows(
      [{ isRole: false, name: "Prakash T M", role: "Head of Sales" }],
      [{ name: "Prakash T M", role: "Head of Sales, Markets" }],
      [],
    )).toHaveLength(1);
  });

  it("(b) keeps TWO rows for two DIFFERENT people in the same role", () => {
    const out = rows(
      [{ isRole: false, name: "Asha Rao", role: "Head of Sales" }],
      [],
      [{ name: "Prakash T M", role: "Head of Sales" }],
    );
    expect(out).toHaveLength(2);
    expect(out.join(" ")).toContain("Asha Rao");
    expect(out.join(" ")).toContain("Prakash T M");
  });

  it("(b2) never merges two different non-empty names, however alike their rows", () => {
    const out = rows(
      [{ isRole: false, name: "Asha Rao", role: "Head of Sales" },
        { isRole: false, name: "Asha Raoul", role: "Head of Sales" }],
      [], [],
    );
    expect(out).toHaveLength(2);
  });

  it("(b3) two people whose names differ ONLY inside a parenthetical stay two rows", () => {
    // Regression: keying people on the loose label identity (which drops
    // parentheticals) reduced BOTH of these to "sales lead" and silently
    // deleted Prakash T M — a fabricated roster, worse than a duplicate.
    const out = rows(
      [{ isRole: false, name: "Sales Lead (Asha Rao)", role: "Head of Sales" },
        { isRole: false, name: "Sales Lead (Prakash T M)", role: "Head of Sales" }],
      [], [],
    );
    expect(out).toHaveLength(2);
    expect(out.join(" ")).toContain("Asha Rao");
    expect(out.join(" ")).toContain("Prakash T M");
  });

  it("(c) collapses a placeholder into the person who resolves it — the NAME wins", () => {
    const out = rows(
      [{ isRole: true, name: "", role: "Head of Sales" }],
      [],
      [{ name: "Prakash T M", role: "Head of Sales" }],
    );
    expect(out).toEqual(["added:Prakash T M|Head of Sales"]);
  });

  it("(c2) '<Role> — TBC' and '<Role>' are ONE identity, so the named person wins", () => {
    const out = rows(
      [{ isRole: true, name: "", role: "End Patient — TBC" }],
      [],
      [{ name: "Maya Iyer", role: "End Patient" }],
    );
    expect(out).toEqual(["added:Maya Iyer|End Patient"]);
  });

  it("(d) THE BUG: a row echoing the person's name as their role is that PERSON, not a second row", () => {
    // The kit wrote an interview with no `role`, so the reader put the person's
    // own name in both fields. Keyed on role, this never collided with their
    // named row and the human was listed twice.
    const out = rows(
      [{ isRole: false, name: "Prakash T M", role: "Prakash T M" }],
      [],
      [{ name: "Prakash T M", role: "Head of Sales" }],
    );
    expect(out).toHaveLength(1);
    // …and the surviving row states their REAL role, not their name echoed back.
    expect(out).toEqual(["added:Prakash T M|Head of Sales"]);
  });

  it("(d2) the echo row survives alone when nothing else names that person", () => {
    // Nothing proves the string is a human here, so it stays a role stand-in —
    // a miss stays visible rather than being quietly folded into someone else.
    expect(rows([{ isRole: false, name: "GTM Sales", role: "GTM Sales" }], [], []))
      .toEqual(["roster:GTM Sales|GTM Sales"]);
  });

  it("(e) a role echoed as a name is still a ROLE — it collapses into its named holder, once", () => {
    const out = rows(
      [{ isRole: false, name: "Head of Sales", role: "Head of Sales" },
        { isRole: true, name: "", role: "Head of Sales" }],
      [],
      [{ name: "Prakash T M", role: "Head of Sales" }],
    );
    expect(out).toEqual(["added:Prakash T M|Head of Sales"]);
  });

  it("(f) two DIFFERENT unfilled roles stay two rows — role spellings are matched exactly, never fuzzily", () => {
    const out = rows(
      [{ isRole: true, name: "", role: "Head of Sales" },
        { isRole: true, name: "", role: "Head of Sales, Markets" }],
      [], [],
    );
    expect(out).toHaveLength(2);
  });

  it("(g) keeps at most ONE stand-in per role across sources", () => {
    const out = rows(
      [{ isRole: true, name: "", role: "Legal" }],
      [{ name: "", role: "Legal" }],
      [{ name: "Legal", role: "Legal" }],
    );
    expect(out).toHaveLength(1);
  });

  it("(h) every kept row is unique by identity, and no input person disappears", () => {
    const roster: Roster[] = [
      { isRole: false, name: "Prakash T M", role: "Prakash T M" },
      { isRole: false, name: "Asha Rao", role: "Head of Sales" },
      { isRole: true, name: "", role: "Recruitment Ops — TBC" },
    ];
    const roles: Roles[] = [{ name: "Prakash T M", role: "Head of Sales, Markets" }, { name: "", role: "Solution Architect" }];
    const added: Added[] = [{ name: "Maya Iyer", role: "Recruitment Ops" }];
    const out = rows(roster, roles, added);
    // Conservation: every distinct human in, every distinct human out.
    const names = new Set(out.map((r) => r.split("|")[0].split(":")[1]).map(personKey));
    expect(names.has(personKey("Prakash T M"))).toBe(true);
    expect(names.has(personKey("Asha Rao"))).toBe(true);
    expect(names.has(personKey("Maya Iyer"))).toBe(true);
    // Prakash once, the resolved Recruitment Ops placeholder gone, the unfilled
    // Solution Architect still visible.
    expect(out.filter((r) => r.includes("Prakash T M"))).toHaveLength(1);
    expect(out.some((r) => r.includes("Recruitment Ops — TBC"))).toBe(false);
    expect(out.some((r) => r.includes("Solution Architect"))).toBe(true);
    expect(out).toHaveLength(4);
  });
});
