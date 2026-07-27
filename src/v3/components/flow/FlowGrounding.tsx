import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProgramSummary } from "@/new/types";
import { supabase } from "@/integrations/supabase/client";

/**
 * Grounding — the standards cheat sheet the provisional ontology is generated
 * against, straight from the deployed edge resolver (grounding-manifest), so
 * this page can never drift from what generation actually does. Shipped
 * standard packs are read-only; the one configurable piece is the CLIENT
 * vocabulary — the engagement's canonical model — which rides as one more
 * name-aligned pack. It persists as a JSON string at
 * phaseInputs.listen.clientVocabulary, so saving it stales the Domain
 * Ontology through the normal input fingerprint.
 */

type ManifestClass = { name: string; uri: string | null; definition: string; aliases: string[]; core: boolean };
type ManifestPack = { vocabulary: string; source: "standard" | "client"; classes: ManifestClass[]; associations: string[] };
type Manifest = {
  steering: string;
  industry: string | null;
  segment: string | null;
  packs: ManifestPack[];
  menuVerbs: string[];
  uriPrefixes: string[];
};

type VocabRow = { name: string; definition: string; aliases: string; core: boolean };
type VocabRel = { from: string; verb: string; to: string };

function parseAssociation(assoc: string, menuVerbs: string[]): VocabRel | null {
  for (const verb of [...menuVerbs].sort((a, b) => b.length - a.length)) {
    const at = assoc.indexOf(` ${verb} `);
    if (at > 0) return { from: assoc.slice(0, at), verb, to: assoc.slice(at + verb.length + 2) };
  }
  return null;
}

export default function FlowGrounding({ program, onSaveInputs }: {
  program: ProgramSummary;
  onSaveInputs: (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; attest?: { action: string; detail?: string } }) => Promise<void>;
}) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [vocabName, setVocabName] = useState("");
  const [rows, setRows] = useState<VocabRow[]>([]);
  const [rels, setRels] = useState<VocabRel[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.functions.invoke("run-agent", {
      body: { agentId: "grounding-manifest", programId: program.id, phaseId: "listen", triggeredBy: "user" },
    });
    if (error) { setLoadError(String((error as { message?: string }).message ?? error)); return; }
    const out = (data as { output?: Manifest } | null)?.output;
    if (out && Array.isArray(out.packs)) setManifest(out);
    else setLoadError("The grounding manifest came back empty — the edge function may be mid-deploy.");
  }, [program.id]);
  useEffect(() => { void load(); }, [load]);

  const clientPack = manifest?.packs.find((p) => p.source === "client") ?? null;
  const standardPacks = useMemo(() => manifest?.packs.filter((p) => p.source === "standard") ?? [], [manifest]);

  const beginEdit = () => {
    setVocabName(clientPack?.vocabulary ?? "");
    setRows(clientPack
      ? clientPack.classes.map((c) => ({ name: c.name, definition: c.definition, aliases: c.aliases.join(", "), core: c.core }))
      : [{ name: "", definition: "", aliases: "", core: true }]);
    setRels(clientPack && manifest
      ? clientPack.associations.map((a) => parseAssociation(a, manifest.menuVerbs)).filter((r): r is VocabRel => !!r)
      : []);
    setSavedNote(false);
    setEditing(true);
  };

  const entityNames = rows.map((r) => r.name.trim()).filter(Boolean);

  // Live validation mirroring the edge sanitiser — what fails here would be
  // silently dropped there, so say it now instead.
  const issues = useMemo(() => {
    const found: string[] = [];
    const lower = entityNames.map((n) => n.toLowerCase());
    if (new Set(lower).size !== lower.length) found.push("Entity names must be unique.");
    if (rows.filter((r) => r.core).length > 5) found.push("At most 5 core entities — a core is ALWAYS asserted into the ontology.");
    const standardTerms = new Map<string, string>();
    for (const p of standardPacks) {
      for (const c of p.classes) {
        for (const term of [c.name, ...c.aliases]) {
          const k = term.trim().toLowerCase();
          if (k && !standardTerms.has(k)) standardTerms.set(k, `${c.name} (${p.vocabulary})`);
        }
      }
    }
    for (const r of rows) {
      for (const term of [r.name, ...r.aliases.split(",")]) {
        const k = term.trim().toLowerCase();
        if (k && standardTerms.has(k)) found.push(`"${term.trim()}" already names ${standardTerms.get(k)} — drop it here, or the vote folds the two into one concept.`);
      }
    }
    for (const rel of rels) {
      if (!entityNames.includes(rel.from) || !entityNames.includes(rel.to)) { found.push("Every relation must connect two entities defined above."); break; }
    }
    return [...new Set(found)];
  }, [rows, rels, standardPacks, entityNames]);

  const save = async () => {
    setSaving(true);
    try {
      const entities = rows
        .map((r) => ({ name: r.name.trim(), definition: r.definition.trim(), aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean), core: r.core }))
        .filter((e) => e.name);
      const names = new Set(entities.map((e) => e.name));
      const relations = rels.filter((r) => names.has(r.from) && names.has(r.to));
      const payload = entities.length
        ? JSON.stringify({ vocabulary: vocabName.trim() || "Client vocabulary", entities, relations })
        : "";
      await onSaveInputs("listen", { clientVocabulary: payload }, {
        attest: { action: entities.length ? "Client vocabulary updated" : "Client vocabulary removed", detail: vocabName.trim() || undefined },
      });
      setEditing(false);
      setSavedNote(true);
      void load();
    } finally {
      setSaving(false);
    }
  };

  const setRow = (i: number, patch: Partial<VocabRow>) => setRows((prev) => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  const setRel = (i: number, patch: Partial<VocabRel>) => setRels((prev) => prev.map((r, j) => j === i ? { ...r, ...patch } : r));

  return (
    <div className="v3fs-grounding" style={{ display: "grid", gap: 14 }}>
      <div className="v3fs-panel">
        <div className="v3fs-ph">
          <h3>Grounding</h3>
          <span>the facts the Domain Ontology is generated against — every entity must trace to these packs or the sponsor&rsquo;s own words</span>
        </div>
        {loadError ? (
          <div className="v3fs-empty">{loadError} <button type="button" className="v3fs-btn" onClick={() => void load()}>Retry</button></div>
        ) : !manifest ? (
          <div className="v3fs-empty">Reading the deployed grounding manifest…</div>
        ) : (
          <p style={{ margin: "4px 0 0", opacity: 0.85 }}>
            <span className="v3fs-tag">{manifest.industry || "No industry set"}{manifest.segment ? ` · ${manifest.segment}` : ""}</span>{" "}
            {manifest.steering}
          </p>
        )}
      </div>

      {standardPacks.map((pack) => (
        <div className="v3fs-panel" key={pack.vocabulary}>
          <div className="v3fs-ph">
            <h3>{pack.vocabulary}</h3>
            <span>industry standard — read-only; ships with AURA and is validated in CI</span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {pack.classes.map((c) => (
              <div key={c.name} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ minWidth: 170 }}>{c.name}{c.core ? <span className="v3fs-tag" style={{ marginLeft: 6 }}>core</span> : null}</strong>
                <span style={{ opacity: 0.85, flex: 1 }}>{c.definition}</span>
                {c.uri ? <a href={c.uri} target="_blank" rel="noreferrer" style={{ fontSize: 12, opacity: 0.7 }}>{c.uri.replace(/^https?:\/\//, "")}</a> : <span style={{ fontSize: 12, opacity: 0.5 }}>name-aligned</span>}
              </div>
            ))}
          </div>
          {pack.associations.length ? (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {pack.associations.map((a) => <span key={a} className="v3fs-tag">{a}</span>)}
            </div>
          ) : null}
        </div>
      ))}

      <div className="v3fs-panel">
        <div className="v3fs-ph">
          <h3>Client vocabulary</h3>
          <span>the engagement&rsquo;s canonical model — rides beside the standards as one more pack of facts. Core entities are always asserted; the rest ground and align.</span>
        </div>

        {!editing && (
          clientPack ? (
            <>
              <p style={{ margin: "2px 0 8px" }}><strong>{clientPack.vocabulary}</strong></p>
              <div style={{ display: "grid", gap: 6 }}>
                {clientPack.classes.map((c) => (
                  <div key={c.name} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ minWidth: 170 }}>{c.name}{c.core ? <span className="v3fs-tag" style={{ marginLeft: 6 }}>core</span> : null}</strong>
                    <span style={{ opacity: 0.85, flex: 1 }}>{c.definition}</span>
                    {c.aliases.length ? <span style={{ fontSize: 12, opacity: 0.6 }}>aka {c.aliases.join(", ")}</span> : null}
                  </div>
                ))}
              </div>
              {clientPack.associations.length ? (
                <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {clientPack.associations.map((a) => <span key={a} className="v3fs-tag">{a}</span>)}
                </div>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <button type="button" className="v3fs-btn" onClick={beginEdit}>Edit vocabulary</button>
              </div>
            </>
          ) : (
            <div className="v3fs-empty">
              No client vocabulary attached. Attach the client&rsquo;s own entity dictionary — an MDM glossary, a canonical data model — and the ontology grounds in their language, not just the public standard.
              <div style={{ marginTop: 10 }}>
                {manifest ? <button type="button" className="v3fs-btn pri" onClick={beginEdit}>Attach client vocabulary</button> : null}
              </div>
            </div>
          )
        )}

        {savedNote && !editing ? (
          <p style={{ marginTop: 10, opacity: 0.85 }}>
            Saved. The Domain Ontology now counts this as a changed input — regenerate it from the Flow board to fold the vocabulary in.
          </p>
        ) : null}

        {editing && manifest && (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 4, maxWidth: 420 }}>
              <span className="v3fs-pf-eyebrow">Vocabulary name</span>
              <input className="v3fs-dir-in" value={vocabName} placeholder="e.g. Acme Canonical Model" onChange={(e) => setVocabName(e.target.value)} />
            </label>

            <div style={{ display: "grid", gap: 6 }}>
              <span className="v3fs-pf-eyebrow">Entities (max 24 · up to 5 core)</span>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input className="v3fs-dir-in" style={{ width: 180 }} value={r.name} placeholder="Entity name" onChange={(e) => setRow(i, { name: e.target.value })} />
                  <input className="v3fs-dir-in" style={{ flex: 1, minWidth: 200 }} value={r.definition} placeholder="One-line definition" onChange={(e) => setRow(i, { definition: e.target.value })} />
                  <input className="v3fs-dir-in" style={{ width: 200 }} value={r.aliases} placeholder="aliases, comma-separated" onChange={(e) => setRow(i, { aliases: e.target.value })} />
                  <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                    <input type="checkbox" checked={r.core} onChange={(e) => setRow(i, { core: e.target.checked })} /> core
                  </label>
                  <button type="button" className="v3fs-btn" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {rows.length < 24 ? (
                <div><button type="button" className="v3fs-btn" onClick={() => setRows((prev) => [...prev, { name: "", definition: "", aliases: "", core: false }])}>Add entity</button></div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <span className="v3fs-pf-eyebrow">Relations (closed verb menu — same menu the generator enforces)</span>
              {rels.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select className="v3fs-dir-in" value={r.from} onChange={(e) => setRel(i, { from: e.target.value })}>
                    <option value="">from…</option>
                    {entityNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <select className="v3fs-dir-in" value={r.verb} onChange={(e) => setRel(i, { verb: e.target.value })}>
                    {manifest.menuVerbs.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select className="v3fs-dir-in" value={r.to} onChange={(e) => setRel(i, { to: e.target.value })}>
                    <option value="">to…</option>
                    {entityNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button type="button" className="v3fs-btn" onClick={() => setRels((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <div><button type="button" className="v3fs-btn" disabled={entityNames.length < 2} onClick={() => setRels((prev) => [...prev, { from: entityNames[0] ?? "", verb: manifest.menuVerbs[0] ?? "applies to", to: entityNames[1] ?? "" }])}>Add relation</button></div>
            </div>

            {issues.length ? (
              <div className="v3fs-empty" role="alert">
                {issues.map((m) => <div key={m}>{m}</div>)}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="v3fs-btn pri" disabled={saving || issues.length > 0} onClick={() => void save()}>
                {saving ? "Saving…" : "Save vocabulary"}
              </button>
              <button type="button" className="v3fs-btn" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              {clientPack ? (
                <button type="button" className="v3fs-btn" disabled={saving} style={{ marginLeft: "auto" }}
                  onClick={() => { setRows([]); setRels([]); void save(); }}>
                  Remove vocabulary
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
