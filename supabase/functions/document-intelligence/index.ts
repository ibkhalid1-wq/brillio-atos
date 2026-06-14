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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

const EXTRACTION_SYSTEM_PROMPT = `You are an expert business analyst and programme management consultant. Analyse the provided document and extract ALL methodology-relevant information.

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
    "strategy": {
      "businessObjective": { "value": "string", "confidence": 0.9, "source": "string", "extractionType": "extracted" },
      "sponsor": { "value": "string", "confidence": 0.9, "source": "string", "extractionType": "extracted" },
      "constraints": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "successMetric": { "value": "string", "confidence": 0.85, "source": "string", "extractionType": "extracted" },
      "keyRoles": { "value": "string", "confidence": 0.85, "source": "string", "extractionType": "extracted" }
    },
    "mobilise": {
      "programDirector": { "value": "string", "confidence": 0.9, "source": "string", "extractionType": "extracted" },
      "teamSize": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "governanceModel": { "value": "string", "confidence": 0.75, "source": "string", "extractionType": "inferred" },
      "keyRisks": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "keyRoles": { "value": "string", "confidence": 0.85, "source": "string", "extractionType": "extracted" }
    },
    "build": {
      "blockers": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "sprintVelocity": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "testCoverage": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" },
      "keyRoles": { "value": "string", "confidence": 0.8, "source": "string", "extractionType": "extracted" }
    }
  },
  "gaps": "string — brief description of what information appears to be missing from this document"
}

RULES:
- extractionType values: "extracted" = verbatim or near-verbatim from document; "enriched" = you restructured/formatted raw text; "inferred" = logically derived from context
- confidence: 0.9+ for verbatim, 0.75-0.9 for paraphrased/enriched, 0.5-0.75 for inferred
- source: short quote (under 60 chars) from the document, or a section/page reference
- Only include methodologyMappings for phases where you found actual data
- Limit each entity array to a maximum of 5 items (the most important ones)
- Omit methodology mapping fields that have no data rather than returning empty strings
- Keep all string values concise — under 300 characters per field
- Never fabricate information that is not in the document
- Convert bullets, tables, and informal notes into structured values where appropriate (mark as "enriched")
- If you are running low on tokens, prioritise completing methodologyMappings over entities arrays`;

// ─── Type helpers ─────────────────────────────────────────────────────────────

interface ExtractionPayload {
  programId: string;
  text?: string;
  fileName: string;
  fileAttachment?: FileAttachment;
  phaseHint?: string;
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
          (payload.text || "").slice(0, 60000),
        ].filter(Boolean).join("\n");

    const startedAt = Date.now();

    const result = await completeClaudeText({
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: toClaudeMessages([{ role: "user", content: userMessage, timestamp: new Date().toISOString() }]),
      maxTokens: 8000,
      temperature: 0.1,
      fileAttachment: payload.fileAttachment,
    });

    const latencyMs = Date.now() - startedAt;

    // Parse JSON from the response
    let intelligence: Record<string, unknown> = {};
    let parseError: string | null = null;
    try {
      // Strip any accidental markdown fences
      const cleaned = result.text.replace(/^```[a-z]*\n?/m, "").replace(/\n?```$/m, "").trim();
      intelligence = JSON.parse(cleaned) as Record<string, unknown>;
    } catch (err) {
      parseError = `Failed to parse AI response as JSON: ${err instanceof Error ? err.message : String(err)}`;
      // Attempt to extract JSON substring as fallback
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          intelligence = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          parseError = null;
        } catch {
          // Give up — return partial error with raw text
        }
      }
    }

    // Store the extraction record
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let attachmentId: string | null = null;
    const { data: insertRow } = await admin
      .from("adam_document_attachments")
      .insert({
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
      })
      .select("id")
      .single();

    attachmentId = insertRow?.id ?? null;

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
