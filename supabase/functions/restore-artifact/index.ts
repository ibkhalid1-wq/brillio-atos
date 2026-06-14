import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { admin, ownerId: null, isService: true };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return { admin, ownerId: data.user.id, isService: false };
}

function getInnerProgramData(programData: Record<string, unknown>) {
  return isRecord(programData.data) ? programData.data as Record<string, unknown> : programData;
}

function wrapProgramData(programData: Record<string, unknown>, nextInner: Record<string, unknown>) {
  return isRecord(programData.data)
    ? { ...programData, data: nextInner }
    : nextInner;
}

function restoreAgentContent(
  programData: Record<string, unknown>,
  agentId: string,
  phaseId: string | null,
  content: Record<string, unknown>,
  generatedAt: string,
) {
  const inner = getInnerProgramData(programData);
  const nextInner = { ...inner };

  switch (agentId) {
    case "narrative":
      nextInner.narrative = typeof content.narrative === "string" ? content.narrative : nextInner.narrative;
      nextInner.narrativeGeneratedAt = generatedAt;
      nextInner.narrativeConfidence = typeof content.confidence === "number" ? content.confidence : nextInner.narrativeConfidence;
      break;
    case "plan":
      nextInner.plan = isRecord(content.plan) ? content.plan : content;
      nextInner.planGeneratedAt = typeof content.planGeneratedAt === "string" ? content.planGeneratedAt : generatedAt;
      nextInner.planConfidence = typeof content.confidence === "number" ? content.confidence : nextInner.planConfidence;
      break;
    case "risk":
      nextInner.raidLog = {
        ...(isRecord(nextInner.raidLog) ? nextInner.raidLog : {}),
        entries: Array.isArray(content.raidEntries) ? content.raidEntries : [],
        generatedAt: typeof content.generatedAt === "string" ? content.generatedAt : generatedAt,
        riskSummary: typeof content.summary === "string" ? content.summary : null,
        confidence: typeof content.confidence === "number" ? content.confidence : null,
      };
      break;
    case "milestone":
      nextInner.milestones = Array.isArray(content.milestones) ? content.milestones : [];
      nextInner.milestonesGeneratedAt = generatedAt;
      break;
    case "budget":
      nextInner.budgetTracking = content;
      nextInner.budgetGeneratedAt = generatedAt;
      break;
    case "critical-path":
      nextInner.criticalPath = content;
      nextInner.criticalPathGeneratedAt = generatedAt;
      break;
    case "change-impact":
      nextInner.changeImpact = content;
      nextInner.changeImpactGeneratedAt = generatedAt;
      break;
    case "stakeholder":
      nextInner.stakeholders = Array.isArray(content.stakeholders) ? content.stakeholders : [];
      nextInner.stakeholderGeneratedAt = generatedAt;
      break;
    case "adoption":
      nextInner.adoption = content;
      nextInner.adoptionGeneratedAt = generatedAt;
      break;
    case "health-heatmap":
      nextInner.healthHeatmap = content;
      nextInner.healthHeatmapGeneratedAt = generatedAt;
      break;
    case "retro":
      nextInner.retros = {
        ...(isRecord(nextInner.retros) ? nextInner.retros : {}),
        [phaseId || "program"]: content,
      };
      nextInner.retrosGeneratedAt = {
        ...(isRecord(nextInner.retrosGeneratedAt) ? nextInner.retrosGeneratedAt : {}),
        [phaseId || "program"]: generatedAt,
      };
      break;
    case "deck":
      nextInner.deck = content;
      nextInner.deckGeneratedAt = generatedAt;
      break;
    case "scope-pcr":
      nextInner.scopePcr = content;
      nextInner.scopePcrGeneratedAt = generatedAt;
      break;
    case "gate-review":
      nextInner.gateReviews = {
        ...(isRecord(nextInner.gateReviews) ? nextInner.gateReviews : {}),
        [phaseId || "program"]: content,
      };
      break;
    case "escalation":
      nextInner.escalations = Array.isArray(content.escalations) ? content.escalations : [];
      nextInner.escalationsLastCheckedAt = generatedAt;
      break;
    case "closure":
      nextInner.closure = content;
      nextInner.closureGeneratedAt = generatedAt;
      break;
    default:
      nextInner.restoredArtifacts = {
        ...(isRecord(nextInner.restoredArtifacts) ? nextInner.restoredArtifacts : {}),
        [`${agentId}:${phaseId || "program"}`]: content,
      };
      break;
  }

  return wrapProgramData(programData, nextInner);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const auth = await authenticate(req);
    const body = await req.json() as { programId?: string; artifactId?: string };
    if (!body.programId || !body.artifactId) {
      return jsonResponse({ error: "programId and artifactId are required." }, 400);
    }

    const { data: program, error: programError } = await auth.admin
      .from("adam_programs")
      .select("id, owner_id, data")
      .eq("id", body.programId)
      .single();
    if (programError || !program) {
      return jsonResponse({ error: programError?.message || "Program not found." }, 404);
    }
    if (!auth.isService && auth.ownerId && program.owner_id && auth.ownerId !== program.owner_id) {
      return jsonResponse({ error: "Forbidden." }, 403);
    }

    const { data: artifact, error: artifactError } = await auth.admin
      .from("adam_program_artifacts")
      .select("*")
      .eq("id", body.artifactId)
      .eq("program_id", body.programId)
      .single();
    if (artifactError || !artifact) {
      return jsonResponse({ error: artifactError?.message || "Artifact not found." }, 404);
    }

    const content = isRecord(artifact.content) ? artifact.content : {};
    const nextData = restoreAgentContent(
      isRecord(program.data) ? program.data : {},
      artifact.agent_id,
      artifact.phase_id,
      content,
      artifact.generated_at,
    );

    const { error: updateError } = await auth.admin
      .from("adam_programs")
      .update({
        data: nextData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.programId);
    if (updateError) {
      throw new Error(updateError.message || "Failed to restore artifact.");
    }

    return jsonResponse({ status: "restored", artifactId: body.artifactId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
