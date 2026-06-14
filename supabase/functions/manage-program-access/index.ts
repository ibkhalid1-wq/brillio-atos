import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupabaseClient = ReturnType<typeof createClient>;
type Role = "admin" | "editor" | "viewer";
const VALID_ROLES: ReadonlySet<string> = new Set(["admin", "editor", "viewer"]);

interface AuthContext {
  admin: SupabaseClient;
  userId: string | null;
  isService: boolean;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase environment is not configured.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  const admin = getAdminClient();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { admin, userId: null, isService: true };
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new Error(error?.message || "Authentication failed.");
  }
  return { admin, userId: data.user.id, isService: false };
}

// Resolve a caller's role for a program. The owner is always an admin even
// without an explicit membership row.
async function resolveRole(
  auth: AuthContext,
  programOwnerId: string | null,
  programId: string,
): Promise<Role | null> {
  if (auth.isService) return "admin";
  if (!auth.userId) return null;
  if (programOwnerId && programOwnerId === auth.userId) return "admin";
  const { data, error } = await auth.admin
    .from("adam_program_members")
    .select("role")
    .eq("program_id", programId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error || !data) return null;
  const role = data.role as string;
  return VALID_ROLES.has(role) ? (role as Role) : null;
}

// Find an auth user by email using the admin API (paginates through users).
async function findUserByEmail(admin: SupabaseClient, email: string): Promise<{ id: string; email: string } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    for (const u of users) {
      if ((u.email || "").trim().toLowerCase() === target) {
        return { id: u.id, email: u.email || target };
      }
    }
    if (users.length < perPage) break;
  }
  return null;
}

// Attach email addresses to a set of member rows for display.
async function attachEmails(
  admin: SupabaseClient,
  members: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const ids = new Set(members.map((m) => String(m.user_id)));
  const emailById = new Map<string, string>();
  const perPage = 200;
  for (let page = 1; page <= 50 && emailById.size < ids.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data?.users ?? [];
    for (const u of users) {
      if (ids.has(u.id)) emailById.set(u.id, u.email || "");
    }
    if (users.length < perPage) break;
  }
  return members.map((m) => ({ ...m, email: emailById.get(String(m.user_id)) || null }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const auth = await authenticate(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const programId = typeof body.programId === "string" ? body.programId : "";

    if (!programId) {
      return jsonResponse({ error: "programId is required." }, 400);
    }

    // Load the program to determine ownership and existence.
    const { data: programRow, error: programError } = await auth.admin
      .from("adam_programs")
      .select("id, owner_id")
      .eq("id", programId)
      .maybeSingle();
    if (programError || !programRow) {
      return jsonResponse({ error: "Program not found." }, 404);
    }
    const ownerId = (programRow.owner_id as string | null) ?? null;

    const callerRole = await resolveRole(auth, ownerId, programId);
    if (!callerRole) {
      return jsonResponse({ error: "You do not have access to this program." }, 403);
    }

    // "list" is available to any member; everything else is admin-only.
    if (action === "list") {
      const { data: members, error: membersError } = await auth.admin
        .from("adam_program_members")
        .select("id, program_id, user_id, role, invited_by, created_at, updated_at")
        .eq("program_id", programId)
        .order("created_at", { ascending: true });
      if (membersError) {
        return jsonResponse({ error: membersError.message }, 500);
      }
      const withEmails = await attachEmails(auth.admin, members ?? []);
      return jsonResponse({ members: withEmails, ownerId, callerRole });
    }

    if (callerRole !== "admin") {
      return jsonResponse({ error: "Only program admins can manage access." }, 403);
    }

    if (action === "invite") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const role = typeof body.role === "string" ? body.role : "viewer";
      if (!email) {
        return jsonResponse({ error: "email is required." }, 400);
      }
      if (!VALID_ROLES.has(role)) {
        return jsonResponse({ error: `Invalid role "${role}".` }, 400);
      }
      const user = await findUserByEmail(auth.admin, email);
      if (!user) {
        return jsonResponse({
          error: "No account found for that email. The person must sign up first.",
        }, 404);
      }
      const { data: inserted, error: insertError } = await auth.admin
        .from("adam_program_members")
        .upsert({
          program_id: programId,
          user_id: user.id,
          role,
          invited_by: auth.userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "program_id,user_id" })
        .select("id, program_id, user_id, role, invited_by, created_at, updated_at")
        .maybeSingle();
      if (insertError) {
        return jsonResponse({ error: insertError.message }, 500);
      }
      return jsonResponse({ member: { ...inserted, email: user.email } });
    }

    if (action === "set-role") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const role = typeof body.role === "string" ? body.role : "";
      if (!userId || !VALID_ROLES.has(role)) {
        return jsonResponse({ error: "userId and a valid role are required." }, 400);
      }
      if (userId === ownerId) {
        return jsonResponse({ error: "The program owner's role cannot be changed." }, 400);
      }
      const { data: updated, error: updateError } = await auth.admin
        .from("adam_program_members")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("program_id", programId)
        .eq("user_id", userId)
        .select("id, program_id, user_id, role, invited_by, created_at, updated_at")
        .maybeSingle();
      if (updateError) {
        return jsonResponse({ error: updateError.message }, 500);
      }
      if (!updated) {
        return jsonResponse({ error: "Member not found." }, 404);
      }
      return jsonResponse({ member: updated });
    }

    if (action === "remove") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!userId) {
        return jsonResponse({ error: "userId is required." }, 400);
      }
      if (userId === ownerId) {
        return jsonResponse({ error: "The program owner cannot be removed." }, 400);
      }
      const { error: deleteError } = await auth.admin
        .from("adam_program_members")
        .delete()
        .eq("program_id", programId)
        .eq("user_id", userId);
      if (deleteError) {
        return jsonResponse({ error: deleteError.message }, 500);
      }
      return jsonResponse({ removed: userId });
    }

    return jsonResponse({ error: `Unknown action "${action}".` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message.includes("token") || message.includes("Authentication") ? 401 : 500;
    return jsonResponse({ error: message }, status);
  }
});
