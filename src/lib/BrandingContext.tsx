import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BrandingConfig {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  orgName: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  primaryColor: "#6366f1",
  accentColor: "#00a0df",
  logoUrl: null,
  orgName: "ADAM",
};

export const BrandingContext = createContext<BrandingConfig>(DEFAULT_BRANDING);

export function BrandingProvider({ children, orgId }: { children: React.ReactNode; orgId?: string | null }) {
  const [config, setConfig] = useState<BrandingConfig>(DEFAULT_BRANDING);

  useEffect(() => {
    if (!orgId || !supabase) return;
    (supabase as any)
      .from("adam_organisations")
      .select("branding, name")
      .eq("id", orgId)
      .single()
      .then(({ data }: { data: any }) => {
        if (!data) return;
        const branding = data.branding ?? {};
        const next: BrandingConfig = {
          primaryColor: branding.primaryColor ?? DEFAULT_BRANDING.primaryColor,
          accentColor: branding.accentColor ?? DEFAULT_BRANDING.accentColor,
          logoUrl: branding.logoUrl ?? null,
          orgName: data.name ?? DEFAULT_BRANDING.orgName,
        };
        setConfig(next);
        document.documentElement.style.setProperty("--color-primary", next.primaryColor);
        document.documentElement.style.setProperty("--v3-accent", next.primaryColor);
        document.documentElement.style.setProperty("--v3-accent-b", next.accentColor);
      });
  }, [orgId]);

  return <BrandingContext.Provider value={config}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingConfig {
  return useContext(BrandingContext);
}

export function useBrandingStyles(): React.CSSProperties {
  const { primaryColor, accentColor } = useBranding();
  return {
    "--color-primary": primaryColor,
    "--v3-accent": primaryColor,
    "--v3-accent-b": accentColor,
  } as React.CSSProperties;
}
