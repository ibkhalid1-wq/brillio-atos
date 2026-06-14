/**
 * Shared types for the Universal Document Intelligence pipeline.
 * Used by useDocumentIntelligence, DocumentReviewPanel, and the document-intelligence edge function.
 */

export type ExtractionType = "extracted" | "enriched" | "inferred";

export type DocumentType =
  | "business-case"
  | "requirements"
  | "project-plan"
  | "meeting-notes"
  | "statement-of-work"
  | "rfp"
  | "architecture"
  | "process"
  | "discovery"
  | "workshop"
  | "technical-spec"
  | "risk-register"
  | "stakeholder-plan"
  | "roadmap"
  | "other";

export interface ExtractedEntity {
  text: string;
  source: string;
  confidence: number;
  extractionType: ExtractionType;
}

export interface RiskEntity extends ExtractedEntity {
  category: string;
}

export interface StakeholderEntity extends ExtractedEntity {
  name: string;
  role: string;
  organization: string;
}

export interface MilestoneEntity extends ExtractedEntity {
  title: string;
  targetDate: string | null;
  description: string;
}

export interface BudgetEntity extends ExtractedEntity {
  amount: string;
  currency: string;
  description: string;
}

export interface RequirementEntity extends ExtractedEntity {
  priority: "high" | "medium" | "low";
}

export interface DecisionEntity extends ExtractedEntity {
  title: string;
  rationale: string;
}

export interface ActionEntity extends ExtractedEntity {
  title: string;
  owner: string;
  dueDate: string | null;
}

export interface TechnologyEntity extends ExtractedEntity {
  name: string;
  role: string;
}

export interface IntegrationEntity extends ExtractedEntity {
  system: string;
  direction: "inbound" | "outbound" | "bidirectional";
  description: string;
}

export interface GapEntity extends ExtractedEntity {
  description: string;
  impact: string;
}

export interface RecommendationEntity extends ExtractedEntity {
  priority: "high" | "medium" | "low";
}

export interface ExtractedEntities {
  objectives: ExtractedEntity[];
  outcomes: ExtractedEntity[];
  successMetrics: ExtractedEntity[];
  constraints: ExtractedEntity[];
  assumptions: ExtractedEntity[];
  risks: RiskEntity[];
  stakeholders: StakeholderEntity[];
  milestones: MilestoneEntity[];
  budget: BudgetEntity[];
  requirements: RequirementEntity[];
  decisions: DecisionEntity[];
  actions: ActionEntity[];
  technologies: TechnologyEntity[];
  integrations: IntegrationEntity[];
  gaps: GapEntity[];
  recommendations: RecommendationEntity[];
}

/** A single methodology field mapping with traceability */
export interface FieldMapping {
  value: string;
  confidence: number;
  source: string;
  extractionType: ExtractionType;
  /** Whether the user has approved/rejected/edited this mapping */
  reviewState?: "pending" | "approved" | "rejected" | "edited";
  /** Value after user edit (if edited) */
  editedValue?: string;
}

/** Methodology mappings: phaseId → fieldId → FieldMapping */
export type MethodologyMappings = Record<string, Record<string, FieldMapping>>;

/** Full intelligence result from the AI extraction */
export interface DocumentIntelligence {
  documentType: DocumentType;
  summary: string;
  primaryPhase: string;
  relevantPhases: string[];
  overallConfidence: number;
  entities: ExtractedEntities;
  methodologyMappings: MethodologyMappings;
  gaps: string;
}

/** Review state for a single field — used in the review UI */
export interface ReviewField {
  phaseId: string;
  fieldId: string;
  fieldLabel: string;
  mapping: FieldMapping;
  /** Existing value in the programme (for conflict detection) */
  existingValue?: string;
  hasConflict: boolean;
}

/** The approved/edited set of inputs to persist, grouped by phase */
export type ApprovedInputs = Record<string, Record<string, string>>;

export type DocumentImportStage =
  | "idle"
  | "parsing"
  | "extracting"
  | "reviewing"
  | "saving"
  | "done"
  | "error";

export interface DocumentImportResult {
  attachmentId: string;
  intelligence: DocumentIntelligence;
  approvedInputs: ApprovedInputs;
}

/** Labels for document types */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  "business-case": "Business Case",
  "requirements": "Requirements",
  "project-plan": "Project Plan",
  "meeting-notes": "Meeting Notes",
  "statement-of-work": "Statement of Work",
  "rfp": "RFP",
  "architecture": "Architecture Document",
  "process": "Process Document",
  "discovery": "Discovery Output",
  "workshop": "Workshop Output",
  "technical-spec": "Technical Specification",
  "risk-register": "Risk Register",
  "stakeholder-plan": "Stakeholder Plan",
  "roadmap": "Roadmap",
  "other": "Document",
};

/** Confidence level label and colour */
export function confidenceLabel(score: number): { label: string; color: string } {
  if (score >= 0.85) return { label: "High", color: "#22c55e" };
  if (score >= 0.65) return { label: "Medium", color: "#f59e0b" };
  return { label: "Low", color: "#ef4444" };
}

/** Human-readable extraction type */
export const EXTRACTION_TYPE_LABELS: Record<ExtractionType, string> = {
  extracted: "Extracted",
  enriched: "Enriched",
  inferred: "Inferred",
};

export const EXTRACTION_TYPE_COLORS: Record<ExtractionType, string> = {
  extracted: "#3b82f6",
  enriched: "#8b5cf6",
  inferred: "#f59e0b",
};
