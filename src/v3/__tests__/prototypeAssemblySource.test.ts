/**
 * ONE prototype assembly, reached by BOTH runtimes — and what a stakeholder actually gets.
 *
 * The stakeholder-facing portal used to serve the stored, MODEL-AUTHORED
 * `prototypeBuild.html` while the operator's studio rendered a deterministic
 * assembly derived from the ontology + atlas. Two artefacts, one name: the client
 * validated something nobody could trace back to the record.
 *
 * Deno cannot import from `src/v3` — that boundary is real, and it is why
 * `edgeLockstep` / `answerCapLockstep` / `unnamedSuffixLockstep` exist. But it is a
 * boundary on ONE direction only. `supabase/functions/_shared` is importable from
 * Deno (relative path) AND from Vite/vitest (the `@shared` alias), so the cluster
 * moved THERE and both sides import the same file. No mirror, no lockstep — the
 * pinning this file does is that no mirror is ever reintroduced.
 *
 * Every assertion below fails on the pre-change tree:
 *   - the cluster used to live in `src/v3/lib` (unreachable from Deno);
 *   - `flow-portal` used to read `prototypeBuild.html` and send it as `pilotHtml`;
 *   - there was no gap for the missing-record case, only a silent nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { pilotSliceFor } from "@shared/prototypePilot.ts";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const snap = (f: string) => JSON.parse(read(`docs/laila/snapshot-2026-08-07/${f}`)) as Record<string, unknown>;

/** The four concerns plus the assembler that joins them. */
const CLUSTER = ["prototypeAssembly.ts", "fabric.ts", "semanticRoles.ts", "seedData.ts", "prototypeDesignSystem.ts"] as const;
const SHARED = "supabase/functions/_shared";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) return [];
  if (statSync(path).isDirectory()) return walk(path);
  return /\.tsx?$/.test(path) ? [path] : [];
});

// ── the cluster has ONE home, reachable from both runtimes ──────────────────────
describe("the assembly cluster lives in exactly one place", () => {
  it("all five modules are in the Deno-importable shared layer", () => {
    for (const f of CLUSTER) {
      expect(() => read(`${SHARED}/${f}`), `${f} is not in ${SHARED}`).not.toThrow();
    }
  });

  it("NO MIRROR: the declarations exist once across src/ and supabase/functions/", () => {
    // Scans real source, not a hand-kept list, so a copy pasted back into
    // src/v3/lib tomorrow is caught the day it lands. Comments are stripped — the
    // arrangement is described in prose in several files, and a guard that fires
    // on its own documentation gets deleted.
    const EXPORTS = [
      "assemblePrototype",
      "deriveFabric",
      "deriveRoles",
      "generateSeed",
      "meridianStylesheet",
    ];
    const files = [...walk(resolve(ROOT, "src")), ...walk(resolve(ROOT, "supabase/functions"))];
    expect(files.length, "source scan found nothing — the walk is broken").toBeGreaterThan(20);
    const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const name of EXPORTS) {
      const declaring: string[] = [];
      for (const path of files) {
        const rel = relative(ROOT, path);
        if (rel.includes("__tests__")) continue;
        if (new RegExp(`export (function|const) ${name}\\b`).test(codeOnly(readFileSync(path, "utf8")))) declaring.push(rel);
      }
      expect(
        declaring,
        `\n${name} is declared in ${declaring.length} files:\n${declaring.join("\n")}\n` +
        `It must be declared exactly once, in ${SHARED}. Both runtimes import that copy —\n` +
        `Deno by relative path, the client via the "@shared" alias. A second declaration is\n` +
        `how the operator's prototype and the stakeholder's silently diverge.\n`,
      ).toHaveLength(1);
      expect(declaring[0].startsWith(SHARED), `${name} is declared outside ${SHARED}`).toBe(true);
    }
  });

  it("stays importable by BOTH runtimes: no remote, npm: or node: imports in the cluster", () => {
    // Deno resolves these; vitest/Vite would too, for some. The point is the cluster
    // must remain pure so `deno check` passes on it without network and the client
    // bundle stays free of server dependencies. It is pure derivation either way.
    for (const f of [...CLUSTER, "prototypePilot.ts"]) {
      const src = read(`${SHARED}/${f}`);
      const specs = [...src.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
      for (const spec of specs) {
        expect(spec.startsWith("./"), `${f} imports "${spec}" — the cluster must stay self-contained`).toBe(true);
        expect(spec.endsWith(".ts"), `${f} imports "${spec}" without a .ts extension — Deno cannot resolve it`).toBe(true);
      }
    }
  });
});

// ── the operator and the stakeholder see the SAME bytes ─────────────────────────
describe("operator and stakeholder are served one artefact", () => {
  it("the studio and the portal both reach the shared assembler, not a local copy", () => {
    const studio = read("src/v3/components/flow/studio/PrototypeStudio.tsx");
    expect(studio).toContain("assemblePrototype");
    expect(studio, "the studio must import the shared assembler").toContain("@shared/prototypeAssembly.ts");

    const portal = read("supabase/functions/flow-portal/index.ts");
    expect(portal, "the portal must import the shared pilot").toContain("../_shared/prototypePilot.ts");
  });

  it("the portal no longer serves the stored model-authored build to anyone", () => {
    const portal = read("supabase/functions/flow-portal/index.ts");
    const codeLines = portal.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const offenders = codeLines.filter((l) => l.includes("prototypeBuild"));
    expect(
      offenders,
      `\nflow-portal reads prototypeBuild in code:\n${offenders.join("\n")}\n` +
      `That blob is model-authored. Serving it on a stakeholder link is the behaviour\n` +
      `this change removed; the refine loop keeps it operator-side (run-agent + the studio).\n`,
    ).toEqual([]);
  });

  it("the same inputs give the studio and the portal identical HTML", () => {
    const ontology = snap("domain-ontology.json");
    const atlas = snap("current-state-atlas.json");
    const studioHtml = assemblePrototype(ontology, atlas).html;          // what PrototypeStudio renders
    const portalSlice = pilotSliceFor({ domainOntology: ontology, currentStateAtlas: atlas });
    expect(portalSlice.pilotHtml).toBe(studioHtml);                       // byte-for-byte
    expect(portalSlice.pilotSource).toBe("assembled");
    expect(portalSlice.pilotGap).toBeUndefined();
  });

  it("the served prototype is Meridian-styled and carries zero source-app leakage", () => {
    const slice = pilotSliceFor({ domainOntology: snap("domain-ontology.json"), currentStateAtlas: snap("current-state-atlas.json") });
    expect(slice.pilotHtml).toContain("--m-warn:#9c5c0e");
    expect(slice.pilotHtml).toMatch(/class="m-/);
    expect(/laila/i.test(slice.pilotHtml ?? ""), "the stakeholder's page leaks the source-app name").toBe(false);
  });
});

// ── the missing-data case is a VISIBLE GAP, never a substitution ────────────────
describe("when the record cannot produce an assembly", () => {
  const modelHtml = "<!doctype html><title>model-authored</title><p>written by the build agent</p>";

  it("no ontology and no atlas: names both, sends no html", () => {
    const slice = pilotSliceFor({ prototypeBuild: { html: modelHtml } });
    expect(slice.pilotHtml).toBeUndefined();
    expect(slice.pilotSource).toBeUndefined();
    expect(slice.pilotGap).toContain("the domain ontology");
    expect(slice.pilotGap).toContain("the current-state atlas");
  });

  it("one side missing: names THAT side, not a generic apology", () => {
    const onlyOntology = pilotSliceFor({ domainOntology: { entities: [] } });
    expect(onlyOntology.pilotGap).toContain("the current-state atlas");
    expect(onlyOntology.pilotGap).not.toContain("the domain ontology");

    const onlyAtlas = pilotSliceFor({ currentStateAtlas: { workflows: [] } });
    expect(onlyAtlas.pilotGap).toContain("the domain ontology");
    expect(onlyAtlas.pilotGap).not.toContain("the current-state atlas");
  });

  it("an ontology with no entities is a gap, not an empty shell that reads as broken", () => {
    const slice = pilotSliceFor({ domainOntology: { entities: [] }, currentStateAtlas: { workflows: [] } });
    expect(slice.pilotHtml).toBeUndefined();
    expect(slice.pilotGap).toContain("no entities");
  });

  it("THE POINT: the stored model build is never substituted for the assembly", () => {
    // Every shape that cannot assemble, with a perfectly good model-authored build
    // sitting right there on the record. None of them may reach for it.
    const withModelBuild = (rest: Record<string, unknown>) => pilotSliceFor({ prototypeBuild: { html: modelHtml }, ...rest });
    for (const [label, inner] of [
      ["nothing on the record", {}],
      ["ontology only", { domainOntology: { entities: [{ name: "Case", attributes: ["status"] }] } }],
      ["atlas only", { currentStateAtlas: { workflows: [] } }],
      ["empty ontology", { domainOntology: { entities: [] }, currentStateAtlas: { workflows: [] } }],
      ["ontology is not a record", { domainOntology: "see the appendix", currentStateAtlas: { workflows: [] } }],
    ] as const) {
      const slice = withModelBuild(inner as Record<string, unknown>);
      expect(slice.pilotHtml, `${label}: served the model-authored build`).toBeUndefined();
      expect(slice.pilotGap, `${label}: silently sent nothing instead of naming the gap`).toBeTruthy();
      expect(JSON.stringify(slice)).not.toContain("model-authored");
    }
  });

  it("the gap is written for the stakeholder, not for the engineer", () => {
    const slice = pilotSliceFor({});
    const gap = slice.pilotGap ?? "";
    expect(gap.length).toBeGreaterThan(40);
    // No internal identifiers in a message an external client reads.
    for (const jargon of ["domainOntology", "currentStateAtlas", "prototypeBuild", "undefined", "null", "regionCount"]) {
      expect(gap, `the gap message leaks "${jargon}"`).not.toContain(jargon);
    }
  });
});

// ── the page prints the gap and the provenance ─────────────────────────────────
describe("the linked page shows what it was given", () => {
  const respond = read("src/v3/components/flow/FlowRespond.tsx");

  it("renders pilotGap rather than dropping it", () => {
    expect(respond).toContain("pilotGap");
    expect(respond, "a gap that nothing renders is the same as no gap").toMatch(/<PilotGap gap=\{state\.pack\.pilotGap\}/);
  });

  it("states the provenance of an assembled prototype to the person validating it", () => {
    expect(respond).toContain("pilotSource");
    expect(respond).toMatch(/pilotSource === "assembled"/);
  });
});
