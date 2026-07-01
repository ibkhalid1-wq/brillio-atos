/**
 * document-intelligence — Universal AI-powered document extraction engine.
 *
 * Accepts any document (pre-extracted text OR native base64 file for AI-native types)
 * and returns a fully structured IntelligenceResult: entities, methodology mappings,
 * confidence scores, source references, and extraction type tags.
 *
 * Called by the client-side useDocumentIntelligence hook.
 * Uses the admin Supabase client for all DB operations (bypasses RLS).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  completeClaudeText,
  toClaudeMessages,
  type FileAttachment,
} from "../_shared/claudeClient.ts";
import { parseLenientJson } from "../_shared/jsonRepair.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Upper bound on document text sent to the extractor in one shot. Capped to stay
// within the model context window; large enough that typical documents pass whole.
const MAX_EXTRACTION_CHARS = 400_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ─── Extraction prompt ────────────────────────────────────────────────────────

// ─── Declared-input schema (passed by the client) ─────────────────────────────
// The client resolves each activated phase's input fields from the methodology +
// dynamic-schema registry (the single source of truth) and forwards a compact
// view here so the extractor maps document data onto the SAME fields the UI will
// surface for review — including ai-derived dynamic fields (e.g. Mobilise's team
// roster grid) the static prompt never knew about.
interface PhaseFieldSchema {
  key?: string;
  id?: string;
  label?: string;
  type?: string;
  hint?: string;
  options?: string[];
  columns?: Array<{ key?: string; label?: string }>;
}
interface PhaseSchema {
  phaseId: string;
  title?: string;
  fields: PhaseFieldSchema[];
}

// Strategy's static input fields — the fallback declaration used when the client
// sends no schema (older callers), preserving the prior behaviour exactly.
const STRATEGY_FALLBACK_SCHEMA: PhaseSchema = {
  phaseId: "strategy",
  fields: [
    { id: "businessObjective", label: "Business objective", type: "textarea" },
    { id: "sponsor", label: "Executive sponsor", type: "text" },
    { id: "industry", label: "Industry", type: "select" },
    { id: "startDate", label: "Start date", type: "date" },
    { id: "targetEndDate", label: "Target end date", type: "date" },
    { id: "costAssumption", label: "Cost assumption", type: "grid", columns: [{ key: "category", label: "Cost line" }, { key: "amount", label: "Estimate" }, { key: "basis", label: "Basis / assumption" }] },
    { id: "constraints", label: "Constraints", type: "textarea" },
    { id: "successMetric", label: "Success metric", type: "textarea" },
  ],
};

function fieldId(field: PhaseFieldSchema): string {
  return (field.id || field.key || "").trim();
}

/** One human-readable line describing a declared field for the prompt's guide. */
function describeField(field: PhaseFieldSchema): string {
  const id = fieldId(field);
  const type = field.type || "text";
  const label = field.label || id;
  if (type === "grid") {
    const cols = (field.columns || []).map((c) => (c.key || "").trim()).filter(Boolean);
    const colHint = cols.length ? ` — value must be a JSON-array STRING of row objects using these keys: ${cols.join(", ")}` : "";
    return `  - ${id} (grid): ${label}${colHint}`;
  }
  const opts = type === "select" && field.options?.length ? ` (one of: ${field.options.slice(0, 24).join(" | ")})` : "";
  const hint = field.hint ? ` — ${field.hint}` : "";
  // Textarea fields are long-form narrative slots (e.g. a functional design
  // summary): they must hold a thorough, multi-sentence summary that actually
  // covers the material, not a single compressed line. Flag them so the model
  // does not squeeze them to fit the short-field character budget below.
  const longForm = type === "textarea"
    ? " — LONG-FORM: write a complete, substantive summary (several sentences or short paragraphs, up to ~1500 chars) that captures the document's structure and specifics for this field; do NOT compress to one sentence"
    : "";
  return `  - ${id} (${type})${opts}: ${label}${hint}${longForm}`;
}

/**
 * Builds the extraction system prompt. The entities/kpis structure is fixed; the
 * methodologyMappings target set is driven entirely by the declared phase schema
 * the client supplies, so the extractor can populate any activated phase's
 * fields — static or ai-derived — rather than a hard-coded Strategy-only set.
 */
function buildExtractionSystemPrompt(schemas: PhaseSchema[]): string {
  const active = schemas.length ? schemas : [STRATEGY_FALLBACK_SCHEMA];

  const mappingSkeleton = active
    .map((phase) => {
      const fieldLines = phase.fields
        .filter((f) => fieldId(f))
        .map((f) => `      "${fieldId(f)}": { "value": "string", "confidence": 0.9, "source": "string", "extractionType": "extracted" }`)
        .join(",\n");
      return `    "${phase.phaseId}": {\n${fieldLines}\n    }`;
    })
    .join(",\n");

  const fieldGuide = active
    .map((phase) => {
      const lines = phase.fields.filter((f) => fieldId(f)).map(describeField).join("\n");
      return `${phase.phaseId}${phase.title ? ` (${phase.title})` : ""}:\n${lines}`;
    })
    .join("\n");

  return `You are an expert business analyst and programme management consultant. Analyse the provided document and extract ALL methodology-relevant information.

Return ONLY valid JSON in the exact structure below. Do not include markdown fences or any text outside the JSON object.

{
  "documentType": "string — one of: business-case | requirements | project-plan | meeting-notes | statement-of-work | rfp | architecture | process | discovery | workshop | technical-spec | risk-register | stakeholder-plan | roadmap | other",
  "summary": "string — concise 2-3 sentence executive summary of the document",
  "primaryPhase": "string — most relevant phase: strategy | mobilise | discover | design | architecture | build | operate | govern | optimize | value",
  "relevantPhases": ["array of phase ids this document is relevant to"],
  "overallConfidence": 0.85,
  "entities": {
    "objectives": [
      { "text": "string", "source": "brief quote or section ref", "confidence": 0.9, "extractionType": "extracted" }
    ],
    "outcomes": [
      { "text": "string", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "successMetrics": [
      { "text": "string", "source": "string", "confidence": 0.85, "extractionType": "extracted" }
    ],
    "constraints": [
      { "text": "string", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "assumptions": [
      { "text": "string", "source": "string", "confidence": 0.75, "extractionType": "extracted" }
    ],
    "risks": [
      { "text": "string", "category": "schedule|budget|resource|technical|regulatory|strategic", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "stakeholders": [
      { "name": "string", "role": "string", "organization": "string", "source": "string", "confidence": 0.9, "extractionType": "extracted" }
    ],
    "milestones": [
      { "title": "string", "targetDate": "YYYY-MM-DD or null", "description": "string", "source": "string", "confidence": 0.85, "extractionType": "extracted" }
    ],
    "budget": [
      { "amount": "string", "currency": "string", "description": "string", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "requirements": [
      { "text": "string", "priority": "high|medium|low", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "decisions": [
      { "title": "string", "rationale": "string", "source": "string", "confidence": 0.85, "extractionType": "extracted" }
    ],
    "actions": [
      { "title": "string", "owner": "string", "dueDate": "YYYY-MM-DD or null", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "technologies": [
      { "name": "string", "role": "string", "source": "string", "confidence": 0.85, "extractionType": "extracted" }
    ],
    "integrations": [
      { "system": "string", "direction": "inbound|outbound|bidirectional", "description": "string", "source": "string", "confidence": 0.8, "extractionType": "extracted" }
    ],
    "gaps": [
      { "description": "string", "impact": "string", "source": "string", "confidence": 0.75, "extractionType": "inferred" }
    ],
    "recommendations": [
      { "text": "string", "priority": "high|medium|low", "source": "string", "confidence": 0.75, "extractionType": "enriched" }
    ]
  },
  "methodologyMappings": {
${mappingSkeleton}
  },
  "kpis": [
    { "name": "string — the metric/KPI name", "baseline": "string — current value, or empty", "target": "string — target value, or empty", "unit": "string — unit of measure, or empty", "source": "brief quote or section ref", "confidence": 0.85, "extractionType": "extracted" }
  ],
  "gaps": "string — brief description of what information appears to be missing from this document"
}

DECLARED PHASE INPUT FIELDS — map document data ONLY to these fields, each under its phase id in methodologyMappings:
${fieldGuide}

RULES:
- kpis: populate whenever the document names ANY performance metric, KPI, OKR, or measurable outcome — even when a baseline, target, or unit is absent. A metric qualifies on its name alone; leave baseline/target/unit as empty strings when the document does not state them. If the document is primarily a metrics/KPI table or list, you MUST emit one kpis entry per metric row. Route anything metric-like to kpis (NOT entities.successMetrics) and never duplicate the same metric across both. Only omit the kpis array when the document names no metrics whatsoever. The 5-item entity cap below does NOT apply to kpis — capture every distinct metric the document lists.
- extractionType values: "extracted" = verbatim or near-verbatim from document; "enriched" = you restructured/formatted raw text; "inferred" = logically derived from context
- confidence: 0.9+ for verbatim, 0.75-0.9 for paraphrased/enriched, 0.5-0.75 for inferred
- source: short quote (under 60 chars) from the document, or a section/page reference
- methodologyMappings: map document data ONLY to the declared phase input fields listed above, each under its own phase id. Do NOT invent fields that are not in that list — capture any other material in the entities arrays instead.
- grid fields: the "value" MUST be a JSON-array STRING (e.g. "[{\\"role\\":\\"Delivery Lead\\",\\"name\\":\\"Jane Doe\\"}]") whose objects use exactly the column keys named for that field. Include one object per row found in the document; omit the field entirely when the document has no such data.
- Only include methodologyMappings for phases/fields where you found actual data
- stakeholders: capture EVERY distinct person/role the document names — one entry per role, across ALL sheets/tabs/sections of the document (e.g. a project team roster, advisory/SME list, and steering committee are separate tables that must ALL be extracted). A role with no named person is still a stakeholder: emit it with an empty name. The 5-item entity cap below does NOT apply to stakeholders — never truncate the roster.
- Limit each entity array (except kpis and stakeholders) to a maximum of 5 items (the most important ones)
- Omit methodology mapping fields that have no data rather than returning empty strings
- Keep short text/select/date field values concise — under 300 characters (grid JSON strings and LONG-FORM textarea fields excepted). For a LONG-FORM textarea field, write a full, substantive summary that covers the relevant content — several sentences or short paragraphs — rather than a single compressed line; a terse one-liner for such a field is an extraction failure
- Never fabricate information that is not in the document
- Convert bullets, tables, and informal notes into structured values where appropriate (mark as "enriched")
- If you are running low on tokens, prioritise completing methodologyMappings over entities arrays`;
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

interface ExtractionPayload {
  programId: string;
  text?: string;
  fileName: string;
  fileAttachment?: FileAttachment;
  phaseHint?: string;
  /** Declared input fields of the programme's activated phases (registry-sourced). */
  phaseSchemas?: PhaseSchema[];
  /**
   * Id of an existing attachment being re-extracted. When set, the run UPDATES
   * that row's extraction in place instead of inserting a new one — otherwise a
   * re-extract would leave a duplicate document in the list.
   */
  reextractId?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const payload = await req.json() as ExtractionPayload;

    if (!payload.programId) {
      return jsonResponse({ error: "programId is required." }, 400);
    }

    // Build the user message
    const userMessage = payload.fileAttachment
      ? [
          `Document filename: ${payload.fileName}`,
          payload.phaseHint ? `Programme phase hint: ${payload.phaseHint}` : "",
          "",
          "The document content is attached. Extract all methodology-relevant information as specified.",
        ].filter(Boolean).join("\n")
      : [
          `Document filename: ${payload.fileName}`,
          payload.phaseHint ? `Programme phase hint: ${payload.phaseHint}` : "",
          "",
          "DOCUMENT CONTENT:",
          // ~400k chars ≈ 100k tokens — comfortably within the model context
          // (alongside the system prompt + 8k output) so whole documents, not
          // just their opening pages, reach the extractor.
          (payload.text || "").slice(0, MAX_EXTRACTION_CHARS),
        ].filter(Boolean).join("\n");

    const startedAt = Date.now();

    const schemas = Array.isArray(payload.phaseSchemas)
      ? payload.phaseSchemas.filter((s) => s && typeof s.phaseId === "string" && Array.isArray(s.fields))
      : [];

    const result = await completeClaudeText({
      system: buildExtractionSystemPrompt(schemas),
      messages: toClaudeMessages([{ role: "user", content: userMessage, timestamp: new Date().toISOString() }]),
      maxTokens: 8000,
      temperature: 0.1,
      fileAttachment: payload.fileAttachment,
      jsonResponse: true,
    });

    const latencyMs = Date.now() - startedAt;

    // Parse JSON from the response. LLM output is frequently fence-wrapped,
    // truncated at the max-token ceiling, or carries raw control characters in
    // string values; parseLenientJson strips/repairs those so a salvageable
    // extraction isn't thrown away over a formatting glitch.
    let intelligence: Record<string, unknown> = {};
    let parseError: string | null = null;
    try {
      const parsed = parseLenientJson<Record<string, unknown>>(result.text);
      intelligence = parsed.value;
      if (parsed.repaired) {
        console.warn(
          `document-intelligence: AI JSON required repair (strategy=${parsed.strategy}) — output was likely truncated or malformed. Extraction salvaged.`,
        );
      }
    } catch (err) {
      parseError = `Failed to parse AI response as JSON: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Store the extraction record
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let attachmentId: string | null = null;
    const record = {
      program_id: payload.programId,
      file_name: payload.fileName,
      file_type: (payload.fileName.split(".").pop() ?? "unknown").toLowerCase(),
      file_size_bytes: (payload.text?.length ?? 0) * 2,
      raw_text: payload.text ? payload.text.slice(0, 50000) : null,
      phase_context: (intelligence.primaryPhase as string) ?? payload.phaseHint ?? "strategy",
      extraction_status: parseError ? "error" : "extracted",
      extracted_data: intelligence,
      confidence: typeof intelligence.overallConfidence === "number"
        ? Math.max(0, Math.min(1, intelligence.overallConfidence))
        : 0.75,
    };

    if (payload.reextractId) {
      // Re-extract: overwrite the existing attachment in place (scoped by
      // program) so the document isn't duplicated in the list.
      const { data: updatedRow } = await admin
        .from("adam_document_attachments")
        .update(record)
        .eq("id", payload.reextractId)
        .eq("program_id", payload.programId)
        .select("id")
        .single();
      attachmentId = updatedRow?.id ?? null;
    }
    // Fresh import (or re-extract whose target row vanished) → insert a new row.
    if (!attachmentId) {
      const { data: insertRow } = await admin
        .from("adam_document_attachments")
        .insert(record)
        .select("id")
        .single();
      attachmentId = insertRow?.id ?? null;
    }

    return jsonResponse({
      ok: !parseError,
      attachmentId,
      intelligence,
      parseError,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isAIConfig = msg.includes("AI provider key is not configured") || msg.includes("not configured");
    return jsonResponse({
      ok: false,
      error: isAIConfig
        ? "AI provider not configured. Please connect an AI provider in Settings."
        : msg,
      isAIUnavailable: isAIConfig,
    }, isAIConfig ? 503 : 500);
  }
});
