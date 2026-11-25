-- =====================================================================
-- ORGANIC ADS AI — Etapa 2 (Inteligência)
-- Fila de agentes (claim atômico), consumo de limite de IA e sinais de produto.
-- Executar no SQL Editor do Supabase DEPOIS da 0001.
-- =====================================================================

-- Sinais brutos usados na pontuação (ex.: posição na lista de mais vendidos do Mercado Livre)
alter table public.products
  add column if not exists signals jsonb not null default '{}'::jsonb,
  add column if not exists category text check (char_length(category) <= 120);

-- Pontuação: guarda o peso de cada sinal e quais eram verificados
alter table public.product_scores
  add column if not exists breakdown jsonb not null default '{}'::jsonb;

-- Público: justificativa e confiança da inferência da IA
alter table public.audiences
  add column if not exists rationale text,
  add column if not exists confidence numeric(3,2) check (confidence between 0 and 1);

-- Estratégia: justificativa e confiança
alter table public.strategies
  add column if not exists rationale text,
  add column if not exists confidence numeric(3,2) check (confidence between 0 and 1);

-- ---------------------------------------------------------------------
-- Pega a próxima tarefa da fila de forma atômica (sem execução duplicada).
-- Só o backend (service_role) pode chamar.
-- ---------------------------------------------------------------------
create or replace function public.claim_agent_task(p_user uuid default null, p_campaign uuid default null)
returns setof public.agent_tasks
language plpgsql security definer set search_path = public as $$
begin
  -- Tarefas travadas há mais de 10 minutos voltam para a fila (ou falham se esgotaram tentativas)
  update public.agent_tasks
     set status = case when attempts >= max_attempts then 'failed'::public.task_status else 'queued'::public.task_status end,
         error = coalesce(error, 'Tempo de execução excedido'),
         finished_at = case when attempts >= max_attempts then now() else null end
   where status = 'running' and started_at < now() - interval '10 minutes';

  return query
  update public.agent_tasks t
     set status = 'running', attempts = t.attempts + 1, started_at = now(), error = null
   where t.id = (
     select q.id
       from public.agent_tasks q
       join public.campaigns c on c.id = q.campaign_id
      where q.status = 'queued'
        and q.run_after <= now()
        and c.status = 'active'
        and (p_user is null or q.user_id = p_user)
        and (p_campaign is null or q.campaign_id = p_campaign)
      order by q.run_after, q.created_at
      for update of q skip locked
      limit 1)
  returning t.*;
end $$;

-- ---------------------------------------------------------------------
-- Consome N requisições de IA do limite mensal. Retorna false se estourar.
-- ---------------------------------------------------------------------
create or replace function public.consume_ai_requests(p_user uuid, p_n integer default 1)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ok boolean;
begin
  insert into public.usage_limits (user_id) values (p_user)
    on conflict (user_id, period_start) do nothing;
  update public.usage_limits
     set used_ai_requests = used_ai_requests + p_n
   where user_id = p_user
     and period_start = date_trunc('month', now())::date
     and used_ai_requests + p_n <= max_ai_requests
  returning true into ok;
  return coalesce(ok, false);
end $$;

revoke all on function public.claim_agent_task(uuid, uuid) from public;
revoke all on function public.consume_ai_requests(uuid, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.claim_agent_task(uuid, uuid) from anon, authenticated';
    execute 'revoke all on function public.consume_ai_requests(uuid, integer) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_agent_task(uuid, uuid) to service_role';
    execute 'grant execute on function public.consume_ai_requests(uuid, integer) to service_role';
  end if;
end $$;
