/**
 * ScreenCard — a READ-ONLY render of a designed screen's wireframe.
 *
 * It used to live in `ExperienceDesignStudio`, which no longer authors screens (that
 * surface is now the entity → parent-screen decision). This is a renderer, not an
 * editor, and its real consumer is `FlowRespond` — the page a STAKEHOLDER opens to
 * review the design. Taking it out with the designer would have silently emptied that
 * review, so it moved here instead: any document that HAS screens (authored under the
 * old designer, or generated) still shows them to the person being asked about them.
 */
import { asArray, asRecord, asText, asStrings } from "./StudioKit";

const BLOCK_GLYPH: Record<string, string> = {
  list: "☰", table: "▦", form: "✎", detail: "¶", metric: "◔", action: "▸", timeline: "⋯",
};

export function WireBlock({ block }: { block: Record<string, unknown> }) {
  const kind = asText(block.kind) || "detail";
  const fields = asStrings(block.fields);
  return (
    <div className={`v3fs-wf-block ${kind}`}>
      <div className="v3fs-wf-block-h">
        <span aria-hidden="true">{BLOCK_GLYPH[kind] ?? "¶"}</span>
        <b>{asText(block.label) || kind}</b>
        {asText(block.entity) ? <em className="v3fs-wf-entity">{asText(block.entity)}</em> : null}
      </div>
      {/* Skeleton lines suggest the block's shape without inventing content. */}
      {kind === "table" || kind === "list" ? (
        <div className="v3fs-wf-skel rows">{[0, 1, 2].map((i) => <span key={i} />)}</div>
      ) : kind === "form" ? (
        <div className="v3fs-wf-skel fields">{(fields.length ? fields.slice(0, 4) : ["", ""]).map((f, i) => (
          <label key={i}>{f || "…"}<span /></label>
        ))}</div>
      ) : kind === "metric" ? (
        <div className="v3fs-wf-skel metric"><b>—</b><span /></div>
      ) : kind === "action" ? (
        <div className="v3fs-wf-skel action"><span className="v3fs-wf-btn">{fields[0] || asText(block.label) || "Action"}</span></div>
      ) : (
        <div className="v3fs-wf-skel rows">{[0, 1].map((i) => <span key={i} />)}</div>
      )}
      {fields.length && kind !== "form" && kind !== "action" ? (
        <div className="v3fs-wf-fields">{fields.slice(0, 5).join(" · ")}</div>
      ) : null}
    </div>
  );
}

export function ScreenCard({ screen, active, onClick }: { screen: Record<string, unknown>; active: boolean; onClick: () => void }) {
  const regions = asArray(screen.wireframe).map(asRecord);
  const byRegion = (name: string) => regions.filter((r) => asText(r.region) === name);
  const mains = [...byRegion("main"), ...regions.filter((r) => !["header", "nav", "main", "aside", "footer"].includes(asText(r.region)))];
  const asides = byRegion("aside");
  return (
    <button type="button" className={`v3fs-wf-screen${active ? " on" : ""}`} onClick={onClick}
      title={asText(screen.purpose) || undefined}>
      <div className="v3fs-wf-title">
        <b>{asText(screen.name) || asText(screen.id) || "Screen"}</b>
        <span>{[asText(screen.journey), asText(screen.stage)].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="v3fs-wf-frame">
        {byRegion("header").length ? <div className="v3fs-wf-region header">{byRegion("header").flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
        <div className="v3fs-wf-body">
          {byRegion("nav").length ? <div className="v3fs-wf-region nav">{byRegion("nav").flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
          <div className="v3fs-wf-region main">{mains.flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div>
          {asides.length ? <div className="v3fs-wf-region aside">{asides.flatMap((r) => asArray(r.blocks).map(asRecord)).map((b, i) => <WireBlock key={i} block={b} />)}</div> : null}
        </div>
      </div>
      <div className="v3fs-wf-meta">
        {asStrings(screen.personas).slice(0, 3).map((p) => <span key={p} className="v3fs-wf-chip">{p}</span>)}
        {asStrings(screen.entities).slice(0, 3).map((e) => <span key={e} className="v3fs-wf-chip ent">{e}</span>)}
      </div>
    </button>
  );
}

