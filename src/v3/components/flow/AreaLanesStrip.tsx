/**
 * AreaLanesStrip — the per-area summary lanes that lead the Discovery tab.
 * One lane per area:
 *   Listen    → HEARD n/n (+meter) · BUSINESS MAP confirmed/drafting ·
 *               HOW IT WORKS TODAY n workflows/seeded
 *   Prototype → Round · verdicts (✓ ✕ ⧗) · signed off / iterating — or the
 *               honest "still in Listen / in design" state before a build.
 * A "See the complete ontology" button (Listen) opens the graphical
 * ontology + atlas modal, which can jump to the editable artifact pages.
 * Salvaged from the retired reimagined chrome (FlowNextBoard's area board).
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { areaProgress, areaHasModel, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { loopState } from "@/v3/components/flow/flowLoop";
import { areaAccent, areaMonogram, stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { movementEvidence, flowMovements } from "@/v3/components/flow/flowShellData";
import OntologyAtlasModal from "@/v3/components/flow/OntologyAtlasModal";

/** Per-area "heard" from the roster — a stakeholder is filed under their primary
 * area and counted heard via the same signal the People board uses. */
function heardByArea(program: ProgramSummary): Map<string, { heard: number; total: number }> {
  const listen = flowMovements().find((m) => m.id === "listen");
  const ev = listen ? movementEvidence(program, listen) : [];
  const packs = listInterviewPacks(program);
  const map = new Map<string, { heard: number; total: number }>();
  const seen = new Set<string>();
  for (const s of resolveMovementStakeholders(program, "listen")) {
    const k = s.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const area = stakeholderPrimaryArea(program, s.name, s.role);
    const heard = stakeholderCollection("listen", s, packs, ev).heard;
    const cur = map.get(area) ?? { heard: 0, total: 0 };
    cur.total += 1;
    if (heard) cur.heard += 1;
    map.set(area, cur);
  }
  return map;
}

export default function AreaLanesStrip({ program, phase, onOpenWorkspace }: {
  program: ProgramSummary;
  phase: "listen" | "prototype";
  /** Jump to an editable artifact page (tab key `art:<id>` on Listen). */
  onOpenWorkspace?: (artifactId: string) => void;
}) {
  const [ontoModal, setOntoModal] = useState<{ area: string | null; section?: "map" | "atlas" } | null>(null);
  const rows = areaProgress(program);
  if (!rows.length) return null;
  const heard = heardByArea(program);
  const ah = (area: string): { heard: number; total: number; ready: boolean } => {
    const h = heard.get(area);
    const r = rows.find((x) => x.area === area);
    const total = h?.total ?? r?.personas.length ?? 0;
    const hd = h?.heard ?? r?.heard.length ?? 0;
    return { heard: hd, total, ready: total > 0 && hd >= total };
  };

  const modal = ontoModal ? (
    <OntologyAtlasModal program={program} area={ontoModal.area} section={ontoModal.section}
      onOpenWorkspace={onOpenWorkspace} onClose={() => setOntoModal(null)} />
  ) : null;

  if (phase === "listen") {
    return (
      <div className="v3fs-nb-strip">
        <div className="v3fs-nb-listenhead">
          <p className="v3fs-nb-note">Each area builds its <b>own</b> understanding in parallel — its business map and its “how it works today”. An area is ready for Prototype when it’s fully heard.</p>
          <button type="button" className="v3fs-nb-open ghost sm" onClick={() => setOntoModal({ area: null })}>◇ See the complete ontology</button>
        </div>
        {rows.map((r) => {
          const map = areaHasModel(program, r.area);
          const a = ah(r.area);
          const pct = a.total ? Math.round((100 * a.heard) / a.total) : 0;
          const idle = a.total === 0;
          return (
            <div key={r.area} className={`v3fs-nb-lane${idle ? " idle" : ""}`}>
              <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(r.area) } as React.CSSProperties}>
                <span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(r.area)}</span>
                <span>{r.area}</span>
              </div>
              <div className="v3fs-nb-lstat">
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">Heard</span><span className="v3fs-nb-v">{a.heard} / {a.total || "—"}</span><span className="v3fs-nb-meter"><i style={{ width: `${pct}%` }} /></span></div>
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">Business map</span><span className="v3fs-nb-v">{map ? <span className="ok">✓ confirmed</span> : <span className="wip">● drafting</span>}</span></div>
                <div className="v3fs-nb-b"><span className="v3fs-nb-k">How it works today</span><span className="v3fs-nb-v">{r.workflows > 0 ? <span className="ok">✓ {r.workflows} workflow{r.workflows === 1 ? "" : "s"}</span> : <span className="idle">○ seeded</span>}</span></div>
              </div>
              <button type="button" className="v3fs-nb-focusbtn" onClick={() => setOntoModal({ area: r.area })}>Open the map →</button>
            </div>
          );
        })}
        {modal}
      </div>
    );
  }

  // Prototype lanes — validation state per area.
  const ls = loopState(program);
  const byArea = new Map(ls.areas.map((a) => [a.area, a]));
  const closest = ls.areas.filter((a) => !a.converged && a.total > 0).sort((a, b) => (a.total - a.accepted) - (b.total - b.accepted))[0]?.area;
  return (
    <div className="v3fs-nb-strip">
      {(rows.length ? rows.map((r) => r.area) : ls.areas.map((a) => a.area)).map((area) => {
        const P = byArea.get(area);
        // A lane is only truly "not started" when NO prototype exists yet (still
        // in design). Once a build exists, every area is in validation — even
        // with zero verdicts it's "awaiting verdicts", not "not started".
        if (!ls.hasPrototype) {
          const a = ah(area);
          return (
            <div key={area} className="v3fs-nb-lane idle">
              <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(area) } as React.CSSProperties}><span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(area)}</span><span>{area}</span></div>
              <div className="v3fs-nb-lstat"><div className="v3fs-nb-b"><span className="v3fs-nb-k">Status</span><span className="v3fs-nb-v idle">{a.ready ? "Ready — prototype in design" : `Still in Listen — ${a.heard}/${a.total || "—"} heard`}</span></div></div>
            </div>
          );
        }
        const accepted = P?.accepted ?? 0;
        const changes = (P?.objections ?? 0) + (P?.changes ?? 0);
        const pending = P?.pending ?? 0;
        const total = P?.total ?? 0;
        const converged = P?.converged ?? false;
        return (
          <div key={area} className="v3fs-nb-lane">
            <div className="v3fs-nb-lname" style={{ "--acc": areaAccent(area) } as React.CSSProperties}><span className="v3fs-nb-mono" aria-hidden="true">{areaMonogram(area)}</span><span>{area}</span></div>
            <div className="v3fs-nb-lstat">
              <div className="v3fs-nb-b"><span className="v3fs-nb-k">Round</span><span className="v3fs-nb-v">Round {ls.round}</span></div>
              <div className="v3fs-nb-b"><span className="v3fs-nb-k">Verdicts</span>{total === 0
                ? <span className="v3fs-nb-v idle">awaiting verdicts</span>
                : <span className="v3fs-nb-v v3fs-nb-vd"><span className="vd ok">{accepted} ✓</span><span className="vd no">{changes} ✕</span><span className="vd wait">{pending} ⧗</span></span>}</div>
            </div>
            {converged ? <span className="v3fs-nb-tag close">signed off</span> : total === 0 ? <span className="v3fs-nb-tag mid">to validate</span> : area === closest ? <span className="v3fs-nb-tag close">closest</span> : <span className="v3fs-nb-tag mid">iterating</span>}
          </div>
        );
      })}
      {modal}
    </div>
  );
}
