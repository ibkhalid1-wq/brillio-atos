/**
 * POINTING AT SOMETHING IS NAMING IT.
 *
 * A review's prose is lossy because it has to be parsed back into an address —
 * "the status column on the campaign list" is a sentence somebody then has to
 * resolve. A click is not: every element in the built application carries its
 * `data-fabric-id`, and the node behind that id carries the `{entity, attribute}`
 * tuple an override is keyed on. The gesture arrives already addressed.
 *
 * The cases below cover the chain that makes that true, and one that guards a
 * defect this codebase has already shipped once: a control that LOOKS wired,
 * whose handler was never attached. Structural assertions passed that build; the
 * click-through test is what caught it. So the annotator is exercised by
 * dispatching a real click at a real element, not by reading its source.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { withAnnotator, readAnnotatePick, ANNOTATE_MESSAGE } from "@/v3/components/flow/studio/prototypeAnnotate";
import { assemblePrototype } from "@shared/prototypeAssembly.ts";
import { deriveFabric } from "@shared/fabric.ts";
import { targetOfFabricNode, targetLabel } from "@shared/designOverrides.ts";

const snap = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../docs/laila/snapshot-2026-08-07/${f}`), "utf8"));
const ontology = snap("domain-ontology.json") as Record<string, unknown>;
const atlas = snap("current-state-atlas.json") as Record<string, unknown>;

describe("the click carries the address", () => {
  it("every addressable region resolves to a durable tuple", () => {
    // Not "most". A field the operator can see and click but cannot name is a
    // dead affordance, and the panel would have to refuse it.
    const fabric = deriveFabric(ontology, atlas);
    const fields = fabric.nodes.filter((n) => n.kind === "field");
    expect(fields.length).toBeGreaterThan(20);
    for (const node of fields) {
      const t = targetOfFabricNode(node);
      expect(t, `no tuple for ${node.id}`).not.toBeNull();
      expect(t!.of).toBe("attribute");
    }
  });

  it("the tuple reads as the thing a person pointed at", () => {
    const fabric = deriveFabric(ontology, atlas);
    const field = fabric.nodes.find((n) => n.kind === "field")!;
    const t = targetOfFabricNode(field)!;
    expect(targetLabel(t)).toMatch(/^[^.]+\.[^.]+$/);   // Entity.attribute
  });

  it("a region the fabric does not own has no tuple — and is refused, not guessed", () => {
    // The persona queues carry `data-region` and no fabric id precisely because
    // the fabric never declared them. Inventing an address for one would put a
    // decision somewhere no later build could find it.
    expect(targetOfFabricNode({ kind: "region", source: undefined })).toBeNull();
    expect(targetOfFabricNode({ kind: "region", source: {} })).toBeNull();
  });
});

describe("the injected annotator", () => {
  let host: HTMLElement;
  const received: unknown[] = [];
  const onMessage = (e: MessageEvent) => received.push(e.data);

  beforeEach(() => {
    received.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    window.addEventListener("message", onMessage);
  });
  afterEach(() => {
    window.removeEventListener("message", onMessage);
    host.remove();
  });

  /** Run the injected script in THIS document, against a real element, and
   *  dispatch a real click — the only way to catch a handler that was written
   *  but never attached. */
  const arm = () => {
    const script = withAnnotator("<body></body>").match(/<script>([\s\S]*?)<\/script>/)![1];
    new Function("parent", script)(window);
  };

  it("sends the fabric id of the nearest addressable ancestor", async () => {
    host.innerHTML = `<div data-fabric-id="field:campaign:status"><span id="inner">Cancelled</span></div>`;
    arm();
    document.getElementById("inner")!.click();
    // postMessage is delivered as a task, not synchronously — the studio's own
    // listener is equally asynchronous, so waiting here is the honest shape.
    await new Promise((r) => setTimeout(r, 0));
    const pick = readAnnotatePick(received[0]);
    expect(pick?.fabricId).toBe("field:campaign:status");
    // …and what it said, so the panel can show what was clicked.
    expect(pick?.text).toBe("Cancelled");
  });

  it("a click is an ADDRESS, not a navigation", async () => {
    // Without this, clicking a row to point at it opens the record, and the
    // operator annotates a screen they did not mean to be on.
    host.innerHTML = `<a href="#lead" data-fabric-id="nav:campaign:lead" id="link">Leads</a>`;
    arm();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("link")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // Drained inside its own case: postMessage is a TASK, so a message left
    // queued here would arrive during the next test and be read as its result.
    await new Promise((r) => setTimeout(r, 0));
    expect(readAnnotatePick(received[0])?.fabricId).toBe("nav:campaign:lead");
  });

  it("a persona queue is addressable by the entity it lists", async () => {
    // The FRONT DOOR is a workbench, and a workbench is made entirely of queues
    // — a persona's view of an entity, not a fabric node. Without this the
    // most-visited screen in the application would be the one nobody could
    // annotate. The entity is not guessed from the region id: the assembler
    // knows it when it emits the slot and writes it there.
    host.innerHTML = `<div data-region="queue:marketing:campaign" data-entity="Campaign"><span id="cell">Northgate</span></div>`;
    arm();
    document.getElementById("cell")!.click();
    await new Promise((r) => setTimeout(r, 0));
    const pick = readAnnotatePick(received[0]);
    expect(pick?.entity).toBe("Campaign");
    expect(pick?.fabricId).toBe("");
  });

  it("the built workbench really carries it — not just the test's markup", () => {
    const built = assemblePrototype(ontology, atlas).html;
    const queues = [...built.matchAll(/data-region="queue:[^"]+"([^>]*)>/g)].map((m) => m[1]);
    expect(queues.length).toBeGreaterThan(0);
    for (const attrs of queues) expect(attrs).toMatch(/data-entity="[^"]+"/);
  });

  it("says nothing when the click lands on nothing addressable", async () => {
    host.innerHTML = `<div id="bare">plain</div>`;
    arm();
    document.getElementById("bare")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(received.filter((d) => readAnnotatePick(d))).toEqual([]);
  });

  it("only our own messages are picks", () => {
    expect(readAnnotatePick({ kind: "something-else", fabricId: "x" })).toBeNull();
    expect(readAnnotatePick({ kind: ANNOTATE_MESSAGE })).toBeNull();
    expect(readAnnotatePick("string")).toBeNull();
    expect(readAnnotatePick(null)).toBeNull();
  });
});

describe("the annotator never reaches the record", () => {
  it("the stored build is the application a stakeholder opens, not one carrying an editor", () => {
    // Same rule the refine contract applies to the renderer: the shipped
    // document is the product, and the tooling lives outside it.
    const built = assemblePrototype(ontology, atlas).html;
    expect(built).not.toContain(ANNOTATE_MESSAGE);
    expect(withAnnotator(built)).toContain(ANNOTATE_MESSAGE);
  });

  it("runs after the client renderer has drawn the records", () => {
    // The regions a person most wants to point at are the ones the data island
    // fills — they do not exist in the served bytes.
    const doc = withAnnotator("<body><script>renderer()</script></body>");
    expect(doc.indexOf(ANNOTATE_MESSAGE)).toBeGreaterThan(doc.indexOf("renderer()"));
    expect(doc.endsWith("</body>")).toBe(true);
  });
});
