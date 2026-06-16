export interface ExitCriterion {
  id: string;
  phaseId: string;
  label: string;
  description: string;
  mandatory: boolean;
  evidencePrompt: string;
  category: "delivery" | "governance" | "quality" | "stakeholder" | "financial";
}

export const EXIT_CRITERIA_LIBRARY: ExitCriterion[] = [
  { id: "strategy-1", phaseId: "strategy", label: "Business case approved", description: "Programme business case has been reviewed and formally approved by the sponsor.", mandatory: true, evidencePrompt: "Link or reference to the approved business case document.", category: "governance" },
  { id: "strategy-2", phaseId: "strategy", label: "Objectives defined and measurable", description: "Programme objectives are SMART and linked to at least one KPI.", mandatory: true, evidencePrompt: "List the programme objectives with their linked KPIs.", category: "delivery" },
  { id: "strategy-3", phaseId: "strategy", label: "Sponsor confirmed and committed", description: "Executive sponsor has been named and has signed off on the programme charter.", mandatory: true, evidencePrompt: "Name and title of sponsor, date of sign-off.", category: "stakeholder" },
  { id: "mobilise-1", phaseId: "mobilise", label: "Programme team mobilised", description: "All key roles are filled and team members are available.", mandatory: true, evidencePrompt: "Team roster with roles and start dates.", category: "delivery" },
  { id: "mobilise-2", phaseId: "mobilise", label: "Governance structure established", description: "SteerCo, working groups, and escalation path are defined and agreed.", mandatory: true, evidencePrompt: "Governance chart or RACI.", category: "governance" },
  { id: "mobilise-3", phaseId: "mobilise", label: "Initial risk register created", description: "Top 10 programme risks have been identified and initial mitigations noted.", mandatory: true, evidencePrompt: "Risk register summary.", category: "quality" },
  { id: "mobilise-4", phaseId: "mobilise", label: "Budget baseline confirmed", description: "Programme budget has been allocated and baseline approved.", mandatory: true, evidencePrompt: "Budget approval reference.", category: "financial" },
  { id: "discover-1", phaseId: "discover", label: "As-is assessment complete", description: "Current state assessment has been completed across all in-scope capability areas.", mandatory: true, evidencePrompt: "Summary of as-is findings.", category: "delivery" },
  { id: "discover-2", phaseId: "discover", label: "Stakeholder interviews completed", description: "At least 80% of identified key stakeholders have been interviewed.", mandatory: true, evidencePrompt: "Interview completion log.", category: "stakeholder" },
  { id: "discover-3", phaseId: "discover", label: "Pain points and gaps documented", description: "Key pain points and capability gaps have been documented and prioritised.", mandatory: true, evidencePrompt: "Pain point and gap register.", category: "quality" },
  { id: "design-1", phaseId: "design", label: "Target operating model approved", description: "TOM has been reviewed and approved by SteerCo.", mandatory: true, evidencePrompt: "TOM approval record.", category: "governance" },
  { id: "design-2", phaseId: "design", label: "Solution architecture signed off", description: "High-level solution architecture is documented and technically reviewed.", mandatory: true, evidencePrompt: "Architecture sign-off reference.", category: "delivery" },
  { id: "design-3", phaseId: "design", label: "Change impact assessment complete", description: "Organisational change impact has been assessed for all affected groups.", mandatory: true, evidencePrompt: "Change impact report summary.", category: "stakeholder" },
  { id: "build-1", phaseId: "build", label: "User acceptance criteria defined", description: "UAT criteria have been agreed with business stakeholders.", mandatory: true, evidencePrompt: "UAT criteria document reference.", category: "quality" },
  { id: "build-2", phaseId: "build", label: "Testing completed to threshold", description: "System and integration testing passed at >= 95% success rate.", mandatory: true, evidencePrompt: "Test results summary.", category: "quality" },
  { id: "build-3", phaseId: "build", label: "Training material ready", description: "End-user training content is complete and reviewed.", mandatory: true, evidencePrompt: "Training completion status.", category: "delivery" },
  { id: "operate-1", phaseId: "operate", label: "Go-live plan approved", description: "Cutover and go-live plan has been reviewed and approved by SteerCo.", mandatory: true, evidencePrompt: "Go-live plan approval reference.", category: "governance" },
  { id: "operate-2", phaseId: "operate", label: "Support model in place", description: "Hypercare and steady-state support model is confirmed and resourced.", mandatory: true, evidencePrompt: "Support model document.", category: "delivery" },
  { id: "operate-3", phaseId: "operate", label: "KPIs being measured", description: "At least one KPI is actively being tracked against baseline.", mandatory: true, evidencePrompt: "KPI tracking report.", category: "financial" },

  // ─── Govern ──────────────────────────────────────────────────────────────────
  { id: "govern-1", phaseId: "govern", label: "Compliance framework validated", description: "All regulatory and internal compliance requirements have been reviewed and confirmed as met.", mandatory: true, evidencePrompt: "Compliance checklist or audit sign-off.", category: "governance" },
  { id: "govern-2", phaseId: "govern", label: "Control matrix approved", description: "Key operational controls are documented, tested, and approved by the programme sponsor.", mandatory: true, evidencePrompt: "Control matrix reference or governance sign-off.", category: "governance" },
  { id: "govern-3", phaseId: "govern", label: "Audit evidence plan in place", description: "A plan for ongoing audit evidence collection has been agreed with internal audit or compliance.", mandatory: true, evidencePrompt: "Audit evidence plan document.", category: "governance" },
  { id: "govern-4", phaseId: "govern", label: "Escalation policies tested", description: "Escalation routes and decision rights have been tested and confirmed operational.", mandatory: true, evidencePrompt: "Escalation test results or confirmation.", category: "delivery" },

  // ─── Optimize ────────────────────────────────────────────────────────────────
  { id: "optimize-1", phaseId: "optimize", label: "Baseline benefits confirmed", description: "Baseline measurement for at least one benefit has been established and agreed.", mandatory: true, evidencePrompt: "Benefit baseline measurement document.", category: "financial" },
  { id: "optimize-2", phaseId: "optimize", label: "Improvement backlog prioritised", description: "Post-go-live improvement opportunities have been logged and prioritised by business value.", mandatory: true, evidencePrompt: "Improvement backlog extract.", category: "delivery" },
  { id: "optimize-3", phaseId: "optimize", label: "Experiment recommendations reviewed", description: "At least one optimization experiment has been proposed, reviewed, and approved by SteerCo.", mandatory: true, evidencePrompt: "Experiment proposal approval record.", category: "quality" },
  { id: "optimize-4", phaseId: "optimize", label: "Adoption metrics on track", description: "User adoption is tracking to the adoption plan at ≥ 80% of target.", mandatory: true, evidencePrompt: "Adoption dashboard or tracking report.", category: "stakeholder" },

  // ─── Value Realise ───────────────────────────────────────────────────────────
  { id: "valuerealize-1", phaseId: "valuerealize", label: "Benefits realised and quantified", description: "At least one business benefit has been realised, measured, and signed off by the sponsor.", mandatory: true, evidencePrompt: "Benefits realisation sign-off and measurement.", category: "financial" },
  { id: "valuerealize-2", phaseId: "valuerealize", label: "Lessons learned captured", description: "Programme retrospective has been completed and lessons documented across all phases.", mandatory: true, evidencePrompt: "Lessons learned register.", category: "quality" },
  { id: "valuerealize-3", phaseId: "valuerealize", label: "Closure pack approved", description: "Programme closure pack (final narrative, lessons, benefits, recommendations) has been approved by SteerCo.", mandatory: true, evidencePrompt: "Closure pack approval reference.", category: "governance" },
  { id: "valuerealize-4", phaseId: "valuerealize", label: "Handover to BAU confirmed", description: "Programme outputs and ongoing responsibilities have been formally handed to the business-as-usual owner.", mandatory: true, evidencePrompt: "BAU handover confirmation document.", category: "delivery" },
];

export function getMandatoryCriteria(phaseId: string): ExitCriterion[] {
  return EXIT_CRITERIA_LIBRARY.filter((c) => c.phaseId === phaseId && c.mandatory);
}
