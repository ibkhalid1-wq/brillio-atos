/**
 * THE REASON BELONGS TO THE GROUP, NOT TO EVERY ROW.
 *
 * A Head of Marketing card carrying ten typing questions printed "answered by the
 * data dictionary, not by them" ten times down the side of the drawer — one fact,
 * restated until it read as noise, crowding out the questions themselves. The list
 * is now sectioned by bucket and each fact is stated once, as a heading.
 *
 * These rules live with the function rather than with the rendered card because the
 * DOM test cannot reach them: the person that test mounts happens to carry all four
 * buckets, so removing the empty-bucket filter changes nothing on screen and the
 * assertion passes over an absent subject. (It was written; it survived its
 * mutation; that is what that meant.)
 *
 * NOTE ON HOME: this cannot live in linkQuestionCapOneDefinition.test.ts, which
 * `vi.mock`s LINK_QUESTION_CAP to 3 to prove the mints read the export. The mock
 * substitutes what OTHER modules import; BUCKET_SECTION is built inside ownedLoad.ts
 * from the real constant at module load, so the two disagree by construction there.
 */
import { describe, it, expect } from "vitest";
import {
  BUCKET_SECTION, LINK_QUESTION_CAP, ownedLoadSections, type OwnedBucket,
} from "@/v3/lib/ledger/ownedLoad";

describe("ownedLoadSections — sections describe what is actually there", () => {
  const it_ = (bucket: OwnedBucket, about: string) => ({ about, slot: "s", bucket });

  it("an empty bucket gets no heading", () => {
    const sections = ownedLoadSections([it_("on-link", "a"), it_("blocked", "b")]);
    expect(sections.map((s) => s.bucket)).toEqual(["on-link", "blocked"]);
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it("REGRESSION: the dictionary bucket is not a section on a person's card", () => {
    // DELIBERATE (2026-08-12). Discover answers "who do I reach and what do they
    // owe". A locus routed to a data dictionary owes this person nothing — no
    // answer of theirs closes it and no link carries it — so it is not their row.
    // It stays in the ledger, the burn-down, the Record and the Inbox's dictionary
    // ask, which is where that work is chased and by whom.
    expect(ownedLoadSections([it_("dictionary", "d")])).toHaveLength(0);
    expect(BUCKET_SECTION.dictionary.onPersonCard).toBe(false);
    for (const b of ["on-link", "next-link", "blocked"] as OwnedBucket[]) {
      expect(BUCKET_SECTION[b].onPersonCard, `${b} is this person's work`).toBe(true);
    }
  });

  it("sections keep list order regardless of the order items arrive in", () => {
    const sections = ownedLoadSections([
      it_("blocked", "c"), it_("next-link", "b"), it_("on-link", "a"),
    ]);
    expect(sections.map((s) => s.bucket)).toEqual(["on-link", "next-link", "blocked"]);
  });

  it("every item lands in exactly one section — nothing is dropped or doubled", () => {
    const items = [it_("on-link", "a"), it_("on-link", "b"), it_("blocked", "c")];
    const out = ownedLoadSections(items).flatMap((s) => s.items);
    expect(out).toHaveLength(items.length);
    expect(new Set(out.map((i) => i.about)).size).toBe(items.length);
  });

  it("the section nobody works through starts CLOSED; the ones addressed to a person start open", () => {
    // 36 rows of "What type of value is Lead.status?" is not this person's work —
    // one upload closes all of them. Open, it buried the eight questions that ARE
    // addressed to them. Closed, its count and its reason are still on screen.
    expect(BUCKET_SECTION.dictionary.defaultOpen).toBe(false);
    for (const bucket of ["on-link", "next-link", "blocked"] as OwnedBucket[]) {
      expect(BUCKET_SECTION[bucket].defaultOpen, `${bucket} is asked of this person and must be open`).toBe(true);
    }
  });

  it("nothing owned means no sections at all", () => {
    expect(ownedLoadSections([])).toEqual([]);
  });

  it("every bucket has copy — a section can never head an unexplained group", () => {
    for (const bucket of ["on-link", "next-link", "blocked", "dictionary"] as OwnedBucket[]) {
      expect(BUCKET_SECTION[bucket].title.trim().length).toBeGreaterThan(0);
      expect(BUCKET_SECTION[bucket].note.trim().length).toBeGreaterThan(0);
    }
    // The cap is named from its ONE declaration, never typed as a literal.
    expect(BUCKET_SECTION["next-link"].note).toContain(String(LINK_QUESTION_CAP));
  });
});
