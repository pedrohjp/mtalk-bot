# mtalk-bot

## Objetivo
Servico backend para integrar o MTALK (entrada via webhook de atendimentos WhatsApp) com uma IA conversacional e, ao final do fluxo confirmado pelo usuario, criar chamados no GLPI.

## Stack atual
- Node.js
- TypeScript
- Fastify
- PostgreSQL
- Docker Compose

## Diretrizes arquiteturais
- Manter um unico servico backend.
- Evitar overengineering e dependencias desnecessarias.
- PostgreSQL e a fonte de verdade; nao depender de memoria para estado principal.
- Nao usar Redis inicialmente, salvo necessidade real.
- Nao usar base64 do MTALK por padrao; preferir `mediaUrl`.
- O backend controla estado, debounce, idempotencia e transicoes.
- A LLM nao orquestra o fluxo; ela interpreta e devolve saida estruturada.

## Identificadores importantes
- `mtalk_ticket_id`: vem de `metadata.ticketId` e identifica a conversa no MTALK.
- `external_message_id`: vem de `customPayload.key.id` e deve ser usado para deduplicacao de mensagens.
- `glpi_ticket_id`: identificador do ticket criado no GLPI, separado do ticket do MTALK.

## Campos relevantes do webhook MTALK
- `type`
- `content`
- `mediaUrl`
- `metadata.ticketId`
- `metadata.from.name`
- `metadata.from.number`
- `customPayload.key.id`
- `rawPayload` deve ser preservado para auditoria/debug.

## Regras de negocio ja definidas
- Nao responder imediatamente a cada mensagem recebida.
- Usar janela de silencio por `mtalk_ticket_id` para debounce.
- Persistir toda mensagem recebida antes de qualquer processamento de IA.
- Criar ticket no GLPI somente apos confirmacao explicita do usuario.
- Suportar pelo menos `text`, `image`, `document` e `audio`.
- Para `audio`, tratar `content` transcrito como texto util para entendimento.

## Fluxo alvo
1. Receber webhook do MTALK.
2. Validar autenticacao Bearer.
3. Normalizar payload interno.
4. Persistir mensagem bruta + mensagem normalizada.
5. Criar ou atualizar sessao por `mtalk_ticket_id`.
6. Reagendar processamento com debounce.
7. Worker processa sessoes vencidas com lock.
8. LLM extrai dados, gera resposta curta e sinaliza estado.
9. Backend decide se continua coleta, pede confirmacao ou cria ticket.
10. So apos confirmacao criar ticket no GLPI.

## Estados previstos da conversa
- `NEW`
- `COLLECTING_COMPANY`
- `COLLECTING_PROBLEM`
- `AWAITING_CONFIRMATION`
- `CREATING_GLPI_TICKET`
- `DONE`
- `HANDOFF_TO_HUMAN`
- `ERROR`

## Proximo passo tecnico recomendado
1. Definir contrato interno de mensagem normalizada do MTALK.
2. Criar camada de banco e migration inicial.
3. Persistir webhook bruto, mensagem normalizada e sessao.
4. Preparar agenda/worker simples para debounce.
5. Deixar interface da LLM pronta para receber implementacao posterior.

## Implementado nesta etapa
- Contrato interno `NormalizedMtalkMessage` para desacoplar o restante da aplicacao do payload bruto do MTALK.
- Tipos centrais de conversa (`ConversationStatus`, direcao de mensagem e status de download de anexo).
- Camada minima de PostgreSQL com `pg`.
- Runner de migrations SQL simples, versionado por arquivo e executado no startup.
- Migration inicial com `conversation_sessions`, `conversation_messages` e `conversation_attachments`.

## Implementado na etapa 3
- A rota do webhook agora delega a ingestao para um servico proprio.
- O payload do MTALK e normalizado antes de qualquer persistencia.
- A persistencia e transacional e idempotente por (`mtalk_ticket_id`, `external_message_id`).
- Webhook duplicado nao cria mensagem duplicada nem deve reagendar `next_processing_at`.
- Mensagens com `mediaUrl` geram registro inicial em `conversation_attachments` com status padrao `PENDING`.
- Cada mensagem inbound valida atualiza `last_message_at` e `next_processing_at` da sessao.

## Implementado na etapa 4
- Worker simples no mesmo servico, baseado em polling no PostgreSQL.
- Claim de sessao vencida com `FOR UPDATE SKIP LOCKED`, evitando processamento concorrente da mesma conversa.
- Marcacao de `processing_started_at`, `last_processed_at` e limpeza segura de `next_processing_at`.
- O worker processa apenas mensagens `inbound` ainda nao processadas e com `received_at` ate o instante do claim.
- Se novas mensagens chegarem durante o processamento, elas nao se perdem e continuam agendadas para a proxima rodada.
- Em falha, a sessao e reagendada usando um retry simples.

## Implementado na etapa 5
- Integracao inicial com Gemini via `@google/genai`.
- O worker agora envia o lote da conversa para a LLM com `responseMimeType=application/json` e `responseSchema`.
- A resposta da LLM passa por validacao manual no backend antes de qualquer uso.
- Campos estruturados extraidos (`company_name`, `problem_details`, `problem_summary`) atualizam a sessao.
- O status da sessao passa a refletir o resultado da analise (`COLLECTING_COMPANY`, `COLLECTING_PROBLEM`, `AWAITING_CONFIRMATION`, `HANDOFF_TO_HUMAN`).
- Nenhuma criacao de ticket ocorre nesta etapa; a LLM apenas interpreta e sugere o proximo passo.

## Implementado na etapa 6
- Maquina de estados centralizada em um modulo proprio.
- Regras de transicao explicitas por status atual, evitando mudancas arbitrarias espalhadas no codigo.
- Derivacao explicita de `nextAction` (`ASK_COMPANY`, `ASK_PROBLEM`, `ASK_CONFIRMATION`, `CREATE_GLPI_TICKET`, `HANDOFF_TO_HUMAN`).
- Confirmacao explicita do usuario agora permite transicao para `CREATING_GLPI_TICKET`, deixando o sistema pronto para a futura integracao com GLPI.
- O worker passa a logar `nextAction` e usa a decisao da state machine, nao mais regras ad-hoc no processor.

## Implementado na etapa 7
- Integracao outbound com a API do MTALK para envio de mensagem de texto.
- Respostas da IA agora podem ser entregues de volta ao usuario pelo WhatsApp.
- Mensagens outbound enviadas com sucesso passam a ser registradas em `conversation_messages` com direcao `outbound`.
- Quando a conversa chega em `CREATING_GLPI_TICKET`, o backend ainda nao cria chamado real; ele apenas:
  - envia uma resposta honesta ao usuario informando que os dados foram registrados internamente;
  - gera e registra no log os dados do ticket candidato (`companyName`, `ticketTitle`, `ticketContent`).

## Implementado na etapa 8
- Integracao inicial com o GLPI para descoberta e cache local de entidades (`glpi_entities_cache`).
- Nova migration adiciona cache de entidades do GLPI e campos de identificacao de empresa em `conversation_sessions`.
- A resolucao de empresa agora usa cache local sincronizado sob demanda a partir de `initSession` + `getMyEntities`.
- O nome bruto retornado pelo GLPI e normalizado para um `display_name` limpo, usando apenas o ultimo segmento da hierarquia.
- O worker tenta casar a empresa informada pelo usuario com a lista sincronizada do GLPI e grava:
  - `glpi_entity_id`
  - `glpi_entity_name`
  - `company_identification_status` (`PENDING`, `IDENTIFIED`, `NOT_IDENTIFIED`)
- Se o GLPI estiver indisponivel, a conversa nao quebra; o sistema segue com a empresa textual informada e registra o fallback em log.
- O prompt da IA foi ajustado para ficar menos restrito a "problema tecnico" e preferir perguntas amplas como "Como posso te ajudar?".
- A IA agora tambem devolve um `ticketDraft` estruturado com:
  - `type` (`incident` ou `request`)
  - `priority` (`low`, `medium`, `high`, `very_high`, `critical`)
  - `title`
  - `description`
- A prioridade padrao orientada para a IA e `medium`, elevando apenas quando houver indicio claro de urgencia ou impacto alto.
- O candidato de ticket registrado em log agora prioriza o nome canonico da entidade do GLPI e ja inclui `tipo` e `prioridade`.

## Implementado na etapa 9
- Integracao real de criacao de ticket no GLPI via `POST /Ticket/`.
- Quando a conversa entra em `CREATING_GLPI_TICKET`, o worker agora:
  - monta o payload do ticket;
  - abre sessao no GLPI;
  - cria o ticket real;
  - persiste `glpi_ticket_id` e `glpi_created_at`;
  - marca a sessao como `DONE`.
- O mapeamento para o GLPI ficou assim:
  - `incident -> type=1`
  - `request -> type=2`
  - `low -> 2`
  - `medium -> 3`
  - `high -> 4`
  - `very_high -> 5`
  - `critical -> 6`
- `entities_id` so e enviado quando a empresa foi identificada no GLPI.
- A resposta final ao usuario agora inclui o numero real do chamado criado no GLPI.

## Implementado na etapa 10
- Prompt conversacional versionado no banco em `ai_prompts`.
- O sistema agora garante um prompt padrao inicial no banco e passa a carregar o prompt ativo a partir dele.
- Rotas admin protegidas por Bearer token proprio:
  - `GET /admin/prompts/conversation`
  - `PUT /admin/prompts/conversation`
- Whitelist de contatos internos em `staff_contacts`.
- Rotas admin protegidas para contatos internos:
  - `GET /admin/staff-contacts`
  - `POST /admin/staff-contacts`
  - `DELETE /admin/staff-contacts/:number`
- Novo modo de conversa `STAFF_FAST_TICKET`, ativado quando:
  - o numero de origem estiver whitelisted em `staff_contacts`;
  - a mensagem comecar com `novo chamado`.
- Em `STAFF_FAST_TICKET`, a IA passa a tratar o remetente como atendente interno abrindo um chamado em nome de outro cliente, sem perguntar quem ele e.
- O comando operacional `novo chamado` e removido do texto util antes de enviar as mensagens da rodada para a IA.

## Implementado na etapa 11
- Sincronizacao de anexos do MTALK para o GLPI apos a criacao do ticket.
- Nova migration adiciona campos de controle de sincronizacao em `conversation_attachments`:
  - `glpi_document_id`
  - `glpi_uploaded_at`
  - `glpi_linked_at`
- O fluxo de anexos agora funciona assim:
  1. cria o ticket no GLPI;
  2. lista anexos pendentes da conversa;
  3. baixa cada `mediaUrl` para arquivo temporario;
  4. faz upload multipart para `POST /Document/`;
  5. vincula o documento ao ticket via `POST /Document_Item`;
  6. apaga o arquivo temporario no `finally`.
- A sincronizacao de anexos e idempotente por anexo:
  - se o documento ja foi enviado ao GLPI, o sistema tenta apenas vincular;
  - se o anexo ja foi vinculado, ele nao entra novamente na fila.
- Em falha de anexo, o ticket principal continua preservado e o anexo pode ser retomado em retry posterior.

## Implementado na etapa 12
- Worker separado para polling de atribuicao de tecnico no GLPI.
- Nova migration adiciona campos de acompanhamento em `conversation_sessions`:
  - `assigned_glpi_user_id`
  - `assigned_glpi_user_name`
  - `last_assignment_check_at`
  - `assignment_check_started_at`
  - `assignment_notified_at`
- O polling olha apenas tickets criados pelo bot que:
  - ja possuem `glpi_ticket_id`;
  - estao com `status = DONE`;
  - ainda nao tiveram notificacao de atribuicao enviada.
- A cada rodada, o worker consulta `GET /Ticket/{id}/Ticket_User` no GLPI e tenta identificar tecnico atribuido por `type = 2` com `users_id` valido.
- Quando encontra tecnico atribuido, o sistema envia uma mensagem fixa pelo MTALK informando que o chamado ja foi assumido por um tecnico.
- A notificacao e idempotente: apos envio bem sucedido, grava `assignment_notified_at` e nao reenvia novamente.
