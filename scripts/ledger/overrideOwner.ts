/**
 * The one place the Laila override-log owner is decided, for the comparison harnesses.
 *
 * `overridesToBatch` / `buildOptionABatch` now REQUIRE the owner as an argument (it used to
 * be a fabricated constant, `overrideAdapter.ts`'s `OP_OWNER = "Sales Leaders"`). These
 * scripts hold Option A against migrate(), and migrate stamps `ownerFor("sales")` on its
 * own override-log path (`src/v3/lib/ledger/migrate.ts:206-211`) — so the two paths have to
 * agree on that owner or the comparison is measuring the wrong thing.
 *
 * It is derived here from migrate's OWN exported mapping rather than re-typing the label.
 * `ownerRoleLabelForArea(area)` is `ownerFor(area)` minus the wrapper: both are
 * `functionOf(area)` → `ROLE_LABEL[fn] ?? fn`, and `ownerFor` returns `{kind:"role", role}`
 * for exactly the areas where the label is non-null. So this is `ownerFor("sales")` by
 * construction, not by comment — retune migrate's FUNCTIONS/ROLE_LABEL table and this moves
 * with it. If the area ever stops resolving, that is a parity break, and it throws rather
 * than quietly substituting some other plausible role.
 */
import { ownerRoleLabelForArea } from "../../src/v3/lib/ledger/migrate";
import type { Owner } from "../../supabase/functions/_shared/ledgerGenerator";

/** The area string migrate's override-log path passes to `ownerFor`. */
export const MIGRATE_OVERRIDE_AREA = "sales";

export const migrateOverrideOwner = (): Owner => {
  const role = ownerRoleLabelForArea(MIGRATE_OVERRIDE_AREA);
  if (!role) {
    throw new Error(
      `parity break: migrate's ownerRoleLabelForArea("${MIGRATE_OVERRIDE_AREA}") resolves to no role, ` +
      `so the override-log import can no longer match migrate's ownerFor("${MIGRATE_OVERRIDE_AREA}"). ` +
      `Fix the mapping (or the comparison) — do not substitute a literal owner here.`,
    );
  }
  return { kind: "role", role };
};
