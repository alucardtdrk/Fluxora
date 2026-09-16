# Automation Control Center - Deploy no Vercel

Esta versão foi adaptada para Vercel. O frontend Vite é publicado como conteúdo estático e a integração com o n8n roda em uma Function server-side (`api/index.ts`). A `N8N_API_KEY` nunca é enviada ao navegador.

## 1. Environment Variables

No projeto do Vercel, abra **Settings > Environment Variables** e configure para **Production**:

- `N8N_BASE_URL` = `https://n8n-adm.saipos.center`
- `N8N_API_KEY` = chave da API do n8n
- `N8N_MAX_PAGES` = `20` (ajuste se necessário)
- `CRON_SECRET` = segredo longo e aleatório usado pela Vercel para autenticar a rotina diária
- `FLUXORA_SYNC_SECRET` = segredo longo e aleatório para acionamentos administrativos do sincronizador
- `APP_ACCESS_PASSWORD` = senha de acesso ao portal
- `JWT_SECRET` = segredo longo e aleatório para assinar a sessão
- `CONTROL_ACTIONS_ENABLED` = `false` inicialmente

Depois de validar o portal, altere `CONTROL_ACTIONS_ENABLED=true` se quiser permitir ativar/desativar workflows diretamente pelo site.

## 2. Deploy

Na pasta do projeto:

```cmd
vercel --prod
```

Se já estiver vinculado ao projeto correto:

```cmd
vercel --prod --force
```

## 3. Build

O Vercel usa o `vercel.json` deste projeto:

- Framework: Vite
- Build: `pnpm build:vercel`
- Output: `dist/public`
- API: `api/index.ts`
- Cron de produção: `/api/internal/sync-n8n`, diariamente às `03:00 UTC`

O Cron Job só roda em deployments de produção. Sem `CRON_SECRET`, o endpoint recusa a execução automática por segurança.

## 4. Segurança

Não crie `VITE_N8N_API_KEY` ou `NEXT_PUBLIC_N8N_API_KEY`. Variáveis com prefixo público podem ser incorporadas ao bundle do navegador.

O portal agora possui uma tela de login própria. A sessão fica em cookie HttpOnly assinado pelo servidor.

## 5. Teste pós-deploy

1. Acesse a URL do Vercel.
2. Entre com `APP_ACCESS_PASSWORD`.
3. Confirme que Visão geral, Workflows, Execuções, Erros e Analytics carregam.
4. Abra `/api/health` e confirme retorno `ok: true`.
5. Valide os números contra o n8n.
6. Só depois habilite `CONTROL_ACTIONS_ENABLED=true` se quiser liberar ações administrativas.

## Observação sobre volume

A integração percorre a paginação do n8n usando `nextCursor`, até `N8N_MAX_PAGES`. Cada página da API contém até 250 registros. Use um limite adequado ao volume da sua instância para evitar Function muito longa.
