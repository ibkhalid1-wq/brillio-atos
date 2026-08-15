/**
 * A RENDER-BASED QA GATE, MEASURED ON BOTH PATHS.
 *
 * The model-written prototype path ships defects the JSON around it cannot
 * show. On the reviewed CRM build, four were true at once:
 *
 *   1. stat cards out of flow over the tables, hiding columns on every screen;
 *   2. the page script threw on load;
 *   3. three ontology entities appeared nowhere, while `gaps` came back `[]`;
 *   4. a row badged "Qualified (BANT)" inside a table headed
 *      "Leads (Unqualified)".
 *
 * `auditPrototype` is the gate. This suite drives it from both ends:
 *
 *   FAILS on a fixture reproducing all four defects — one finding per check,
 *   each naming what is wrong in words that can be handed straight back to the
 *   generator.
 *
 *   PASSES on the assembled build, which is the output the gate has to leave
 *   alone. Assembled from the real 33-entity snapshot AND from a three-entity
 *   ontology in another domain, so "passes" is not a property of one scale.
 *
 * And because a gate that passes everything also passes the assembled build,
 * two controls inject ONE defect into that same real build and require the
 * gate to go red — then reserve space for the same card and require it to go
 * green again. That pins the PROPERTY (out-of-flow content over a table's
 * flow, with no room reserved) rather than the presence of a CSS keyword.
 *
 * The document is parsed and its script is RUN before anything is asserted —
 * no regex over the source. That mistake has been made twice in this area.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { auditPrototype, qaFeedback, visibleText, pxOf } from "@/v3/lib/prototypeQa";
import { loadPrototype } from "./helpers/renderPrototype";

const snap = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;
const entitiesOf = (o: Record<string, unknown>) =>
  (Array.isArray(o.entities) ? o.entities : []).map((e) => String((e as { name?: unknown }).name ?? "")).filter(Boolean);

/** A three-entity ontology from another domain — the gate must not have
 *  learned the shape of one build. */
const surgeryOntology = {
  entities: [
    { name: "Case", attributes: ["id", "name", "status", "priority"] },
    { name: "Anesthesia Record", attributes: ["id", "type", "caseId"] },
    { name: "OR Slot", attributes: ["id", "state"] },
  ],
  relations: [
    { from: "Case", to: "Anesthesia Record", cardinality: "1:N" },
    { from: "OR Slot", to: "Case", cardinality: "1:N" },
  ],
} as unknown as Record<string, unknown>;

// ── the reproduction: a model-written build carrying all four defects ─────────

/**
 * Written to the shape of the refined path's output — token block, app shell,
 * a dashboard and a list screen — with the four defects in it and nothing
 * else wrong. It is a REPRODUCTION, not a minimal trigger: each defect is
 * expressed the way the real build expressed it, so the checks are measured
 * against the thing they exist for.
 */
const REFINED_WITH_DEFECTS = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Prototype</title>
<style>
:root{--brand:#2d6a4f;--ink:#101418;--line:#e4e7ec;--surface:#fff;--muted:#5b6472}
body{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif;color:var(--ink);background:#f7f8fa}
.app{display:grid;grid-template-columns:220px 1fr}
.side{background:var(--brand);color:#eef4f0;padding:20px 14px;height:100vh}
.side a{display:block;color:#eef4f0;text-decoration:none;padding:7px 10px;border-radius:6px}
.main{padding:28px 32px}
.screen{position:relative;padding:0}
.screen[hidden]{display:none}
.page-h{margin-bottom:18px}
.h1{font-size:22px;font-weight:650;margin:0}
.sub{color:var(--muted);margin:4px 0 0}
/* THE DEFECT: the stat row is lifted out of flow and painted across the top of
   the screen, where the table flows. Its own box is content-sized, so nothing
   in the declarations can show it clear of the table. */
.stat-row{position:absolute;top:8px;right:0;display:flex;gap:12px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat-n{font-size:22px;font-weight:650}
.stat-l{color:var(--muted);font-size:12px}
/* …and a second one with a declared box, over the same flow. */
.kpi{position:absolute;top:96px;left:0;width:260px;height:104px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px}
.card-h{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.card-t{font-weight:600}
.badge{background:#eef2f6;border-radius:999px;padding:2px 9px;font-size:12px}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);padding:8px 10px}
td{padding:9px 10px;border-bottom:1px solid var(--line)}
.pill{background:#e7f3ec;color:#1c5738;border-radius:999px;padding:2px 9px;font-size:12px}
.toast{position:absolute;bottom:16px;right:16px;display:none;background:var(--ink);color:#fff;padding:12px 16px;border-radius:8px}
</style></head><body>
<div class="app">
  <aside class="side"><div style="font-weight:650;margin-bottom:14px">Pipeline</div>
    <a href="#" onclick="show('dashboard')">Dashboard</a>
    <a href="#" onclick="show('leads')">Leads</a>
    <a href="#" onclick="show('accounts')">Accounts</a>
  </aside>
  <main class="main">
    <section class="screen" data-screen="dashboard">
      <div class="page-h"><h1 class="h1">Revenue operations</h1><p class="sub">Live pipeline health</p></div>
      <div class="stat-row">
        <div class="stat"><div class="stat-n">$4.2M</div><div class="stat-l">Open pipeline</div></div>
        <div class="stat"><div class="stat-n">38%</div><div class="stat-l">Win rate</div></div>
      </div>
      <div class="kpi"><div class="stat-n">17</div><div class="stat-l">Deals closing this month</div></div>
      <div class="card">
        <div class="card-h"><span class="card-t">Opportunity</span><span class="badge">3</span></div>
        <table><thead><tr><th>Name</th><th>Stage</th><th>Amount</th></tr></thead>
        <tbody>
          <tr><td>Northwind renewal</td><td><span class="pill">Proposal</span></td><td>$180,000</td></tr>
          <tr><td>Contoso expansion</td><td><span class="pill">Proposal</span></td><td>$240,000</td></tr>
          <tr><td>Fabrikam pilot</td><td><span class="pill">Discovery</span></td><td>$62,000</td></tr>
        </tbody></table>
      </div>
      <canvas id="pipeline-chart" width="600" height="220"></canvas>
    </section>
    <section class="screen" data-screen="leads" hidden>
      <div class="page-h"><h1 class="h1">Leads</h1><p class="sub">Working queue</p></div>
      <div class="stat-row">
        <div class="stat"><div class="stat-n">126</div><div class="stat-l">New this week</div></div>
      </div>
      <div class="card">
        <div class="card-h"><span class="card-t">Leads (Unqualified)</span><span class="badge">4</span></div>
        <table><thead><tr><th>Contact</th><th>Company</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Dana Whitfield</td><td>Northwind</td><td><span class="pill">Qualified (BANT)</span></td></tr>
          <tr><td>Priya Raman</td><td>Contoso</td><td><span class="pill">Working</span></td></tr>
          <tr><td>Sam Oduya</td><td>Fabrikam</td><td><span class="pill">Working</span></td></tr>
          <tr><td>Lena Fischer</td><td>Tailspin</td><td><span class="pill">Working</span></td></tr>
          <tr><td>Marc Bellamy</td><td>Adventure Works</td><td><span class="pill">Working</span></td></tr>
        </tbody></table>
      </div>
    </section>
    <section class="screen" data-screen="accounts" hidden>
      <div class="page-h"><h1 class="h1">Account</h1><p class="sub">Book of business</p></div>
      <div class="card">
        <div class="card-h"><span class="card-t">Account</span><span class="badge">2</span></div>
        <table><thead><tr><th>Name</th><th>Owner</th></tr></thead>
        <tbody>
          <tr><td>Northwind Traders</td><td>D. Whitfield</td></tr>
          <tr><td>Contoso Ltd</td><td>P. Raman</td></tr>
        </tbody></table>
      </div>
    </section>
    <div class="toast">Saved</div>
  </main>
</div>
<script>
function show(id){document.querySelectorAll('.screen').forEach(function(s){s.hidden=s.getAttribute('data-screen')!==id});}
show('dashboard');
document.getElementById('pipeline-chart').getContext('2d');
// THE DEFECT: the chart the build advertises is wired to a second element it
// never rendered, so the page throws on load and the dashboard stays
// half-drawn.
document.getElementById('revenue-chart').getContext('2d');
</script>
</body></html>`;

/** What the ontology said the build had to cover, and what the build DECLARED
 *  it had missed — `[]`, exactly as the reviewed build reported it. */
const REFINED_ENTITIES = ["Account", "Contact", "Lead", "Opportunity", "Quote", "Contract", "Territory"];
const REFINED_GAPS: string[] = [];

describe("the gate fails on a build carrying the four defects", () => {
  const loaded = loadPrototype(REFINED_WITH_DEFECTS, { entities: REFINED_ENTITIES, gaps: REFINED_GAPS });
  const report = auditPrototype(loaded);

  it("fails, and fails on ALL FOUR checks — not on whichever one is loudest", () => {
    expect(report.passed).toBe(false);
    for (const check of ["layout-overlap", "console-errors", "entity-coverage", "header-agreement"] as const) {
      expect(report.byCheck[check].filter((f) => f.severity === "error").length, `${check} found no offender`).toBeGreaterThan(0);
    }
  });

  it("1 · names the out-of-flow cards over the table, whether or not their box resolves", () => {
    const overlaps = report.byCheck["layout-overlap"].filter((f) => f.severity === "error");
    // Both screens carry a stat row; one screen also carries a declared-box KPI.
    expect(overlaps.length).toBeGreaterThanOrEqual(3);
    expect(overlaps.some((f) => /260×104px/.test(f.message)), "the resolvable box is not quoted").toBe(true);
    expect(overlaps.some((f) => /cannot be resolved/.test(f.message)), "the unresolvable box is waved through").toBe(true);
    // It says WHERE, in the page's own terms.
    expect(overlaps.map((f) => f.where)).toContain('screen "leads"');
  });

  it("2 · reports the page's own load-time exception, and not jsdom's unimplemented surfaces", () => {
    const consoleFindings = report.byCheck["console-errors"];
    expect(consoleFindings.length).toBe(1);
    expect(consoleFindings[0].message).toMatch(/revenue-chart|null|getContext/i);
    // The <canvas> the page DOES render makes jsdom complain about a surface it
    // has not implemented. That is this environment's limit, not the page's
    // defect, and it must not be laundered into a page error.
    expect(loaded.notImplemented.length).toBeGreaterThan(0);
    expect(report.byCheck["console-errors"].some((f) => /not implemented/i.test(f.message))).toBe(false);
  });

  it("3 · names each entity that is absent while gaps says nothing", () => {
    const missing = report.byCheck["entity-coverage"].filter((f) => f.severity === "error");
    expect(missing.map((f) => f.message.match(/"([^"]+)"/)?.[1]).sort()).toEqual(["Contract", "Quote", "Territory"]);
    // Entities the build DID render are not accused.
    for (const rendered of ["Account", "Contact", "Lead", "Opportunity"]) {
      expect(missing.some((f) => f.message.includes(`"${rendered}"`)), `${rendered} is on the screen`).toBe(false);
    }
  });

  it("3 · an absence the build DECLARES is a warning, not a failure", () => {
    const declared = auditPrototype(loadPrototype(REFINED_WITH_DEFECTS, {
      entities: REFINED_ENTITIES,
      gaps: ["No fixture exists for Quote or Contract yet", "Territory is not in the Experience Design"],
    }));
    const coverage = declared.byCheck["entity-coverage"];
    expect(coverage.filter((f) => f.severity === "error")).toEqual([]);
    expect(coverage.filter((f) => f.severity === "warning").length).toBe(3);
  });

  it("4 · catches the header its own rows contradict, and the count they deny", () => {
    const disagreements = report.byCheck["header-agreement"];
    const contradiction = disagreements.find((f) => /Qualified \(BANT\)/.test(f.message));
    expect(contradiction, "the Qualified row inside the Unqualified table went unnoticed").toBeTruthy();
    expect(contradiction!.message).toMatch(/Leads \(Unqualified\)/);
    expect(contradiction!.where).toMatch(/row 1/);
    // The same section claims 4 and renders 5, with nothing saying it is a page
    // of a longer list.
    expect(disagreements.some((f) => /states 4, and its table renders 5 rows/.test(f.message))).toBe(true);
    // The truthful sections are left alone.
    expect(disagreements.every((f) => !/Account/.test(f.where ?? ""))).toBe(true);
  });

  it("hands the generator something it can act on", () => {
    const feedback = qaFeedback(report);
    expect(feedback).toMatch(/failed 4 of the 4 render checks/);
    expect(feedback).toMatch(/Quote/);
    expect(feedback).toMatch(/Leads \(Unqualified\)/);
    expect(feedback.split("\n").length).toBeGreaterThan(report.errors.length);
    // A passing report has nothing to say.
    expect(qaFeedback({ ...report, passed: true, errors: [] })).toBe("");
  });
});

// ── the assembled build has to survive its own gate ──────────────────────────

describe("the gate passes the assembled build", () => {
  for (const [label, on, at] of [
    ["the 33-entity snapshot", ontology, atlas],
    ["a three-entity ontology from another domain", surgeryOntology, {} as Record<string, unknown>],
  ] as const) {
    it(`${label}: no errors on any of the four checks`, () => {
      const { html } = assemblePrototype(on as Record<string, unknown>, at as Record<string, unknown>);
      const loaded = loadPrototype(html, { entities: entitiesOf(on as Record<string, unknown>), gaps: [] });
      const report = auditPrototype(loaded);
      expect(qaFeedback(report)).toBe("");
      expect(report.passed).toBe(true);
    });
  }

  /**
   * COVERAGE IS JUDGED AGAINST WHAT THE BUILD DECLARES, on either path.
   *
   * A curated build renders the operator's chosen parent screens and reaches
   * the rest only as child collections, so an entity neither chosen nor owned
   * by a chosen one is in the ontology and nowhere in the app. That is a
   * legitimate operator decision — and it is still an absence, so it has to be
   * DECLARED rather than left for a stakeholder to notice. The gate reports it
   * as a silent drop until something declares it, and as a warning once
   * something does. (The assembled path has no `gaps` channel today; the
   * caller supplies the declaration.)
   */
  it("an absence stays an error until the build declares it — on the assembled path too", () => {
    const names = entitiesOf(ontology);
    const { html } = assemblePrototype(ontology, atlas, ["Account", "Opportunity", "Contact", "Partner"]);
    const undeclared = auditPrototype(loadPrototype(html, { entities: names, gaps: [] }));
    const absent = undeclared.byCheck["entity-coverage"]
      .filter((f) => f.severity === "error")
      .map((f) => f.message.match(/"([^"]+)"/)![1]);
    // Whatever curation left out, declaring it turns the silent drop into a
    // stated one — and nothing else about the build changes verdict.
    const declared = auditPrototype(loadPrototype(html, {
      entities: names,
      gaps: absent.map((n) => `${n} is not on a curated screen in this build`),
    }));
    expect(declared.byCheck["entity-coverage"].filter((f) => f.severity === "error")).toEqual([]);
    expect(declared.byCheck["entity-coverage"].filter((f) => f.severity === "warning").length).toBe(absent.length);
    expect(declared.passed).toBe(true);
  });

  it("and the pass is not vacuous — the gate really examined the document", () => {
    const { html } = assemblePrototype(ontology, atlas);
    const loaded = loadPrototype(html, { entities: entitiesOf(ontology), gaps: [] });
    // Tables, headings and entities are all present in quantity: if any of the
    // three came back empty the suite above would pass by finding nothing to
    // check, which is the shape of a guard that has quietly stopped working.
    const tables = loaded.doc.querySelectorAll("table");
    expect(tables.length).toBeGreaterThan(20);
    expect(entitiesOf(ontology).length).toBeGreaterThan(20);
    // Every table is under a heading the checker can read — the header/row
    // agreement check is comparing against something.
    const headed = Array.from(tables).filter((t) => {
      const card = t.closest("section,div");
      return card && visibleText(card).length > 0;
    });
    expect(headed.length).toBe(tables.length);
    // The screens the entities live on really rendered.
    expect(loaded.doc.querySelectorAll("[data-screen]").length).toBeGreaterThan(20);
  });
});

// ── the controls: one defect in, red; the room reserved for it, green ────────

describe("the overlap check pins the property, not a keyword", () => {
  const assembled = assemblePrototype(surgeryOntology, {}).html;
  /** Inject a stat card into the real assembled build, exactly as the model
   *  path draws one: a positioned container, a card lifted out of its flow. */
  const withStatCard = (extraContainerCss: string) => assembled.replace(
    "</head>",
    `<style>.m-screen{position:relative;${extraContainerCss}}
     .qa-stat{position:absolute;top:8px;right:0;width:240px;height:88px;background:#fff;border:1px solid #ddd}</style></head>`,
  ).replace(/(<section class="m-screen"[^>]*>)/, '$1<div class="qa-stat"><b>$4.2M</b> Open pipeline</div>');

  it("goes RED when a card is lifted over a table's flow in a build that was green", () => {
    const report = auditPrototype(loadPrototype(withStatCard(""), { entities: entitiesOf(surgeryOntology), gaps: [] }));
    expect(report.passed).toBe(false);
    expect(report.byCheck["layout-overlap"].some((f) => f.severity === "error" && /240×88px/.test(f.message))).toBe(true);
  });

  it("goes GREEN again when the container reserves room for that same card", () => {
    // Identical card, identical position — the container now pads past its
    // bottom edge, so the table's flow starts below it. Nothing about the
    // element changed; the LAYOUT FACT did.
    const report = auditPrototype(loadPrototype(withStatCard("padding-top:120px;"), { entities: entitiesOf(surgeryOntology), gaps: [] }));
    expect(report.byCheck["layout-overlap"].filter((f) => f.severity === "error")).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("reports what it cannot decide — hidden, viewport-anchored, or too small to hide a column — without failing on it", () => {
    const overlay = assembled.replace(
      "</head>",
      `<style>.m-screen{position:relative}
       .qa-modal{position:absolute;top:0;left:0;width:400px;height:300px;display:none}
       .qa-toast{position:fixed;right:20px;bottom:20px;width:220px;height:52px}
       .qa-close{position:absolute;top:6px;right:6px;width:28px;height:28px}</style></head>`,
    ).replace(/(<section class="m-screen"[^>]*>)/, '$1<div class="qa-modal">Confirm</div><div class="qa-toast">Saved</div><button class="qa-close">×</button>');
    const report = auditPrototype(loadPrototype(overlay, { entities: entitiesOf(surgeryOntology), gaps: [] }));
    expect(report.passed).toBe(true);
    const kinds = report.byCheck["layout-overlap"].filter((f) => f.severity === "warning").map((f) => f.message);
    expect(kinds.some((m) => /hidden at load/.test(m)), "a hidden overlay went unmentioned").toBe(true);
    expect(kinds.some((m) => /position:fixed/.test(m)), "viewport chrome went unmentioned").toBe(true);
    // A 28×28 corner control does paint over the flow, and it cannot hide a
    // column. Failing a build for it would train everyone to ignore the gate.
    expect(kinds.some((m) => /28×28px/.test(m) && /too small to hide a column/.test(m)), "corner chrome went unmentioned").toBe(true);
  });

  it("catches the other way a card lands on a table: a negative margin", () => {
    // Injected AFTER the list region — the element the page fills with its
    // table — so the pulled card lands on that table's flow once the document
    // has rendered. It used to be spliced after a literal `</table>`, which the
    // served markup stopped containing when the rows became data; the defect is
    // the same one, expressed against the structure the assembler still emits.
    const pulled = assembled
      .replace("</head>", `<style>.qa-pull{margin-top:-48px;height:60px}</style></head>`)
      .replace(/(<div data-fabric-id="screen:[^"]*:list"><\/div>)/, '$1<div class="qa-pull">Totals</div>');
    const report = auditPrototype(loadPrototype(pulled, { entities: entitiesOf(surgeryOntology), gaps: [] }));
    expect(report.byCheck["layout-overlap"].some((f) => f.severity === "error" && /48px up/.test(f.message))).toBe(true);
  });
});

describe("the header check reads a negation, not a prefix", () => {
  /** Two sections, one word apart: a real contradiction on a four-letter state,
   *  and a prefix that only looks like one. Both sides of the rule matter — a
   *  gate that misses "Paid" under "Unpaid" is asleep, and one that calls
   *  "Put on hold" a contradiction of "Input queue" is noise the generator
   *  will learn to ignore. */
  const page = `<!doctype html><html><body>
    <section><div>Invoices (Unpaid)</div>
      <table><tbody><tr><td>INV-4021</td><td>Paid</td></tr><tr><td>INV-4022</td><td>Overdue</td></tr></tbody></table></section>
    <section><div>Input queue</div>
      <table><tbody><tr><td>Batch 9</td><td>Put on hold</td></tr></tbody></table></section>
  </body></html>`;
  const report = auditPrototype(loadPrototype(page));

  it("flags the paid invoice inside the unpaid table", () => {
    const flagged = report.byCheck["header-agreement"].filter((f) => /Invoices \(Unpaid\)/.test(f.message));
    expect(flagged.length).toBe(1);
    expect(flagged[0].message).toMatch(/"paid" contradicts the header's "unpaid"/);
  });

  it("says nothing about a section whose header merely starts with the same letters", () => {
    expect(report.byCheck["header-agreement"].filter((f) => /Input queue/.test(f.message))).toEqual([]);
  });
});

// ── the small pieces the checks stand on ────────────────────────────────────

describe("the primitives behave", () => {
  it("reads text with element boundaries kept apart", () => {
    const { doc } = loadPrototype("<!doctype html><body><div><span>Opportunity</span><span>12</span></div></body>");
    // textContent would return "Opportunity12" and every word comparison after
    // it would miss — this is the reading the header check is built on.
    expect(visibleText(doc.querySelector("div")!)).toBe("Opportunity 12");
  });

  it("resolves only the lengths a document without layout can actually resolve", () => {
    expect(pxOf("240px")).toBe(240);
    expect(pxOf("-48px")).toBe(-48);
    expect(pxOf("0")).toBe(0);
    for (const undecidable of ["auto", "50%", "calc(100% - 20px)", "", null, undefined]) {
      expect(pxOf(undecidable), `${undecidable} was treated as a known length`).toBeNull();
    }
  });
});
