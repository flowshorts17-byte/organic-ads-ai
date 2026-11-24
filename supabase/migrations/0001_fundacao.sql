-- =====================================================================
-- ORGANIC ADS AI — Etapa 1 (Fundação)
-- Schema completo, relacionamentos, índices e RLS por usuário.
-- Executar no SQL Editor do Supabase (ou `supabase db push`).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.subscription_status as enum
  ('pending_payment','active','past_due','canceled','expired');
create type public.payment_status as enum
  ('pending','approved','rejected','refunded','canceled');
create type public.campaign_status as enum
  ('draft','active','paused','ended');
create type public.campaign_objective as enum
  ('affiliate_sales','own_product_sales','lead_generation','brand_awareness');
create type public.niche_mode as enum ('user_defined','ai_discovery');
create type public.product_mode as enum ('user_defined','ai_discovery');
create type public.product_type as enum ('physical','digital','service','any');
create type public.social_platform as enum
  ('instagram','tiktok','youtube','facebook','pinterest','kwai','whatsapp','x');
create type public.task_status as enum
  ('queued','running','succeeded','failed','canceled');
create type public.data_quality as enum ('verified','estimated','indirect');
create type public.post_status as enum
  ('draft','pending_approval','approved','scheduled','publishing','published','failed','canceled');

-- ---------------------------------------------------------------------
-- Função utilitária: updated_at
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- users (espelho público de auth.users) e profiles
-- ---------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references public.users(id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  country text not null default 'BR' check (char_length(country) = 2),
  language text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  onboarding_completed boolean not null default false,
  lgpd_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Assinaturas e pagamentos (cartões NUNCA são armazenados aqui)
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_code text not null default 'organic_starter',
  price_cents integer not null default 1790 check (price_cents >= 0),
  currency text not null default 'BRL',
  status public.subscription_status not null default 'pending_payment',
  provider text check (provider in ('mercadopago','stripe')),
  provider_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_one_open_per_user
  on public.subscriptions(user_id)
  where status in ('pending_payment','active','past_due');
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null check (provider in ('mercadopago','stripe')),
  provider_payment_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'BRL',
  status public.payment_status not null default 'pending',
  paid_at timestamptz,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  -- idempotência de webhooks: impede cobrança/registro duplicado
  unique (provider, provider_payment_id)
);
create index payments_user_idx on public.payments(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Campanhas
-- ---------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  objective public.campaign_objective not null,
  market_country text not null check (char_length(market_country) = 2),
  market_region text check (char_length(market_region) <= 80),
  language text not null default 'pt-BR',
  niche_mode public.niche_mode not null,
  niche text check (char_length(niche) <= 120),
  product_mode public.product_mode not null,
  product_hint text check (char_length(product_hint) <= 300),
  product_type public.product_type not null default 'any',
  platforms public.social_platform[] not null default '{}',
  organic_only boolean not null default true check (organic_only = true),
  approval_required boolean not null default true,
  status public.campaign_status not null default 'draft',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint niche_required_when_user check (niche_mode <> 'user_defined' or niche is not null),
  constraint product_required_when_user check (product_mode <> 'user_defined' or product_hint is not null),
  constraint at_least_one_platform check (cardinality(platforms) >= 1)
);
create index campaigns_user_status_idx on public.campaigns(user_id, status);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Produtos e fontes
-- ---------------------------------------------------------------------
create table public.product_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('marketplace','affiliate_network','manual')),
  requires_credentials boolean not null default true,
  docs_url text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  source_id uuid references public.product_sources(id) on delete set null,
  external_id text,
  title text not null check (char_length(title) <= 300),
  url text,
  affiliate_url text,
  image_url text,
  price_cents integer check (price_cents >= 0),
  currency text default 'BRL',
  commission_rate numeric(5,2) check (commission_rate between 0 and 100),
  rating numeric(3,2),
  reviews_count integer,
  sales_count integer,
  data_quality public.data_quality not null default 'indirect',
  selected boolean not null default false,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, source_id, external_id)
);
create index products_campaign_idx on public.products(campaign_id);
create index products_user_idx on public.products(user_id);

create table public.product_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  score numeric(5,2) not null check (score between 0 and 100),
  demand_signal numeric(5,2),
  commission_signal numeric(5,2),
  competition_signal numeric(5,2),
  reviews_signal numeric(5,2),
  rationale text not null,
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  data_quality public.data_quality not null,
  created_at timestamptz not null default now()
);
create index product_scores_product_idx on public.product_scores(product_id, created_at desc);

-- ---------------------------------------------------------------------
-- Público, estratégia, conteúdo
-- ---------------------------------------------------------------------
create table public.audiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  persona jsonb not null default '{}'::jsonb,
  pains text[] not null default '{}',
  interests text[] not null default '{}',
  buying_intent text,
  location text,
  language text,
  created_at timestamptz not null default now()
);
create index audiences_campaign_idx on public.audiences(campaign_id);

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  audience_id uuid references public.audiences(id) on delete set null,
  positioning text,
  sales_angles text[] not null default '{}',
  formats text[] not null default '{}',
  calendar_plan jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index strategies_campaign_idx on public.strategies(campaign_id, is_current);

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  strategy_id uuid references public.strategies(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  kind text not null check (kind in ('video_script','caption','title','cta','carousel','image_idea','copy')),
  platform public.social_platform,
  language text not null default 'pt-BR',
  title text,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','rejected','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_assets_campaign_idx on public.content_assets(campaign_id, created_at desc);
create trigger trg_content_assets_updated before update on public.content_assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Contas sociais (tokens ficam criptografados / só service role)
-- ---------------------------------------------------------------------
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  platform public.social_platform not null,
  external_account_id text not null,
  handle text,
  status text not null default 'connected' check (status in ('connected','expired','revoked','error')),
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, external_account_id)
);
create trigger trg_social_accounts_updated before update on public.social_accounts
  for each row execute function public.set_updated_at();

-- Segredos OAuth separados: SEM políticas RLS para usuários => só service role acessa.
create table public.social_account_secrets (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Publicações
-- ---------------------------------------------------------------------
create table public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  content_asset_id uuid not null references public.content_assets(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  platform public.social_platform not null,
  scheduled_for timestamptz not null,
  status public.post_status not null default 'pending_approval',
  attempts integer not null default 0,
  last_error text,
  idempotency_key text not null unique default gen_random_uuid()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scheduled_posts_due_idx on public.scheduled_posts(status, scheduled_for);
create index scheduled_posts_campaign_idx on public.scheduled_posts(campaign_id);
create trigger trg_scheduled_posts_updated before update on public.scheduled_posts
  for each row execute function public.set_updated_at();

create table public.published_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scheduled_post_id uuid unique references public.scheduled_posts(id) on delete set null,
  platform public.social_platform not null,
  external_post_id text not null,
  permalink text,
  published_at timestamptz not null default now(),
  unique (platform, external_post_id)
);
create index published_posts_campaign_idx on public.published_posts(campaign_id, published_at desc);

-- ---------------------------------------------------------------------
-- Links rastreados e analytics
-- ---------------------------------------------------------------------
create table public.tracked_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  slug text not null unique check (slug ~ '^[a-zA-Z0-9_-]{4,32}$'),
  destination_url text not null check (destination_url ~ '^https://'),
  clicks_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index tracked_links_campaign_idx on public.tracked_links(campaign_id);

create table public.analytics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  published_post_id uuid references public.published_posts(id) on delete cascade,
  tracked_link_id uuid references public.tracked_links(id) on delete cascade,
  metric text not null check (metric in ('views','reach','likes','comments','shares','saves','clicks','conversions','revenue_cents')),
  value numeric not null,
  source text not null,
  data_quality public.data_quality not null default 'verified',
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index analytics_campaign_metric_idx on public.analytics(campaign_id, metric, measured_at desc);
create index analytics_user_idx on public.analytics(user_id, measured_at desc);

-- ---------------------------------------------------------------------
-- Agentes de IA, tarefas e decisões
-- ---------------------------------------------------------------------
create table public.ai_agents (
  code text primary key,
  name text not null,
  description text not null,
  pipeline_order smallint not null unique,
  enabled boolean not null default true
);

create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  agent_code text not null references public.ai_agents(code),
  status public.task_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- evita execução duplicada da mesma tarefa enquanto ela estiver aberta
create unique index agent_tasks_dedupe_open
  on public.agent_tasks(dedupe_key)
  where dedupe_key is not null and status in ('queued','running');
create index agent_tasks_queue_idx on public.agent_tasks(status, run_after);
create index agent_tasks_user_idx on public.agent_tasks(user_id, created_at desc);
create trigger trg_agent_tasks_updated before update on public.agent_tasks
  for each row execute function public.set_updated_at();

create table public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  task_id uuid references public.agent_tasks(id) on delete set null,
  agent_code text not null references public.ai_agents(code),
  decision text not null,
  justification text not null,
  sources jsonb not null default '[]'::jsonb,
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  analyzed_at timestamptz not null default now(),
  observed_result text,
  created_at timestamptz not null default now()
);
create index agent_decisions_user_idx on public.agent_decisions(user_id, created_at desc);
create index agent_decisions_campaign_idx on public.agent_decisions(campaign_id, created_at desc);

-- ---------------------------------------------------------------------
-- Limites de uso e notificações
-- ---------------------------------------------------------------------
create table public.usage_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period_start date not null default date_trunc('month', now())::date,
  max_campaigns integer not null default 3,
  max_ai_requests integer not null default 300,
  max_contents integer not null default 120,
  used_ai_requests integer not null default 0,
  used_contents integer not null default 0,
  unique (user_id, period_start)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------
-- Log de auditoria (somente leitura para o dono)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_user_idx on public.audit_logs(user_id, created_at desc);

-- =====================================================================
-- Dados de catálogo (reais: agentes e fontes, sem dados de produto)
-- =====================================================================
insert into public.ai_agents (code, name, description, pipeline_order) values
 ('product_hunter','Product Hunter','Pesquisa produtos com sinais de demanda em marketplaces e redes de afiliados autorizadas.',1),
 ('product_selector','Product Selector','Compara produtos e calcula a pontuação de oportunidade, separando dados verificados, estimados e indiretos.',2),
 ('audience_intelligence','Audience Intelligence','Identifica público, dores, interesses e cria personas comerciais.',3),
 ('strategy_builder','Strategy Builder','Define posicionamento, ângulos de venda, formatos e calendário.',4),
 ('creative_generator','Creative Generator','Cria roteiros, títulos, legendas, CTAs e carrosséis por plataforma.',5),
 ('distribution_manager','Distribution Manager','Organiza e publica por APIs oficiais, registrando o status de cada post.',6),
 ('performance_optimizer','Performance Optimizer','Analisa métricas reais e recomenda ajustes na estratégia.',7);

insert into public.product_sources (code, name, kind, requires_credentials, docs_url) values
 ('mercadolivre','Mercado Livre','marketplace',true,'https://developers.mercadolivre.com.br/'),
 ('shopee','Shopee Afiliados','affiliate_network',true,'https://affiliate.shopee.com.br/'),
 ('amazon_br','Amazon Associados (BR)','affiliate_network',true,'https://associados.amazon.com.br/'),
 ('hotmart','Hotmart','affiliate_network',true,'https://developers.hotmart.com/'),
 ('manual','Informado pelo usuário','manual',false,null);

-- =====================================================================
-- Novo usuário: cria users, profile, assinatura pendente e limites
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.profiles (id, full_name, lgpd_consent_at)
    values (new.id,
            left(coalesce(new.raw_user_meta_data->>'full_name',''),120),
            case when (new.raw_user_meta_data->>'lgpd_consent') = 'true' then now() end);
  insert into public.subscriptions (user_id) values (new.id);
  insert into public.usage_limits (user_id) values (new.id);
  insert into public.audit_logs (user_id, action, entity, entity_id)
    values (new.id, 'signup', 'users', new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auditoria de mudanças de status de campanha
create or replace function public.audit_campaign_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, action, entity, entity_id, details)
      values (new.user_id, 'campaign_created', 'campaigns', new.id, jsonb_build_object('status', new.status));
  elsif new.status is distinct from old.status then
    insert into public.audit_logs (user_id, action, entity, entity_id, details)
      values (new.user_id, 'campaign_status_changed', 'campaigns', new.id,
              jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

create trigger trg_campaigns_audit after insert or update on public.campaigns
  for each row execute function public.audit_campaign_status();

-- Limite de campanhas abertas por usuário (controle de custos)
create or replace function public.enforce_campaign_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lim integer;
  open_count integer;
begin
  select max_campaigns into lim from public.usage_limits
    where user_id = new.user_id order by period_start desc limit 1;
  select count(*) into open_count from public.campaigns
    where user_id = new.user_id and status <> 'ended';
  if lim is not null and open_count >= lim then
    raise exception 'Limite de % campanhas ativas atingido', lim using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_campaigns_limit before insert on public.campaigns
  for each row execute function public.enforce_campaign_limit();

-- =====================================================================
-- RLS — um usuário só acessa os próprios dados
-- =====================================================================
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.campaigns enable row level security;
alter table public.product_sources enable row level security;
alter table public.products enable row level security;
alter table public.product_scores enable row level security;
alter table public.audiences enable row level security;
alter table public.strategies enable row level security;
alter table public.content_assets enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_account_secrets enable row level security;
alter table public.scheduled_posts enable row level security;
alter table public.published_posts enable row level security;
alter table public.analytics enable row level security;
alter table public.tracked_links enable row level security;
alter table public.ai_agents enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.agent_decisions enable row level security;
alter table public.usage_limits enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Catálogos: leitura para autenticados
create policy "catalog read" on public.ai_agents for select to authenticated using (true);
create policy "catalog read" on public.product_sources for select to authenticated using (true);

-- users / profiles
create policy "own user read" on public.users for select to authenticated using (id = auth.uid());
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Somente leitura para o dono (escrita apenas pelo backend com service role / webhooks)
create policy "own read" on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.payments for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.usage_limits for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.audit_logs for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.agent_decisions for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.product_scores for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.published_posts for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.analytics for select to authenticated using (user_id = auth.uid());
create policy "own read" on public.social_accounts for select to authenticated using (user_id = auth.uid());

-- agent_tasks: dono lê e enfileira (só em campanha própria); execução é do worker
create policy "own read" on public.agent_tasks for select to authenticated using (user_id = auth.uid());
create policy "own enqueue" on public.agent_tasks for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'queued' and attempts = 0
    and (campaign_id is null or exists (
      select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  );

-- notifications: dono lê e marca como lida
create policy "own read" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "own mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- campaigns: CRUD do dono
create policy "own all" on public.campaigns for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tabelas ligadas a campanha: CRUD do dono, e a campanha precisa ser dele
create policy "own all" on public.products for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (campaign_id is null or exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid())));
create policy "own all" on public.audiences for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "own all" on public.strategies for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "own all" on public.content_assets for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "own all" on public.scheduled_posts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "own all" on public.tracked_links for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists
    (select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()));

-- social_account_secrets: RLS ligado e nenhuma política => inacessível pelo cliente.

-- Privilégios mínimos para a role anônima
revoke all on all tables in schema public from anon;
