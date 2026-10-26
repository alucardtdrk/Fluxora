# Automation Control Center - Deploy no Vercel

Esta versão foi adaptada para Vercel. O frontend Vite é publicado como conteúdo estático e a integração com o n8n roda em uma Function server-side (`api/index.ts`). A `N8N_API_KEY` nunca é enviada ao navegador.

## 1. Environment Variables

No projeto do Vercel, abra **Settings > Environment Variables** e configure para **Production**:

- `N8N_BASE_URL` = `https://n8n-adm.saipos.center`
- `N8N_API_KEY` = chave da API do n8n
- `N8N_MAX_PAGES` = `20` (ajuste se necessário)
- `CRON_SECRET` = segredo longo e aleatório usado pela Vercel para autenticar a rotina diária
- `FLUXORA_SYNC_SECRET` = segredo longo e aleatório para acionamentos administrativos do sincronizador
- `JWT_SECRET` = segredo longo e aleatório para assinar a sessão
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` = credenciais OAuth Google do tipo aplicação Web
- `GOOGLE_ALLOWED_DOMAIN` = domínio corporativo permitido, sem `@`
- `APP_BASE_URL` = origem HTTPS pública do Fluxora
- `GOOGLE_REDIRECT_URI` = opcional; se definido, use a origem pública seguida de `/api/auth/google/callback`
- `FLUXORA_ADMIN_EMAILS` = e-mails dos administradores iniciais, separados por vírgula
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` = conta de serviço do Firestore
- `CONTROL_ACTIONS_ENABLED` = `false` inicialmente

Depois de validar o portal, altere `CONTROL_ACTIONS_ENABLED=true` se quiser permitir ativar/desativar workflows diretamente pelo site.

Cadastre o callback HTTPS no cliente OAuth Google. O ambiente local usa o mesmo fluxo, com seu próprio callback, por exemplo `http://localhost:3000/api/auth/google/callback`. Não use uma origem ou um callback de produção nas variáveis locais.

A auditoria não exige novos índices compostos: utiliza a indexação automática de `createdAt`, que deve permanecer habilitada. Categoria, resultado e texto são filtrados em lotes no servidor, com até 1.000 registros examinados por requisição e continuação pelo botão Continuar busca. Filtros muito específicos podem consumir mais leituras. Preserve os índices existentes de outras coleções.

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

O portal usa login Google com e-mail verificado, restrição de domínio quando configurada e verificação de acesso ativo no Fluxora. A sessão fica em cookie HttpOnly assinado pelo servidor. A rota legada `/api/logs` também exige esse acesso e não permite cache compartilhado.

## 5. Teste pós-deploy

1. Acesse a URL do Vercel.
2. Entre com uma conta Google autorizada em `FLUXORA_ADMIN_EMAILS` ou cadastrada e ativa no Fluxora.
3. Confirme que Visão geral, Workflows, Execuções, Erros e Analytics carregam.
4. Abra `/api/health` e confirme retorno `ok: true`.
5. Valide os números contra o n8n.
6. Confirme login e logout, bloqueio de usuário, busca de um evento antigo na auditoria e recusa de `/api/logs` sem sessão.
7. Só depois habilite `CONTROL_ACTIONS_ENABLED=true` se quiser liberar ações administrativas.

## Observação sobre volume

A integração percorre a paginação do n8n usando `nextCursor`, até `N8N_MAX_PAGES`. Cada página da API contém até 250 registros. Use um limite adequado ao volume da sua instância para evitar Function muito longa.

## Resumo diário no Google Chat (opcional)

Configure em Production, sem prefixo `VITE_`:

- `GOOGLE_CHAT_DAILY_SUMMARY_WEBHOOK_URL`: URL completa do webhook do espaço de avisos. É uma credencial; não coloque seu valor no repositório.
- `APP_BASE_URL`: endereço HTTPS público do Fluxora, usado nos links da mensagem.

Sem webhook configurado, nenhum envio ou consulta para o resumo é realizado. O resumo é enviado após o cron existente `/api/internal/sync-google-workspace` (04:00 UTC, 1h de Brasília), inclusive quando a coleta informa falhas. Atualizações manuais da interface não enviam mensagens.

O texto mostra incidentes com ocorrências nos últimos 7 dias, suas resoluções nas últimas 24h, prioridades sem responsável, achados de segurança das últimas 24h e o resultado da coleta. Dados indisponíveis ou parciais são identificados. Não inclui contas, IPs ou conteúdo de erros.

O Firestore registra a mensagem pendente antes da entrega e a marca como enviada apenas após sucesso. Reexecuções no mesmo dia usam a mensagem pendente e o mesmo `requestId` do Google Chat para evitar duplicação. Falhas de entrega não repetem automaticamente a coleta; o resultado fica no log `google_chat_daily_summary`. O envio do dia seguinte gera um novo resumo, sem reenviar automaticamente dias anteriores.
