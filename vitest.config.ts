import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/v3/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "./supabase/functions/_shared"),
      // Edge modules are Deno-targeted and import their deps by URL. Node cannot
      // load an https: specifier, so a test that imports `_shared/extractText.ts`
      // dies at resolution rather than exercising the extractor. fflate is already
      // present in node_modules (via officeparser), so the URL maps to the SAME
      // library the deployed function gets — this substitutes the loader, not the code.
      "https://esm.sh/fflate@0.8.2": "fflate",
    },
  },
});
