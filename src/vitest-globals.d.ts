// Makes the vitest global APIs (describe/it/test/expect/vi/beforeEach/…) visible
// to the TypeScript type-checker. Vitest is configured with `globals: true`
// (vitest.config.ts), so the test suites call these without importing them.
// This reference is additive — it does not restrict the default inclusion of
// other @types packages the app relies on.
/// <reference types="vitest/globals" />
