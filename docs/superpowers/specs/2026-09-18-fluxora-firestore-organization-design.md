# Organização compatível do Firestore do Fluxora

## Objetivo

Reorganizar exclusivamente as coleções que pertencem ao Fluxora sob um único documento raiz no Firestore, preservando os dados existentes e mantendo o painel disponível durante a transição.

## Escopo estrito

Somente estas coleções existentes podem ser lidas, copiadas ou alteradas pelo processo:

- `fluxora_alert_rules`
- `fluxora_audit_events`
- `fluxora_incidents`
- `fluxora_notification_state`
- `fluxora_slos`
- `fluxora_system`
- `fluxora_users`
- `fluxora_workspace_directory_posture`
- `fluxora_workspace_security_events`
- `fluxora_workspace_security_findings`
- `fluxora_workspace_sync_state`

Nenhuma outra coleção, documento, pasta ou informação do Firestore será consultada, modificada, movida ou excluída.

## Estrutura de destino

Todos os dados do Fluxora ficam abaixo do documento `fluxora/data`:

```text
fluxora/data/
├── users
├── audit-events
├── alert-rules
├── incidents
├── notification-state
├── slos
├── system
└── workspace/
    ├── directory-posture
    ├── security-events
    ├── security-findings
    └── sync-state
```

Cada item acima é uma subcoleção Firestore; os IDs e conteúdos dos documentos são preservados.

## Estratégia de transição compatível

1. O código passa a oferecer caminhos legado e destino somente para a lista explícita de coleções do Fluxora.
2. Escritas novas são duplicadas no caminho legado e no novo durante a migração.
3. A migração administrativa copia documentos em lotes idempotentes, preservando o mesmo ID no destino.
4. Leituras consultam o novo caminho primeiro e usam o legado somente quando o documento ou consulta correspondente ainda não estiver no destino.
5. A verificação compara contagem e IDs por coleção entre origem e destino.
6. Após confirmação explícita do usuário, uma entrega posterior poderá remover a escrita dupla. A exclusão dos caminhos antigos não faz parte deste trabalho.

## Segurança e continuidade

- Nenhum dado será apagado.
- O painel não será interrompido: leituras compatíveis e escrita dupla impedem lacunas durante a cópia.
- A migração exige perfil administrador e registra uma entrada de auditoria resumida.
- O processo trata cada coleção de maneira independente; falha em uma delas não autoriza alterar outra.
- Respostas e logs não exibem conteúdo de documentos, apenas coleção permitida, quantidades e status seguro.

## Operação no Fluxora

Uma ação administrativa de migração apresenta somente as coleções permitidas, progresso por coleção e resultado da verificação. A ação deve ser reexecutável: documentos já copiados são atualizados no mesmo ID, sem criar duplicatas.

## Testes e critérios de sucesso

- Testes validam que toda coleção permitida tem um caminho novo definido.
- Testes rejeitam coleções fora da lista permitida.
- A cópia preserva ID e dados de cada documento.
- Escrita dupla grava somente em caminhos legado e destino do Fluxora.
- Leitura retorna dados do destino e usa legado como fallback durante a transição.
- A verificação reporta contagem e IDs divergentes sem corrigir ou apagar dados automaticamente.
- Nenhuma função de deleção será criada ou chamada.
