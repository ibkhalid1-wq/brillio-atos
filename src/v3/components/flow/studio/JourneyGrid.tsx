/**
 * The journey orchestrator: a service-blueprint grid per journey — stages
 * as columns, four lanes as rows — so the customer's experience, the staff
 * journey supporting it, the agents underneath and the systems they touch
 * read in one aligned view. The grid IS the document
 * (agenticBlueprint.journeys); the generator emits it, edits guard like
 * every mirror.
 */
import { useMemo, useState } from "react";
import { TextField, SelectField, asArray, asRecord, asText, useStudioLocked, EmptyState, type StudioProps } from "./StudioKit";

const JOURNEY_LANES: Array<{ key: string; label: string }> = [
  { key: "customer", label: "Customer" },
  { key: "user", label: "User (staff)" },
  { key: "agent", label: "Agent" },
  { key: "systems", label: "Systems" },
];

export default function JourneyGrid({ doc, onChange }: StudioProps) {
  const locked = useStudioLocked();
  const journeys = useMemo(() => asArray(doc.journeys).map(asRecord), [doc.journeys]);
  const [active, setActive] = useState(0);
  const journey = journeys[Math.min(active, Math.max(0, journeys.length - 1))];
  const stages = journey ? asArray(journey.stages).map(asRecord) : [];

  const writeJourneys = (next: Array<Record<string, unknown>>) => onChange({ ...doc, journeys: next });
  const patchJourney = (patch: Record<string, unknown>) =>
    writeJourneys(journeys.map((entry, index) => (index === active ? { ...entry, ...patch } : entry)));
  const patchStage = (index: number, patch: Record<string, unknown>) =>
    patchJourney({ stages: stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)) });

  return (
    <div className="v3fs-jny">
      <div className="v3fs-wf-tabs" role="tablist" aria-label="Journeys">
        {journeys.map((entry, index) => (
          <button key={index} type="button" role="tab" aria-selected={index === active}
            className={index === active ? "on" : ""} onClick={() => setActive(index)}>
            {asText(entry.name) || `Journey ${index + 1}`}
            <em>{asText(entry.persona) === "user" ? "user" : "customer"}</em>
          </button>
        ))}
        {locked ? null : <button type="button" className="v3fs-a"
          onClick={() => { writeJourneys([...journeys, { name: `Journey ${journeys.length + 1}`, persona: "customer", stages: [] }]); setActive(journeys.length); }}>
          ＋ journey
        </button>}
      </div>
      {!journey ? (
        <EmptyState icon="🗺" title="No journeys yet" hint="Add one above, or regenerate the Blueprint and they arrive grounded in the Atlas’s workflows." />
      ) : (
        <>
          <div className="v3fs-wf-head">
            <TextField label="Name" value={asText(journey.name)} onChange={(next) => patchJourney({ name: next })} />
            <SelectField label="Persona" value={asText(journey.persona) || "customer"} options={["customer", "user"]}
              onChange={(next) => patchJourney({ persona: next })} />
          </div>
          <div className="v3fs-jny-scroll">
            <table className="v3fs-jny-grid">
              <thead>
                <tr>
                  <th className="v3fs-jny-lane" aria-label="Lane" />
                  {stages.map((stage, index) => (
                    <th key={index}>
                      <input value={asText(stage.name)} placeholder={`Stage ${index + 1}`} aria-label="Stage name" disabled={locked}
                        onChange={(event) => patchStage(index, { name: event.target.value })} />
                      {locked ? null : <button type="button" className="v3fs-a" aria-label="Remove stage"
                        onClick={() => patchJourney({ stages: stages.filter((_, i) => i !== index) })}>×</button>}
                    </th>
                  ))}
                  {locked ? null : <th className="v3fs-jny-add">
                    <button type="button" className="v3fs-a"
                      onClick={() => patchJourney({ stages: [...stages, { name: "", customer: "", user: "", agent: "", systems: "" }] })}>
                      ＋ stage
                    </button>
                  </th>}
                </tr>
              </thead>
              <tbody>
                {JOURNEY_LANES.map((lane) => (
                  <tr key={lane.key} className={`v3fs-jny-${lane.key}`}>
                    <th className="v3fs-jny-lane">{lane.label}</th>
                    {stages.map((stage, index) => (
                      <td key={index}>
                        <textarea rows={2} value={asText(stage[lane.key])} disabled={locked}
                          aria-label={`${lane.label} at ${asText(stage.name) || `stage ${index + 1}`}`}
                          onChange={(event) => patchStage(index, { [lane.key]: event.target.value })} />
                      </td>
                    ))}
                    <td className="v3fs-jny-add" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
