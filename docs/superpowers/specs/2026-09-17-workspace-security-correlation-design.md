# Workspace Security: correlação programada

## Objetivo

Ampliar o Fluxora para dar visibilidade centralizada e acionável sobre riscos do Google Workspace. A solução consolida evidências de Alert Center, login, administração, OAuth e Drive, correlaciona sinais relacionados e apresenta achados priorizados no painel Workspace Security.

Esta etapa não envia notificações nem altera dados do Google Workspace. Ela prepara o modelo de achados para que notificações possam ser incluídas posteriormente sem reprocessar eventos históricos.

## Restrições

- A integração permanece somente leitura.
- O projeto usa Vercel no plano gratuito; não haverá processamento contínuo ou em tempo real.
- A correlação roda em cada sincronização: pelo cron diário existente e pela sincronização manual.
- O Fluxora só persiste campos seguros e curtos. Corpos de e-mail, anexos e payloads brutos não são armazenados nem exibidos.
- A retenção de um achado acompanha a retenção das evidências que o sustentam.

## Fontes de evidência

Os cinco grupos já integrados permanecem como origem dos eventos:

1. Alert Center, incluindo phishing, malware e alertas de identidade.
2. Relatórios de login, com usuário, IP, país e tentativas suspeitas quando fornecidos.
3. Relatórios administrativos, incluindo alterações relevantes de privilégios e configurações.
4. Relatórios OAuth, incluindo autorizações de aplicativos.
5. Relatórios do Drive, incluindo mudanças de acesso e compartilhamento quando fornecidos.

Para alertas de phishing, o normalizador extrai e exibe campos seguros que o Google disponibilizar: usuário reportante, remetente suspeito, assunto resumido, destinatários, links ou arquivos sinalizados. Campos indisponíveis aparecem como “Não disponibilizado pelo Google”.

## Modelo de achado

Um `WorkspaceSecurityFinding` é separado de um evento bruto e contém:

- identificador estável;
- regra de detecção e severidade;
- título e explicação do risco;
- usuários e IPs envolvidos;
- janela de tempo analisada;
- identificadores dos eventos de origem;
- primeira e última ocorrência;
- contagem de evidências e data de expiração.

O identificador é derivado da regra, dos envolvidos e da janela de correlação. Isso atualiza um achado recorrente em vez de criar duplicatas a cada sincronização.

## Regras iniciais de correlação

As regras são determinísticas e vivem no código nesta etapa:

1. **Tentativas de login distribuídas:** múltiplas falhas de login para o mesmo usuário em IPs ou países diferentes dentro de uma janela curta.
2. **Login suspeito seguido de OAuth:** login suspeito e autorização OAuth para o mesmo usuário na mesma janela.
3. **Mudança administrativa seguida de atividade anormal:** ação administrativa sensível acompanhada de login suspeito ou alerta de identidade relacionado.
4. **Risco no Drive após sinal de identidade:** mudança de acesso ou compartilhamento no Drive após sinal de login, OAuth ou identidade para o mesmo usuário.
5. **Campanha de phishing ou malware recorrente:** alertas equivalentes associados ao mesmo usuário, remetente ou domínio em uma janela de análise.

Cada regra só produz um achado quando há evidência suficiente. Eventos únicos continuam visíveis na lista de eventos e não são tratados como correlação confirmada.

## Fluxo de dados

1. A sincronização coleta e normaliza os eventos das cinco fontes.
2. Os eventos seguros são gravados no repositório existente.
3. O correlacionador consulta eventos dentro da janela necessária, avalia as regras e grava ou atualiza os achados.
4. O endpoint do dashboard retorna eventos, postura do domínio e achados.
5. A interface apresenta uma área “Requer atenção”, filtros e o detalhe de cada achado com a linha do tempo das evidências relacionadas.

Falhas de uma fonte atualizam o status da integração; não criam achados de segurança, evitando falsos positivos.

## Interface

A página Workspace Security passa a ter:

- contadores de achados críticos/altos e eventos recentes;
- lista filtrável de achados por severidade, origem, usuário e período;
- detalhe de achado com explicação da regra, envolvidos, intervalo e evidências relacionadas;
- eventos de origem clicáveis, preservando o painel atual de detalhes;
- campos ausentes identificados explicitamente como indisponíveis no Google.

Os dados brutos de metadata seguem excluídos da interface.

## Notificações futuras

Notificações ficam fora do escopo desta implementação. Quando forem adicionadas, consumirão os achados deduplicados e suas severidades, com canal e destinatários configuráveis. A coleta e a correlação não dependerão do canal escolhido.

## Tratamento de erros e testes

- A ausência de um campo opcional do Google não interrompe a sincronização.
- Eventos inválidos continuam sendo ignorados de forma segura.
- Cada regra de correlação terá testes para cenário positivo, ausência de evidências e deduplicação.
- Os normalizadores terão testes para os campos seguros de phishing.
- Dashboard e interface serão verificados para os estados vazio, erro e achado com detalhes.

## Critérios de sucesso

- Uma sincronização manual ou diária produz achados consistentes para os cinco grupos de evidência.
- Achados repetidos são atualizados, não duplicados.
- O usuário consegue entender por que um achado foi criado e abrir os eventos que o compõem.
- Nenhum conteúdo integral de e-mail, anexo ou payload bruto é persistido ou exibido.
