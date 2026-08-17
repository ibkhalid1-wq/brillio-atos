/**
 * A ROLE IS A JOB, NOT A CONSULTING CREDENTIAL (2026-08-16, operator direction).
 *
 * The discovery kit casts its interviewees as "Marketing SME" / "Sales SME" —
 * right for an engagement roster, where SME distinguishes the person we
 * interviewed from the department. The atlas inherits those names as workflow
 * owners and the prototype rendered them verbatim, so a client's own product
 * showed them a sidebar of SMEs: a word from our methodology, describing them,
 * on a screen that is meant to be theirs.
 */
import { describe, expect, it } from "vitest";
import { areaOf, businessRole, deriveWorkbenches } from "@shared/atlasWorkbenches.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { loadPrototype } from "./helpers/renderPrototype";

describe("the credential comes off, the job stays", () => {
  it("drops the trailing credential in the forms an atlas actually writes", () => {
    expect(businessRole("Marketing SME")).toBe("Marketing");
    expect(businessRole("Sales Operations SME")).toBe("Sales Operations");
    expect(businessRole("Delivery SME ")).toBe("Delivery");
    expect(businessRole("Legal (SME)")).toBe("Legal");
    expect(businessRole("Alliances - SME")).toBe("Alliances");
    expect(businessRole("Talent Acquisition Subject Matter Expert")).toBe("Talent Acquisition");
  });

  it("never eats a real title", () => {
    expect(businessRole("Executive Sponsor")).toBe("Executive Sponsor");
    expect(businessRole("Sales")).toBe("Sales");
    // "Smetana" must not lose its tail to a word-boundary-less match
    expect(businessRole("Smetana")).toBe("Smetana");
    // a name that is ONLY the credential keeps it — "" names nobody
    expect(businessRole("SME")).toBe("SME");
    expect(businessRole("")).toBe("");
  });
});

describe("the prototype says the job everywhere it says the person", () => {
  const atlas = {
    workflows: [
      { name: "Campaign Management", area: "Marketing", owner: "Marketing SME", steps: [
        { actor: "Marketing SME", action: "Launch the campaign.", entities: ["Campaign"] },
        { actor: "Sales SME", action: "Accept the qualified leads.", entities: ["Lead"] },
      ] },
    ],
  };
  const ontology = {
    entities: [
      { name: "Campaign", area: "Marketing", attributes: [{ name: "campaignName", kind: "string" }] },
      { name: "Lead", area: "Sales", attributes: [{ name: "leadName", kind: "string" }] },
    ],
    relations: [],
  };

  it("the role, its slug and its collaborators are all job titles", () => {
    const roles = deriveWorkbenches(atlas);
    expect(roles[0].role).toBe("Marketing");
    expect(roles[0].slug).toBe("marketing");
    expect(roles[0].collaborators).toEqual(["Sales"]);
  });

  it("no screen a stakeholder reads carries the word", () => {
    const built = assemblePrototype(ontology, atlas);
    const doc = loadPrototype(built.html, { entities: ["Campaign", "Lead"], url: "https://p.test/" }).window.document;
    const text = doc.body.textContent ?? "";
    expect(text).toMatch(/Marketing/);
    expect(text).not.toMatch(/\bSME\b/i);
    // …and the menu/heading agree
    expect(doc.querySelector('[data-screen="work-marketing"]')).toBeTruthy();
  });

  it("and the workbench stops naming our own documents at a client", () => {
    const built = assemblePrototype(ontology, atlas);
    expect(built.html).not.toMatch(/actors the atlas names/);
    // The list is the job titles on these steps. It used to be described as
    // "who these workflows hand off to", which was true when the board was
    // headed by a job title and stopped being true when it became an area:
    // on Marketing's own board, Marketing's people are not a handoff.
    expect(built.html).toMatch(/Worked by Sales\./);
  });
});

/**
 * A WORKBENCH IS A PLACE, NOT A PERSON (2026-08-17, operator direction).
 *
 * Grouping by the workflow's OWNER made a menu of job titles — and on the
 * measured atlas, three of them ("Sales reps - Markets", "GTM - Practices",
 * "Sales") were the same part of the business seen from three engagements, and
 * one ("Executive Sponsor") was a person. The atlas already states the answer:
 * every workflow carries an `area`, and those are the words the client uses for
 * their own business.
 */
describe("the workbench is the area the work happens in", () => {
  const atlas = {
    workflows: [
      { name: "Signal generation", area: "Marketing", owner: "Marketing", steps: [{ actor: "Demand gen lead", action: "Run it" }] },
      { name: "Qualification", area: "Sales", owner: "Sales reps - Markets", steps: [{ actor: "Sales rep", action: "Qualify" }] },
      { name: "Deal shaping", area: "Sales", owner: "GTM - Practices", steps: [{ actor: "Solution lead", action: "Shape" }] },
    ],
  };

  it("two owners in one area share one workbench", () => {
    // THE POINT. By owner this was two boards, each holding half of Sales.
    const boards = deriveWorkbenches(atlas);
    expect(boards.map((b) => b.role)).toEqual(["Marketing", "Sales"]);
    expect(boards[1].workflows.map((w) => w.name)).toEqual(["Qualification", "Deal shaping"]);
  });

  it("the people are still named — on the steps, where WHO belongs", () => {
    // The heading says where; the step says who. Nothing is lost by grouping.
    const boards = deriveWorkbenches(atlas);
    expect(boards[1].collaborators).toEqual(["Sales rep", "Solution lead"]);
  });

  it("a workflow with no area falls back to its owner rather than vanishing", () => {
    expect(areaOf({ name: "x", slug: "x", area: "", owner: "Legal SME", trigger: "", steps: [], handoffs: [], index: 0 }))
      .toBe("Legal");
    const orphan = deriveWorkbenches({ workflows: [{ name: "Unowned", steps: [] }] });
    expect(orphan).toHaveLength(1);
    expect(orphan[0].role).toBe("");
  });

  it("on the real atlas the boards are parts of the business, not job titles", () => {
    // MEASURED, not assumed. The count does not drop on this atlas — 11 owners,
    // 11 areas — and that is worth saying plainly rather than claiming a
    // collapse. What changes is WHAT THE NAMES ARE: the owner list held
    // "Sales reps - Markets", "Sales Leaders - Markets", "GTM Leaders -
    // Practices" — three ways of saying who, two of them seniority. The area
    // list holds Sales, Practices, Customer Success: places the work happens.
    const live = JSON.parse(readFileSync(
      resolve(__dirname, "../../../docs/laila/snapshot-2026-08-07/current-state-atlas.json"), "utf8"));
    const boards = deriveWorkbenches(live).map((b) => b.role);
    expect(boards).toContain("Sales");
    expect(boards).toContain("Customer Success");
    // Nothing on the menu describes a seat, a seniority or an engagement.
    expect(boards.some((b) => /\bsme\b|sponsor|reps\b|leaders\b/i.test(b)), boards.join(" · ")).toBe(false);
  });
});
