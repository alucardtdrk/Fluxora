# Auditoria de segurança do Google Workspace no Fluxora

## Objetivo

Adicionar ao Fluxora um módulo consultivo de segurança para o Google Workspace Enterprise Plus. O módulo deve coletar sinais disponibilizados pelo Google, preservar evidências, correlacionar eventos e apresentar incidentes priorizados sem executar ações administrativas no domínio.

## Escopo inicial

O módulo deve:

- consultar o Google Workspace a cada 15 minutos;
- detectar sinais de comprometimento, abuso, vazamento e alterações sensíveis;
- agrupar eventos relacionados em incidentes acionáveis;
- preservar eventos detalhados por 6 meses;
- preservar incidentes, decisões e indicadores consolidados sem expiração automática;
- funcionar inteiramente pelo backend da Vercel e pelo Firestore;
- operar exclusivamente com permissões de leitura.

O módulo não deve:

- suspender contas;
- revogar sessões ou tokens OAuth;
- alterar configurações do Workspace;
- remover compartilhamentos;
- executar qualquer resposta automática;
- coletar, mostrar ou usar eventos de redefinição de senha de superadministrador.

## Arquitetura

```text
Google Workspace APIs
        |
        v
Coleta incremental na Vercel (15 minutos)
        |
        v
Normalização, deduplicação e classificação
        |
        v
Firestore: eventos, cursores, incidentes e indicadores
        |
        v
Painel de segurança do Fluxora
```

### Serviços Google

- Alert Center API para alertas de segurança detectados pelo Google.
- Admin SDK Reports API para atividades de login, administração, Drive, OAuth Token e dispositivos quando disponíveis.
- Admin SDK Directory API para usuários, grupos, administradores, unidades organizacionais e postura de conta.
- Fontes do Security Center e DLP disponíveis para a edição Enterprise Plus e acessíveis pelas APIs autorizadas.

Uma conta de serviço com delegação em todo o domínio representará uma conta administrativa dedicada. Cada escopo OAuth deve ser somente leitura e limitado às fontes realmente usadas.

### Execução na Vercel

Um Cron Job chamará um endpoint protegido a cada 15 minutos. O endpoint iniciará coletores independentes por fonte. A falha de uma fonte não interromperá as demais. Cada coletor terá limite de duração, paginação, repetição com espera progressiva e cursor próprio.

O endpoint do agendamento exigirá segredo compartilhado da Vercel. Chamadas manuais continuarão restritas a administradores autenticados no Fluxora.

## Modelo de dados

### Evento de segurança

Cada evento normalizado conterá:

- identificador interno determinístico;
- identificador e origem do Google;
- categoria e tipo do evento;
- data do evento e data da coleta;
- usuário ou entidade afetada;
- ator responsável, quando disponível;
- IP, dispositivo e localização informados pelo Google;
- aplicativo, arquivo ou recurso relacionado;
- gravidade original e gravidade calculada;
- evidências sanitizadas;
- referência ao incidente relacionado;
- data de expiração seis meses após o evento.

O identificador determinístico combinará origem e identificador original. Quando a fonte não fornecer identificador estável, será usada uma impressão digital dos campos imutáveis. Reprocessar uma página não poderá duplicar eventos.

### Cursor de coleta

Cada fonte manterá separadamente:

- último cursor ou token de página;
- última janela temporal concluída;
- última execução iniciada e concluída;
- estado da execução;
- quantidade processada e salva;
- mensagem sanitizada do último erro.

O cursor só avançará depois que a página correspondente estiver preservada com sucesso.

### Incidente

Um incidente conterá:

- impressão digital de agrupamento;
- título e resumo em linguagem clara;
- gravidade;
- status: novo, reconhecido, investigando ou resolvido;
- responsável interno;
- usuários e recursos afetados;
- primeira e última ocorrência;
- quantidade de eventos relacionados;
- evidências e linha do tempo;
- ação recomendada;
- observações e histórico de tratamento.

Os incidentes reutilizarão o ciclo de vida já existente no Fluxora.

## Detecções iniciais

- login suspeito, bloqueado ou programático suspeito;
- possível senha vazada;
- phishing, malware e spam;
- conta suspensa por atividade suspeita;
- dispositivo comprometido ou atividade suspeita em dispositivo;
- concessão ou remoção de privilégio administrativo;
- alterações sensíveis de SSO;
- novo acesso OAuth ou comportamento OAuth potencialmente arriscado;
- exportação de dados do domínio;
- compartilhamento externo incomum;
- volume incomum de download, cópia ou movimentação no Drive;
- violação de DLP;
- possível ransomware;
- sequência anormal de eventos relacionados ao mesmo usuário.

Eventos de redefinição de senha de superadministrador serão descartados antes da persistência e nunca participarão das regras.

## Classificação e correlação

A classificação combinará a gravidade fornecida pelo Google com regras do Fluxora. Sinais críticos conhecidos pelo Google permanecerão críticos. Repetição, quantidade de usuários afetados, privilégio administrativo, compartilhamento externo e combinação de múltiplos sinais poderão elevar a prioridade.

O agrupamento usará tipo de detecção, usuário ou recurso afetado e uma janela temporal adequada à regra. Eventos individuais permanecerão acessíveis como evidência, mesmo quando agrupados.

O sistema deve informar se uma conclusão veio diretamente do Google ou se foi inferida por uma regra do Fluxora.

## Experiência no produto

### Visão de segurança

- nível geral de risco;
- incidentes novos, críticos e atrasados;
- usuários afetados;
- logins suspeitos;
- ameaças de e-mail;
- riscos de Drive e OAuth;
- estado e horário da última coleta.

### Central de incidentes

- ordenação por gravidade, atraso e recorrência;
- filtros por categoria, status, usuário e período;
- responsável e próxima ação;
- abertura das evidências sem sair do incidente;
- reconhecimento, investigação, resolução e notas internas.

### Atividades e evidências

- linha do tempo pesquisável;
- filtros por usuário, IP, dispositivo, aplicativo, recurso e evento;
- indicação clara de dados fornecidos pelo Google e inferências do Fluxora;
- acesso condicionado ao perfil do usuário no Fluxora.

### Postura de segurança

- contas sem verificação em duas etapas, quando a fonte fornecer esse estado;
- administradores e atribuições de função;
- aplicativos OAuth;
- compartilhamentos externos;
- usuários inativos;
- configurações que merecem revisão.

## Segurança e privacidade

- credenciais somente em variáveis protegidas da Vercel;
- nenhum segredo ou token enviado ao navegador;
- escopos OAuth mínimos e somente leitura;
- evidências sanitizadas antes da gravação;
- controle de acesso por função no backend;
- registro de consultas sensíveis na auditoria do Fluxora;
- mensagens de erro sem credenciais ou conteúdo privado;
- expiração automática dos eventos detalhados após 6 meses.

Os dados resumidos e incidentes não devem conservar conteúdo bruto desnecessário. Alterar futuramente a retenção para 12 meses deve exigir apenas configuração, sem migração do modelo.

## Falhas e recuperação

- coletores executados de forma independente;
- repetição com espera progressiva para limites e falhas transitórias;
- preservação do cursor quando uma página falhar;
- estado parcial quando apenas algumas fontes concluírem;
- alerta quando uma fonte ficar sem sucesso por mais de dois ciclos;
- indicação de coleta atrasada após 45 minutos;
- possibilidade de retomada manual por administrador;
- logs estruturados por execução, fonte e identificador de requisição.

## Observabilidade

O Monitoramento do Fluxora exibirá:

- estado geral da integração;
- última coleta completa;
- duração do último ciclo;
- fontes concluídas, atrasadas ou com falha;
- eventos processados, novos e descartados;
- cursores que não avançam;
- taxa de erro e consumo aproximado da rotina na Vercel.

## Testes e critérios de aceite

A implementação deve incluir testes automatizados para:

- geração e assinatura do token de acesso;
- escopos exclusivamente de leitura;
- paginação e retomada por cursor;
- deduplicação de eventos;
- exclusão dos eventos de redefinição de senha de superadministrador;
- normalização de cada fonte;
- classificação e elevação de risco;
- agrupamento de incidentes;
- falha parcial entre coletores;
- retenção de 6 meses;
- autorização das rotas;
- ausência de métodos de alteração do Google Workspace.

Antes do deploy, uma validação real em ambiente de produção deve confirmar:

- autenticação bem-sucedida com a conta delegada;
- leitura de cada fonte autorizada;
- ausência de duplicação após duas coletas consecutivas;
- retomada correta depois de uma falha simulada;
- visibilidade das informações somente para os perfis permitidos;
- endpoint agendado protegido;
- nenhuma ação de escrita disponível no código ou nos escopos configurados.

## Entrega incremental

1. Fundação: autenticação Google, modelos, cursores e estado da integração.
2. Coleta: Alert Center, Login, Admin, OAuth, Drive e Directory.
3. Detecção: normalização, classificação, correlação e retenção.
4. Produto: visão de segurança, incidentes, evidências e postura.
5. Operação: Cron de 15 minutos, observabilidade, testes reais e deploy.

O uso de Pub/Sub e ações administrativas fica reservado para uma evolução posterior e não faz parte desta primeira versão.
