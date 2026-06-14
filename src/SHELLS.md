# Shell Ownership

This repo currently has multiple shell implementations on disk, but only one is live.

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

## Legacy shells

These files are kept only as references and are not mounted by the live app:

- `src/flavor2/AppShellFlavor2.tsx`
- `src/new/AppShell.tsx`

Do not place new shell-level UX work in those files unless the goal is specifically to revive or compare an older shell.

## Quick verification

To confirm the live shell is still V3:

1. Open `src/main.jsx`
2. Confirm the app module import points to `./v3/AppShellV3`
3. Run `npm run build`
4. Smoke-test core V3 routes:
   - `/`
   - `/journey`
   - `/decisions`
   - `/reports`
   - `/more`
