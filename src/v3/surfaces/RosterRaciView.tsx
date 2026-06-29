import React, { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import { AdamCard, AdamCardBody, AdamCardHeader } from "@/v3/components/ui/AdamCard";
import { EmptyState } from "@/v3/components/ui/EmptyState";
import { getDynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { resolveRosterField, ROSTER_PHASE_ID } from "@/v3/lib/phaseInputSchema";
import { parseRows } from "@/v3/components/StructuredGrid";
import {
  readRaciMatrix,
  raciDeliveryRoles,
  rosterColumnKeys,
  missingRosterRoles,
} from "@/v3/lib/rosterRaci";

/**
 * A read-only consolidated view of the two artifacts that describe the programme
 * team: the Mobilise core-team roster (a person per role) and the RACI matrix
 * (accountability per activity). They are produced as phase inputs/artifacts and
 * edited in the Mobilise phase; this surface just reconciles and presents them in
 * one place, including which RACI delivery roles the roster has yet to staff.
 */

function programSource(program: ProgramSummary | null): Record<string, unknown> | null {
  const raw = program?.rawData as Record<string, unknown> | null | undefined;
  if (!raw) return null;
  return typeof raw.data === "object" && raw.data !== null
    ? raw.data as Record<string, unknown>
    : raw;
}

function joinPeople(value: string[] | undefined): string {
  return value && value.length ? value.join(", ") : "—";
}

export default function RosterRaciView({ program }: { program: ProgramSummary | null }) {
  const model = useMemo(() => {
    const source = programSource(program);
    const store = getDynamicSchemaStore(program?.rawData);
    const raci = readRaciMatrix(source);

    const rosterField = resolveRosterField(store);
    const columns = rosterField?.columns ?? [];
    const { roleKey, nameKey } = rosterColumnKeys(columns);
    const rosterInputs = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
      ? (source.phaseInputs as Record<string, unknown>)[ROSTER_PHASE_ID]
      : null;
    const rosterValue = rosterField && rosterInputs && typeof rosterInputs === "object" && !Array.isArray(rosterInputs)
      ? (rosterInputs as Record<string, unknown>)[rosterField.id]
      : null;
    const rows = rosterField ? parseRows(rosterValue, columns) : [];

    const staffedRows = roleKey
      ? rows.filter((row) => (row[roleKey] ?? "").trim() || (nameKey ? (row[nameKey] ?? "").trim() : false))
      : rows;
    const deliveryRoles = raciDeliveryRoles(raci);
    const unstaffedRoles = missingRosterRoles(rows, roleKey, deliveryRoles);

    return { raci, columns, roleKey, nameKey, rows: staffedRows, deliveryRoles, unstaffedRoles };
  }, [program]);

  const { raci, columns, roleKey, rows, deliveryRoles, unstaffedRoles } = model;
  const hasRoster = columns.length > 0 && rows.length > 0;
  const hasRaci = !!raci && raci.activities.length > 0;

  if (!hasRoster && !hasRaci) {
    return (
      <div className="v3-section">
        <AdamCard>
          <AdamCardHeader
            title="Team & RACI"
            subtitle="The core-team roster and RACI matrix, reconciled in one place."
          />
          <AdamCardBody>
            <EmptyState
              compact
              icon="◎"
              title="No team or RACI defined yet"
              description="Staff the core-team roster and generate the RACI matrix in the Mobilise phase — they will appear here together once they exist."
            />
          </AdamCardBody>
        </AdamCard>
      </div>
    );
  }

  return (
    <div className="v3-section" style={{ display: "grid", gap: 16 }}>
      {/* Coverage summary — RACI delivery roles the roster has not yet staffed. */}
      {hasRaci ? (
        <AdamCard accent={unstaffedRoles.length ? "warning" : "none"}>
          <AdamCardBody padded>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--v3-text-primary)" }}>RACI coverage</span>
              <span className="v3-chip muted" style={{ fontSize: 11 }}>{deliveryRoles.length} delivery role{deliveryRoles.length === 1 ? "" : "s"}</span>
              {unstaffedRoles.length ? (
                <span className="v3-chip amber" style={{ fontSize: 11 }}>{unstaffedRoles.length} unstaffed</span>
              ) : (
                <span className="v3-chip green" style={{ fontSize: 11 }}>Fully staffed</span>
              )}
            </div>
            {unstaffedRoles.length ? (
              <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 8 }}>
                These RACI roles have no named person in the roster: <strong>{unstaffedRoles.join(", ")}</strong>. Add them in the Mobilise core-team roster.
              </div>
            ) : null}
          </AdamCardBody>
        </AdamCard>
      ) : null}

      {/* Core-team roster */}
      <AdamCard>
        <AdamCardHeader
          title="Core team roster"
          subtitle="Named individuals per core-team role (from the Mobilise phase)."
          badge={hasRoster ? <span className="v3-chip muted" style={{ fontSize: 11 }}>{rows.length} member{rows.length === 1 ? "" : "s"}</span> : undefined}
        />
        <AdamCardBody>
          {hasRoster ? (
            <div style={{ overflowX: "auto" }}>
              <table className="v3-data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--v3-border)", color: "var(--v3-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {col.label ?? col.key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={(roleKey && row[roleKey]) || row.id || i}>
                      {columns.map((col) => (
                        <td key={col.key} style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-primary)" }}>
                          {(row[col.key] ?? "").trim() || <span style={{ color: "var(--v3-text-muted)" }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              icon="◎"
              title="Roster not staffed yet"
              description="Add named individuals to the core-team roster in the Mobilise phase."
            />
          )}
        </AdamCardBody>
      </AdamCard>

      {/* RACI matrix */}
      <AdamCard>
        <AdamCardHeader
          title="RACI matrix"
          subtitle="Responsible, Accountable, Consulted, Informed — per programme activity."
          badge={hasRaci ? <span className="v3-chip muted" style={{ fontSize: 11 }}>{raci!.activities.length} activit{raci!.activities.length === 1 ? "y" : "ies"}</span> : undefined}
        />
        <AdamCardBody>
          {hasRaci ? (
            <div style={{ overflowX: "auto" }}>
              <table className="v3-data-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Activity", "Responsible", "Accountable", "Consulted", "Informed"].map((head) => (
                      <th key={head} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--v3-border)", color: "var(--v3-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {raci!.activities.map((activity, i) => (
                    <tr key={activity.activity || i}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-primary)", fontWeight: 500 }}>{activity.activity || "—"}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-secondary)" }}>{joinPeople(activity.responsible)}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-primary)" }}>{activity.accountable || "—"}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-secondary)" }}>{joinPeople(activity.consulted)}</td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--v3-border-subtle)", color: "var(--v3-text-secondary)" }}>{joinPeople(activity.informed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {raci!.gaps.length ? (
                <div style={{ fontSize: 12, color: "var(--v3-text-secondary)", marginTop: 12 }}>
                  <strong>Noted gaps:</strong> {raci!.gaps.join("; ")}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              compact
              icon="⊞"
              title="No RACI matrix yet"
              description="Generate the RACI matrix in the Mobilise phase to define accountability per activity."
            />
          )}
        </AdamCardBody>
      </AdamCard>
    </div>
  );
}
