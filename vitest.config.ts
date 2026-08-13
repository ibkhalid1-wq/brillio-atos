import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/v3/__tests__/**/*.test.ts"],
    // jsdom 29's btoa/atob recurse into themselves under vitest's jsdom
    // environment: ~30s of CPU and then a bogus InvalidCharacterError on valid
    // input, which silently pushes every upload path onto its failure branch.
    // The setup file restores Node's spec-correct pair — see it for the mechanism.
    setupFiles: ["./src/test/setupBase64.ts"],
    // A TIMEOUT IS A HANG DETECTOR, NOT A PERFORMANCE ASSERTION.
    //
    // The a11y suites mount the whole FlowShell against a real Laila snapshot, once
    // per case — ~1s each on an idle machine, and comfortably 5× that when the
    // worker pool is saturated by the other 175 files. At vitest's 5s default they
    // passed alone and timed out in the full run: intermittent red that says nothing
    // about the code, which is exactly the signal that teaches an engineer to re-run
    // until green and, one day, to shrug at a real failure.
    //
    // 30s does not slow a passing suite down by a millisecond — a test that finishes
    // still finishes. It only changes how long a genuinely STUCK test hangs before
    // the runner kills it, which is the only thing this number is for.
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
