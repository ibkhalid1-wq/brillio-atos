/**
 * The public sponsor brief — what a ?flowBrief= link opens. No account, no
 * app chrome: the token is the access, the flow-portal edge function serves
 * a dated SNAPSHOT of the board pack, and this page typesets it read-only.
 * It deliberately reuses the board pack's print typography: the sponsor sees
 * the same page the operator printed.
 */
import { useEffect, useState } from "react";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1`;

interface BriefPayload {
  programme: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

export default function FlowBrief({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "invalid" | "ready">("loading");
  const [brief, setBrief] = useState<BriefPayload | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`${FUNCTIONS_BASE}/flow-portal?brief=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) { setState("invalid"); return; }
        const payload = await response.json() as BriefPayload;
        setBrief(payload);
        setState("ready");
      })
      .catch(() => { if (alive) setState("invalid"); });
    return () => { alive = false; };
  }, [token]);

  if (state === "loading") return <div className="v3-splash">Opening the brief…</div>;
  if (state === "invalid" || !brief) {
    return (
      <div className="v3fs-brief">
        <div className="v3fs-brief-card v3fs-pack-page">
          <div className="v3fs-pack-eyebrow">ATOS Flow · Sponsor brief</div>
          <h1>This link is not valid</h1>
          <p>It may have expired or been superseded by a newer brief. Ask the programme team for a fresh link.</p>
        </div>
      </div>
    );
  }

  const snap = brief.snapshot;
  const numbers = isRecord(snap.numbers) ? snap.numbers : {};
  const kpis = rows(snap.kpis);
  const gates = rows(snap.gates);
  const verdicts = rows(snap.verdicts);
  const benefits = rows(snap.benefits);
  const trail = rows(snap.trail);
  const sent = new Date(brief.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const days = typeof snap.daysToFirstDemo === "number" ? snap.daysToFirstDemo : null;

  return (
    <div className="v3fs-brief">
      <div className="v3fs-brief-card v3fs-pack-page">
        <div className="v3fs-pack-eyebrow">ATOS Flow · Sponsor brief — sent {sent}</div>
        <h1>{text(snap.name) || brief.programme}</h1>
        {text(snap.client) ? <div className="v3fs-pack-client">{text(snap.client)}</div> : null}

        <section>
          <h2>The mandate</h2>
          <p>{text(snap.objective) || "Objective not yet on record."}</p>
          <div className="v3fs-pack-facts">
            {text(snap.sponsor) ? <div><b>Sponsor</b><span>{text(snap.sponsor)}</span></div> : null}
            {text(snap.industry) ? <div><b>Industry</b><span>{text(snap.industry)}</span></div> : null}
            {days != null ? <div><b>First demonstration</b><span>{days} days away</span></div> : null}
          </div>
        </section>

        <section>
          <h2>The numbers</h2>
          <div className="v3fs-pack-stats">
            <div><b>{Number(numbers.voicesHeard ?? 0)}/{Number(numbers.voicesTotal ?? 0) || "—"}</b><span>voices heard</span></div>
            <div><b>{Number(numbers.demosAccepted ?? 0)}/{Number(numbers.demosTotal ?? 0) || "—"}</b><span>demos accepted</span></div>
            <div><b>{Number(numbers.words ?? 0).toLocaleString()}</b><span>words of evidence</span></div>
            <div><b>{Number(numbers.waiting ?? 0)}</b><span>decisions waiting</span></div>
          </div>
        </section>

        {kpis.length ? (
          <section>
            <h2>Success measures</h2>
            <table className="v3fs-pack-table">
              <thead><tr><th>Measure</th><th>Baseline</th><th>Target</th></tr></thead>
              <tbody>
                {kpis.map((kpi, index) => (
                  <tr key={index}><td>{text(kpi.name)}</td><td>{text(kpi.baseline) || "—"}</td><td>{text(kpi.target) || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section>
          <h2>Where the engagement stands</h2>
          <div className="v3fs-pack-gates">
            {gates.map((gate, index) => (
              <div key={index} className={`v3fs-pack-gate ${text(gate.tone)}`}>
                <b>{text(gate.name)}</b>
                <span>{text(gate.headline)}{text(gate.detail) ? ` — ${text(gate.detail)}` : ""}</span>
              </div>
            ))}
          </div>
        </section>

        {verdicts.length ? (
          <section>
            <h2>Verdicts, person by person</h2>
            <table className="v3fs-pack-table">
              <thead><tr><th>Stakeholder</th><th>Verdict</th><th>Reaction</th></tr></thead>
              <tbody>
                {verdicts.map((row, index) => (
                  <tr key={index}><td>{text(row.stakeholder) || "—"}</td><td>{text(row.verdict) || "Pending"}</td><td>{text(row.reaction)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {benefits.length ? (
          <section>
            <h2>Realised benefits</h2>
            <table className="v3fs-pack-table">
              <thead><tr><th>Benefit</th><th>Baseline</th><th>Current</th><th>Target</th></tr></thead>
              <tbody>
                {benefits.map((row, index) => (
                  <tr key={index}><td>{text(row.benefit) || "—"}</td><td>{text(row.baseline) || "—"}</td><td>{text(row.current) || "—"}</td><td>{text(row.target) || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {trail.length ? (
          <section>
            <h2>Latest on the record</h2>
            {trail.map((entry, index) => (
              <div key={index} className="v3fs-pack-trail">
                <span>{text(entry.action)}</span>
                <em>{text(entry.date) ? new Date(text(entry.date)).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</em>
              </div>
            ))}
          </section>
        ) : null}

        <footer className="v3fs-pack-foot">
          A dated snapshot from ATOS Flow, sent {sent}. The live programme may have moved on — ask the team for a fresh brief.
        </footer>
      </div>
    </div>
  );
}
