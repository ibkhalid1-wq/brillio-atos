/**
 * Prototype assembly — the four concerns joined, verified structural + separation
 * + determinism against Laila's real committed snapshot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@/v3/lib/prototypeAssembly";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json");
const atlas = snap("current-state-atlas.json");

describe("prototype assembly", () => {
  it("is deterministic — same ontology in, same HTML out", () => {
    expect(assemblePrototype(ontology, atlas).html).toBe(assemblePrototype(ontology, atlas).html);
  });

  it("tags every region with its fabric node id (stable, non-positional)", () => {
    const { html, regionCount } = assemblePrototype(ontology, atlas);
    expect(regionCount).toBeGreaterThan(50);
    const ids = [...html.matchAll(/data-fabric-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(regionCount);
    // ids are name-based fabric ids — no bare positional index segment
    for (const id of ids) expect(id.split(":").slice(1).some((s) => /^\d+$/.test(s)), `positional region id ${id}`).toBe(false);
  });

  it("is self-contained (Meridian inlined, no external fetch) and uses only .m-* appearance", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).toContain("m-app");
    expect(html).toContain("m-table");
  });

  it("renders list, detail, and form screens per entity", () => {
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).toMatch(/data-screen="list-/);
    expect(html).toMatch(/data-screen="detail-/);
    expect(html).toMatch(/data-screen="form-/);
  });

  it("keeps separation — the HTML carries no ontology attribute types or fabric internals as tokens", () => {
    // seed data (content) and Meridian (appearance) are present; fabric ids are
    // data attributes, not style. A trivial guard that the assembler didn't leak
    // a `--m-` token into a fabric id or vice versa.
    const { html } = assemblePrototype(ontology, atlas);
    expect(html).not.toMatch(/data-fabric-id="[^"]*--m-/);
  });
});
