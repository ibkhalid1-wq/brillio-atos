# Shell Ownership

The repo has a single live shell. The legacy pre-V3 shells (`src/App.jsx`,
`src/components/*`, `src/pages/*`, `src/flavor2/*`, `src/new/AppShell.tsx`) have
been removed; they are recoverable from git history if ever needed.

## Live shell

- `src/v3/AppShellV3.tsx`

This is the production shell mounted by:

- `src/main.jsx`

All shell-level UX, navigation, chrome, routing, and presentation changes should land in:

- `src/v3/*`

## Shared modules used by V3

These modules are still active because V3 renders or wraps them:

- `src/new/pages/*`
- `src/new/lib/*`
- `src/new/components/*`
- `src/hooks/*`

Changes here are appropriate when they affect shared business logic or page content that V3 embeds.

## Quick verification

To confirm the live shell is still V3:

1. Open `src/main.jsx`
2. Confirm the app module import points to `./v3/AppShellV3`
3. Run `npm run build`
4. Smoke-test the core V3 surfaces:
   - Today (`insight-feed`)
   - Activity / Action Center (`decide`)
   - Program (`program` / `stage`)
   - Executive Overview (`executive`)
