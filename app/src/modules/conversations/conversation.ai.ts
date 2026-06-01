import { GoogleGenAI, Type } from "@google/genai";
import { env } from "../../config/env";
import { getConversationPrompt } from "../admin/prompt.repository";
import { stripStaffFastTicketCommand } from "../staff/staff.repository";
import { ClaimedConversationSession, PendingConversationMessage } from "./conversation.repository";

const MISSING_FIELD_VALUES = ["company_name", "problem_details"] as const;
const INTENT_VALUES = [
  "collect_company",
  "collect_problem",
  "ready_for_confirmation",
  "confirmed",
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

  return `
${prompt.content}

Contexto atual da sessao:
- status: ${session.status}
- conversationMode: ${session.conversationMode}
- contactName: ${session.contactName ?? ""}
- contactNumber: ${session.contactNumber ?? ""}
- companyName: ${session.companyName ?? ""}
- companyIdentificationStatus: ${session.companyIdentificationStatus}
- problemDetails: ${session.problemDetails ?? ""}
- problemSummary: ${session.problemSummary ?? ""}
- awaitingConfirmation: ${session.awaitingConfirmation}

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
      temperature: env.geminiTemperature,
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
