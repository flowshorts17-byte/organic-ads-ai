// Testa a migração SQL num Postgres real em memória (PGlite) e verifica o isolamento RLS.
// Simula o mínimo do Supabase: schema auth, auth.users, auth.uid() e as roles anon/authenticated.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
let passed = 0;
const ok = (name) => { passed++; console.log("  ✔", name); };
const fail = (name, e) => { console.error("  ✘", name, e?.message ?? e); process.exitCode = 1; };

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`);

const sql = readFileSync(new URL("../supabase/migrations/0001_fundacao.sql", import.meta.url), "utf8")
  // gen_random_uuid() é nativo no Postgres 13+; PGlite não traz a extensão pgcrypto
  .replace(/create extension if not exists pgcrypto;/i, "");
try { await db.exec(sql); ok("migração aplicada sem erros"); } catch (e) { fail("migração", e); process.exit(1); }

await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;
`);

const tables = (await db.query(`select tablename from pg_tables where schemaname='public' order by 1`)).rows.map(r => r.tablename);
const required = ["users","profiles","subscriptions","payments","campaigns","products","product_sources","product_scores","audiences","strategies","content_assets","social_accounts","scheduled_posts","published_posts","analytics","tracked_links","ai_agents","agent_tasks","agent_decisions","usage_limits","notifications"];
const missing = required.filter(t => !tables.includes(t));
missing.length ? fail("21 tabelas do item 9", "faltando: " + missing) : ok("21 tabelas do item 9 existem");

const noRls = (await db.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).rows;
noRls.length ? fail("RLS em todas as tabelas", noRls.map(r=>r.relname)) : ok("RLS ativado em todas as tabelas");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into auth.users (id,email,raw_user_meta_data) values
  ('${A}','a@teste.com','{"full_name":"Ana","lgpd_consent":"true"}'),
  ('${B}','b@teste.com','{"full_name":"Bruno"}')`);
const sub = (await db.query(`select status, price_cents from public.subscriptions where user_id='${A}'`)).rows[0];
sub?.status === "pending_payment" && sub.price_cents === 1790
  ? ok("cadastro cria profile, assinatura pendente (R$ 17,90) e limites")
  : fail("trigger de cadastro", JSON.stringify(sub));

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`); }
}
const campaign = (uid, name) => db.query(
  `insert into public.campaigns (user_id,name,objective,market_country,niche_mode,niche,product_mode,platforms,status)
   values ($1,$2,'affiliate_sales','BR','user_defined','pets','ai_discovery','{instagram}','active') returning id`, [uid, name]);

let campA;
await as(A, async () => {
  campA = (await campaign(A, "Campanha da Ana")).rows[0].id;
  ok("usuário A cria campanha própria");
  try { await campaign(B, "Intrusa"); fail("A não pode criar campanha em nome de B", "inseriu"); }
  catch { ok("A não consegue criar campanha em nome de B"); }
  await db.query(`insert into public.agent_tasks (user_id,campaign_id,agent_code,dedupe_key) values ($1,$2,'product_hunter',$3)`, [A, campA, `hunt:${campA}`]);
  ok("A enfileira tarefa do Product Hunter");
  try { await db.query(`insert into public.agent_tasks (user_id,campaign_id,agent_code,dedupe_key) values ($1,$2,'product_hunter',$3)`, [A, campA, `hunt:${campA}`]); fail("dedupe", "duplicou"); }
  catch { ok("tarefa duplicada é bloqueada (dedupe)"); }
  try { await db.query(`insert into public.agent_tasks (user_id,agent_code,status) values ($1,'product_hunter','succeeded')`, [A]); fail("usuário marcar tarefa como concluída", "permitiu"); }
  catch { ok("usuário não consegue marcar tarefa como concluída"); }
  try { await db.query(`update public.subscriptions set status='active' where user_id=$1`, [A]); 
    const s = (await db.query(`select status from public.subscriptions where user_id=$1`, [A])).rows[0];
    s.status === "pending_payment" ? ok("usuário não consegue ativar a própria assinatura") : fail("assinatura", "ativou"); }
  catch { ok("usuário não consegue ativar a própria assinatura"); }
});

await as(B, async () => {
  const seen = (await db.query(`select count(*)::int n from public.campaigns`)).rows[0].n;
  seen === 0 ? ok("B não vê campanhas de A") : fail("isolamento campaigns", seen);
  const tasks = (await db.query(`select count(*)::int n from public.agent_tasks`)).rows[0].n;
  tasks === 0 ? ok("B não vê tarefas de A") : fail("isolamento agent_tasks", tasks);
  const upd = await db.query(`update public.campaigns set name='hack' where id=$1`, [campA]);
  upd.affectedRows === 0 ? ok("B não consegue editar campanha de A") : fail("update cruzado", upd.affectedRows);
  try { await db.query(`insert into public.content_assets (user_id,campaign_id,kind,body) values ($1,$2,'caption','x')`, [B, campA]); fail("B anexar conteúdo na campanha de A", "permitiu"); }
  catch { ok("B não consegue anexar conteúdo à campanha de A"); }
  const sec = (await db.query(`select count(*)::int n from public.social_account_secrets`)).rows[0].n;
  sec === 0 ? ok("tokens sociais inacessíveis ao cliente") : fail("secrets", sec);
  const agents = (await db.query(`select count(*)::int n from public.ai_agents`)).rows[0].n;
  agents === 7 ? ok("catálogo com os 7 agentes legível") : fail("ai_agents", agents);
});

await as(A, async () => {
  await campaign(A, "Campanha 2"); await campaign(A, "Campanha 3");
  try { await campaign(A, "Campanha 4"); fail("limite de campanhas", "passou"); }
  catch (e) { /Limite/.test(e.message) ? ok("limite de 3 campanhas abertas aplicado") : fail("limite", e); }
  const logs = (await db.query(`select count(*)::int n from public.audit_logs where action='campaign_created'`)).rows[0].n;
  logs === 3 ? ok("auditoria registra criação de campanhas") : fail("audit", logs);
});

console.log(`\n${passed} verificações passaram${process.exitCode ? " — HÁ FALHAS" : ""}.`);
