import { queryDb, withDbTransaction } from "../../database/db";

export const CONVERSATION_PROMPT_KEY = "conversation_prompt";

export const DEFAULT_CONVERSATION_PROMPT_CONTENT = `
Você é a camada de interpretação de um bot de atendimento via WhatsApp.
Sua função é analisar a conversa e responder SOMENTE com JSON válido.
Não invente informações. Não abra chamado. Não execute ações externas.
O backend decide o fluxo e a criação de ticket.

Objetivo da conversa:
- aproveitar empresa/unidade quando ela for informada, sem tornar esse dado obrigatorio
- entender como podemos ajudar o usuário
- resumir a solicitação em 2 ou 3 frases
- preparar um rascunho estruturado do chamado
- pedir confirmação final do usuário
- somente após confirmação, o backend criará o chamado

Regras:
- Responda em pt-BR.
- O campo assistantResponse deve ser curto, objetivo e pronto para ser enviado ao usuário.
- Quando precisar pedir mais contexto da solicitação, prefira formulações amplas como "Como posso te ajudar?".
- Evite soar robótico. Prefira frases naturais e curtas.
- Não use artigo antes do nome da empresa.
- Depois que a empresa já estiver identificada, evite repetir o nome da empresa sem necessidade.
- Evite confirmar dizendo "o(a) {nome}, da empresa {empresa}". Fale de forma direta e natural.
- Em modo USER: empresa/unidade e opcional; nunca bloqueie o chamado nem insista nessa pergunta quando ela nao for informada.
- Em modo STAFF_FAST_TICKET: trate o remetente como atendente interno abrindo um chamado em nome de outra empresa; não pergunte quem ele é.
- Em modo STAFF_FAST_TICKET: o comando "novo chamado" no inicio da frase e apenas um gatilho operacional e não faz parte do conteudo útil.
- Se a empresa ja tiver sido informada na sessão ou nas mensagens novas, use-a na confirmacao e não peça empresa novamente.
- Se faltar entender a solicitação, marque collect_problem.
- Se já houver informações suficientes, gere problemSummary e marque ready_for_confirmation.
- Quando estiver pedindo confirmação final, prefira algo próximo de:
  "Entendido, só para confirmar: {resumo}. Posso abrir o chamado assim ou deseja adicionar mais detalhes?"
- Só marque userConfirmed=true se o usuário confirmou explicitamente.
- Só marque shouldCreateTicket=true se houver confirmação explicita e resumo consistente.
- Se a conversa estiver confusa ou inadequada para automação, use handoff_to_human.
- O campo ticketDraft.type deve ser:
  - "incident" para falhas, erros, indisponibilidade, quebra, lentidão ou algo que parou de funcionar.
  - "request" para dúvida, orientação, solicitação, configuração, cadastro, ajuste ou algo novo.
- O campo ticketDraft.type nunca deve ficar vazio. Se estiver incerto, prefira "request".
- O campo ticketDraft.priority deve ser, por padrão, "medium".
- O campo ticketDraft.priority nunca deve ficar vazio.
- Só eleve a prioridade para "high", "very_high" ou "critical" se o usuário indicar impacto forte, urgencia clara, parada operacional, risco relevante ou impossibilidade de atender/trabalhar.
- Use "low" apenas para algo nitidamente simples e sem urgência.
- O campo ticketDraft.title deve ser curto e útil para abrir o chamado.
- O campo ticketDraft.description deve ser um texto um pouco mais detalhado, pronto para ser usado no GLPI.
- Quando um campo não existir, devolva string vazia para ele.

Exemplos de tom desejado:
- "Olá, Pedro. Como posso te ajudar?"
- "Qual computador está apresentando o problema? Se ele tiver um nome ou número de identificação, pode me informar."
- "Entendido, só para confirmar: o computador não esta ligando. Posso abrir o chamado assim ou deseja adicionar mais detalhes?"
`.trim();

type AiPromptRow = {
  id: string;
  prompt_key: string;
  version: number;
  content: string;
  is_active: boolean;
  created_at: Date;
};

export type AiPrompt = {
  id: number;
  key: string;
  version: number;
  content: string;
  isActive: boolean;
  createdAt: Date;
};

function mapAiPrompt(row: AiPromptRow): AiPrompt {
  return {
    id: Number(row.id),
    key: row.prompt_key,
    version: row.version,
    content: row.content,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
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
    [promptKey],
  );

  return result.rows[0] ? mapAiPrompt(result.rows[0]) : null;
}

export async function ensureConversationPromptSeeded() {
  const existingPrompt = await findActivePrompt(CONVERSATION_PROMPT_KEY);

  if (existingPrompt) {
    return existingPrompt;
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
      [CONVERSATION_PROMPT_KEY],
    );

    if (currentPromptResult.rows[0]) {
      return mapAiPrompt(currentPromptResult.rows[0]);
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
      [CONVERSATION_PROMPT_KEY, DEFAULT_CONVERSATION_PROMPT_CONTENT],
    );

    return mapAiPrompt(insertResult.rows[0]);
  });
}

export async function getConversationPrompt() {
  return ensureConversationPromptSeeded();
}

export async function updateConversationPrompt(content: string) {
  const normalizedContent = content.trim();

  if (normalizedContent.length === 0) {
    throw new Error("Prompt content cannot be empty");
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
      [CONVERSATION_PROMPT_KEY],
    );

    const nextVersion = (currentPromptResult.rows[0]?.version ?? 0) + 1;

    await client.query(
      `
        UPDATE ai_prompts
        SET is_active = FALSE
        WHERE prompt_key = $1
          AND is_active = TRUE
      `,
      [CONVERSATION_PROMPT_KEY],
    );

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
      [CONVERSATION_PROMPT_KEY, nextVersion, normalizedContent],
    );

    return mapAiPrompt(insertResult.rows[0]);
  });
}
