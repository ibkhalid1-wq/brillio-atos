/**
 * TWO PEOPLE CAN SHARE A NAME, and neither may vanish.
 *
 * The defect (found by driving the live UI against a seeded roster): the Listen
 * roster carried two entries both named "Head of Sales" with DIFFERENT roles —
 * "Sales" and "Sales Operations". The People page rendered ONE row. The second
 * human had no row, no conflict, no marker: they were simply gone, and the
 * "Head of Sales Operations" slot stayed unbound with nothing on screen
 * explaining why. Identity was keyed on the name alone, so the second entry
 * lost a claim it never knew it was making. At a 12,000-person firm two
 * "A. Kumar"s is a Tuesday; silently dropping one is data loss, and it is
 * invisible data loss, which is worse.
 *
 * The fix has to hold a fine line, and both sides of it are asserted here:
 *   • Two lists spelling ONE person's role differently is the cross-source case
 *     `dedupePeopleRows` exists to collapse — "Head of Sales" on the roster and
 *     "Head of Sales, Markets" on their delivery binding is one human, one row.
 *     (peopleDirectoryDedup.test.ts (a) pins that; it must not regress.)
 *   • One list stating two different roles for one name is TWO humans.
 *
 * Nothing is invented to tell them apart: the disambiguator is the role each
 * row already states, and `ambiguousNames` reports the collision so the page
 * can say "same name" out loud instead of letting it read as a glitch.
 */
import { describe, it, expect } from "vitest";
import { dedupePeopleRows, personKey } from "@/v3/components/flow/flowStakeholders";

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

describe("dedupePeopleRows — a shared name is not a duplicate", () => {
  it("THE BUG: one roster, two 'Head of Sales', two different roles — BOTH survive", () => {
    const out = rows(
      [{ isRole: false, name: "Head of Sales", role: "Sales" },
        { isRole: false, name: "Head of Sales", role: "Sales Operations" }],
      [], [],
    );
    expect(out).toHaveLength(2);
    // …and each one still states the role that distinguishes it, so the page
    // shows a person for the Sales Operations slot instead of leaving it blank.
    expect(out).toContain("roster:Head of Sales|Sales");
    expect(out).toContain("roster:Head of Sales|Sales Operations");
  });

  it("reports the collision so the operator sees two people, not a rendering bug", () => {
    const collide = dedupePeopleRows(
      [{ isRole: false, name: "A. Kumar", role: "Sales" },
        { isRole: false, name: "A. Kumar", role: "Finance" }],
      [], [],
    );
    expect(collide.ambiguousNames.has(personKey("A. Kumar"))).toBe(true);
    // No collision, no marker — the flag is evidence, not decoration.
    const clean = dedupePeopleRows(
      [{ isRole: false, name: "A. Kumar", role: "Sales" },
        { isRole: false, name: "B. Rao", role: "Finance" }],
      [], [],
    );
    expect(clean.ambiguousNames.size).toBe(0);
  });

  it("holds for the operator-added list and the delivery-role list too", () => {
    // Two people the operator typed in under one name…
    expect(rows([], [], [
      { name: "A. Kumar", role: "Sales" },
      { name: "A. Kumar", role: "Finance" },
    ])).toHaveLength(2);
    // …and one person bound to two delivery slots keeps BOTH slots visible,
    // rather than one binding disappearing off the page.
    expect(rows([], [
      { name: "Asha Rao", role: "Product Owner" },
      { name: "Asha Rao", role: "Solution Architect" },
    ], [])).toHaveLength(2);
  });

  it("still collapses an exact name+role repeat — that IS one person listed twice", () => {
    const out = rows(
      [{ isRole: false, name: "Head of Sales", role: "Sales" },
        { isRole: false, name: "Head of Sales", role: "Sales Operations" }],
      [],
      [{ name: "Head of Sales", role: "Sales" }],
    );
    expect(out).toHaveLength(2);
    // The added row (settled first) carries the Sales identity; the roster's
    // duplicate of it drops, and Sales Operations is untouched.
    expect(out).toContain("added:Head of Sales|Sales");
    expect(out).toContain("roster:Head of Sales|Sales Operations");
  });

  it("does NOT split one person whom two SOURCES spell differently", () => {
    // The over-correction to guard against: keying every row on name+role would
    // make "Head of Sales" (roster) and "Head of Sales, Markets" (their
    // delivery binding) two humans. One list saying two roles is a collision;
    // two lists saying two spellings is the merge this function is for.
    const out = rows(
      [{ isRole: false, name: "Prakash T M", role: "Head of Sales" }],
      [{ name: "Prakash T M", role: "Head of Sales, Markets" }],
      [],
    );
    expect(out).toHaveLength(1);
    expect(dedupePeopleRows(
      [{ isRole: false, name: "Prakash T M", role: "Head of Sales" }],
      [{ name: "Prakash T M", role: "Head of Sales, Markets" }],
      [],
    ).ambiguousNames.size).toBe(0);
  });

  it("CONSERVATION: with a collision in play, no input person is dropped", () => {
    const roster: Roster[] = [
      { isRole: false, name: "Head of Sales", role: "Sales" },
      { isRole: false, name: "Head of Sales", role: "Sales Operations" },
      { isRole: false, name: "Priya Raghunathan", role: "Finance" },
      { isRole: true, name: "", role: "Legal — TBC" },
    ];
    const out = rows(roster, [], [{ name: "João Álvares", role: "Fulfilment" }]);
    for (const name of ["Head of Sales|Sales", "Head of Sales|Sales Operations", "Priya Raghunathan", "João Álvares", "Legal"]) {
      expect(out.join(" ")).toContain(name);
    }
    expect(out).toHaveLength(5);
  });
});
