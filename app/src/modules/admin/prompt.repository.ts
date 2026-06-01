import { queryDb, withDbTransaction } from '../../database/db'

export const CONVERSATION_PROMPT_KEY = 'conversation_prompt'

export const DEFAULT_CONVERSATION_PROMPT_CONTENT = `
Voce e a camada de interpretacao de um bot de atendimento via WhatsApp.
Sua funcao e analisar a conversa e responder SOMENTE com JSON valido.
Nao invente informacoes. Nao abra chamado. Nao execute acoes externas.
O backend decide o fluxo e a criacao de ticket.

Objetivo da conversa:
- coletar empresa/unidade
- entender como podemos ajudar o usuario
- resumir a solicitacao em 2 ou 3 frases
- preparar um rascunho estruturado do chamado
- pedir confirmacao final do usuario
- somente apos confirmacao, o backend criara o chamado

Regras:
- Responda em pt-BR.
- O campo assistantResponse deve ser curto, objetivo e pronto para ser enviado ao usuario.
- Quando precisar pedir mais contexto da solicitacao, prefira formulacoes amplas como "Como posso te ajudar?".
- Evite soar robotico. Prefira frases naturais e curtas.
- Nao use artigo antes do nome da empresa.
- Depois que a empresa ja estiver identificada, evite repetir o nome da empresa sem necessidade.
- Evite confirmar dizendo "o(a) {nome}, da empresa {empresa}". Fale de forma direta e natural.
- Em modo USER: se faltar empresa/unidade e ela ainda nao tiver sido informada, marque collect_company.
- Em modo STAFF_FAST_TICKET: trate o remetente como atendente interno abrindo um chamado em nome de outra empresa; nao pergunte quem ele e.
- Em modo STAFF_FAST_TICKET: o comando "novo chamado" no inicio da frase e apenas um gatilho operacional e nao faz parte do conteudo util.
- Se a empresa ja tiver sido informada na sessao ou nas mensagens novas, nao peca empresa novamente.
- Se faltar entender a solicitacao, marque collect_problem.
- Se ja houver informacoes suficientes, gere problemSummary e marque ready_for_confirmation.
- Quando estiver pedindo confirmacao final, prefira algo proximo de:
  "Entendido, so para confirmar: {resumo}. Posso abrir o chamado assim ou deseja adicionar mais detalhes?"
- So marque userConfirmed=true se o usuario confirmou explicitamente.
- So marque shouldCreateTicket=true se houver confirmacao explicita e resumo consistente.
- Se a conversa estiver confusa ou inadequada para automacao, use handoff_to_human.
- O campo ticketDraft.type deve ser:
  - "incident" para falhas, erros, indisponibilidade, quebra, lentidao ou algo que parou de funcionar.
  - "request" para duvida, orientacao, solicitacao, configuracao, cadastro, ajuste ou algo novo.
- O campo ticketDraft.type nunca deve ficar vazio. Se estiver incerto, prefira "request".
- O campo ticketDraft.priority deve ser, por padrao, "medium".
- O campo ticketDraft.priority nunca deve ficar vazio.
- So eleve a prioridade para "high", "very_high" ou "critical" se o usuario indicar impacto forte, urgencia clara, parada operacional, risco relevante ou impossibilidade de atender/trabalhar.
- Use "low" apenas para algo nitidamente simples e sem urgencia.
- O campo ticketDraft.title deve ser curto e util para abrir o chamado.
- O campo ticketDraft.description deve ser um texto um pouco mais detalhado, pronto para ser usado no GLPI.
- Quando um campo nao existir, devolva string vazia para ele.

Exemplos de tom desejado:
- "Ola, Pedro. Para comecarmos, qual e o nome da sua empresa ou unidade?"
- "Ok, como posso te ajudar?"
- "Entendido, so para confirmar: o computador nao esta ligando. Posso abrir o chamado assim ou deseja adicionar mais detalhes?"
`.trim()

type AiPromptRow = {
  id: string
  prompt_key: string
  version: number
  content: string
  is_active: boolean
  created_at: Date
}

export type AiPrompt = {
  id: number
  key: string
  version: number
  content: string
  isActive: boolean
  createdAt: Date
}

function mapAiPrompt(row: AiPromptRow): AiPrompt {
  return {
    id: Number(row.id),
    key: row.prompt_key,
    version: row.version,
    content: row.content,
    isActive: row.is_active,
    createdAt: row.created_at
  }
}

async function findActivePrompt(promptKey: string) {
  const result = await queryDb<AiPromptRow>(
    `
      SELECT id, prompt_key, version, content, is_active, created_at
      FROM ai_prompts
      WHERE prompt_key = $1
        AND is_active = TRUE
      ORDER BY version DESC
      LIMIT 1
    `,
    [promptKey]
  )

  return result.rows[0] ? mapAiPrompt(result.rows[0]) : null
}

export async function ensureConversationPromptSeeded() {
  const existingPrompt = await findActivePrompt(CONVERSATION_PROMPT_KEY)

  if (existingPrompt) {
    return existingPrompt
  }

  return withDbTransaction(async (client) => {
    const currentPromptResult = await client.query<AiPromptRow>(
      `
        SELECT id, prompt_key, version, content, is_active, created_at
        FROM ai_prompts
        WHERE prompt_key = $1
          AND is_active = TRUE
        ORDER BY version DESC
        LIMIT 1
      `,
      [CONVERSATION_PROMPT_KEY]
    )

    if (currentPromptResult.rows[0]) {
      return mapAiPrompt(currentPromptResult.rows[0])
    }

    const insertResult = await client.query<AiPromptRow>(
      `
        INSERT INTO ai_prompts (
          prompt_key,
          version,
          content,
          is_active
        )
        VALUES ($1, 1, $2, TRUE)
        RETURNING id, prompt_key, version, content, is_active, created_at
      `,
      [CONVERSATION_PROMPT_KEY, DEFAULT_CONVERSATION_PROMPT_CONTENT]
    )

    return mapAiPrompt(insertResult.rows[0])
  })
}

export async function getConversationPrompt() {
  return ensureConversationPromptSeeded()
}

export async function updateConversationPrompt(content: string) {
  const normalizedContent = content.trim()

  if (normalizedContent.length === 0) {
    throw new Error('Prompt content cannot be empty')
  }

  return withDbTransaction(async (client) => {
    const currentPromptResult = await client.query<AiPromptRow>(
      `
        SELECT id, prompt_key, version, content, is_active, created_at
        FROM ai_prompts
        WHERE prompt_key = $1
          AND is_active = TRUE
        ORDER BY version DESC
        LIMIT 1
      `,
      [CONVERSATION_PROMPT_KEY]
    )

    const nextVersion = (currentPromptResult.rows[0]?.version ?? 0) + 1

    await client.query(
      `
        UPDATE ai_prompts
        SET is_active = FALSE
        WHERE prompt_key = $1
          AND is_active = TRUE
      `,
      [CONVERSATION_PROMPT_KEY]
    )

    const insertResult = await client.query<AiPromptRow>(
      `
        INSERT INTO ai_prompts (
          prompt_key,
          version,
          content,
          is_active
        )
        VALUES ($1, $2, $3, TRUE)
        RETURNING id, prompt_key, version, content, is_active, created_at
      `,
      [CONVERSATION_PROMPT_KEY, nextVersion, normalizedContent]
    )

    return mapAiPrompt(insertResult.rows[0])
  })
}
