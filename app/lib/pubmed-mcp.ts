import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { UIMessage } from "ai";
import { getOptionalEnv } from "./env";

const defaultPubMedMcpUrl = "https://pubmed.caseyjhand.com/mcp";

const literatureIntentPattern =
  /\b(?:pubmed|pmid|pmcid|doi|mesh|citation|citations|cite|literature|article|paper|papers|journal|abstract|systematic review|meta-analysis|clinical trial|evidence|guideline|biomedical)\b/i;

const sensitivePubMedQueryPattern =
  /\b(?:mrn|medical\s+record|patient\s+id|date\s+of\s+birth|dob|ssn|social\s+security|password|secret|token|api[_\s-]*key|database[_\s-]*url|connection\s+string|accountkey|sharedaccesssignature|blob\s+path|sas\s+url)\b/i;

const sensitivePubMedValuePattern =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}|https?:\/\/\S+|postgres(?:ql)?:\/\/\S+|AccountName=\S+|AccountKey=\S+|sig=[A-Za-z0-9%+/=_-]+)/i;

type PubMedMcpTools = Awaited<ReturnType<MCPClient["tools"]>>;

export type PubMedMcpToolContext = {
  tools: PubMedMcpTools;
  close: () => Promise<void>;
  systemPrompt: string;
};

function pubMedMcpEnabled() {
  return getOptionalEnv("PUBMED_MCP_ENABLED")?.toLowerCase() === "true";
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

function messagesAskForLiterature(messages: UIMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");

  return latestUserMessage ? literatureIntentPattern.test(getMessageText(latestUserMessage)) : false;
}

function collectStrings(value: unknown, strings: string[] = []): string[] {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, strings);
    }

    return strings;
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStrings(item, strings);
    }
  }

  return strings;
}

function assertPubMedInputIsSafe(input: unknown) {
  const combinedText = collectStrings(input).join("\n");

  if (sensitivePubMedQueryPattern.test(combinedText) || sensitivePubMedValuePattern.test(combinedText)) {
    throw new Error(
      "PubMed MCP can only be used for public biomedical literature lookups. Remove identifiers, credentials, private URLs, database URLs, and storage tokens before searching.",
    );
  }
}

function wrapPubMedTools(tools: PubMedMcpTools): PubMedMcpTools {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute;

      if (!execute) {
        return [name, tool];
      }

      return [
        name,
        {
          ...tool,
          execute: async (...args: Parameters<NonNullable<typeof execute>>) => {
            assertPubMedInputIsSafe(args[0]);
            return execute(...args);
          },
        },
      ];
    }),
  ) as PubMedMcpTools;
}

function getPubMedMcpUrl() {
  const rawUrl = getOptionalEnv("PUBMED_MCP_URL") ?? defaultPubMedMcpUrl;
  const url = new URL(rawUrl);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("PUBMED_MCP_URL must be an HTTP or HTTPS MCP endpoint.");
  }

  return url.toString();
}

async function createPubMedMcpClient(): Promise<MCPClient> {
  return createMCPClient({
    clientName: "rheas-intern-ai-chat",
    transport: {
      type: "http",
      url: getPubMedMcpUrl(),
    },
  });
}

export async function getPubMedMcpToolContext(messages: UIMessage[]): Promise<PubMedMcpToolContext | null> {
  if (!pubMedMcpEnabled() || !messagesAskForLiterature(messages)) {
    return null;
  }

  const client = await createPubMedMcpClient();

  try {
    const tools = wrapPubMedTools(await client.tools());

    return {
      tools,
      close: () => client.close(),
      systemPrompt: [
        "PubMed MCP literature tools are available server-side for public biomedical literature tasks.",
        "Use them only for PubMed, PubMed Central, Europe PMC, MeSH, PMID/PMCID/DOI, citation, and public full-text lookup tasks.",
        "Do not send PHI, PII, credentials, private file names, database URLs, Blob paths, SAS URLs, row-level records, controlled dataset values, or private project details to PubMed MCP tools.",
        "Prefer concise citation-backed summaries and include PMID, PMCID, DOI, journal, year, and citation details when tools return them.",
      ].join("\n"),
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
