# ORGANIC ADS AI — Etapa 1 (Fundação)

SaaS de marketing orgânico autônomo. Next.js 15 (App Router, TypeScript, Tailwind 4) + Supabase (Postgres, Auth, RLS).

## O que esta etapa entrega
- Página inicial, cadastro (com consentimento LGPD), login, recuperação e redefinição de senha.
- Proteção de rotas: middleware + verificação no servidor em todas as páginas de `/app`.
- Onboarding de campanha em 7 passos (objetivo, mercado, nicho ou IA, produto ou IA, plataformas, tráfego orgânico, confirmação).
- Campanhas: listar, ver, editar, pausar, retomar e encerrar, com histórico.
- Painel com indicadores lidos do banco e a seção **MINHA IA DE MARKETING** (estado real das tarefas dos 7 agentes, próximos passos e decisões).
- Banco: 21 tabelas do item 9 + `social_account_secrets` e `audit_logs`, índices, RLS em todas, limites de uso, idempotência de webhooks e de tarefas.

## Rodar localmente
```bash
npm install
cp .env.example .env.local   # preencha com os dados do Supabase
npm run dev
```

## Configurar o Supabase (camada gratuita)
1. Crie um projeto em https://supabase.com (plano Free).
2. SQL Editor → cole e execute `supabase/migrations/0001_fundacao.sql`.
3. Authentication → URL Configuration: Site URL = URL do app; Redirect URLs: `https://SEU-DOMINIO/auth/confirm`.
4. Authentication → Email Templates (Confirm signup e Reset password): troque o link por
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}&next={{ .RedirectTo }}`
   (ou mantenha o padrão: a rota também aceita `?code=`).
5. Project Settings → API: copie `Project URL` e `anon public key` para `.env.local`.

## Hospedagem gratuita com uso comercial
A Vercel Hobby proíbe uso comercial. Recomendado: **Cloudflare Workers** (plano Free) com o adaptador OpenNext:
```bash
npm i -D @opennextjs/cloudflare wrangler
npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy
```
Configure as mesmas variáveis `NEXT_PUBLIC_*` no painel da Cloudflare.

## Testes
```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm run build       # build de produção
npm run test:db     # aplica a migração num Postgres em memória e testa RLS/isolamento
```

## Credenciais por etapa
| Etapa | Serviço | Credencial |
|---|---|---|
| 1 | Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| 2 | Google AI Studio (Gemini, grátis) ou Groq | `GEMINI_API_KEY` ou `GROQ_API_KEY` |
| 2 | Mercado Livre Developers | App ID + Client Secret (OAuth) |
| 2 | Shopee Afiliados (Open API) | App ID + Secret (requer aprovação no programa) |
| 2 | Amazon Associados BR (PA-API 5) | Access Key, Secret Key, Partner Tag (exige 3 vendas qualificadas em 180 dias) |
| 4 | Supabase | `SUPABASE_SERVICE_ROLE_KEY` (só no servidor/worker) |
| 4 | Meta (Instagram Graph API) | App ID + App Secret; conta Instagram Profissional ligada a Página do Facebook; revisão do app para `instagram_content_publish` |
| 4 | TikTok Content Posting API | Client Key + Client Secret; app aprovado em auditoria para publicar como público |
| 4 | YouTube Data API v3 | OAuth Client ID + Secret (Google Cloud) |
| 5 | Mercado Pago | Access Token, Public Key, segredo de assinatura do webhook |

## Publicação (Cloudflare Workers, gratuito)
- Projeto Supabase: `cjrhkmrgrqfiotjklgco` (sa-east-1), migração 0001 aplicada.
- Worker: `organic-ads-ai` → https://organic-ads-ai.organic-ads-ai.workers.dev
- Deploy automático pelo Workers Builds (conectado a este repositório):
  - Comando de build: `npx opennextjs-cloudflare build`
  - Comando de deploy: `npx wrangler deploy`
- Variáveis públicas em `.env.production` (URL e anon key; seguras por causa da RLS).
- Manual: `npm run cf:deploy` com `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
