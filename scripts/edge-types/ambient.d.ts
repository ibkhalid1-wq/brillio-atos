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
   * `createClient` is bound to the project's REAL schema.
   *
   * It briefly returned `SupabaseClient<any, any, any>`, which was the honest
   * description of what the edge had: it calls `createClient` with no
   * `Database` generic, so it had no schema and every row was untyped. (Newer
   * supabase-js typings resolve an unparameterised client's rows to `never`,
   * which turned every `row.id` into an error — an artifact of this shim, not a
   * defect in the code, so silencing it by editing the edge would have been
   * fixing the product to suit the measuring instrument.)
   *
   * `database.types.ts` is the upgrade, generated from the live project. Now a
   * column renamed out from under the edge is a type error rather than an
   * `undefined` at runtime — which is the whole reason to typecheck this tree.
   */
  export function createClient(
    url: string,
    key: string,
    options?: Record<string, unknown>,
  ): import("@supabase/supabase-js").SupabaseClient<
    import("../../supabase/functions/_shared/database.types.ts").Database
  >;
}
