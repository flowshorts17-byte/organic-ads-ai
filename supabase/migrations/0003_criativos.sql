-- =====================================================================
-- ORGANIC ADS AI — Etapa 3 (Creative Generator)
-- Roteiros + narração por item do calendário. O vídeo é montado no aparelho.
-- Executar no SQL Editor do Supabase DEPOIS da 0002.
-- =====================================================================

create table if not exists public.creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  strategy_id uuid not null references public.strategies(id) on delete cascade,
  calendar_index integer not null check (calendar_index >= 0),
  product_id uuid references public.products(id) on delete set null,
  platform text not null,
  day integer,
  -- script_ready = roteiro pronto, falta narração | ready = roteiro + narração | failed
  status text not null default 'script_ready' check (status in ('script_ready','ready','failed')),
  hook text,
  scenes jsonb not null default '[]'::jsonb,         -- [{ "on_screen": "...", "speech": "..." }]
  caption text,
  hashtags text[] not null default '{}',
  cta text,
  affiliate_url text,
  audio_path text,                                    -- caminho no bucket "creatives"
  audio_seconds numeric(6,2),
  videos_generated integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (strategy_id, calendar_index)
);
create index if not exists creatives_campaign_idx on public.creatives(campaign_id, calendar_index);
drop trigger if exists trg_creatives_updated on public.creatives;
create trigger trg_creatives_updated before update on public.creatives
  for each row execute function public.set_updated_at();

alter table public.creatives enable row level security;
drop policy if exists "own read" on public.creatives;
create policy "own read" on public.creatives for select to authenticated using (user_id = auth.uid());
-- escrita só pelo backend (service_role)

-- ---------------------------------------------------------------------
-- Conta 1 conteúdo (vídeo gerado) no limite mensal do plano.
-- Chamado pelo navegador do dono antes de montar o vídeo.
-- ---------------------------------------------------------------------
create or replace function public.consume_content(p_creative uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ok boolean;
begin
  if uid is null then return false; end if;
  if not exists (select 1 from public.creatives where id = p_creative and user_id = uid) then
    return false;
  end if;
  insert into public.usage_limits (user_id) values (uid)
    on conflict (user_id, period_start) do nothing;
  update public.usage_limits
     set used_contents = used_contents + 1
   where user_id = uid
     and period_start = date_trunc('month', now())::date
     and used_contents + 1 <= max_contents
  returning true into ok;
  if coalesce(ok, false) then
    update public.creatives set videos_generated = videos_generated + 1 where id = p_creative;
  end if;
  return coalesce(ok, false);
end $$;

revoke all on function public.consume_content(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.consume_content(uuid) from anon';
    execute 'grant execute on function public.consume_content(uuid) to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Storage: bucket privado para as narrações. Pasta = id do usuário.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creatives', 'creatives', false, 10485760, array['audio/wav'])
on conflict (id) do nothing;

drop policy if exists "creatives own read" on storage.objects;
create policy "creatives own read" on storage.objects for select to authenticated
  using (bucket_id = 'creatives' and (storage.foldername(name))[1] = auth.uid()::text);
