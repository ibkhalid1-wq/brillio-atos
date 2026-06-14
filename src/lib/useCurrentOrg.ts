import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OrgMembership {
  orgId: string;
  orgName: string;
  role: "admin" | "member" | "viewer";
}

export function useCurrentOrg(): { org: OrgMembership | null; loading: boolean; error: string | null } {
  const [org, setOrg] = useState<OrgMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) { setLoading(false); return; }
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) { setLoading(false); return; }
        const { data, error: qErr } = await (supabase as any)
          .from("adam_org_members")
          .select("org_id, role, adam_organisations(name)")
          .eq("user_id", userData.user.id)
          .single();
        if (cancelled) return;
        if (qErr || !data) { setLoading(false); return; }
        setOrg({
          orgId: data.org_id,
          orgName: data.adam_organisations?.name ?? "Organisation",
          role: data.role ?? "member",
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load org");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => ({ org, loading, error }), [org, loading, error]);
}

export async function getOrgId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;
    const { data } = await (supabase as any)
      .from("adam_org_members")
      .select("org_id")
      .eq("user_id", userData.user.id)
      .single();
    return data?.org_id ?? null;
  } catch { return null; }
}
