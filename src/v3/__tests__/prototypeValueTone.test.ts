/**
 * CHIP TONING — a table you can read without reading it (2026-08-16).
 *
 * Two defects in one renderer line: every status rendered the same grey badge,
 * so "Closed Won" and "Closed Lost" looked identical; and health/priority were
 * pinned to `m-pill--warn` for EVERY value, so a record reading "Healthy" was
 * drawn as a warning. The benchmark's at-a-glance quality is exactly this.
 *
 * What keeps it honest is what the vocabulary LEAVES OUT: only words that state
 * their own verdict are toned. Bare magnitudes are not — "High" is good on an
 * influence column and bad on a risk one, and a system that guessed would be
 * colouring in its own assumption.
 */
import { describe, expect, it } from "vitest";
import { valueTone } from "@shared/prototypeDesignSystem.ts";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { loadPrototype } from "./helpers/renderPrototype";

describe("§1 the vocabulary", () => {
  it("tones the states that state a verdict", () => {
    for (const v of ["Healthy", "Closed Won", "Active", "Paid", "Approved", "Converted", "On Track"]) {
      expect(valueTone(v), `${v} should read positive`).toBe("good");
    }
    for (const v of ["At Risk", "Closed Lost", "Overdue", "Cancelled", "Disqualified", "Blocked", "Critical"]) {
      expect(valueTone(v), `${v} should read as risk`).toBe("risk");
    }
    for (const v of ["Watch", "Pending", "On Hold", "Paused", "In Review", "Awaiting"]) {
      expect(valueTone(v), `${v} should read as attention`).toBe("warn");
    }
  });

  it("risk is tested FIRST, so a lost deal is not caught by a positive phrase", () => {
    expect(valueTone("Closed Lost")).toBe("risk");
    expect(valueTone("Closed Won")).toBe("good");
  });

  it("leaves ambiguous and neutral values alone — the load-bearing omission", () => {
    // Magnitudes: good on influence, bad on risk. The system does not guess.
    for (const v of ["High", "Medium", "Low", "Tier 1"]) expect(valueTone(v)).toBeNull();
    // Ordinary pipeline stages state no verdict.
    for (const v of ["Prospecting", "New", "Qualifying", "Proposal", "Draft", "Planned"]) expect(valueTone(v)).toBeNull();
    expect(valueTone("")).toBeNull();
    expect(valueTone(null)).toBeNull();
  });
});

describe("§2 the build wears them", () => {
  const ontology = {
    entities: [{ name: "Account", attributes: [
      { name: "accountName", kind: "string" },
      { name: "health", kind: "enum", values: ["Healthy", "Watch", "At Risk"] },
      { name: "accountStatus", kind: "enum", values: ["Active", "Prospecting", "Closed Lost"] },
    ] }],
    relations: [],
  };
  const atlas = { workflows: [{ name: "Serve", owner: "Sales", steps: [{ action: "Review", entities: ["Account"] }] }] };
  const built = assemblePrototype(ontology, atlas);

  it("ships a tone lookup for the values that carry one, and only those", () => {
    const island = JSON.parse(built.html.match(/id="m-seed">([\s\S]*?)<\/script>/)![1].replace(/\\u003c/g, "<"));
    expect(island.tones.Healthy).toBe("good");
    expect(island.tones["At Risk"]).toBe("risk");
    expect(island.tones.Watch).toBe("warn");
    expect(island.tones.Prospecting).toBeUndefined();   // states no verdict
  });

  it("a healthy record is no longer drawn as a warning", () => {
    const doc = loadPrototype(built.html, { entities: ["Account"], url: "https://p.test/#account" }).window.document;
    const html = doc.querySelector('[data-screen="list-account"]')!.innerHTML;
    // the old renderer pinned EVERY health value to --warn
    expect(html).toMatch(/m-pill--good|m-badge--good/);
    expect(html).toMatch(/m-pill--risk|m-badge--risk/);
    const healthy = [...doc.querySelectorAll("span")].find((s) => s.textContent?.trim() === "Healthy");
    expect(healthy?.className ?? "").not.toMatch(/warn/);
  });

  it("a build whose values state nothing carries no lookup at all", () => {
    const plain = assemblePrototype({
      entities: [{ name: "Account", attributes: [
        { name: "accountName", kind: "string" },
        { name: "accountStage", kind: "enum", values: ["Prospecting", "Proposal"] },
      ] }], relations: [],
    }, atlas);
    expect(plain.html).not.toContain('"tones"');
  });
});
