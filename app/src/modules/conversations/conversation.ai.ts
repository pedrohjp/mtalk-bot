import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../../config/env";
import { getConversationPrompt } from "../admin/prompt.repository";
import { stripStaffFastTicketCommand } from "../staff/staff.repository";
import { ClaimedConversationSession, PendingConversationMessage } from "./conversation.repository";

const MISSING_FIELD_VALUES = ["problem_details"] as const;
const INTENT_VALUES = [
  "collect_company",
  "collect_problem",
  "ready_for_confirmation",
  "confirmed",
  "service_inquiry",
  "handoff_to_human",
  "unclear",
] as const;
const CONFIDENCE_VALUES = ["low", "medium", "high"] as const;
const TICKET_TYPE_VALUES = ["incident", "request"] as const;
const TICKET_PRIORITY_VALUES = ["low", "medium", "high", "very_high", "critical"] as const;

type MissingField = (typeof MISSING_FIELD_VALUES)[number];
type ConversationIntent = (typeof INTENT_VALUES)[number];
type ConversationConfidence = (typeof CONFIDENCE_VALUES)[number];
export type TicketType = (typeof TICKET_TYPE_VALUES)[number];
export type TicketPriority = (typeof TICKET_PRIORITY_VALUES)[number];

export type ConversationTicketDraft = {
  type: TicketType | null;
  priority: TicketPriority | null;
  title: string | null;
  description: string | null;
};

export type ConversationAiAnalysis = {
  intent: ConversationIntent;
  confidence: ConversationConfidence;
  missingFields: MissingField[];
  shouldCreateTicket: boolean;
  readyForConfirmation: boolean;
  userConfirmed: boolean;
  clarificationRequested: boolean;
  assistantResponse: string;
  ticketDraft: ConversationTicketDraft;
  extractedData: {
    requesterName: string | null;
    companyName: string | null;
    problemDetails: string | null;
    problemSummary: string | null;
  };
};

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export class InvalidConversationAiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConversationAiResponseError";
  }
}

let client: GoogleGenAI | null = null;

function getGeminiClient() {
  if (!env.geminiApiKey) {
    throw new GeminiUnavailableError("GEMINI_API_KEY is not configured");
  }

  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  }

  return client;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function ensureObject(value: unknown, fieldName: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  return value as Record<string, unknown>;
}

function ensureBoolean(value: unknown, fieldName: string) {
  if (typeof value !== "boolean") {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  return value;
}

function ensureString(value: unknown, fieldName: string) {
  if (typeof value !== "string") {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  return normalizedValue;
}

function ensureEnum<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
): T[number] {
  const normalizedValue = ensureString(value, fieldName);

  if (!allowedValues.includes(normalizedValue)) {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  return normalizedValue as T[number];
}

function ensureMissingFields(value: unknown) {
  if (!Array.isArray(value)) {
    throw new InvalidConversationAiResponseError("Invalid field: missingFields");
  }

  return value.map((item) => ensureEnum(item, "missingFields[]", MISSING_FIELD_VALUES));
}

function ensureEnumWithDefault<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
  fallback: T[number],
): T[number] {
  const normalizedValue = normalizeNullableString(value);

  if (!normalizedValue) {
    return fallback;
  }

  if (!allowedValues.includes(normalizedValue)) {
    throw new InvalidConversationAiResponseError(`Invalid field: ${fieldName}`);
  }

  return normalizedValue as T[number];
}

function parseConversationAiAnalysis(rawText: string): ConversationAiAnalysis {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(rawText);
  } catch {
    throw new InvalidConversationAiResponseError("Gemini returned invalid JSON");
  }

  const root = ensureObject(parsedValue, "root");
  const extractedData = ensureObject(root.extractedData, "extractedData");
  const ticketDraft = ensureObject(root.ticketDraft, "ticketDraft");

  return {
    intent: ensureEnum(root.intent, "intent", INTENT_VALUES),
    confidence: ensureEnum(root.confidence, "confidence", CONFIDENCE_VALUES),
    missingFields: ensureMissingFields(root.missingFields),
    shouldCreateTicket: ensureBoolean(root.shouldCreateTicket, "shouldCreateTicket"),
    readyForConfirmation: ensureBoolean(root.readyForConfirmation, "readyForConfirmation"),
    userConfirmed: ensureBoolean(root.userConfirmed, "userConfirmed"),
    clarificationRequested: ensureBoolean(
      root.clarificationRequested,
      "clarificationRequested",
    ),
    assistantResponse: ensureString(root.assistantResponse, "assistantResponse"),
    ticketDraft: {
      type: ensureEnumWithDefault(
        ticketDraft.type,
        "ticketDraft.type",
        TICKET_TYPE_VALUES,
        "request",
      ),
      priority: ensureEnumWithDefault(
        ticketDraft.priority,
        "ticketDraft.priority",
        TICKET_PRIORITY_VALUES,
        "medium",
      ),
      title: normalizeNullableString(ticketDraft.title),
      description: normalizeNullableString(ticketDraft.description),
    },
    extractedData: {
      requesterName: normalizeNullableString(extractedData.requesterName),
      companyName: normalizeNullableString(extractedData.companyName),
      problemDetails: normalizeNullableString(extractedData.problemDetails),
      problemSummary: normalizeNullableString(extractedData.problemSummary),
    },
  };
}

function formatConversationMessages(messages: PendingConversationMessage[]) {
  if (messages.length === 0) {
    return "Nenhuma mensagem nova.";
  }

  return messages
    .map((message, index) => {
      const content = message.content ?? "[sem texto]";
      return `${index + 1}. tipo=${message.messageType}; conteudo=${content}`;
    })
    .join("\n");
}

function normalizeConversationMessagesForPrompt(
  session: ClaimedConversationSession,
  messages: PendingConversationMessage[],
) {
  if (session.conversationMode !== "STAFF_FAST_TICKET") {
    return messages;
  }

  return messages.map((message) => ({
    ...message,
    content: stripStaffFastTicketCommand(message.content),
  }));
}

async function buildConversationPrompt(
  session: ClaimedConversationSession,
  messages: PendingConversationMessage[],
) {
  const prompt = await getConversationPrompt();
  const backendRules = `
Regras obrigatorias adicionais do backend:
- O nome da empresa ou unidade e opcional. Se nao tiver sido informado, continue o atendimento normalmente e nunca insista nessa pergunta.
- Nao use intent="collect_company" apenas porque companyName esta vazio. Nao inclua empresa ausente em missingFields.
- Se o usuario disser que nao pertence a uma empresa, que e particular ou que nao deseja informar, mantenha companyName vazio e prossiga.
- Se o usuario pedir explicitamente para falar com uma pessoa, atendente, humano, tecnico ou similar, use intent="handoff_to_human".
- Se o usuario perguntar se a ONTECH oferece, realiza, vende ou atende determinado servico, use intent="service_inquiry". Nao invente a resposta sobre o catalogo de servicos.
- Diferencie uma pergunta sobre a disponibilidade de um servico, como "voces consertam celular?", de uma solicitacao direta e concreta, como "preciso instalar o Office no computador 02". Apenas a pergunta sobre disponibilidade deve usar intent="service_inquiry".
- Para intent="service_inquiry", informe brevemente que a solicitacao sera encaminhada para a equipe humana.
- Quando identificar esse pedido, o campo assistantResponse deve ser curto e direto, informando que o atendimento sera encaminhado para um humano.
- Nao insista na automacao quando houver pedido explicito de atendimento humano.
- Se a sessao estiver aguardando o nome da empresa/unidade e o usuario responder apenas com um nome curto, como "Raio X Oral" ou "Minermix", trate essa resposta diretamente como o nome da empresa, mesmo sem frases como "sou da empresa" ou "empresa".
- O backend envia uma mensagem fixa apresentando a OMNI no inicio do atendimento. Nao repita essa apresentacao e nao se apresente novamente.
- Analise tudo que o usuario ja informou e nao solicite novamente dados presentes na sessao ou nas mensagens novas.
- Em modo USER, quando a solicitacao estiver compreensivel mas faltar um detalhe pratico realmente util para o tecnico iniciar o atendimento, faca uma unica pergunta complementar curta e objetiva antes de pedir confirmacao.
- Exemplos de detalhes praticos: identificacao do equipamento, impressora envolvida, sistema ou tela afetada, mensagem de erro e se o problema afeta uma pessoa ou varias.
- Para incidentes em computador, notebook, impressora ou outro equipamento, se o usuario nao identificar qual equipamento esta afetado, obrigatoriamente use a unica pergunta complementar disponivel para pedir essa identificacao.
- A frase "meu computador nao liga" ainda precisa de uma pergunta como "Qual computador esta apresentando o problema?". A frase "o computador Desktop 01 nao liga" ja identifica o equipamento e nao exige essa pergunta.
- Nao tente diagnosticar ou conduzir troubleshooting. Nao pergunte detalhes apenas para prolongar a conversa.
- Ao fazer essa pergunta complementar, use intent="collect_problem", clarificationRequested=true, readyForConfirmation=false e shouldCreateTicket=false.
- So solicite complementacao se clarificationAttempts for menor que maxClarificationAttempts.
- Quando clarificationAttempts atingir maxClarificationAttempts, ou se o usuario disser que nao sabe, prossiga com os dados disponiveis e peca confirmacao.
- Em modo STAFF_FAST_TICKET, nunca solicite essa complementacao opcional; preserve o fluxo rapido.
- Ao pedir confirmacao final, inclua o nome da empresa ou unidade somente se companyName estiver preenchido. Se estiver vazio, confirme apenas a solicitacao.
`.trim();

  return `
${prompt.content}
${backendRules}

Contexto atual da sessao:
- status: ${session.status}
- conversationMode: ${session.conversationMode}
- contactName: ${session.contactName ?? ""}
- contactNumber: ${session.contactNumber ?? ""}
- companyName: ${session.companyName ?? ""}
- companyIdentificationStatus: ${session.companyIdentificationStatus}
- companyPromptAttempts: ${session.companyPromptAttempts}
- problemDetails: ${session.problemDetails ?? ""}
- problemSummary: ${session.problemSummary ?? ""}
- awaitingConfirmation: ${session.awaitingConfirmation}
- clarificationAttempts: ${session.clarificationAttempts}
- maxClarificationAttempts: 1

Mensagens novas desta rodada:
${formatConversationMessages(normalizeConversationMessagesForPrompt(session, messages))}
`.trim();
}

const conversationAiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [...INTENT_VALUES],
    },
    confidence: {
      type: Type.STRING,
      enum: [...CONFIDENCE_VALUES],
    },
    missingFields: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: [...MISSING_FIELD_VALUES],
      },
    },
    shouldCreateTicket: {
      type: Type.BOOLEAN,
    },
    readyForConfirmation: {
      type: Type.BOOLEAN,
    },
    userConfirmed: {
      type: Type.BOOLEAN,
    },
    clarificationRequested: {
      type: Type.BOOLEAN,
    },
    assistantResponse: {
      type: Type.STRING,
    },
    ticketDraft: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          enum: [...TICKET_TYPE_VALUES],
        },
        priority: {
          type: Type.STRING,
          enum: [...TICKET_PRIORITY_VALUES],
        },
        title: { type: Type.STRING },
        description: { type: Type.STRING },
      },
      required: ["type", "priority", "title", "description"],
    },
    extractedData: {
      type: Type.OBJECT,
      properties: {
        requesterName: { type: Type.STRING },
        companyName: { type: Type.STRING },
        problemDetails: { type: Type.STRING },
        problemSummary: { type: Type.STRING },
      },
      required: ["requesterName", "companyName", "problemDetails", "problemSummary"],
    },
  },
  required: [
    "intent",
    "confidence",
    "missingFields",
    "shouldCreateTicket",
    "readyForConfirmation",
    "userConfirmed",
    "clarificationRequested",
    "assistantResponse",
    "ticketDraft",
    "extractedData",
  ],
} as const;

export async function analyzeConversationWithGemini(
  session: ClaimedConversationSession,
  messages: PendingConversationMessage[],
) {
  const ai = getGeminiClient();
  const prompt = await buildConversationPrompt(session, messages);

  console.log(
    [
      "===== GEMINI REQUEST START =====",
      `mtalkTicketId: ${session.mtalkTicketId}`,
      `model: ${env.geminiModel}`,
      prompt,
      "===== GEMINI REQUEST END =====",
    ].join("\n"),
  );

  const response = await ai.models.generateContent({
    model: env.geminiModel,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: conversationAiResponseSchema,
    },
  });

  const rawText = response.text?.trim();

  if (!rawText) {
    throw new InvalidConversationAiResponseError("Gemini returned an empty structured response");
  }

  return parseConversationAiAnalysis(rawText);
}
