/**
 * Runtime-only loaders for the DENO-TARGETED edge modules.
 *
 * `supabase/functions/_shared/extractText.ts` and `claudeClient.ts` compile under
 * Deno, not under the app's `tsc` program: they use the `Deno` global and import
 * `https://esm.sh/fflate@0.8.2` by URL. A STATIC `import` from a test resolves
 * through the `@shared` path mapping, pulls both files into `tsc --noEmit`, and
 * turns a clean typecheck into 15 errors that say nothing about the test.
 *
 * The specifier is therefore assembled at runtime. TypeScript cannot follow a
 * non-literal `import()`, so the modules stay out of the program and the result
 * is `any`; vite-node still resolves the alias when the test actually runs.
 * (`vitest.config.ts` maps the esm.sh URL to the local `fflate` so the import
 * resolves in Node — same library the deployed function gets.)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (name: string): Promise<any> => {
  const spec = ["@shared", name].join("/");
  return import(/* @vite-ignore */ spec);
};

export const loadExtractText = (): Promise<any> => load("extractText.ts");
export const loadClaudeClient = (): Promise<any> => load("claudeClient.ts");
