/**
 * THE DETAIL PAGE SHOWS THE RECORD WITH THE MOST TO SHOW.
 *
 * It showed `rows[0]` — and the seed deliberately gives the FIRST parent row
 * zero children as the cardinality extreme (seedData: "first parent gets 0,
 * second gets max"). The two rules composed into a demo that argued against
 * itself: on the curated Laila build 16 of 22 child sections read "No X yet"
 * while 95 opportunities sat in the seed, so an exec clicking Account saw an
 * empty CRM. The extreme belongs in the SEED, where the stress tests live —
 * not on the one record each entity gets to demo.
 */
import { describe, it, expect } from "vitest";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { generateSeed } from "@shared/seedData.ts";
import { deriveFabric } from "@shared/fabric.ts";

const ent = (name: string, attributes: string[]) => ({ name, attributes, definition: name });
const ontology = {
  entities: [
    ent("Account", ["id", "name"]),
    ent("Opportunity", ["id", "name", "accountId"]),
    ent("Contact", ["id", "name", "accountId"]),
  ],
  relations: [
    { from: "Account", to: "Opportunity", cardinality: "1:N" },
    { from: "Account", to: "Contact", cardinality: "1:N" },
  ],
};

const detailOf = (html: string, slug: string) => {
  const at = html.indexOf(`data-screen="detail-${slug}"`);
  const end = html.indexOf("<section class=\"m-screen\"", at + 1);
  return html.slice(at, end === -1 ? undefined : end);
};

describe("the showcase record", () => {
  const html = assemblePrototype(ontology, {}).html;
  const detail = detailOf(html, "account");

  it("is a record that HAS children — not the zero-child stress extreme", () => {
    // MUTATION: `const r = rows[0]` → the empty extreme is back on stage and
    // every child section below reads "No X yet".
    expect(detail).not.toContain("No Opportunity yet");
    expect(detail).not.toContain("No Contact yet");
  });

  it("agrees with the seed about who the fullest parent is", () => {
    // The pick is derived, not row-two-by-convention: it must be a row whose
    // child count is the maximum the seed actually produced.
    const seed = generateSeed(ontology, deriveFabric(ontology, {}).version);
    const count = (id: unknown) =>
      (seed.records["Opportunity"] ?? []).filter((c) => String(c.accountId) === String(id)).length
      + (seed.records["Contact"] ?? []).filter((c) => String(c.accountId) === String(id)).length;
    const max = Math.max(...(seed.records["Account"] ?? []).map((a) => count(a.id)));
    const winners = (seed.records["Account"] ?? []).filter((a) => count(a.id) === max);
    expect(max, "the fixture lost its fan-out — no row has children").toBeGreaterThan(0);
    // The headline on the detail page is one of the fullest rows' display names.
    expect(winners.some((w) => detail.includes(String(w._display ?? w.id)))).toBe(true);
  });

  it("still renders a detail for an entity with no children at all", () => {
    // Contact owns nothing; the reduce must fall back to rows[0], not to
    // nothing. A missing detail screen would be a dead "Open" on every row.
    expect(detailOf(html, "contact")).toContain('data-screen="detail-contact"');
  });
});
