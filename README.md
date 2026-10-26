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
| `JWT_SECRET` | Sim | Segredo longo e aleatório para assinar a sessão. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sim | Credenciais do cliente OAuth Google, do tipo aplicação Web. |
| `GOOGLE_ALLOWED_DOMAIN` | Recomendada | Domínio corporativo permitido no login, sem `@`. |
| `GOOGLE_REDIRECT_URI` | Opcional | Callback fixo; quando omitido, usa a origem da aplicação e `/api/auth/google/callback`. |
| `APP_BASE_URL` | Recomendada em produção | Origem pública HTTPS da aplicação. Localmente, use a origem local ou deixe vazia. |
| `FLUXORA_ADMIN_EMAILS` | Sim | E-mails dos administradores iniciais, separados por vírgula. |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | Sim | Conta de serviço do Firestore para acessos, auditoria e histórico. |
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

O login local e o da Vercel usam as mesmas rotas Google de `server/googleOAuth.ts`. Cadastre no cliente OAuth os callbacks de cada ambiente, por exemplo `http://localhost:3000/api/auth/google/callback` e `https://seu-dominio/api/auth/google/callback`. Se definir `GOOGLE_REDIRECT_URI`, seu valor deve corresponder ao ambiente; não copie o callback de produção para o ambiente local. A porta deve ser a mesma usada pelo servidor.

O usuário precisa ter e-mail verificado e acesso ativo cadastrado no Fluxora, ou estar em `FLUXORA_ADMIN_EMAILS`. Outros usuários são gerenciados por um administrador em Usuários e permissões. O logout limpa o cookie com os mesmos atributos usados no login, inclusive no HTTP local.

## Deploy na Vercel

1. Importe este repositório na Vercel.
2. Mantenha o comando de build como `pnpm build:vercel`, conforme `vercel.json`.
3. Adicione `N8N_BASE_URL` e `N8N_API_KEY` em **Project Settings → Environment Variables** para os ambientes necessários.
4. Configure o OAuth Google, os administradores iniciais e o Firestore conforme a tabela acima.
5. Faça um novo deploy. A auditoria usa o índice automático de `createdAt` e não exige novos índices compostos; mantenha a indexação automática desse campo habilitada.

O arquivo `vercel.json` direciona as rotas principais da API para `api/index.ts`. Os dois servidores compartilham o login Google e os procedimentos tRPC. O frontend é servido a partir de `dist/public`.

## Segurança

A chave do n8n é usada exclusivamente pelo backend no header `X-N8N-API-KEY`. Os procedimentos operacionais tRPC e a rota legada `/api/logs` exigem acesso ativo. A rota legada usa `Cache-Control: private, no-store`, sem cache compartilhado de dados operacionais.

## Estado atual

A visão geral informa falhas de atualização, dados desatualizados e o horário da última consulta bem-sucedida. Operações recusadas são registradas como falhas na auditoria. A auditoria consulta o período no Firestore usando a ordenação automática por `createdAt` e pelo caminho do documento como desempate, sem novos índices compostos. Categoria, resultado e texto são filtrados no servidor, com páginas de 50 eventos e até 1.000 registros examinados por requisição. O botão Continuar busca permite avançar no histórico sem declarar uma busca incompleta como concluída. Filtros muito específicos podem exigir mais leituras e mais etapas de busca.
