import { createOpenAI } from "@ai-sdk/openai";
import type { UIMessage } from "ai";
import { getOptionalEnv, getRequiredEnv } from "./env";

export type ModelTier = "cheap" | "default" | "code" | "strong" | "premium";

type AiProvider = "azure" | "openai";

const modelTierRank: Record<ModelTier, number> = {
  cheap: 0,
  default: 1,
  code: 2,
  strong: 3,
  premium: 4,
};

const codeCommands = [
  "/ce-strategy",
  "/ce-ideate",
  "/ce-brainstorm",
  "/ce-plan",
  "/ce-work",
  "/ce-work-beta",
  "/ce-worktree",
  "/ce-simplify-code",
  "/ce-debug",
  "/ce-optimize",
  "/ce-code-review",
  "/ce-doc-review",
  "/ce-resolve-pr-feedback",
  "/ce-test-browser",
  "/ce-test-xcode",
  "/ce-polish",
  "/ce-compound",
  "/ce-compound-refresh",
  "/ce-product-pulse",
  "/ce-riffrec-feedback-analysis",
  "/ce-promote",
  "/ce-commit",
  "/ce-commit-push-pr",
  "/ce-setup",
  "/lfg",
] as const;

const premiumCommands = ["/ce-dogfood-beta", "/ce-proof"] as const;

const premiumIntentWords = [
  "final review",
  "final qa",
  "quality assurance",
  "red team",
  "second pass",
  "executive review",
  "admin review",
] as const;

const codeIntentWords = [
  "dataset recipe",
  "sql",
  "query",
  "python",
  "r code",
  "r script",
  "marimo",
  "debug",
  "error",
  "failing",
  "failed",
  "fix",
  "code review",
  "optimize",
  "refactor",
  "autonomous",
] as const;

const strongIntentWords = [
  "complex sql",
  "multi-table",
  "multi table",
  "join",
  "statistical",
  "analysis plan",
  "compare",
  "synthesize",
] as const;

const cheapIntentWords = [
  "summarize",
  "explain",
  "outline",
] as const;

function normalizeAzureResponsesBaseUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.search = "";
  url.hash = "";

  const normalizedPath = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/openai\/responses$/i, "/openai")
    .replace(/\/openai\/v1$/i, "/openai");

  url.pathname = normalizedPath.endsWith("/openai") ? normalizedPath : `${normalizedPath}/openai`;

  return url.toString().replace(/\/+$/, "");
}

function appendAzureApiVersion(apiVersion: string): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    url.searchParams.set("api-version", apiVersion);

    const requestInput = input instanceof Request ? new Request(url, input) : url;

    return fetch(requestInput, init);
  };
}

function getAiProvider(): AiProvider {
  const configuredProvider = getOptionalEnv("AI_PROVIDER")?.toLowerCase();
  const isProductionRuntime = process.env.NODE_ENV === "production" || Boolean(getOptionalEnv("VERCEL"));

  if (configuredProvider === "openai") {
    if (isProductionRuntime) {
      throw new Error("Production deployments must use AI_PROVIDER=azure for server-side Foundry routing.");
    }

    return "openai";
  }

  if (configuredProvider === "azure") {
    return "azure";
  }

  if (!isProductionRuntime && getOptionalEnv("OPENAI_API_KEY")) {
    return "openai";
  }

  return "azure";
}

function normalizeModelTier(value: string | undefined): ModelTier | null {
  const normalizedValue = value?.toLowerCase();

  if (
    normalizedValue === "cheap" ||
    normalizedValue === "default" ||
    normalizedValue === "code" ||
    normalizedValue === "strong" ||
    normalizedValue === "premium"
  ) {
    return normalizedValue;
  }

  return null;
}

export function capModelTier(tier: ModelTier): ModelTier {
  const maxTier = normalizeModelTier(getOptionalEnv("AI_MAX_MODEL_TIER"));

  if (!maxTier || modelTierRank[tier] <= modelTierRank[maxTier]) {
    return tier;
  }

  return maxTier;
}

function getAzureDeployment(tier: ModelTier): string {
  const tierPrefix = tier.toUpperCase();
  const deployment =
    getOptionalEnv(`AZURE_AI_${tierPrefix}_DEPLOYMENT`) ??
    getOptionalEnv(`AZURE_AI_${tierPrefix}_MODEL`) ??
    getOptionalEnv("AZURE_AI_DEFAULT_DEPLOYMENT") ??
    getOptionalEnv("AZURE_AI_DEFAULT_MODEL");

  if (!deployment) {
    throw new Error(`Azure AI ${tier} deployment is not configured`);
  }

  return deployment;
}

function getOpenAIModelName(tier: ModelTier): string {
  if (tier === "premium") {
    return getOptionalEnv("OPENAI_MODEL_PREMIUM") ?? "gpt-5.5";
  }

  if (tier === "strong") {
    return getOptionalEnv("OPENAI_MODEL_STRONG") ?? "gpt-5.4";
  }

  if (tier === "code") {
    return getOptionalEnv("OPENAI_MODEL_CODE") ?? "gpt-5.3-codex";
  }

  if (tier === "cheap") {
    return getOptionalEnv("OPENAI_MODEL_CHEAP") ?? "gpt-5.4-mini";
  }

  return getOptionalEnv("OPENAI_MODEL_DEFAULT") ?? "gpt-5.3-codex";
}

function getAzureModel(tier: ModelTier) {
  const modelName = getAzureDeployment(tier);
  const endpoint = getOptionalEnv("AZURE_AI_ENDPOINT");
  const apiVersion = getOptionalEnv("AZURE_AI_API_VERSION") ?? "2025-04-01-preview";

  const foundry = createOpenAI({
    name: "azure-foundry",
    apiKey: getOptionalEnv("AZURE_AI_API_KEY") ?? getRequiredEnv("AZURE_API_KEY"),
    baseURL: normalizeAzureResponsesBaseUrl(endpoint ?? getRequiredEnv("AZURE_AI_ENDPOINT")),
    fetch: appendAzureApiVersion(apiVersion),
  });

  return foundry.responses(modelName as Parameters<typeof foundry.responses>[0]);
}

function getOpenAIModel(tier: ModelTier) {
  const openai = createOpenAI({
    apiKey: getRequiredEnv("OPENAI_API_KEY"),
  });
  const modelName = getOpenAIModelName(tier);

  return openai(modelName as Parameters<typeof openai>[0]);
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

export function chooseModelTierFromText(text: string): ModelTier {
  const normalizedText = text.toLowerCase();

  if (
    premiumCommands.some((command) => normalizedText.includes(command)) ||
    premiumIntentWords.some((word) => normalizedText.includes(word))
  ) {
    return "premium";
  }

  if (
    strongIntentWords.some((word) => normalizedText.includes(word))
  ) {
    return "strong";
  }

  if (
    codeCommands.some((command) => normalizedText.includes(command)) ||
    codeIntentWords.some((word) => normalizedText.includes(word))
  ) {
    return "code";
  }

  if (cheapIntentWords.some((word) => normalizedText.includes(word))) {
    return "cheap";
  }

  return "default";
}

export function chooseModelTier(messages: UIMessage[]): ModelTier {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  if (!latestUserMessage) {
    return capModelTier("default");
  }

  return capModelTier(chooseModelTierFromText(getMessageText(latestUserMessage)));
}

export function getModelForTier(tier: ModelTier) {
  return getAiProvider() === "openai" ? getOpenAIModel(tier) : getAzureModel(tier);
}

export function getModelRouteLabel(tier: ModelTier): string {
  const provider = getAiProvider();

  if (provider === "openai") {
    return `OpenAI ${tier} route`;
  }

  return `Azure/Foundry ${tier} route`;
}

export function getDefaultModel() {
  return getModelForTier("default");
}
