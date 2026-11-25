# ORGANIC ADS AI — Etapas 1 (Fundação) e 2 (Inteligência)

SaaS de marketing orgânico autônomo. Next.js 15 (App Router, TypeScript, Tailwind 4) + Supabase (Postgres, Auth, RLS).

## O que esta etapa entrega
- Página inicial, cadastro (com consentimento LGPD), login, recuperação e redefinição de senha.
- Proteção de rotas: middleware + verificação no servidor em todas as páginas de `/app`.
- Onboarding de campanha em 7 passos (objetivo, mercado, nicho ou IA, produto ou IA, plataformas, tráfego orgânico, confirmação).
- Campanhas: listar, ver, editar, pausar, retomar e encerrar, com histórico.
- Painel com indicadores lidos do banco e a seção **MINHA IA DE MARKETING** (estado real das tarefas dos 7 agentes, próximos passos e decisões).
- Banco: 21 tabelas do item 9 + `social_account_secrets` e `audit_logs`, índices, RLS em todas, limites de uso, idempotência de webhooks e de tarefas.

## Etapa 2 — Inteligência
- **Processador de agentes**: `claim_agent_task` (atômico, `skip locked`) + Cron Trigger da Cloudflare a cada 2 minutos (`worker.ts` → `POST /api/agents/run`) + botão **Processar agora** na campanha. Tentativas com espera de 2/4/8 min para erros temporários (limite 429 do Gemini, instabilidade).
- **Pipeline**: Product Hunter → Product Selector → Audience Intelligence → Strategy Builder. Creative Generator entra na Etapa 3.
- **Produtos reais apenas**: produto informado pelo usuário (formulário na campanha) e mais vendidos da categoria no **Mercado Livre** (API oficial, opcional). A IA nunca cria produtos, preços ou vendas; sem fonte real, a tarefa termina pedindo produtos ao usuário.
- **Pontuação 0–100** (`src/lib/agents/scoring.ts`): média ponderada só dos sinais existentes — demanda (posição nos mais vendidos, verificada), comissão e avaliações (verificadas quando informadas), concorrência e aderência (estimadas pelo Gemini). Cada pontuação guarda confiança, qualidade do dado e o detalhamento.
- **Público e estratégia**: Gemini com saída JSON validada por zod; tudo marcado como inferência, com justificativa e confiança (máx. 70%).
- **Decisões**: cada agente registra decisão, justificativa, fontes (com link) e confiança em `agent_decisions`.
- **Limite de custo**: cada chamada ao Gemini desconta 1 de `usage_limits.max_ai_requests` (300/mês por usuário).
- Migração: `supabase/migrations/0002_inteligencia.sql` (rodar depois da 0001).

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
npm run test:db     # aplica as migrações num Postgres em memória e testa RLS, isolamento e a fila de agentes
npm run test:score  # testa a fórmula de pontuação
```

## Credenciais por etapa
| Etapa | Serviço | Credencial |
|---|---|---|
| 1 | Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| 2 | Google AI Studio (Gemini, grátis) | `GEMINI_API_KEY` (opcional `GEMINI_MODEL`) |
| 2 | Supabase | `SUPABASE_SERVICE_ROLE_KEY` (secret no Worker) |
| 2 | Cron do processador | `AGENTS_CRON_SECRET` (texto aleatório) |
| 2 | Mercado Livre Developers (opcional) | `ML_CLIENT_ID`, `ML_CLIENT_SECRET` |
| 2 | Shopee Afiliados (Open API) | App ID + Secret (requer aprovação no programa) |
| 2 | Amazon Associados BR (PA-API 5) | Access Key, Secret Key, Partner Tag (exige 3 vendas qualificadas em 180 dias) |
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
