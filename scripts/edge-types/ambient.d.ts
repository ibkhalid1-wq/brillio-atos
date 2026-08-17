/**
 * WHAT DENO GIVES THE EDGE FUNCTIONS, DECLARED SO `tsc` CAN READ THEM.
 *
 * `supabase/functions` runs on Deno and imports over HTTPS; the app runs on
 * Node and imports from `node_modules`. Nothing here changes what SHIPS — Deno
 * resolves both of these itself at deploy time. This file exists purely so the
 * one typechecker we own can read the edge sources without drowning in
 * "Cannot find name 'Deno'" and "Cannot find module 'https://…'", which is
 * exactly what kept `supabase/functions` untypechecked: the noise was 58 config
 * errors deep before a single real one, so nobody could see the real ones.
 *
 * DELIBERATELY NARROW. Only what the edge actually uses is declared — two Deno
 * calls, one module. A fuller `Deno` type would let a future edit reach for an
 * API this repo does not use, and the point is to typecheck what is written,
 * not to reimplement a runtime.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

/**
 * The pinned esm.sh import, typed from the `@supabase/supabase-js` already in
 * `node_modules`. The VERSIONS DIFFER ON PURPOSE and it is worth knowing why:
 * the edge pins 2.49.8 and the package.json carries ^2.108.1. Typing one from
 * the other is a deliberate approximation — good enough to catch a misspelled
 * method or a bad argument, and not a claim that the two are identical. If the
 * client's surface ever changes under us, the honest signal is a type error
 * here, which is strictly better than the nothing we had.
 */
declare module "https://esm.sh/@supabase/supabase-js@2.49.8" {
  export * from "@supabase/supabase-js";
  /**
   * `createClient` is re-declared UNTYPED, and that is the accurate statement.
   *
   * The edge calls it with no `Database` generic, so it has no schema to work
   * from. Newer supabase-js typings resolve an unparameterised client's rows to
   * `never`, which made every `row.id` in the edge an error — 137 of them,
   * every one an artifact of THIS SHIM resolving 2.108 typings against a 2.49.8
   * import, not a defect in the code. Silencing them by editing the edge would
   * have been fixing the product to suit the measuring instrument.
   *
   * The honest description of a client with no schema is `any` rows. It costs
   * nothing that was ever there — the edge never had row types — and it lets
   * the check surface the errors that are actually about the code. Generating a
   * real `Database` type from the migrations is the upgrade; until someone does
   * that, this states the truth rather than implying a safety nobody has.
   */
  export function createClient(
    url: string,
    key: string,
    options?: Record<string, unknown>,
  ): import("@supabase/supabase-js").SupabaseClient<any, any, any>;
}
