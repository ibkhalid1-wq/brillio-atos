/**
 * The slice of jsdom's API the render-QA loader uses.
 *
 * jsdom ships no type declarations and `@types/jsdom` is not installed, so a
 * bare `import { JSDOM } from "jsdom"` is TS7016 and the typecheck goes red.
 * The alternatives were worse: `declare module "jsdom"` erases the types
 * entirely, and assembling the specifier at runtime (the trick
 * `helpers/edgeModules.ts` needs for the Deno-targeted modules) would hide a
 * dependency that is a plain, installed devDependency here.
 *
 * So this declares only what is called, with real types. jsdom is already a
 * devDependency — vitest's `environment: "jsdom"` runs on it — and this adds
 * no package.
 */
declare module "jsdom" {
  export class VirtualConsole {
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  export interface ConstructorOptions {
    url?: string;
    runScripts?: "dangerously" | "outside-only";
    virtualConsole?: VirtualConsole;
    pretendToBeVisual?: boolean;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
