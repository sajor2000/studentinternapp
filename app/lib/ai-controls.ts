import type { UIMessage } from "ai";
import { getOptionalEnv } from "./env";

const defaultMaxChatMessages = 40;
const defaultMaxChatTextChars = 20_000;

export class ChatInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatInputValidationError";
  }
}

export function isAiChatEnabled(): boolean {
  const value = getOptionalEnv("AI_CHAT_ENABLED")?.toLowerCase();

  return value !== "false" && value !== "0" && value !== "off";
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(getOptionalEnv(name) ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getMaxChatTextChars(): number {
  return getPositiveIntegerEnv("AI_MAX_CHAT_TEXT_CHARS", defaultMaxChatTextChars);
}

export function validateAiRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  const maxTextChars = getMaxChatTextChars();
  const maxRequestBytes = Math.max(maxTextChars * 2, maxTextChars + 10_000);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new ChatInputValidationError("AI request body size is invalid.");
  }

  if (contentLength > maxRequestBytes) {
    throw new ChatInputValidationError(
      `AI request body is too large. Share schema, summaries, or a smaller excerpt. Maximum request bytes: ${maxRequestBytes}.`,
    );
  }
}

function getMessageTextChars(message: UIMessage): number {
  if (!message || typeof message !== "object" || !Array.isArray(message.parts)) {
    throw new ChatInputValidationError("Each chat message must include an array of parts.");
  }

  return message.parts.reduce((total, part) => {
    if (part.type === "text" && typeof part.text !== "string") {
      throw new ChatInputValidationError("Chat text parts must include text.");
    }

    return total + (part.type === "text" ? part.text.length : 0);
  }, 0);
}

export function validateChatMessagesForAi(messages: unknown): UIMessage[] {
  if (!Array.isArray(messages)) {
    throw new ChatInputValidationError("Chat messages must be an array.");
  }

  if (messages.length === 0) {
    throw new ChatInputValidationError("At least one chat message is required.");
  }

  const maxMessages = getPositiveIntegerEnv("AI_MAX_CHAT_MESSAGES", defaultMaxChatMessages);

  if (messages.length > maxMessages) {
    throw new ChatInputValidationError(
      `Chat is too long. Start a new chat or summarize before continuing. Maximum messages: ${maxMessages}.`,
    );
  }

  const typedMessages = messages as UIMessage[];
  const maxTextChars = getMaxChatTextChars();
  const textChars = typedMessages.reduce((total, message) => total + getMessageTextChars(message), 0);

  if (textChars > maxTextChars) {
    throw new ChatInputValidationError(
      `Chat prompt is too large. Share schema, summaries, or a smaller excerpt. Maximum text characters: ${maxTextChars}.`,
    );
  }

  return typedMessages;
}
