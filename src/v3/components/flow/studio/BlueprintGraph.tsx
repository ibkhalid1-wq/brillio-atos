/**
 * The Agentic Blueprint — WHAT YOU ARE ABOUT TO LET RUN BY ITSELF.
 *
 * This was a node graph with five lenses (flow / data / HITL / eval / build): agents
 * as boxes, derived dataflow as edges, and a toolbar to change which fact the boxes
 * emphasised. It drew the one thing the document is least interesting for — that agent
 * A's output tokens overlap agent B's input tokens — and it hid, one lens-click away
 * each, the things that decide whether this blueprint is safe to build.
 *
 * The document holds, per agent: `autonomyLevel`, `blastRadius`, `reversibility`,
 * `requiresHitl`, `escalatesTo`, and `guardrails[]` of {failureMode, detection,
 * fallback}. Those are the answer to the only question anyone asks of an agentic
 * design — *which of these can hurt us, and what catches it when it goes wrong* — and
 * not one of them was on the canvas.
 *
 * So: a roster in BUILD ORDER, because that is the order someone will implement it,
 * with the risk triad on every row and the ungoverned ones surfaced first as a
 * reading. No layout engine, no lens switching, no derived edges nobody asked for.
 *
 * It DECIDES nothing — the blueprint is generated and this reads it. What it adds is
 * that an agent with wide blast radius, no reversibility and no human gate cannot sit
 * quietly in the middle of a graph looking like every other box.
 */
import { useMemo } from "react";
import { asArray, asRecord, asText, asStrings, EmptyState, Section, type StudioProps } from "./StudioKit";

/** One agent, read once, with the doc-level facts folded in. */
interface AgentRow {
  name: string;
  purpose: string;
  replaces: string;
  inputs: string[];
  outputs: string[];
  tools: string[];
  autonomy: string;
  blast: string;
  reversibility: string;
  requiresHitl: boolean;
  escalatesTo: string;
  guardrails: Array<{ failureMode: string; detection: string; fallback: string }>;
  /** 1-based position in `buildSequence`, or 0 when the sequence never names it. */
  buildIndex: number;
  /** A human gate stated at the document level (`hitlPoints`), if any. */
  gate: string;
  /** The pass bar from `evalPlan`, if any. */
  passBar: string;
}

/** Token overlap, so "ReconciliationAction" matches "reconciliation actions". */
const tok = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).map((t) => t.replace(/s$/, "")).filter((t) => t.length >= 4);

/**
 * A TOKEN ONLY IDENTIFIES AN AGENT IF NO OTHER AGENT SHARES IT.
 *
 * The old matcher accepted ANY token overlap, and on real data every agent is called
 * "<Something> Agent" — so the token "agent" matched every one of them. Every agent
 * mapped to build slice 1, to the first HITL point, and to the first eval row. The
 * graph's Build lens numbered them all `1` and nobody noticed, because a number in a
 * box looks the same whether it is right or wrong. Caught by the roster's ordering
 * guard, which asserted the sequence rather than the rendering.
 *
 * Distinctiveness is computed from the roster itself rather than a stoplist: whatever
 * this programme's agents happen to have in common is exactly what cannot identify one
 * of them.
 */
const distinctive = (name: string, allNames: readonly string[]): string[] => {
  const mine = tok(name);
  const others = new Set(allNames.filter((n) => n !== name).flatMap(tok));
  return mine.filter((t) => !others.has(t));
};
const mentionsIn = (haystack: string, name: string, allNames: readonly string[]) => {
  const hs = haystack.toLowerCase();
  if (name.length >= 3 && hs.includes(name.toLowerCase())) return true;   // the whole name always counts
  return distinctive(name, allNames).some((t) => hs.includes(t));
};

/** HIGH / WIDE / IRREVERSIBLE, however the generator worded it. */
const isHigh = (v: string) => /high|full|autonomous|unsupervised/i.test(v);
const isWide = (v: string) => /wide|broad|high|org|global|cross|external|customer/i.test(v);
const isIrreversible = (v: string) => /irreversible|permanent|cannot|not reversible|hard/i.test(v);

/**
 * THE READING THIS SURFACE EXISTS FOR.
 *
 * An agent is UNGOVERNED when it can act on its own, the damage is wide or
 * irreversible, and nothing gates it — no `requiresHitl`, no document-level HITL
 * point. That is a conjunction of facts the document already states; nothing is
 * inferred beyond reading them together.
 *
 * Exported because the guard asserts on it: a reading that decides which agents get
 * flagged must be testable without mounting a component.
 */
export function isUngoverned(a: Pick<AgentRow, "autonomy" | "blast" | "reversibility" | "requiresHitl" | "gate">): boolean {
  if (a.requiresHitl || a.gate) return false;                  // a human is in the path
  const risky = isWide(a.blast) || isIrreversible(a.reversibility);
  return risky && isHigh(a.autonomy);
}

export function readAgentRows(doc: Record<string, unknown>): AgentRow[] {
  const agents = asArray(doc.agents).map(asRecord);
  const hitl = asArray(doc.hitlPoints).map(asRecord);
  const evals = asArray(doc.evalPlan).map(asRecord);
  const build = asStrings(doc.buildSequence);
  const rows: AgentRow[] = [];
  const allNames = agents.map((a) => asText(a.name).trim()).filter(Boolean);
  for (const a of agents) {
    const name = asText(a.name).trim();
    if (!name) continue;
    const h = hitl.find((p) => mentionsIn(`${asText(p.agent)} ${asText(p.point ?? p.where ?? "")}`, name, allNames));
    const e = evals.find((r) => mentionsIn(`${asText(r.agent)} ${asText(r.metric ?? r.what ?? r.check ?? "")}`, name, allNames));
    const bi = build.findIndex((slice) => mentionsIn(slice, name, allNames));
    rows.push({
      name,
      purpose: asText(a.purpose),
      replaces: asText(a.replacesWorkflow),
      inputs: asStrings(a.inputs),
      outputs: asStrings(a.outputs),
      tools: asStrings(a.tools),
      autonomy: asText(a.autonomyLevel),
      blast: asText(a.blastRadius),
      reversibility: asText(a.reversibility),
      requiresHitl: a.requiresHitl === true || /yes|true|required/i.test(asText(a.requiresHitl)),
      escalatesTo: asText(a.escalatesTo),
      guardrails: asArray(a.guardrails).map(asRecord).map((g) => ({
        failureMode: asText(g.failureMode), detection: asText(g.detection), fallback: asText(g.fallback),
      })).filter((g) => g.failureMode || g.detection || g.fallback),
      buildIndex: bi >= 0 ? bi + 1 : 0,
      gate: h ? (asText(h.point ?? h.where) || asText(h.approver) || "a human approves") : "",
      passBar: e ? (asText(e.passBar ?? e.threshold ?? e.target) || asText(e.metric ?? e.what ?? e.check)) : "",
    });
  }
  // Build order is implementation order — the order somebody will actually do this in.
  // Agents the sequence never names sort last, because "when" is the open question
  // about them, not their position.
  return rows.sort((x, y) => (x.buildIndex || 999) - (y.buildIndex || 999) || x.name.localeCompare(y.name));
}

const Chip = ({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" | "ok" }) => (
  <span className={`v3bp-chip${tone ? ` is-${tone}` : ""}`}>
    <span className="v3bp-chip-k">{label}</span>
    <span className="v3bp-chip-v">{value || "not stated"}</span>
  </span>
);

export default function BlueprintGraph({ doc }: Pick<StudioProps, "doc">) {
  const rows = useMemo(() => readAgentRows(doc), [doc]);
  const stats = useMemo(() => ({
    gated: rows.filter((r) => r.requiresHitl || r.gate).length,
    ungoverned: rows.filter(isUngoverned).length,
    noAutonomy: rows.filter((r) => !r.autonomy.trim()).length,
    noGuardrails: rows.filter((r) => !r.guardrails.length).length,
    unsequenced: rows.filter((r) => !r.buildIndex).length,
  }), [rows]);

  if (!rows.length) {
    return <EmptyState icon="🧩" title="No agents yet"
      hint="Regenerate the Blueprint to derive them from the Atlas and the Ontology." />;
  }

  return (
    <div className="v3bp">
      {/* THE HEADLINE IS THE RISK, not the count. "12 agents" tells nobody whether
          this is safe to build; "3 can act alone with nothing to catch them" does. */}
      <div className="v3bp-top">
        <span className="v3bp-stat"><b>{rows.length}</b> agents</span>
        <span className="v3bp-stat"><b>{stats.gated}</b> gated by a human</span>
        {stats.ungoverned ? <span className="v3bp-stat is-bad"><b>{stats.ungoverned}</b> can act alone on something wide or irreversible</span> : null}
        {stats.noGuardrails ? <span className="v3bp-stat is-warn"><b>{stats.noGuardrails}</b> state no failure handling</span> : null}
        {stats.noAutonomy ? <span className="v3bp-stat is-warn"><b>{stats.noAutonomy}</b> with no autonomy decided</span> : null}
      </div>

      <Section label="Agents, in build order"
        hint="The order someone will implement them in. Each row is what the blueprint states — nothing here is inferred beyond reading those fields together.">
        <ol className="v3bp-list">
          {rows.map((r) => {
            const ungoverned = isUngoverned(r);
            return (
              <li key={r.name} className={`v3bp-row${ungoverned ? " is-ungoverned" : ""}`}>
                <span className="v3bp-seq" aria-label={r.buildIndex ? `build step ${r.buildIndex}` : "not in the build sequence"}>
                  {r.buildIndex || "—"}
                </span>
                <span className="v3bp-body">
                  <span className="v3bp-h">
                    <b className="v3bp-name">{r.name}</b>
                    {r.requiresHitl || r.gate
                      ? <span className="v3bp-gate">✋ {r.gate || "a human approves"}</span>
                      : <span className="v3bp-nogate">runs unattended</span>}
                    {ungoverned ? <span className="v3bp-flag">nothing catches this one</span> : null}
                  </span>
                  {r.purpose ? <span className="v3bp-purpose">{r.purpose}</span> : null}
                  {r.replaces ? <span className="v3bp-replaces">replaces <b>{r.replaces}</b></span> : null}
                  <span className="v3bp-chips">
                    <Chip label="autonomy" value={r.autonomy} tone={!r.autonomy ? "warn" : isHigh(r.autonomy) ? "bad" : undefined} />
                    <Chip label="blast radius" value={r.blast} tone={isWide(r.blast) ? "bad" : undefined} />
                    <Chip label="reversible" value={r.reversibility} tone={isIrreversible(r.reversibility) ? "bad" : "ok"} />
                    {r.escalatesTo ? <Chip label="escalates to" value={r.escalatesTo} /> : null}
                    {r.passBar ? <Chip label="pass bar" value={r.passBar} tone="ok" /> : null}
                  </span>
                  <span className="v3bp-data">
                    {r.inputs.length ? <>reads <b>{r.inputs.join(", ")}</b></> : <>reads nothing stated</>}
                    {r.outputs.length ? <> → writes <b>{r.outputs.join(", ")}</b></> : <> → writes nothing stated</>}
                    {r.tools.length ? <span className="v3bp-tools"> · via {r.tools.join(", ")}</span> : null}
                  </span>
                  {/* WHAT HAPPENS WHEN IT GOES WRONG. The graph had no room for this
                      and it is the half of the design that matters at 3am. */}
                  {r.guardrails.length ? (
                    <details className="v3bp-guards">
                      <summary>{r.guardrails.length} failure mode{r.guardrails.length === 1 ? "" : "s"} handled</summary>
                      <ul>
                        {r.guardrails.map((g, i) => (
                          <li key={i}>
                            <b>{g.failureMode || "failure"}</b>
                            {g.detection ? <> — caught by {g.detection}</> : <> — <i>no detection stated</i></>}
                            {g.fallback ? <> → {g.fallback}</> : <> → <i>no fallback stated</i></>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <span className="v3bp-noguards">No failure handling stated — nothing says what happens when this fails.</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </Section>

      {stats.unsequenced ? (
        <p className="v3bp-foot">
          <b>{stats.unsequenced}</b> agent{stats.unsequenced === 1 ? " is" : "s are"} not named in the build
          sequence — they are listed last, and when to build them is an open question rather than a position.
        </p>
      ) : null}
    </div>
  );
}
