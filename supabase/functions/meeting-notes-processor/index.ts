/**
 * meeting-notes-processor — AI-powered meeting transcript extraction engine.
 *
 * Accepts a meeting transcript and extracts:
 *   - Decisions made
 *   - Action items (with owners and due dates)
 *   - Blockers / impediments
 *   - Key discussion points
 *
 * Also accepts an "approve" action to merge selected items into the
 * programme's decision queue and RAID log.
 *
 * Called by MeetingNotesPanel via supabase.functions.invoke().
 * Uses the admin Supabase client for all DB operations (bypasses RLS).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  completeClaudeText,
  toClaudeMessages,
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

const EXTRACTION_SYSTEM_PROMPT = `You are an expert programme management consultant specialising in extracting structured information from meeting transcripts, notes, and minutes.

Analyse the provided meeting content and extract ALL actionable and decision-relevant information.

Return ONLY valid JSON in the exact structure below. Do not include markdown fences or any text outside the JSON object.

{
  "decisions": [
    {
      "title": "string — concise title of the decision made",
      "detail": "string — additional context or rationale, max 300 chars",
      "owner": "string or null — person/role responsible for the decision",
      "source": "string — brief quote or reference from the transcript, max 80 chars"
    }
  ],
  "actionItems": [
    {
      "title": "string — clear, actionable task description",
      "owner": "string or null — person assigned",
      "dueDate": "YYYY-MM-DD or null — if a date was mentioned",
      "priority": "high|medium|low",
      "source": "string — brief quote or reference, max 80 chars"
    }
  ],
  "blockers": [
    {
      "title": "string — concise blocker description",
      "impact": "string — what this blocks or delays, max 200 chars",
      "owner": "string or null — person responsible for resolving",
      "source": "string — brief quote or reference, max 80 chars"
    }
  ],
  "keyDiscussions": [
    {
      "topic": "string — topic or theme discussed",
      "summary": "string — 1-3 sentence summary of discussion, max 400 chars",
      "outcome": "string or null — conclusion reached if any"
    }
  ]
}

RULES:
- Extract ALL decisions, action items, and blockers — do not omit items for brevity
- Limit keyDiscussions to the 6 most significant topics
- source: short verbatim quote (under 80 chars) from the transcript
- If owner cannot be determined, use null
- dueDate: only set if a specific date or deadline was explicitly mentioned
- Never fabricate information not present in the transcript
- If the transcript is unclear or ambiguous, lean toward inclusion rather than exclusion
- Normalise action item titles to start with a verb (e.g. "Schedule", "Review", "Confirm")`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Decision {
  title: string;
  detail: string;
  owner: string | null;
  source: string;
}

interface ActionItem {
  title: string;
  owner: string | null;
  dueDate: string | null;
  priority: "high" | "medium" | "low";
  source: string;
}

interface Blocker {
  title: string;
  impact: string;
  owner: string | null;
  source: string;
}

interface KeyDiscussion {
  topic: string;
  summary: string;
  outcome: string | null;
}

interface ExtractedMeetingNotes {
  decisions: Decision[];
  actionItems: ActionItem[];
  blockers: Blocker[];
  keyDiscussions: KeyDiscussion[];
}

interface ExtractPayload {
  programId: string;
  transcriptText: string;
  phaseId?: string;
}

interface ApprovePayload {
  action: "approve";
  programId: string;
  meetingNoteId: string;
  approved: {
    decisions: Decision[];
    actionItems: ActionItem[];
    blockers: Blocker[];
  };
}

type RequestPayload = ExtractPayload | ApprovePayload;

// ─── Admin Supabase client ────────────────────────────────────────────────────

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Extract handler ──────────────────────────────────────────────────────────

async function handleExtract(payload: ExtractPayload): Promise<Response> {
  const { programId, transcriptText, phaseId } = payload;

  if (!transcriptText?.trim()) {
    return jsonResponse({ ok: false, error: "transcriptText is required and must not be empty." }, 400);
  }

  const userMessage = [
    phaseId ? `Programme phase context: ${phaseId}` : "",
    "",
    "MEETING TRANSCRIPT / NOTES:",
    transcriptText.slice(0, 60000),
  ].filter(Boolean).join("\n");

  const startedAt = Date.now();

  const result = await completeClaudeText({
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: toClaudeMessages([
      { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    ]),
    maxTokens: 6000,
    temperature: 0.1,
    jsonResponse: true,
  });

  const latencyMs = Date.now() - startedAt;

  // Parse JSON from the AI response
  let extracted: ExtractedMeetingNotes = {
    decisions: [],
    actionItems: [],
    blockers: [],
    keyDiscussions: [],
  };
  let parseError: string | null = null;

  try {
    const cleaned = result.text
      .replace(/^```[a-z]*\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    extracted = JSON.parse(cleaned) as ExtractedMeetingNotes;
  } catch (err) {
    parseError = `Failed to parse AI response as JSON: ${err instanceof Error ? err.message : String(err)}`;
    // Attempt to extract JSON substring as fallback
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        extracted = JSON.parse(jsonMatch[0]) as ExtractedMeetingNotes;
        parseError = null;
      } catch {
        // Give up — return partial error
      }
    }
  }

  // Ensure arrays are always present
  extracted.decisions = extracted.decisions ?? [];
  extracted.actionItems = extracted.actionItems ?? [];
  extracted.blockers = extracted.blockers ?? [];
  extracted.keyDiscussions = extracted.keyDiscussions ?? [];

  // Store the meeting note record in the DB
  const admin = getAdminClient();
  let meetingNoteId: string | null = null;

  try {
    const { data: insertRow } = await admin
      .from("adam_meeting_notes")
      .insert({
        program_id: programId,
        phase_id: phaseId ?? null,
        raw_transcript: transcriptText.slice(0, 50000),
        extracted_data: extracted,
        extraction_status: parseError ? "error" : "extracted",
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        latency_ms: latencyMs,
      })
      .select("id")
      .single();

    meetingNoteId = insertRow?.id ?? null;
  } catch {
    // DB insert failure is non-fatal — still return extraction result
  }

  return jsonResponse({
    ok: !parseError,
    decisions: extracted.decisions,
    actionItems: extracted.actionItems,
    blockers: extracted.blockers,
    keyDiscussions: extracted.keyDiscussions,
    meetingNoteId,
    parseError,
    latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });
}

// ─── Approve handler ──────────────────────────────────────────────────────────

async function handleApprove(payload: ApprovePayload): Promise<Response> {
  const { programId, meetingNoteId, approved } = payload;

  if (!meetingNoteId) {
    return jsonResponse({ ok: false, error: "meetingNoteId is required for approve action." }, 400);
  }

  const admin = getAdminClient();
  const errors: string[] = [];

  // 1. Merge decisions into decision queue (adam_decisions or similar table)
  if (approved.decisions?.length) {
    for (const decision of approved.decisions) {
      try {
        await admin.from("adam_decisions").insert({
          program_id: programId,
          meeting_note_id: meetingNoteId,
          title: decision.title,
          detail: decision.detail ?? null,
          owner: decision.owner ?? null,
          source: decision.source ?? null,
          status: "open",
        });
      } catch (err) {
        errors.push(`Decision insert error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 2. Merge action items into RAID log (adam_raid_log with type "action")
  if (approved.actionItems?.length) {
    for (const item of approved.actionItems) {
      try {
        await admin.from("adam_raid_log").insert({
          program_id: programId,
          meeting_note_id: meetingNoteId,
          type: "action",
          title: item.title,
          owner: item.owner ?? null,
          due_date: item.dueDate ?? null,
          priority: item.priority ?? "medium",
          source_quote: item.source ?? null,
          status: "open",
        });
      } catch (err) {
        errors.push(`Action item insert error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. Merge blockers into RAID log (adam_raid_log with type "issue")
  if (approved.blockers?.length) {
    for (const blocker of approved.blockers) {
      try {
        await admin.from("adam_raid_log").insert({
          program_id: programId,
          meeting_note_id: meetingNoteId,
          type: "issue",
          title: blocker.title,
          detail: blocker.impact ?? null,
          owner: blocker.owner ?? null,
          source_quote: blocker.source ?? null,
          status: "open",
        });
      } catch (err) {
        errors.push(`Blocker insert error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 4. Mark the meeting note as approved
  try {
    await admin
      .from("adam_meeting_notes")
      .update({
        extraction_status: "approved",
        approved_decisions: approved.decisions ?? [],
        approved_action_items: approved.actionItems ?? [],
        approved_blockers: approved.blockers ?? [],
        approved_at: new Date().toISOString(),
      })
      .eq("id", meetingNoteId);
  } catch (err) {
    errors.push(`Meeting note status update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return jsonResponse({
    ok: errors.length === 0,
    meetingNoteId,
    savedDecisions: approved.decisions?.length ?? 0,
    savedActionItems: approved.actionItems?.length ?? 0,
    savedBlockers: approved.blockers?.length ?? 0,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const payload = await req.json() as RequestPayload;

    if (!payload.programId) {
      return jsonResponse({ ok: false, error: "programId is required." }, 400);
    }

    // Route based on action field
    if ("action" in payload && payload.action === "approve") {
      return await handleApprove(payload as ApprovePayload);
    }

    return await handleExtract(payload as ExtractPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const isAIConfig =
      msg.includes("AI provider key is not configured") ||
      msg.includes("not configured");
    return jsonResponse(
      {
        ok: false,
        error: isAIConfig
          ? "AI provider not configured. Please connect an AI provider in Settings."
          : msg,
        isAIUnavailable: isAIConfig,
      },
      isAIConfig ? 503 : 500,
    );
  }
});
