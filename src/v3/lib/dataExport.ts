export interface ExportManifest {
  exportedAt: string;
  version: string;
  programId: string;
  programName: string;
  data: Record<string, unknown>;
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportProgramAsJSON(program: { id?: string; name?: string; data?: Record<string, unknown> } & Record<string, unknown>): void {
  const manifest: ExportManifest = {
    exportedAt: new Date().toISOString(),
    version: "v3",
    programId: (program.id as string) ?? "unknown",
    programName: (program.name as string) ?? "Programme",
    data: (program.data ?? program) as Record<string, unknown>,
  };
  const filename = `adam-${((program.name as string) ?? "programme").replace(/\s+/g, "-").toLowerCase()}-export.json`;
  triggerDownload(JSON.stringify(manifest, null, 2), filename, "application/json");
}

export function exportMilestonesAsCSV(
  milestones: Array<{ name: string; dueDate: string; status: string; owner?: string; phase?: string }>
): void {
  const rows = [["Name", "Due Date", "Status", "Owner", "Phase"]];
  for (const m of milestones) rows.push([m.name, m.dueDate, m.status, m.owner ?? "", m.phase ?? ""]);
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  triggerDownload(csv, "milestones-export.csv", "text/csv");
}

export function exportRisksAsCSV(
  risks: Array<{ title: string; severity: string; status: string; owner?: string; phase?: string; mitigation?: string }>
): void {
  const rows = [["Title", "Severity", "Status", "Owner", "Phase", "Mitigation"]];
  for (const r of risks) rows.push([r.title, r.severity, r.status, r.owner ?? "", r.phase ?? "", r.mitigation ?? ""]);
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  triggerDownload(csv, "risks-export.csv", "text/csv");
}
