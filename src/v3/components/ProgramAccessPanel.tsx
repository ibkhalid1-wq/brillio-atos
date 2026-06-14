import React, { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { pushV3Toast } from "@/v3/utils";

type Role = "admin" | "editor" | "viewer";

interface MemberRow {
  id: string;
  program_id: string;
  user_id: string;
  role: Role;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
  email: string | null;
}

interface ProgramAccessPanelProps {
  programId: string | null;
  currentUserId: string | null;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_HINT: Record<Role, string> = {
  admin: "Full control, including managing members.",
  editor: "Can view and edit, and run agents.",
  viewer: "Read-only access.",
};

export default function ProgramAccessPanel({ programId, currentUserId }: ProgramAccessPanelProps) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);

  const callManage = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase || !isSupabaseConfigured) {
      throw new Error("Cloud backend is not configured for this workspace.");
    }
    const { data, error: invokeError } = await supabase.functions.invoke("manage-program-access", { body });
    if (invokeError) {
      // Supabase wraps non-2xx responses; surface the function's error message when present.
      const message = (data && typeof data === "object" && "error" in data && typeof (data as Record<string, unknown>).error === "string")
        ? (data as Record<string, string>).error
        : invokeError.message;
      throw new Error(message || "Request failed.");
    }
    if (data && typeof data === "object" && "error" in data && (data as Record<string, unknown>).error) {
      throw new Error(String((data as Record<string, unknown>).error));
    }
    return data as Record<string, unknown>;
  }, []);

  const loadMembers = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    setError("");
    try {
      const data = await callManage({ action: "list", programId });
      setMembers((data.members as MemberRow[]) || []);
      setOwnerId((data.ownerId as string | null) ?? null);
      setCallerRole((data.callerRole as Role | null) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load members.");
    } finally {
      setLoading(false);
    }
  }, [programId, callManage]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const isAdmin = callerRole === "admin";

  const handleInvite = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email || !programId) return;
    setBusy(true);
    try {
      await callManage({ action: "invite", programId, email, role: inviteRole });
      setInviteEmail("");
      setInviteRole("viewer");
      pushV3Toast(`Invited ${email} as ${ROLE_LABEL[inviteRole]}.`, { tone: "success", duration: 5000 });
      await loadMembers();
    } catch (caught) {
      pushV3Toast(caught instanceof Error ? caught.message : "Failed to invite member.", { tone: "error", duration: 7000 });
    } finally {
      setBusy(false);
    }
  }, [inviteEmail, inviteRole, programId, callManage, loadMembers]);

  const handleSetRole = useCallback(async (userId: string, role: Role) => {
    if (!programId) return;
    setBusy(true);
    try {
      await callManage({ action: "set-role", programId, userId, role });
      await loadMembers();
    } catch (caught) {
      pushV3Toast(caught instanceof Error ? caught.message : "Failed to change role.", { tone: "error", duration: 7000 });
    } finally {
      setBusy(false);
    }
  }, [programId, callManage, loadMembers]);

  const handleRemove = useCallback(async (userId: string, email: string | null) => {
    if (!programId) return;
    setBusy(true);
    try {
      await callManage({ action: "remove", programId, userId });
      pushV3Toast(`Removed ${email || "member"} from this programme.`, { tone: "success", duration: 5000 });
      await loadMembers();
    } catch (caught) {
      pushV3Toast(caught instanceof Error ? caught.message : "Failed to remove member.", { tone: "error", duration: 7000 });
    } finally {
      setBusy(false);
    }
  }, [programId, callManage, loadMembers]);

  if (!isSupabaseConfigured) {
    return (
      <div className="v3-section">
        <section className="v3-card">
          <div className="v3-card-title">Access &amp; sharing</div>
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
            Sharing requires the cloud backend, which isn't configured for this workspace.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="v3-section">
      <section className="v3-card">
        <div className="v3-card-title">Members</div>
        {error ? (
          <div style={{ fontSize: 12, color: "var(--v3-red)", marginBottom: 10 }}>{error}</div>
        ) : null}
        {loading ? (
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>Loading members…</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {members.length ? members.map((member) => {
              const isOwner = member.user_id === ownerId;
              const isSelf = member.user_id === currentUserId;
              return (
                <div key={member.id} className="v3-card-sm" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--v3-text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {member.email || member.user_id}
                      {isSelf ? <span style={{ color: "var(--v3-text-muted)", fontWeight: 400 }}> (you)</span> : null}
                      {isOwner ? <span style={{ color: "var(--v3-text-muted)", fontWeight: 400 }}> · owner</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--v3-text-muted)" }}>{ROLE_HINT[member.role]}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {isAdmin && !isOwner ? (
                      <>
                        <select
                          className="v3-input"
                          aria-label={`Role for ${member.email || member.user_id}`}
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          value={member.role}
                          disabled={busy}
                          onChange={(event) => void handleSetRole(member.user_id, event.target.value as Role)}
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          type="button"
                          className="v3-button"
                          style={{ fontSize: 12 }}
                          disabled={busy}
                          onClick={() => void handleRemove(member.user_id, member.email)}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--v3-text-secondary)", fontWeight: 600 }}>{ROLE_LABEL[member.role]}</span>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>No members yet.</div>
            )}
          </div>
        )}
      </section>

      {isAdmin ? (
        <section className="v3-card">
          <div className="v3-card-title">Invite a collaborator</div>
          <div style={{ fontSize: 11, color: "var(--v3-text-muted)", marginBottom: 10 }}>
            The person must already have an account. Enter the email they signed up with.
          </div>
          <div className="v3-wizard-grid">
            <div>
              <div className="v3-field-label">Email</div>
              <input
                className="v3-input"
                type="email"
                aria-label="Invite email"
                placeholder="name@company.com"
                value={inviteEmail}
                disabled={busy}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </div>
            <div>
              <div className="v3-field-label">Role</div>
              <select
                className="v3-input"
                aria-label="Invite role"
                value={inviteRole}
                disabled={busy}
                onChange={(event) => setInviteRole(event.target.value as Role)}
              >
                <option value="viewer">Viewer — read-only</option>
                <option value="editor">Editor — view &amp; edit</option>
                <option value="admin">Admin — full control</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="v3-button primary"
              style={{ fontSize: 12 }}
              disabled={busy || !inviteEmail.trim()}
              onClick={() => void handleInvite()}
            >
              {busy ? "Working…" : "Send invite"}
            </button>
          </div>
        </section>
      ) : (
        <section className="v3-card">
          <div style={{ fontSize: 12, color: "var(--v3-text-muted)" }}>
            Only programme admins can invite collaborators or change roles.
          </div>
        </section>
      )}
    </div>
  );
}
