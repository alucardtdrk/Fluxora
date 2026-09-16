# Automation Control Center

Interface operacional para monitorar e operar automações n8n com clareza, segurança e contexto. A aplicação consulta a API nativa do n8n exclusivamente no servidor, preservando a URL e a chave de API fora do navegador.

## Stack

O projeto usa React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide, Recharts, Express e tRPC. O mesmo app pode rodar localmente pelo servidor Express do projeto ou como função Node.js na Vercel.

## Variáveis de ambiente

Configure as variáveis abaixo no ambiente do servidor. **Não use o prefixo `VITE_` nas credenciais do n8n**, pois variáveis com esse prefixo podem ser incluídas no bundle do navegador.

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `N8N_BASE_URL` | Sim | URL base da instância n8n, sem a barra final, por exemplo `https://n8n.exemplo.com`. |
| `N8N_API_KEY` | Sim | Chave criada no n8n para autenticar chamadas server-side. |
| `CRON_SECRET` | Em produção | Autentica o ciclo diário de preservação disparado pela Vercel. |
| `FLUXORA_SYNC_SECRET` | Recomendada | Autentica acionamentos administrativos do sincronizador. |
| `DATABASE_URL` | Conforme autenticação | Banco usado pelo template full-stack. |
| `JWT_SECRET` | Conforme autenticação | Assinatura da sessão da aplicação. |
| `VITE_APP_TITLE` | Recomendada | Título da interface. |

Quando as variáveis do n8n não estiverem preenchidas, a interface não tenta usar dados fictícios: apresenta um estado seguro informando que o ambiente ainda precisa ser conectado.

## Desenvolvimento local

Instale as dependências e inicie o servidor:

```bash
pnpm install
pnpm dev
```

Valide o projeto com:

```bash
pnpm check
pnpm test
pnpm build
```

## Deploy na Vercel

1. Importe este repositório na Vercel.
2. Mantenha o comando de build como `pnpm build`.
3. Adicione `N8N_BASE_URL` e `N8N_API_KEY` em **Project Settings → Environment Variables** para os ambientes necessários.
4. Adicione também as variáveis do template de autenticação caso o login corporativo esteja habilitado.
5. Faça um novo deploy.

O arquivo `vercel.json` direciona chamadas `/api/*` para `api/index.ts`, que inicializa o mesmo backend Express usado localmente. O frontend é servido a partir de `dist/public`.

## Segurança

A chave do n8n só é lida em `server/n8n.ts` e enviada no header `X-N8N-API-KEY` a partir do backend. O frontend acessa apenas procedimentos tRPC autenticados e nunca recebe `N8N_BASE_URL` ou `N8N_API_KEY`.

## Estado atual

A visão geral, o catálogo de workflows e o histórico de execuções já estão estruturados para consumir dados reais do n8n. Os estados de carregamento, ausência de dados e n8n não configurado são tratados explicitamente. A extensão para detalhes de execução, ativação/desativação de workflows e alertas pode seguir o mesmo contrato server-side sem alterar a segurança da integração.
