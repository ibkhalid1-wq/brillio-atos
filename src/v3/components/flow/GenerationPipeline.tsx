/**
 * GenerationPipeline — the atos-gen explainer, made real. Artifact generation
 * in the new design isn't a button you press: evidence lands, the document keeps
 * itself current in place, and you only step in when the engine can't decide (a
 * suggestion to confirm, or a clash with your own edits → an Inbox decision).
 *
 * The strip shows the same five stages that run every time, plus REAL
 * provenance for this programme (how many inputs the documents are grounded in).
 */
import type { ProgramSummary } from "@/new/types";
import { movementEvidence, flowMovements } from "@/v3/components/flow/flowShellData";

const STAGES: Array<{ n: string; name: string; detail: string }> = [
  { n: "01", name: "Trigger", detail: "Evidence lands — no click needed" },
  { n: "02", name: "Assemble", detail: "Gather every fact on record" },
  { n: "03", name: "Prompt", detail: "Fill the artifact’s template" },
  { n: "04", name: "Generate", detail: "Draft it — voted for the map" },
  { n: "05", name: "Govern", detail: "Apply, or propose if it clashes" },
];

export default function GenerationPipeline({ program }: { program: ProgramSummary }) {
  // Real provenance: distinct voices heard across the collection phases, and the
  // programme's documents of record — what every generation is grounded in.
  const heard = new Set<string>();
  for (const id of ["frame", "listen"]) {
    const mv = flowMovements().find((m) => m.id === id);
    if (!mv) continue;
    for (const e of movementEvidence(program, mv)) {
      const who = (e.who || "").split(",")[0].trim().toLowerCase();
      if (who) heard.add(who);
    }
  }
  const inputs = heard.size;

  return (
    <div className="v3fs-gp">
      <div className="v3fs-gp-h">
        <div>
          <div className="v3fs-gp-eyebrow">Under the hood</div>
          <h3 className="v3fs-gp-title">How your documents stay current</h3>
        </div>
        <div className="v3fs-gp-prov">
          {inputs > 0
            ? <>Grounded in <b>{inputs}</b> {inputs === 1 ? "voice" : "voices"} on record — documents keep themselves current as more land.</>
            : <>As evidence lands, each document keeps itself current in place — nothing to press.</>}
        </div>
      </div>
      <div className="v3fs-gp-steps">
        {STAGES.map((s, i) => (
          <div key={s.n} className="v3fs-gp-step">
            {i < STAGES.length - 1 ? <span className="v3fs-gp-arrow" aria-hidden="true">→</span> : null}
            <span className="v3fs-gp-n">{s.n}</span>
            <span className="v3fs-gp-nm">{s.name}</span>
            <span className="v3fs-gp-d">{s.detail}</span>
          </div>
        ))}
      </div>
      <p className="v3fs-gp-note">You only step in for what the engine can’t decide. A clean update lands silently; one that would overwrite your edits becomes an <b>Inbox</b> decision — your work is never overwritten.</p>
    </div>
  );
}
