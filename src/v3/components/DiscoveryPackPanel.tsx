import React from "react";
import { RelativeTime } from "@/v3/components/ui/RelativeTime";

/**
 * Renders the Discover-phase Discovery Pack (produced by the
 * `discovery-guide-generator` support agent and stored at `inner.discoveryGuide`).
 * The pack is a support artifact, not a gated deliverable, so it never appears in
 * the methodology-driven output strip — this is the surface that makes it
 * visible. Every field is optional AI output, so each section renders only when
 * it carries content.
 */

interface InterviewGuide {
  purpose?: string;
  duration?: string;
  questions?: string[];
}

interface WorkshopActivity {
  name?: string;
  duration?: string;
  facilitation?: string;
}

interface WorkshopAgenda {
  title?: string;
  duration?: string;
  objectives?: string[];
  activities?: WorkshopActivity[];
}

export interface DiscoveryPack {
  executiveInterviewGuide?: InterviewGuide;
  operationalInterviewGuide?: InterviewGuide;
  workshopAgenda?: WorkshopAgenda;
  documentRequestList?: string[];
  hypotheses?: string[];
  generatedAt?: string;
}

function asGuide(value: unknown): InterviewGuide | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as InterviewGuide;
}

function asAgenda(value: unknown): WorkshopAgenda | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as WorkshopAgenda;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function GuideBlock({ label, guide }: { label: string; guide: InterviewGuide | null }) {
  const questions = strings(guide?.questions);
  if (!guide || (!guide.purpose && !guide.duration && questions.length === 0)) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="v3-output-preview-label">{label}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
        {guide.purpose ? <span>{guide.purpose}</span> : null}
        {guide.duration ? <span>· {guide.duration}</span> : null}
      </div>
      {questions.length ? (
        <ol style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
          {questions.map((question, index) => (
            <li key={`${label}-q-${index}`} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{question}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export default function DiscoveryPackPanel({ pack }: { pack: DiscoveryPack }) {
  const executive = asGuide(pack.executiveInterviewGuide);
  const operational = asGuide(pack.operationalInterviewGuide);
  const agenda = asAgenda(pack.workshopAgenda);
  const objectives = strings(agenda?.objectives);
  const activities = Array.isArray(agenda?.activities)
    ? (agenda!.activities as WorkshopActivity[]).filter((a) => a && typeof a === "object" && !Array.isArray(a))
    : [];
  const documents = strings(pack.documentRequestList);
  const hypotheses = strings(pack.hypotheses);

  return (
    <div className="v3-output-preview" style={{ marginTop: 16 }}>
      <div className="v3-output-preview-head">
        <div>
          <div className="v3-output-preview-label">Discovery pack</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
            Interview guides, workshop agenda, document requests, and hypotheses to run discovery
          </div>
        </div>
        {pack.generatedAt ? (
          <span style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>
            <RelativeTime date={pack.generatedAt} />
          </span>
        ) : null}
      </div>

      <GuideBlock label="Executive interview guide" guide={executive} />
      <GuideBlock label="Operational interview guide" guide={operational} />

      {agenda && (agenda.title || objectives.length || activities.length) ? (
        <div style={{ marginTop: 14 }}>
          <div className="v3-output-preview-label">Workshop agenda</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--v3-text-muted)", marginTop: 2 }}>
            {agenda.title ? <span>{agenda.title}</span> : null}
            {agenda.duration ? <span>· {agenda.duration}</span> : null}
          </div>
          {objectives.length ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
              {objectives.map((objective, index) => (
                <li key={`obj-${index}`} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{objective}</li>
              ))}
            </ul>
          ) : null}
          {activities.length ? (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {activities.map((activity, index) => (
                <div key={`act-${index}`} style={{ border: "1px solid var(--v3-border)", borderRadius: 6, padding: "6px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--v3-text-primary)" }}>
                    {activity.name || "Activity"}
                    {activity.duration ? <span style={{ fontWeight: 400, color: "var(--v3-text-muted)" }}> · {activity.duration}</span> : null}
                  </div>
                  {activity.facilitation ? (
                    <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", lineHeight: 1.5, marginTop: 2 }}>{activity.facilitation}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {documents.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="v3-output-preview-label">Documents to request</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            {documents.map((doc, index) => (
              <li key={`doc-${index}`} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{doc}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hypotheses.length ? (
        <div style={{ marginTop: 14 }}>
          <div className="v3-output-preview-label">Hypotheses to test</div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            {hypotheses.map((hypothesis, index) => (
              <li key={`hyp-${index}`} style={{ fontSize: 13, color: "var(--v3-text-secondary)", lineHeight: 1.55 }}>{hypothesis}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
