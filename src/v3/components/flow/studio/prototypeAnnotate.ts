/**
 * POINTING AT SOMETHING IS NAMING IT.
 *
 * The reason a review's prose is lossy is that it has to be parsed back into an
 * address — "the status column on the campaign list" is a sentence somebody then
 * has to resolve. A CLICK does not have that problem: every element in the built
 * application already carries its `data-fabric-id`, and the fabric node behind
 * that id carries the `{entity, attribute}` tuple `designOverrides` addresses by.
 * So the gesture arrives already addressed, and nothing in between can lose it.
 *
 * This module is the injected half. It is added to the document the STUDIO
 * PREVIEWS and never to the bytes on the record: the stored build must stay the
 * application a stakeholder opens, not one carrying an editor. Same reason the
 * refine contract forbids the model touching the renderer — the shipped document
 * is the product, and the tooling lives outside it.
 */

/** What the injected script sends up when somebody clicks a region. */
export interface AnnotatePick {
  /** The fabric node clicked, when the click landed on one. */
  fabricId: string;
  /**
   * The entity a NON-fabric region is about (`data-entity`).
   *
   * A persona's queue is not a fabric node — it is that persona's view of one —
   * so it carries no fabric id. And the front door is made entirely of them, so
   * without this the most-visited screen in the application would be the one
   * screen nobody could annotate.
   */
  entity: string;
  /** The words on the element, so the panel can say what was clicked. */
  text: string;
}

/** The marker that separates our message from anything else on the channel. */
export const ANNOTATE_MESSAGE = "aura-annotate-pick";

/**
 * The script, as a string, because it runs in the previewed document and not
 * here. Deliberately small and dependency-free.
 *
 * `capture: true` and `preventDefault` on every click: in annotate mode a click
 * is an ADDRESS, not a navigation. Without it, clicking a row to point at it
 * would open the record, and the operator would be annotating a different screen
 * from the one they meant.
 */
export function annotatorScript(): string {
  return [
    "<style>",
    "[data-fabric-id]{outline:0}",
    "[data-fabric-id]:hover{outline:2px solid #6b5ce7;outline-offset:1px;cursor:crosshair}",
    "html{cursor:crosshair}",
    "</style>",
    "<script>",
    "(function(){",
    "var pick=function(e){",
    // The closest ancestor that IS an address. A click lands on a <span> inside
    // a cell; the addressable thing is the region or field that contains it.
    "  var el=e.target&&e.target.closest?e.target.closest('[data-fabric-id],[data-entity]'):null;",
    "  e.preventDefault();e.stopPropagation();",
    "  if(!el)return;",
    "  var t=(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);",
    `  parent.postMessage({kind:'${ANNOTATE_MESSAGE}',fabricId:el.getAttribute('data-fabric-id')||'',entity:el.getAttribute('data-entity')||'',text:t},'*');`,
    "};",
    "document.addEventListener('click',pick,true);",
    // A form inside the preview must not submit while somebody is pointing.
    "document.addEventListener('submit',function(e){e.preventDefault();},true);",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * The previewed document, wearing the annotator.
 *
 * Appended at the very end so it runs after the client renderer has drawn the
 * records — the regions a person most wants to point at are the ones the island
 * fills, and they do not exist in the served bytes.
 */
export function withAnnotator(html: string): string {
  if (!html.trim()) return html;
  const script = annotatorScript();
  return html.includes("</body>")
    ? html.replace("</body>", `${script}</body>`)
    : `${html}${script}`;
}

/** Read a window message as a pick, or null. Anything else on the channel —
 *  and there is plenty — is not ours. */
export function readAnnotatePick(data: unknown): AnnotatePick | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== ANNOTATE_MESSAGE) return null;
  const fabricId = typeof d.fabricId === "string" ? d.fabricId.trim() : "";
  const entity = typeof d.entity === "string" ? d.entity.trim() : "";
  if (!fabricId && !entity) return null;
  return { fabricId, entity, text: typeof d.text === "string" ? d.text : "" };
}
