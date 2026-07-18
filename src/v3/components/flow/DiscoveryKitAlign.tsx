/**
 * DiscoveryKitAlign — the Discovery Kit alignment surface (reimagined chrome).
 * The many-to-many map of PEOPLE × AREAS: each area holds several people, and a
 * person can span several areas (interviewed once, evidence flows to every area
 * they cover). Two views — a coverage Matrix and a By-person list — with a live
 * per-area "heard" footer.
 *
 * Every figure is REAL, read from the same derivations the rest of the app uses:
 *   areas     → programAreas()
 *   coverage  → stakeholderPrimaryArea() ∪ personaAreas()   (who covers what)
 *   heard     → stakeholderCollection()                     (per-person)
 *
 * Coverage here is DERIVED from the business map (atlas actors + role→area
 * aliases), not a stored M:N table — so this surface visualises and audits the
 * alignment; corrections are made through the role→area remap on the Listen
 * gaps table, which this view reflects on the next render.
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { programAreas, personaAreas, stakeholderPrimaryArea, GENERAL_AREA } from "@/v3/components/flow/flowAreas";
import { areaAccent, areaMonogram, stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { movementEvidence, flowMovements } from "@/v3/components/flow/flowShellData";

const initials = (name: string): string => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
};

export default function DiscoveryKitAlign({ program }: { program: ProgramSummary }) {
  const [view, setView] = useState<"matrix" | "person">("matrix");

  const allAreas = programAreas(program);
  const areas = allAreas.filter((a) => a !== GENERAL_AREA);
  const shown = areas.length ? areas : allAreas;
  const shownSet = new Set(shown);

  const listen = flowMovements().find((m) => m.id === "listen");
  const evidence = listen ? movementEvidence(program, listen) : [];
  const packs = listInterviewPacks(program);

  // People — the resolved roster for the programme (deduped by name).
  const seen = new Set<string>();
  const people = resolveMovementStakeholders(program, "listen")
    .filter((s) => {
      const k = s.name.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((s) => {
      const cover = new Set<string>();
      const primary = stakeholderPrimaryArea(program, s.name, s.role);
      if (shownSet.has(primary)) cover.add(primary);
      for (const a of personaAreas(program, s.name)) if (shownSet.has(a)) cover.add(a);
      const heard = stakeholderCollection("listen", s, packs, evidence).heard;
      return { id: s.id, name: s.name, role: s.role, cover, heard };
    });

  // Per-area footer — of the people covering an area, how many are heard.
  const footer = shown.map((area) => {
    const covering = people.filter((p) => p.cover.has(area));
    const heard = covering.filter((p) => p.heard).length;
    return { area, total: covering.length, heard };
  });

  const spanners = people.filter((p) => p.cover.size > 1);
  const gridCols = `230px repeat(${shown.length}, minmax(96px, 1fr))`;

  return (
    <div className="v3fs-dka">
      <div className="v3fs-dka-h">
        <div>
          <div className="v3fs-dka-eyebrow">Frame · Discovery Kit</div>
          <h2 className="v3fs-dka-title">Areas &amp; people — who covers what</h2>
          <p className="v3fs-dka-sub">Areas come from the business map; a person who spans areas is interviewed once and their evidence flows to every area they cover.</p>
        </div>
        <div className="v3fs-dka-views" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "matrix"} className={view === "matrix" ? "on" : ""} onClick={() => setView("matrix")}>Matrix</button>
          <button type="button" role="tab" aria-selected={view === "person"} className={view === "person" ? "on" : ""} onClick={() => setView("person")}>By person</button>
        </div>
      </div>

      {!people.length ? (
        <div className="v3fs-dka-empty">No people on the roster yet — add stakeholders in the Discovery Kit to map their area coverage.</div>
      ) : view === "matrix" ? (
        <div className="v3fs-dka-matrixwrap">
          <div className="v3fs-dka-matrix" style={{ gridTemplateColumns: gridCols }}>
            {/* header */}
            <div className="v3fs-dka-corner">People × Areas</div>
            {shown.map((area) => (
              <div key={area} className="v3fs-dka-ahdr" style={{ "--acc": areaAccent(area) } as React.CSSProperties}>
                <span className="mono" aria-hidden="true">{areaMonogram(area)}</span>
                <span className="an">{area}</span>
              </div>
            ))}
            {/* rows */}
            {people.map((p) => (
              <div key={p.id} className="v3fs-dka-row" style={{ display: "contents" }}>
                <div className={`v3fs-dka-person${p.cover.size > 1 ? " spans" : ""}`}>
                  <span className="av">{initials(p.name)}</span>
                  <span className="who"><span className="nm">{p.name}</span><span className="rl">{p.role}</span></span>
                  {p.cover.size > 1 ? <span className="spanbadge">{p.cover.size} areas</span> : null}
                </div>
                {shown.map((area) => (
                  <div key={area} className="v3fs-dka-cell" title={`${p.name} · ${area}${p.cover.has(area) ? " — covers" : ""}`}>
                    <span className={`v3fs-dka-dot${p.cover.has(area) ? " on" : ""}`} aria-label={p.cover.has(area) ? `${p.name} covers ${area}` : `${p.name} does not cover ${area}`} />
                  </div>
                ))}
              </div>
            ))}
            {/* footer */}
            <div className="v3fs-dka-foot lbl">Coverage · heard</div>
            {footer.map((f) => (
              <div key={f.area} className={`v3fs-dka-foot cov${f.total > 0 && f.heard === f.total ? " full" : ""}`}>
                <span className="n">{f.heard} / {f.total || "—"}</span>
                <span className="bar"><i style={{ width: `${f.total ? Math.round((100 * f.heard) / f.total) : 0}%` }} /></span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="v3fs-dka-byperson">
          {people.map((p) => (
            <div key={p.id} className="v3fs-dka-pcard">
              <span className="av">{initials(p.name)}</span>
              <span className="who"><span className="nm">{p.name}</span><span className="rl">{p.role}</span></span>
              <span className="areas">
                {[...p.cover].length
                  ? [...p.cover].map((a) => <span key={a} className="achip" style={{ "--acc": areaAccent(a) } as React.CSSProperties}>{a}</span>)
                  : <span className="achip none">no area yet</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {spanners.length ? (
        <div className="v3fs-dka-note">
          <span className="ic" aria-hidden="true">✉</span>
          <p><b>Asked once.</b> {spanners.slice(0, 3).map((p) => p.name.split(" ")[0]).join(", ")}{spanners.length > 3 ? ` and ${spanners.length - 3} more` : ""} each span multiple areas — they get <b>one interview</b> covering everything they touch, and their evidence counts toward every area they cover. No duplicate outreach.</p>
        </div>
      ) : null}

      <p className="v3fs-dka-hint">Coverage is derived from the business map and role assignments. To move a person to a different area, use the role → area remap on Listen’s gaps table — this view reflects it on the next pass.</p>
    </div>
  );
}
