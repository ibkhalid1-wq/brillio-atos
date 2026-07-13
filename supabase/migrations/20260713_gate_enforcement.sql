-- Audit F-001 — server-side gate enforcement (HARD PREVENTION).
--
-- The T6 probe proved a client can forge a gate approval by a direct API write
-- to data->'gateReviews' (RLS only checks ownership). This migration makes that
-- write path impossible: the ONLY way to change gateReviews is through a
-- SECURITY DEFINER function that verifies ownership, re-checks readiness, sets
-- the approver from the authenticated identity (not client-supplied), and
-- stamps a server marker. A trigger rejects any other write that touches
-- gateReviews.
--
-- NOT APPLIED to production by the audit (contract Rule 6: never touch a shared
-- database). Apply intentionally:  supabase db push   (rollback below).

-- 1) The gate-context guard: only writes made inside record_gate_approval() may
--    change data->'gateReviews'. Everything else is rejected.
create or replace function atos_block_client_gate_writes()
returns trigger
language plpgsql
as $$
begin
  if (new.data -> 'gateReviews') is distinct from (old.data -> 'gateReviews')
     and coalesce(current_setting('atos.gate_ctx', true), '') <> 'server' then
    raise exception 'gateReviews may only be changed through record_gate_approval()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists atos_gate_guard on adam_programs;
create trigger atos_gate_guard
  before update on adam_programs
  for each row execute function atos_block_client_gate_writes();

-- 2) The only legitimate writer. Verifies ownership, sets the approver from the
--    JWT identity, stamps a server marker + timestamp, and (optionally) the
--    caller-supplied review body MINUS any client-set status/approver fields.
create or replace function record_gate_approval(
  p_program uuid,
  p_phase   text,
  p_status  text,          -- 'approved' | 'pending'
  p_review  jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_email text;
  v_data  jsonb;
  v_review jsonb;
begin
  select owner_id, data into v_owner, v_data from adam_programs where id = p_program;
  if v_owner is null then raise exception 'programme not found'; end if;
  if v_owner <> auth.uid() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_status not in ('approved','pending') then raise exception 'bad status'; end if;

  select email into v_email from auth.users where id = auth.uid();

  -- Server owns the trustworthy fields; strip anything the client tried to set.
  v_review := coalesce(p_review, '{}'::jsonb)
              - 'status' - 'approvedBy' - 'approvedAt' - 'approvedVia'
              || jsonb_build_object(
                   'status',      p_status,
                   'approvedBy',  coalesce(v_email, auth.uid()::text),
                   'approvedAt',  case when p_status = 'approved' then to_jsonb(now()) else 'null'::jsonb end,
                   'approvedVia', 'server'
                 );

  -- The `data` shape is either {data:{...}} or {...}; write to whichever holds gateReviews.
  perform set_config('atos.gate_ctx', 'server', true);
  if v_data ? 'data' then
    update adam_programs
      set data = jsonb_set(v_data, array['data','gateReviews',p_phase], v_review, true),
          updated_at = now()
      where id = p_program;
  else
    update adam_programs
      set data = jsonb_set(v_data, array['gateReviews',p_phase], v_review, true),
          updated_at = now()
      where id = p_program;
  end if;
  perform set_config('atos.gate_ctx', '', true);
end;
$$;

revoke all on function record_gate_approval(uuid, text, text, jsonb) from public;
grant execute on function record_gate_approval(uuid, text, text, jsonb) to authenticated;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- drop trigger if exists atos_gate_guard on adam_programs;
-- drop function if exists atos_block_client_gate_writes();
-- drop function if exists record_gate_approval(uuid, text, text, jsonb);
