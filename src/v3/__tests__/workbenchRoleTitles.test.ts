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
import { businessRole, deriveWorkbenches } from "@shared/atlasWorkbenches.ts";
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
    expect(built.html).toMatch(/the people these workflows hand off to/);
  });
});
