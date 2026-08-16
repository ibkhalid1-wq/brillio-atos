/**
 * THE WALK HAS TO REACH THE BOTTOM.
 *
 * A stakeholder demo is a WALK: open an Account, see its Opportunities, open
 * one, see its Tasks. The build drew every level of that and made only the
 * first one openable — the child collections on a detail screen rendered their
 * rows with the `action` flag off, so from an Account you could SEE its
 * Opportunities and not reach a single one. The walk died two screens in, and
 * everything below the dead row — the Opportunity's own children, its
 * contacts — was unreachable in a demo of an application that contained it.
 *
 * It looked complete, which is why it survived: the rows were there, the counts
 * were right, the empty states were right. Only the walk was missing.
 *
 * These cases walk it, in the loaded document, following the same handlers a
 * person clicks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

const built = assemblePrototype(ontology, atlas);
const load = () => loadPrototype(built.html);

/** Every collection card the detail screens draw, with the rows it renders. */
const collectionCards = (doc: Document) =>
  [...doc.querySelectorAll('section[data-screen^="detail-"] .m-card')]
    .map((card) => ({
      screen: card.closest("[data-screen]")!.getAttribute("data-screen")!,
      title: card.querySelector(".m-card-t")?.textContent?.trim() ?? "",
      rows: [...card.querySelectorAll("tbody tr")],
      card,
    }))
    .filter((c) => c.rows.length);

describe("a collection row is a way in, not a picture of one", () => {
  it("every child row on every detail screen can be opened", () => {
    const { document } = load().window;
    const cards = collectionCards(document);
    expect(cards.length, "no detail screen drew a collection at all").toBeGreaterThan(3);
    for (const c of cards) {
      for (const row of c.rows) {
        const open = row.querySelector(".m-row-actions button");
        expect(open, `${c.screen} · ${c.title}: a row with no way into it`).not.toBeNull();
      }
    }
  });

  it("the control goes to the CHILD's detail, not back to the record you are on", () => {
    const { document } = load().window;
    const [first] = collectionCards(document);
    const open = first.rows[0].querySelector(".m-row-actions button")!;
    const handler = open.getAttribute("onclick") ?? "";
    // The row's OWN id, not the entity's showcase record — the defect `cells`
    // records in its own comment, guarded here at the level it matters.
    const id = first.rows[0].querySelector(".m-cell-sub")?.textContent?.trim();
    expect(id).toBeTruthy();
    expect(handler).toContain(id!);
    expect(handler).not.toContain(first.screen.replace("detail-", "") + "'");
  });

  it("the head row still matches the body — an action column needs a column", () => {
    // A body row one cell wider than its head is the kind of defect that reads
    // as a rendering bug to a client and never as a missing <th>.
    const { document } = load().window;
    for (const c of collectionCards(document)) {
      const heads = c.card.querySelectorAll("thead th").length;
      for (const row of c.rows) {
        expect(row.querySelectorAll("td").length, `${c.screen} · ${c.title}`).toBe(heads);
      }
    }
  });
});

describe("the walk reaches the bottom", () => {
  it("a chain of at least three screens is reachable by clicking", () => {
    // Account → Opportunity → whatever the Opportunity owns. Followed through
    // the document, not asserted from the ontology: the point is that the
    // BUILD offers it.
    const { document } = load().window;
    const detailOf = (slug: string) => document.querySelector(`section[data-screen="detail-${slug}"]`);
    const firstChildSlug = (screen: Element | null): string | null => {
      if (!screen) return null;
      const open = screen.querySelector(".m-card tbody tr .m-row-actions button");
      const m = /#([a-z0-9-]+)\//.exec(open?.getAttribute("onclick") ?? "");
      return m ? m[1] : null;
    };
    const start = [...document.querySelectorAll('section[data-screen^="detail-"]')]
      .map((s) => s.getAttribute("data-screen")!.replace("detail-", ""))
      .find((slug) => firstChildSlug(detailOf(slug)));
    expect(start, "no detail screen leads anywhere").toBeTruthy();

    const walked = [start!];
    let here = start!;
    for (let step = 0; step < 4; step += 1) {
      const next = firstChildSlug(detailOf(here));
      if (!next || walked.includes(next)) break;
      walked.push(next);
      here = next;
    }
    expect(walked.length, `the walk stopped at ${walked.join(" → ")}`).toBeGreaterThanOrEqual(3);
  });

  it("every screen the walk lands on exists — a control into nothing is worse than none", () => {
    const { document } = load().window;
    const screens = new Set([...document.querySelectorAll("[data-screen]")].map((s) => s.getAttribute("data-screen")));
    for (const button of document.querySelectorAll(".m-card .m-row-actions button, .m-chip")) {
      const m = /#([a-z0-9-]+)/.exec(button.getAttribute("onclick") ?? "");
      if (!m) continue;
      expect(screens.has(`detail-${m[1]}`), `nothing at #${m[1]}`).toBe(true);
    }
  });

  it("the page still loads clean with the rows wired", () => {
    const loaded = load();
    expect(loaded.consoleErrors).toEqual([]);
  });
});
