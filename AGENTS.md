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

## Implementado na etapa 13
- Frontend admin minimo servido pelo proprio backend em `/admin-ui`.
- Login simples hardcoded para uso interno inicial:
  - usuario: `admin`
  - senha: `123456`
- Sessao do admin web protegida por cookie HttpOnly com assinatura simples.
- O frontend admin usa endpoints proprios em `/admin-ui/api/*`, sem expor `ADMIN_API_TOKEN` ao navegador.
- Funcionalidades iniciais do painel:
  - visualizar e editar o prompt ativo da IA;
  - visualizar, adicionar e remover numeros da whitelist interna (`staff_contacts`).
- Estrutura propositalmente simples:
  - um `index.html`
  - um `styles.css`
  - um `app.js`
  - tudo servido pelo Fastify, sem bundler e sem framework frontend dedicado.

## Implementado na etapa 15
- Worker separado para expiracao da automacao por inatividade.
- Nova migration adiciona campos de expiracao em `conversation_sessions`:
  - `automation_expired_at`
  - `automation_expiration_reason`
  - `last_expiration_check_at`
  - `expiration_started_at`
- A expiracao olha apenas sessoes que:
  - ainda nao estao em `DONE`, `HANDOFF_TO_HUMAN` ou `ERROR`;
  - nao foram expiradas anteriormente;
  - estao sem interacao ha mais de `AUTOMATION_EXPIRATION_INACTIVITY_MINUTES` (padrao 60 minutos).
- Quando expira, o sistema tenta transferir o atendimento para a fila humana configurada.
- Se a transferencia for bem sucedida, a sessao e marcada como expirada por inatividade e fica com status `HANDOFF_TO_HUMAN`.
- Se houver erro terminal de permissao ou ausencia de fila humana configurada, a automacao tambem e encerrada sem entrar em loop infinito de retry.
- A exclusao fisica do historico nao acontece nesta etapa; a expiracao apenas encerra a automacao e preserva auditoria.

## Implementado na etapa 14
- Nova configuracao persistida de roteamento do MTALK em `app_settings`, com tres filas:
  - `initialQueueId`
  - `aiQueueId`
  - `humanQueueId`
- Painel admin agora consegue:
  - listar as filas reais do Ticketz/MTALK via login autenticado no painel;
  - salvar a configuracao das filas inicial, IA e humana.
- Novo client autenticado do Ticketz/MTALK usando `POST /auth/login` e JWT Bearer para:
  - listar filas (`GET /queue`);
  - transferir atendimento de fila (`PUT /tickets/:ticketId`);
  - encerrar atendimento (`PUT /tickets/:ticketId` com `status=closed`).
- Novas credenciais do painel Ticketz/MTALK via ambiente:
  - `TICKETZ_PANEL_EMAIL`
  - `TICKETZ_PANEL_PASSWORD`
  - `TICKETZ_BASE_URL` opcional; se ausente, e derivado de `MTALK_API_SEND_MESSAGE_URL`.
- O prompt enviado ao Gemini ganhou uma regra fixa adicional fora do prompt editavel:
  - se o usuario pedir explicitamente humano/atendente/pessoa, a IA deve sinalizar `handoff_to_human`.
- Quando a IA sinaliza handoff humano:
  - o backend responde com mensagem fixa de encaminhamento;
  - transfere o atendimento para a fila humana configurada;
  - marca `human_handoff_transferred_at` na sessao.
- Quando o ticket e criado com sucesso no GLPI:
  - o backend envia a resposta final ao usuario;
  - mantem o atendimento aberto e o transfere para a fila humana configurada;
  - marca `human_handoff_transferred_at` na sessao.
- Foram adicionadas protecoes de retry para estados terminais:
  - sessoes `DONE` nao voltam a chamar a IA em retry;
  - sessoes `HANDOFF_TO_HUMAN` nao dependem de nova analise da IA para concluir a transferencia pendente.

## Implementado na etapa 16
- Mensagem deterministica de apresentacao da OMNI no inicio de novos atendimentos processados pela fila da IA.
- O texto da apresentacao fica persistido em `app_settings` com uma versao padrao e pode ser alterado pelo painel administrativo.
- Novos endpoints autenticados do painel:
  - `GET /admin-ui/api/welcome-message`
  - `PUT /admin-ui/api/welcome-message`
- Nova migration adiciona `welcome_sent_at` em `conversation_sessions`, impedindo o envio normal da apresentacao mais de uma vez por `mtalk_ticket_id`.
- Se a primeira rodada contiver apenas saudacao ou escolha numerica do menu do MTALK, o backend envia a apresentacao e aguarda a proxima mensagem sem chamar o Gemini.
- Se a primeira rodada ja contiver uma solicitacao util ou anexo, o conteudo e preservado e processado pelo Gemini depois da apresentacao.
- O contexto fixo do Gemini informa que a OMNI ja foi apresentada, evitando que a IA repita a apresentacao.

## Implementado na etapa 17
- A mensagem final de criacao do chamado agora informa que o atendimento sera encaminhado para a equipe humana.
- O atendimento continua aberto no MTALK e e transferido para a fila humana depois da criacao do ticket no GLPI.
- Nova intencao estruturada `service_inquiry` para perguntas sobre servicos oferecidos pela ONTECH.
- Perguntas sobre disponibilidade, venda ou realizacao de servicos sao encaminhadas para o fluxo existente de `HANDOFF_TO_HUMAN`.
- Solicitacoes operacionais concretas continuam elegiveis para abertura de chamado e nao devem ser confundidas com perguntas comerciais sobre servicos.
- Nova migration adiciona `clarification_attempts` em `conversation_sessions`.
- Em conversas `USER`, a IA pode fazer uma unica pergunta complementar quando ja compreendeu a solicitacao, mas falta um detalhe pratico relevante para o tecnico.
- O limite de uma complementacao e aplicado pelo backend e o contador so e incrementado depois do envio bem-sucedido da pergunta.
- O modo `STAFF_FAST_TICKET` nao utiliza a complementacao opcional e preserva o fluxo rapido.

## Implementado na etapa 18
- O prazo padrao de expiracao da automacao por inatividade passou de 15 para 60 minutos.
- `AUTOMATION_EXPIRATION_INACTIVITY_MINUTES` agora e repassada explicitamente pelo Docker Compose, com fallback 60.
- Antes de transferir uma conversa expirada para a fila humana, o backend envia uma mensagem fixa explicando que o redirecionamento ocorre por inatividade.
- Nova migration adiciona `expiration_notice_sent_at` em `conversation_sessions`.
- O aviso de expiracao e persistido como mensagem outbound e nao e reenviado em retries normais da transferencia.
- Se a fila humana nao estiver configurada, o aviso de redirecionamento nao e enviado para evitar uma informacao incorreta ao usuario.

## Implementado na etapa 19
- Empresa/unidade deixou de ser requisito obrigatorio para confirmar e criar chamados.
- A state machine agora exige apenas detalhes e resumo consistentes da solicitacao antes da confirmacao.
- `company_name` foi removido de `missingFields` no contrato estruturado do Gemini.
- Se o Gemini tentar usar `collect_company` sem necessidade, o backend redireciona o fluxo para coleta do problema ou confirmacao, sem insistir na empresa.
- Quando houver empresa, a mensagem de confirmacao exibe explicitamente `Empresa/unidade: {nome}`; sem empresa, essa parte e omitida.
- Titulos de tickets sem empresa nao recebem mais o prefixo artificial `Empresa nao informada`.
- Problemas envolvendo equipamentos sem identificacao pratica usam a unica pergunta complementar disponivel para solicitar nome, numero, patrimonio ou localizacao.
- O caso `meu computador nao liga` gera uma pergunta de identificacao; descricoes como `Desktop 01 nao liga` podem seguir diretamente para confirmacao.

## Implementado na etapa 20
- Todas as mensagens automaticas enviadas pelo backend ao usuario recebem o prefixo idempotente `*OMNI*:`.
- O prefixo e aplicado a apresentacao inicial, respostas conversacionais, confirmacoes, handoff, expiracao e notificacoes automaticas existentes.
- Depois da criacao confirmada do ticket no GLPI:
  1. o backend envia a mensagem com o numero do chamado;
  2. encerra o atendimento correspondente no MTALK;
  3. persiste `mtalk_closed_at` para impedir novos encerramentos em retries.
- O pedido explicito por atendimento humano continua transferindo a conversa para a fila humana configurada.
- Depois de 60 minutos de inatividade:
  1. o backend envia um aviso informando que o atendimento sera encerrado;
  2. encerra o atendimento no MTALK;
  3. marca a sessao como expirada e `DONE`, preservando o historico para auditoria.
- A expiracao por inatividade deixou de depender da configuracao de fila humana.

## Implementado na etapa 21
- O polling de atribuicao de tecnico foi removido; atribuir um tecnico no GLPI nao envia mais mensagem ao usuario.
- Novo worker de solucao consulta `GET /Ticket/{id}` para tickets criados pelo bot.
- O polling considera o ticket concluido quando o GLPI retorna:
  - `status = 5` (`SOLVED`);
  - `status = 6` (`CLOSED`), como fallback para fechamento direto.
- A verificacao acontece a cada `SOLUTION_POLL_INTERVAL_MS` (padrao 20 segundos).
- A notificacao de conclusao usa a mensagem:
  - `*OMNI*: Seu chamado nº {id} foi concluido com sucesso. Agradecemos o contato.`
- O envio de conclusao usa explicitamente `saveOnTicket: false`, evitando salvar a mensagem ou abrir novo atendimento no MTALK.
- A migration `011_solution_notifications.sql` adiciona:
  - `solution_tracking_started_at`
  - `last_solution_check_at`
  - `solution_check_started_at`
  - `solution_notified_at`
  - `glpi_last_status`
- Somente tickets criados depois da migration recebem `solution_tracking_started_at`; tickets historicos nao sao notificados retroativamente.
- Depois do envio bem-sucedido, `solution_notified_at` garante idempotencia e remove o ticket das proximas verificacoes.
- As colunas antigas de atribuicao permanecem no banco apenas como legado historico, sem worker ou comportamento ativo.

## Implementado na etapa 22
- O encerramento no Ticketz/MTALK agora envia `status=closed`, `justClose=true`, `userId=null` e `queueId=null`.
- Limpar `userId` e `queueId` evita que um atendimento encerrado continue visualmente associado a fila do chatbot.
- A resposta da API de encerramento e validada; `mtalk_closed_at` so e persistido quando o Ticketz retorna efetivamente `status=closed`.
- Nova migration `012_optional_company_prompt.sql` adiciona `company_prompt_attempts` em `conversation_sessions`.
- Em conversas `USER`, depois de coletar detalhes suficientes, o backend pode fazer uma unica pergunta opcional adicional sobre empresa/unidade.
- A coleta opcional de empresa:
  - nao bloqueia a criacao do chamado;
  - nao ocorre em `STAFF_FAST_TICKET`;
  - nao atrasa solicitacoes urgentes;
  - nao se repete depois de uma resposta como `nao se aplica`;
  - possui contador separado da pergunta complementar tecnica.
- Quando a empresa continuar ausente depois dessa tentativa, o fluxo segue normalmente para confirmacao e criacao sem `entities_id`.

## Implementado na etapa 23
- O modelo padrao do Gemini passou de `gemini-2.5-flash` para `gemini-3.5-flash-lite`, devido a indisponibilidade do modelo anterior para novos usuarios/projetos.
- `GEMINI_MODEL` agora e repassada pelo Docker Compose e pode sobrescrever o modelo padrao sem alteracao de codigo.
- O parametro de geracao `temperature` deixou de ser enviado, mantendo compatibilidade com a API dos modelos Gemini mais novos.

## Implementado na etapa 24
- Foi criada uma configuracao de producao separada em `docker-compose.production.yml`, preservando o Compose de desenvolvimento local.
- O `app/Dockerfile.production` compila o TypeScript em uma etapa de build e executa somente o JavaScript compilado com `node dist/server.js`.
- Em producao, o PostgreSQL nao publica a porta `5432` e o app publica somente `127.0.0.1:3001` por padrao, evitando conflito com o Grafana na porta `3000` e permitindo proxy pelo Apache.
- O volume de producao possui nome proprio (`mtalk_bot_prod_postgres_data`) para nao compartilhar dados com outros projetos.
- O guia `DEPLOY.md` documenta a subida, validacao, atualizacao e o cuidado de nunca usar `docker compose down -v` no banco de producao.

## Implementado na etapa 25
- O aviso de encaminhamento para a fila humana passou a ser idempotente por sessao.
- A migration `013_human_handoff_notice_idempotency.sql` adiciona `human_handoff_notice_sent_at` e recupera avisos ja persistidos antes da correcao.
- Se a transferencia para a fila humana falhar depois do envio do aviso, retries posteriores tentam a transferencia sem reenviar a mesma mensagem.

## Implementado na etapa 26
- O `app/Dockerfile.production` passou a copiar `src/admin-ui` para a imagem final.
- Isso corrige o erro `ENOENT` ao acessar `/admin-ui` em producao, pois a rota serve os arquivos estaticos diretamente desse diretorio em runtime.
