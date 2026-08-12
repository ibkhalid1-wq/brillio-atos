/**
 * ASK ONLY WHAT YOU CANNOT WORK OUT.
 *
 * Measured on the live CRM: 173 open "what type of value is X?" questions, and
 * `deriveRoles` — Aura's own semantic-role reader — already produced a role for
 * every one of them. The same system rendered `Account.annual revenue` as a
 * currency column in the prototype while asking a person what type of value
 * `Account.annual revenue` is. The capability was wired to one surface and not
 * the other.
 *
 * The danger in fixing that is obvious and it is the reason for every rule below:
 * a reading of a FIELD NAME is not knowledge of the client's business. So the
 * cases here are weighted to what must NOT happen — a guess outranking a stated
 * fact, a low-confidence guess being spent at all, a question disappearing
 * without anyone being told.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  derivedTypeProposals, derivedTypeClaims, DERIVED_TYPE_FLOOR, DERIVED_TYPE_PROVENANCE,
} from "@/v3/lib/ledger/derivedTypes";
import { dictionaryProvenance } from "@/v3/lib/ledger/dictionary";
import { migrate, type Snapshot } from "@/v3/lib/ledger/migrate";
import { buildUnknownQueue } from "@/v3/lib/ledger/projections";
import { reconcile } from "@/v3/lib/ledger/merge";
import { deriveRoles } from "@shared/semanticRoles.ts";

const locus = (entity: string, attr: string) =>
  `el:attr:${entity.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${attr.toLowerCase().replace(/[^a-z0-9]+/g, "-")}#dataType`;

describe("what it proposes, and what it refuses to", () => {
  const open = new Set([locus("Account", "annual revenue"), locus("Account", "segment"), locus("Account", "owner")]);

  it("a strong reading becomes a proposal", () => {
    const out = derivedTypeProposals(
      [{ entity: "Account", attribute: "annual revenue", role: "monetary", confidence: 0.85 }], open,
    );
    expect(out).toHaveLength(1);
    expect(out[0].dataType).toBe("currency");
  });

  it("REGRESSION: below the floor it stays a question, even for a role we CAN type", () => {
    // The case must discriminate. `person-ref` at 0.55 is excluded for having no
    // type mapping at all, so it proves nothing about the floor — deleting the
    // floor left that version of this test green. `category` at 0.6 is the real
    // discriminator: `semanticRoles` scores "type|segment|tier|region" there, it
    // maps cleanly to picklist, and it is still only a guess about a name.
    expect(DERIVED_TYPE_FLOOR).toBe(0.7);
    expect(derivedTypeProposals(
      [{ entity: "Account", attribute: "segment", role: "category", confidence: 0.6 }], open,
    ), "a 0.6 guess was spent on the operator's attention").toHaveLength(0);
    // and the same role at a real signal's confidence IS proposed
    expect(derivedTypeProposals(
      [{ entity: "Account", attribute: "segment", role: "category", confidence: 0.8 }], open,
    )).toHaveLength(1);
  });

  it("a role that is not a TYPE proposes nothing", () => {
    // `identifier`, `title` and the reference roles say what a field is FOR. Closing
    // a dataType locus with "reference" would answer the question while telling
    // nobody what it points at.
    for (const role of ["identifier", "title", "parent-ref", "person-ref", "cross-ref"]) {
      expect(derivedTypeProposals(
        [{ entity: "Account", attribute: "segment", role, confidence: 0.95 }], open,
      ), role).toHaveLength(0);
    }
  });

  it("REGRESSION: it only ever fills a GAP — a locus not open is never touched", () => {
    // The caller passes the loci still open after every real source has spoken, so
    // an uploaded dictionary always wins. A heuristic must never compete with a
    // document the client actually wrote.
    expect(derivedTypeProposals(
      [{ entity: "Contact", attribute: "email", role: "code", confidence: 0.9 }], open,
    )).toHaveLength(0);
  });

  it("an enumerated role types the field and leaves its VALUES open", () => {
    const out = derivedTypeProposals(
      [{ entity: "Account", attribute: "segment", role: "category", confidence: 0.8 }], open,
    );
    expect(out[0].dataType).toBe("picklist");
    // nothing here claims to know WHICH values — a name cannot tell you them
    expect(out.every((p) => p.about.endsWith("#dataType"))).toBe(true);
  });

  it("two readings of one locus propose once", () => {
    const out = derivedTypeProposals([
      { entity: "Account", attribute: "segment", role: "category", confidence: 0.8 },
      { entity: "Account", attribute: "segment", role: "status", confidence: 0.75 },
    ], open);
    expect(out).toHaveLength(1);
  });
});

describe("the claim it writes is the weakest on the record", () => {
  const claims = () => derivedTypeClaims(derivedTypeProposals(
    [{ entity: "Account", attribute: "annual revenue", role: "monetary", confidence: 0.85 }],
    new Set([locus("Account", "annual revenue")]),
  ));

  it("REGRESSION: code-derived and weak — a human answer always wins", () => {
    const c = claims()[0];
    expect(c.source).toBe("code-derived");
    expect(c.status).toBe("weak");
  });

  it("its provenance is a READING, not a document", () => {
    // The merge rules tell a client's stated fact from a machine's guess by this
    // token; if it looked like a dictionary the two would be indistinguishable.
    expect(claims()[0].closedBy?.by).toBe(DERIVED_TYPE_PROVENANCE);
    expect(DERIVED_TYPE_PROVENANCE).not.toBe(dictionaryProvenance("uploaded-dictionary"));
    expect(DERIVED_TYPE_PROVENANCE.startsWith("dictionary:")).toBe(false);
  });
});

describe("on the real ontology", () => {
  const ontology = () => JSON.parse(readFileSync(
    resolve(__dirname, "../../../docs/laila/snapshot-2026-08-07/domain-ontology.json"), "utf8"));

  it("it answers real questions, and leaves real ones open", () => {
    const store = migrate({ ontology: ontology(), atlas: {}, overrides: [] } as unknown as Snapshot);
    const openBefore = buildUnknownQueue(store).items.filter((i) => i.status === "open");
    const openTypes = new Set(openBefore.filter((i) => i.slot === "dataType").map((i) => i.about));
    expect(openTypes.size, "no typing questions — this case would prove nothing").toBeGreaterThan(10);

    const roles = deriveRoles(ontology() as Record<string, unknown>).attributeRoles as never[];
    const proposals = derivedTypeProposals(roles, openTypes);
    expect(proposals.length, "the reader proposed nothing at all").toBeGreaterThan(0);

    reconcile(store, derivedTypeClaims(proposals), new Set(store.elements().map((e) => e.id)));
    const openAfter = buildUnknownQueue(store).items.filter((i) => i.status === "open");

    // it moved the wall...
    expect(openAfter.length).toBe(openBefore.length - proposals.length);
    // ...and did not flatten it: a name cannot type everything, and what it
    // cannot type must still be asked.
    expect(openAfter.some((i) => i.slot === "dataType"), "every typing question was guessed away").toBe(true);
  });

  it("REGRESSION: a stated answer is never overwritten by a reading", () => {
    // The ordering rule made concrete: seed only over what is still open, and a
    // locus somebody answered is not open.
    const store = migrate({ ontology: ontology(), atlas: {}, overrides: [] } as unknown as Snapshot);
    const first = buildUnknownQueue(store).items.find((i) => i.status === "open" && i.slot === "dataType")!;
    store.assert({
      about: first.about, value: { kind: "scalar", value: "a human said so" },
      source: "asserted", world: "to-be", layer: "configuration",
      ownerWhileOpen: { kind: "unowned" }, status: "closed",
    });
    const stillOpen = new Set(buildUnknownQueue(store).items
      .filter((i) => i.status === "open" && i.slot === "dataType").map((i) => i.about));
    const roles = deriveRoles(ontology() as Record<string, unknown>).attributeRoles as never[];
    expect(derivedTypeProposals(roles, stillOpen).some((p) => p.about === first.about),
      "a reading was proposed over a locus a person had answered").toBe(false);
  });
});

describe("the shrink is never silent", () => {
  const INBOX = readFileSync(resolve(__dirname, "../components/flow/OperatorInbox.tsx"), "utf8");

  it("REGRESSION: the count is stated where the typing wall is discussed", () => {
    expect(INBOX).toContain("read from the field names, not answered by anyone");
    expect(INBOX, "the proposals are not counted from the ledger").toContain("ledger.derivedTypes");
  });

  it("proposals alone keep the section on screen", () => {
    // Otherwise a programme whose whole typing wall was derived would show
    // nothing — the burn-down would have shrunk with no explanation anywhere.
    expect(INBOX).toContain("!settled.length && !derived.length");
  });

  it("the copy says it is the weakest claim, and that a dictionary beats it", () => {
    expect(INBOX).toContain("code-derived · weak");
    expect(INBOX).toContain("A real dictionary is still the better answer");
  });
});
