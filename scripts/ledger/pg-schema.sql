-- Ledger persistence schema (docs/aura/persistence-report.md). Mutable, precedence-
-- resolved; every write emits an append-only audit_events row via the Step 1 trigger.
create table if not exists public.ledger_elements (
  id text not null, program_id text not null, kind text not null,
  name text not null, of text, refs jsonb not null default '{}'::jsonb,
  dropped boolean not null default false,      -- regeneration no longer produces it; row STAYS (orphan target)
  primary key (program_id, id)                 -- element ids are program-agnostic too
);
-- idempotent for a pre-existing table (create-if-not-exists won't add the column)
alter table public.ledger_elements add column if not exists dropped boolean not null default false;
create table if not exists public.ledger_claims (
  id text not null,                            -- contentId(about,world,source,value) — program-agnostic hash
  program_id text not null,                    -- engagement scope + audit program_id
  about text not null, world text not null, source text not null, status text not null, layer text not null,
  value jsonb not null,                        -- A1 tagged union
  owner jsonb not null,                        -- ownerWhileOpen (role | joint | unowned)
  superseded_by text,                          -- soft link (filtered by null); NOT a FK (contentId hashes source)
  closed_by jsonb, contradicts text[] not null default '{}', escalate_to text, blocked_reason text,
  created_at timestamptz not null default now(),
  primary key (program_id, id)                 -- contentId is program-agnostic; two engagements migrating
);                                             -- the same blob share ids, so the PK MUST be program-scoped
create index if not exists ledger_claims_locus on public.ledger_claims (program_id, about, world);
create index if not exists ledger_claims_open  on public.ledger_claims (program_id) where status in ('open','blocked');
create index if not exists ledger_claims_live  on public.ledger_claims (about, world) where superseded_by is null;

-- rename intent: durable old->new element id, captured explicitly, never inferred
create table if not exists public.ledger_rename_intents (
  id bigint generated always as identity primary key, program_id text not null,
  old_element_id text not null, new_element_id text not null, by text not null, at timestamptz not null default now()
);

-- audit linkage: the SAME Step 1 trigger writes the append-only audit row on every ledger write —
-- on BOTH state-bearing ledger tables (claims and elements), so element maintenance is audited too.
drop trigger if exists aura_audit_ledger on public.ledger_claims;
create trigger aura_audit_ledger after insert or update or delete on public.ledger_claims
  for each row execute function public.aura_audit();
drop trigger if exists aura_audit_ledger_elements on public.ledger_elements;
create trigger aura_audit_ledger_elements after insert or update or delete on public.ledger_elements
  for each row execute function public.aura_audit();

-- the RLS predicate calls auth.uid(); `authenticated` must be able to reach it.
-- (Real Supabase grants this; the bare-Postgres shim needs it stated.)
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- RLS: engagement-scoped, owner-only-until-Authority (Step 1's interim posture). NOT open.
do $rls$
declare t text;
begin
  foreach t in array array['ledger_elements','ledger_claims','ledger_rename_intents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I_owner_read on public.%I', t, t);
    execute format($p$create policy %I_owner_read on public.%I for select using (program_id in (select id::text from public.adam_programs where owner_id = auth.uid()))$p$, t, t);
  end loop;
end $rls$;
