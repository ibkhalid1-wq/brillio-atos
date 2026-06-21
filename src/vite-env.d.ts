/// <reference types="vite/client" />

// App-specific Vite env vars. Declaring them here gives `import.meta.env.VITE_*`
// precise types across the app (the base vite/client reference only types the
// built-in MODE/DEV/PROD/BASE_URL keys).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_PROJECT_ID?: string;
  readonly VITE_SUPABASE_FUNCTIONS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
