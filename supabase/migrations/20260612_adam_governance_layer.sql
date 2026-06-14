alter table if exists public.adam_programs
  add column if not exists status text not null default 'active';

do $$
begin
  begin
    alter table public.adam_programs
      add constraint adam_programs_status_check
      check (status in ('active', 'finalized', 'archived'));
  exception
    when duplicate_object then null;
  end;
end
$$;

create index if not exists adam_programs_status_idx
  on public.adam_programs (status, updated_at desc);

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'adam-escalation-check') then
      perform cron.schedule(
        'adam-escalation-check',
        '0 */6 * * *',
        $job$
        select net.http_post(
          url := current_setting('app.edge_function_url') || '/run-agent',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
          ),
          body := '{"agentId":"escalation","programId":"ALL"}'::jsonb
        );
        $job$
      );
    end if;
  end if;
end
$$;
