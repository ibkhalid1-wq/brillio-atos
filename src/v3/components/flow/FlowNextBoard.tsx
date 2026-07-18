/**
 * FlowNextBoard — the reimagined phase home for the two workstream phases
 * (Listen · Prototype), shown only under the `?ui=next` chrome. Both phases run
 * PER AREA in parallel: the board shows every area at once (the Focus card picks
 * the single most valuable move across them), then Focus one area to open its
 * three-zone workspace. "Open the workspace" drops into the existing, proven
 * movement body for the actual editing — this layer is navigation + overview.
 *
 * All figures are REAL, read from the same derivations the classic surfaces use:
 *   Listen    → areaProgress()  (heard / personas, entities, business map)
 *   Prototype → loopState()     (round, per-area verdicts, convergence)
 */
import { useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { areaProgress, areaHasModel, hasMultipleAreas, stakeholderPrimaryArea, ontologyEntities, atlasWorkflows, entityArea, workflowArea } from "@/v3/components/flow/flowAreas";
import { loopState, changeRequests, type AreaLoop } from "@/v3/components/flow/flowLoop";
import { areaAccent, areaMonogram, stakeholderCollection } from "@/v3/components/flow/CollectBoard";
import { resolveMovementStakeholders } from "@/v3/components/flow/flowStakeholders";
import { listInterviewPacks } from "@/v3/components/flow/flowPortal";
import { movementEvidence, flowMovements, readMovementInputs } from "@/v3/components/flow/flowShellData";

/** Per-area "heard" from the roster — a stakeholder is filed under their primary
 * area and counted heard via the same signal the People board uses. More honest
 * than matching evidence names to atlas-actor labels (which misses when the
 * interviewee's name differs from the workflow's actor). */
function heardByArea(program: ProgramSummary): Map<string, { heard: number; total: number; heardNames: string[] }> {
  const listen = flowMovements().find((m) => m.id === "listen");
  const ev = listen ? movementEvidence(program, listen) : [];
  const packs = listInterviewPacks(program);
  const map = new Map<string, { heard: number; total: number; heardNames: string[] }>();
  const seen = new Set<string>();
  for (const s of resolveMovementStakeholders(program, "listen")) {
    const k = s.name.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const area = stakeholderPrimaryArea(program, s.name, s.role);
    const heard = stakeholderCollection("listen", s, packs, ev).heard;
    const cur = map.get(area) ?? { heard: 0, total: 0, heardNames: [] };
    cur.total += 1;
    if (heard) { cur.heard += 1; cur.heardNames.push(s.name); }
    map.set(area, cur);
  }
  return map;
}

type Phase = "listen" | "prototype";

const initials = (name: string): string => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w[1]?.[0] ?? "")).toUpperCase() || (name.slice(0, 2).toUpperCase());
};

export default function FlowNextBoard({ program, phase, onOpenWork, onSaveInputs }: {
  program: ProgramSummary;
  phase: Phase;
  onOpenWork: () => void;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const [focusArea, setFocusArea] = useState<string | null>(null);
  const [ontoModal, setOntoModal] = useState<{ area: string | null } | null>(null);
  const rows = areaProgress(program);
  const ls = loopState(program);
  const multi = hasMultipleAreas(program);
  // Roster-based heard per area — the honest count (see heardByArea).
  const heard = heardByArea(program);
  const ah = (area: string): { heard: number; total: number; ready: boolean; names: string[] } => {
    const h = heard.get(area);
    const r = rows.find((x) => x.area === area);
    const total = h?.total ?? r?.personas.length ?? 0;
    const hd = h?.heard ?? r?.heard.length ?? 0;
    return { heard: hd, total, ready: total > 0 && hd >= total, names: h?.heardNames ?? r?.heard ?? [] };
  };

  // ── The Focus card — "do this next", computed across every area ──────────
  const focus = (() => {
    if (phase === "listen") {
      if (!rows.length) return { mark: "🎧", title: "Listen hasn't started yet.", sub: "Add the people to hear from and send them discovery links.", cta: "Open the workspace" };
      // An area is incomplete if it isn't fully heard — including unstaffed areas
      // (no one assigned yet), which "all heard" must NOT count as done.
      const staffedOpen = rows.filter((r) => { const a = ah(r.area); return a.total > 0 && !a.ready; });
      const unstaffed = rows.filter((r) => ah(r.area).total === 0);
      if (!staffedOpen.length && !unstaffed.length) return { mark: "🎧", title: "Every area has a complete picture — ready for Prototype.", sub: "All voices heard and the business map confirmed across areas.", cta: "Open the workspace" };
      if (!staffedOpen.length && unstaffed.length) return { mark: "🎧", title: `${unstaffed.length} area${unstaffed.length === 1 ? " has" : "s have"} no one assigned yet — map who covers them.`, sub: "Add people to each area in the Discovery Kit, then send their discovery links.", cta: "Open the workspace" };
      // Closest to done = smallest remaining, ties broken by highest ratio heard.
      const best = [...staffedOpen].sort((a, b) => (ah(a.area).total - ah(a.area).heard) - (ah(b.area).total - ah(b.area).heard))[0];
      const ba = ah(best.area);
      const left = ba.total - ba.heard;
      return {
        mark: "🎧",
        title: `${best.area} is ${left} interview${left === 1 ? "" : "s"} from a complete picture — the most valuable move across ${multi ? "all areas" : "the programme"}.`,
        sub: `${ba.heard} of ${ba.total} heard. Send the remaining discovery link${left === 1 ? "" : "s"} to close it.`,
        cta: `Focus ${best.area}`,
        area: best.area,
      };
    }
    // Prototype
    if (!ls.hasPrototype) return { mark: "◎", title: "Build the prototype to start validating.", sub: "Design assembles one clickable build from the areas' slices, then pilots weigh in.", cta: "Open the workspace" };
    if (ls.converged) return { mark: "◎", title: "Approved — every area signed off and the sponsor accepted.", sub: "The areas' prototypes are ready to merge into one build for Ship.", cta: "Open the workspace" };
    // Distance to convergence = shortfall to the accepted-majority PLUS pending.
    const toGo = (a: AreaLoop) => Math.max(0, Math.ceil(a.total / 2) - a.accepted) + a.pending;
    const contending = ls.areas.filter((a) => !a.converged && a.total > 0);
    const best = [...contending].sort((a, b) => toGo(a) - toGo(b))[0];
    if (best) {
      const need = toGo(best);
      return {
        mark: "◎",
        title: `${best.area} is ${need} verdict${need === 1 ? "" : "s"} from converging — the first area to clear opens the merge.`,
        sub: `${best.accepted} of ${best.total} pilots approved. ${best.objections + best.changes} change request${best.objections + best.changes === 1 ? "" : "s"} queued for the next round.`,
        cta: `Focus ${best.area}`,
        area: best.area,
      };
    }
    // Every area with verdicts has signed off — the only thing left is the sponsor.
    if (ls.areas.some((a) => a.total > 0) && ls.areasTotal > 0 && ls.areasConverged === ls.areasTotal && !ls.sponsorAccepted) {
      return { mark: "◎", title: "Every area signed off — waiting on the sponsor to accept.", sub: "Once the sponsor accepts on their link, the build merges toward Ship.", cta: "Open the workspace" };
    }
    // A prototype exists but no verdicts are in yet — validation hasn't begun.
    const firstArea = (rows.find((r) => r.listenReady) ?? rows[0])?.area;
    return {
      mark: "◎",
      title: "The prototype is built — gather pilot verdicts to start validating.",
      sub: "Validate one area at a time on the board; each area converges on its own before the build merges for Ship.",
      cta: firstArea ? `Validate ${firstArea}` : "Open the workspace",
      area: firstArea,
    };
  })();

  const goFocus = () => { if ((focus as { area?: string }).area) setFocusArea((focus as { area?: string }).area!); else onOpenWork(); };

  return (
    <div className="v3fs-nb">
      {/* Focus — the one thing to do next, across areas */}
      <div className="v3fs-nb-focus">
        <div className="v3fs-nb-fmark" aria-hidden="true">{focus.mark}</div>
        <div className="v3fs-nb-ftext">
          <div className="v3fs-nb-flabel">{focusArea ? `${focusArea} · do this next` : "Across areas · do this next"}</div>
          <h2 className="v3fs-nb-ftitle">{focus.title}</h2>
          <div className="v3fs-nb-fsub">{focus.sub}</div>
        </div>
        <button type="button" className="v3fs-nb-primary" onClick={focusArea ? onOpenWork : goFocus}>
          {focusArea ? "Open the workspace" : focus.cta}
        </button>
      </div>

      {focusArea
        ? <FocusedArea program={program} phase={phase} area={focusArea} rows={rows} ls={ls} ah={ah} onBack={() => setFocusArea(null)} onOpenWork={onOpenWork} onOpenOntology={(area) => setOntoModal({ area })} />
        : <Board program={program} phase={phase} rows={rows} ls={ls} ah={ah} onFocus={setFocusArea} onOpenWork={onOpenWork} onSaveInputs={onSaveInputs} onOpenOntology={(area) => setOntoModal({ area })} />}
      {ontoModal ? <OntologyAtlasModal program={program} area={ontoModal.area} onClose={() => setOntoModal(null)} /> : null}
    </div>
  );
}

// ── The parallel board: one lane per area ──────────────────────────────────
function Board({ program, phase, rows, ls, ah, onFocus, onOpenWork, onSaveInputs, onOpenOntology }: {
  program: ProgramSummary;
  phase: Phase;
  rows: ReturnType<typeof areaProgress>;
  ls: ReturnType<typeof loopState>;
  ah: (area: string) => { heard: number; total: number; ready: boolean; names: string[] };
  onFocus: (area: string) => void;
  onOpenWork: () => void;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
  onOpenOntology: (area: string | null) => void;
}) {
  if (phase === "listen") {
    return (
      <>
        <div className="v3fs-nb-listenhead">
          <p className="v3fs-nb-note">Each area builds its <b>own</b> understanding in parallel — its business map and its “how it works today”. An area is ready for Prototype when it’s fully heard.</p>
          <button type="button" className="v3fs-nb-open ghost sm" onClick={() => onOpenOntology(null)}>◇ See the complete ontology</button>
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
              <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(r.area)}>{a.ready ? "Review" : "Focus"} →</button>
            </div>
          );
        })}
      </>
    );
  }
  // Prototype board
  const byArea = new Map(ls.areas.map((a) => [a.area, a]));
  const closest = ls.areas.filter((a) => !a.converged && a.total > 0).sort((a, b) => (a.total - a.accepted) - (b.total - b.accepted))[0]?.area;
  return (
    <>
      <div className="v3fs-nb-merge">
        <span className="v3fs-nb-merge-ic" aria-hidden="true">⤷</span>
        <div>All areas’ prototypes <b>merge into one build</b> before Ship — <b>{ls.areasConverged} of {ls.areasTotal || rows.length}</b> converged. Design once, validate per area.</div>
        <button type="button" className="v3fs-nb-merge-btn" onClick={onOpenWork}>Open the design workspace →</button>
      </div>
      <ExternalBuildPanel program={program} onSaveInputs={onSaveInputs} />
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
              <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(area)}>Focus →</button>
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
            <button type="button" className="v3fs-nb-focusbtn" onClick={() => onFocus(area)}>Validate →</button>
          </div>
        );
      })}
    </>
  );
}

// ── Focused area: the three-zone workspace overview ────────────────────────
function FocusedArea({ program, phase, area, rows, ls, ah, onBack, onOpenWork, onOpenOntology }: {
  program: ProgramSummary;
  phase: Phase;
  area: string;
  rows: ReturnType<typeof areaProgress>;
  ls: ReturnType<typeof loopState>;
  ah: (area: string) => { heard: number; total: number; ready: boolean; names: string[] };
  onBack: () => void;
  onOpenWork: () => void;
  onOpenOntology: (area: string | null) => void;
}) {
  const back = (
    <div className="v3fs-nb-backrow">
      <button type="button" className="v3fs-nb-back" onClick={onBack}>← All areas</button>
      <span className="v3fs-nb-title" style={{ "--acc": areaAccent(area) } as React.CSSProperties}>{area}<span className="v3fs-nb-dom">{phase === "listen" ? "Listen" : "Prototype"}</span></span>
    </div>
  );

  if (phase === "listen") {
    const r = rows.find((x) => x.area === area);
    const map = areaHasModel(program, area);
    const a = ah(area);
    const pct = a.total ? Math.round((100 * a.heard) / a.total) : 0;
    const entities = r?.entities ?? 0;
    const workflows = r?.workflows ?? 0;
    return (
      <>
        {back}
        <div className="v3fs-nb-zones">
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">This area · Listen</p>
            <div className="v3fs-nb-prog"><span className="big">{a.heard}</span><span className="of">/ {a.total} heard</span></div>
            <span className="v3fs-nb-meter wide"><i style={{ width: `${pct}%` }} /></span>
            <ul className="v3fs-nb-produces">
              <li><span className={`ic ${map ? "ok" : "wip"}`}>{map ? "✓" : "●"}</span> Business map</li>
              <li><span className={`ic ${workflows > 0 ? "ok" : "dot"}`}>{workflows > 0 ? "✓" : "○"}</span> How it works today</li>
            </ul>
            <div className="v3fs-nb-ready"><b>Ready when</b> this area is fully heard and its map is confirmed.</div>
          </div>
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">The work · what we’ve mapped</p>
            {/* The two Listen artifacts, made explicit — this is where the
                ontology (business map) and the current-state atlas live. */}
            <div className="v3fs-nb-doccard">
              <div className="v3fs-nb-doc">
                <div><div className="dt">Business map <span className="code">ontology</span></div><div className="dd">{entities > 0 ? `${entities} ${entities === 1 ? "entity" : "entities"} · ${map ? "confirmed" : "drafting"}` : "not started yet"}</div></div>
                <button type="button" className="v3fs-nb-open ghost sm" onClick={() => onOpenOntology(area)}>Open →</button>
              </div>
              <div className="v3fs-nb-doc">
                <div><div className="dt">How it works today <span className="code">current-state atlas</span></div><div className="dd">{workflows > 0 ? `${workflows} workflow${workflows === 1 ? "" : "s"} mapped` : "not started yet"}</div></div>
                <button type="button" className="v3fs-nb-open ghost sm" onClick={() => onOpenOntology(area)}>Open →</button>
              </div>
            </div>
            <p className="v3fs-nb-hint">Opens {area}’s business map and atlas here. To edit them, use the full workspace.</p>
          </div>
          <div className="v3fs-nb-zone">
            <p className="v3fs-nb-ztag">The record · heard</p>
            <ul className="v3fs-nb-rec">
              {a.names.map((who) => (
                <li key={who}><span className="av">{initials(who)}</span><div><div className="who">{who}</div><div className="what">Listen evidence on record</div></div></li>
              ))}
              {!a.names.length ? <li className="empty">No one heard in this area yet.</li> : null}
            </ul>
          </div>
        </div>
      </>
    );
  }

  // Prototype focused. Validation lives HERE on the board (verdicts + change
  // requests per area); the workspace is design-only.
  const P: AreaLoop | undefined = ls.areas.find((x) => x.area === area);
  const reqs = changeRequests(program).filter((c) => c.area === area);
  if (!ls.hasPrototype) {
    const r = rows.find((x) => x.area === area);
    return (
      <>
        {back}
        <div className="v3fs-nb-gatebox">
          <b>The prototype is still in design.</b>
          {r && r.listenReady ? "This area is fully heard — Design is assembling the build. Validation opens here once there’s a prototype to try." : `This area is still in Listen — ${r?.heard.length ?? 0} of ${r?.personas.length ?? 0} heard. Its build begins once the picture is complete.`}
          <div className="v3fs-nb-gate-act"><button type="button" className="v3fs-nb-open" onClick={onOpenWork}>Open the design workspace →</button></div>
        </div>
      </>
    );
  }
  const accepted = P?.accepted ?? 0;
  const changes = (P?.objections ?? 0) + (P?.changes ?? 0);
  const pending = P?.pending ?? 0;
  const total = P?.total ?? 0;
  return (
    <>
      {back}
      <div className="v3fs-nb-zones">
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">This area · Prototype</p>
          <div className="v3fs-nb-prog"><span className="big">Round {ls.round}</span></div>
          <ul className="v3fs-nb-produces">
            <li><span className="ic ok">✓</span> Clickable prototype</li>
            <li><span className={`ic ${total > 0 && pending === 0 ? "ok" : "wip"}`}>{total > 0 && pending === 0 ? "✓" : "●"}</span> Pilot verdicts</li>
          </ul>
          <div className="v3fs-nb-ready"><b>Ready when</b> the sponsor and a majority of this area’s pilots approve. Then it merges toward Ship.</div>
          <div className="v3fs-nb-gate-act"><button type="button" className="v3fs-nb-open ghost" onClick={onOpenWork}>Open the design workspace →</button></div>
        </div>
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">Validate · verdicts</p>
          {total === 0 ? (
            <p className="v3fs-nb-hint" style={{ marginTop: 0 }}>No verdicts yet — pilots weigh in from their demo links. Their responses land here as you gather them.</p>
          ) : (
            <div className="v3fs-nb-worksum">
              <div className="v3fs-nb-ws"><span className="n ok">{accepted}</span><span className="l">approved</span></div>
              <div className="v3fs-nb-ws"><span className="n no">{changes}</span><span className="l">change{changes === 1 ? "" : "s"}</span></div>
              <div className="v3fs-nb-ws"><span className="n wait">{pending}</span><span className="l">pending</span></div>
            </div>
          )}
          <p className="v3fs-nb-hint">Validation happens here on the board — one area at a time.</p>
        </div>
        <div className="v3fs-nb-zone">
          <p className="v3fs-nb-ztag">The record · change requests</p>
          <ul className="v3fs-nb-rec">
            {reqs.map((c, i) => (
              <li key={`${c.stakeholder}-${i}`}><span className="av">{initials(c.stakeholder)}</span><div><div className="who">{c.stakeholder}{c.blocking ? <span className="v3fs-nb-block"> objection</span> : null}</div><div className="what">{c.ask || c.verdict}</div></div></li>
            ))}
            {!reqs.length ? <li className="empty">No open change requests — everyone’s approved or pending.</li> : null}
          </ul>
        </div>
      </div>
    </>
  );
}

// ── Build outside the app: link an external prototype + generate an AI build
// prompt from the pilots' feedback. The URL is saved to show.prototypeLocation,
// which the flow-portal edge already serves as the pilots' "Open the prototype".
function ExternalBuildPanel({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs?: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const stored = String(readMovementInputs(program, "show").prototypeLocation ?? "");
  const [url, setUrl] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    if (!onSaveInputs) return;
    setSaving(true); setSaved(false);
    try {
      await onSaveInputs("show", { prototypeLocation: url.trim() }, {
        attest: { action: url.trim() ? `Linked external prototype — ${url.trim()}` : "Cleared external prototype link" },
      });
      setSaved(true);
    } finally { setSaving(false); }
  };

  const reqs = changeRequests(program);
  const genPrompt = () => {
    const lines: string[] = [];
    lines.push(`Update the "${program.name}" prototype to address the pilot feedback below. Keep everything that already works; change only what the feedback calls out, and keep the product's domain language consistent.`);
    lines.push("");
    if (reqs.length) {
      lines.push("Feedback to address:");
      reqs.forEach((c, i) => lines.push(`${i + 1}. [${c.area}] ${c.stakeholder}${c.blocking ? " — BLOCKING objection" : ""}: ${c.ask || c.verdict}`));
    } else {
      lines.push("No open change requests yet — the pilots haven't asked for changes. Use this once their feedback lands.");
    }
    lines.push("");
    lines.push("Return the updated build; preserve the existing structure and styling unless the feedback requires otherwise.");
    setPrompt(lines.join("\n"));
    setCopied(false);
  };
  const copyPrompt = async () => {
    if (!prompt) return;
    try { await navigator.clipboard.writeText(prompt); setCopied(true); } catch { /* clipboard denied — the box is selectable */ }
  };

  return (
    <div className="v3fs-nb-ext">
      <div className="v3fs-nb-ext-eyebrow">Build outside the app</div>
      <p className="v3fs-nb-ext-sub">Prototype in your own tool (v0, Cursor, Figma Make…) and link it here — the pilots’ “Open the prototype” points at your build.</p>
      <div className="v3fs-nb-ext-row">
        <input className="v3fs-nb-ext-in" type="url" value={url} placeholder="https://your-prototype.example.com"
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }} aria-label="External prototype URL" />
        <button type="button" className="v3fs-nb-open" disabled={!onSaveInputs || saving || url.trim() === stored} onClick={() => void save()}>{saving ? "Saving…" : "Save link"}</button>
        {url.trim() ? <a className="v3fs-nb-open ghost" href={url.trim()} target="_blank" rel="noreferrer">Open ↗</a> : null}
      </div>
      {saved ? <p className="v3fs-nb-ext-ok">✓ Linked — the pilots now open this build.</p> : null}
      <div className="v3fs-nb-ext-prompt">
        <button type="button" className="v3fs-nb-open ghost" onClick={genPrompt}>✳ Generate build prompt from feedback{reqs.length ? ` (${reqs.length})` : ""}</button>
        {prompt !== null ? (
          <>
            <textarea className="v3fs-nb-ext-ta" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} rows={Math.min(14, prompt.split("\n").length + 1)} />
            <button type="button" className="v3fs-nb-open" onClick={() => void copyPrompt()}>{copied ? "✓ Copied" : "Copy prompt"}</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── The area-scoped (or complete) ontology + current-state atlas, read-only.
// Opened from the Listen board's "See the complete ontology" and each focused
// area's business-map / atlas cards.
function OntologyAtlasModal({ program, area, onClose }: { program: ProgramSummary; area: string | null; onClose: () => void }) {
  const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
  const entities = ontologyEntities(program).filter((e) => !area || entityArea(e, program) === area);
  const workflows = atlasWorkflows(program).filter((w) => !area || workflowArea(w) === area);
  const stepText = (step: unknown): string => {
    if (!step || typeof step !== "object") return s(step);
    const r = step as Record<string, unknown>;
    const actor = s(r.actor);
    const act = s(r.action) || s(r.step) || s(r.beat) || s(r.name);
    return [actor, act].filter(Boolean).join(" — ") || s(r.description);
  };
  return (
    <div className="v3fs-nb-modal-scrim" role="dialog" aria-modal="true" aria-label={area ? `${area} business map` : "Complete ontology"} onClick={onClose}>
      <div className="v3fs-nb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="v3fs-nb-modal-h">
          <div>
            <div className="v3fs-nb-modal-eyebrow">{area ? `${area} · Listen` : "Every area · Listen"}</div>
            <h2 className="v3fs-nb-modal-title">{area ? `${area} — business map & how it works today` : "The complete ontology & current-state atlas"}</h2>
          </div>
          <button type="button" className="v3fs-nb-modal-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="v3fs-nb-modal-b">
          <section className="v3fs-nb-modal-sec">
            <div className="v3fs-nb-modal-sh"><b>Business map</b><span className="code">ontology · {entities.length} {entities.length === 1 ? "entity" : "entities"}</span></div>
            {entities.length ? (
              <div className="v3fs-nb-modal-ents">
                {entities.map((e, i) => (
                  <div key={i} className="v3fs-nb-modal-ent">
                    <div className="v3fs-nb-modal-ent-h"><b>{s(e.name) || "Entity"}</b>{s(e.systemOfRecord) ? <span className="sor">{s(e.systemOfRecord)}</span> : null}</div>
                    {s(e.definition) ? <p className="def">{s(e.definition)}</p> : null}
                    {Array.isArray(e.relationships) && e.relationships.length ? (
                      <p className="rel">{(e.relationships as unknown[]).map((r) => { const rr = r as Record<string, unknown>; return `${s(rr.type) || "relates to"} → ${s(rr.to) || s(rr.target) || s(rr.entity)}`; }).filter((t) => t.trim() !== "relates to → ").slice(0, 6).join(" · ")}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : <p className="v3fs-nb-modal-empty">No entities mapped {area ? "for this area" : "yet"}.</p>}
          </section>
          <section className="v3fs-nb-modal-sec">
            <div className="v3fs-nb-modal-sh"><b>How it works today</b><span className="code">current-state atlas · {workflows.length} {workflows.length === 1 ? "workflow" : "workflows"}</span></div>
            {workflows.length ? (
              <div className="v3fs-nb-modal-wfs">
                {workflows.map((w, i) => {
                  const steps = Array.isArray(w.steps) ? (w.steps as unknown[]) : [];
                  return (
                    <div key={i} className="v3fs-nb-modal-wf">
                      <div className="v3fs-nb-modal-ent-h"><b>{s(w.name) || "Workflow"}</b>{s(w.owner) ? <span className="sor">{s(w.owner)}</span> : null}</div>
                      {steps.length ? <ol className="steps">{steps.map((st, j) => <li key={j}>{stepText(st)}</li>)}</ol> : null}
                    </div>
                  );
                })}
              </div>
            ) : <p className="v3fs-nb-modal-empty">No workflows mapped {area ? "for this area" : "yet"}.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
