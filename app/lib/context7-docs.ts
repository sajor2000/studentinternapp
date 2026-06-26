import { Context7 } from "@upstash/context7-sdk";
import { tool } from "ai";
import { z } from "zod";
import { getOptionalEnv } from "./env";

const sensitiveQueryPattern =
  /\b(?:phi|pii|hipaa|mrn|medical\s+record|patient|dob|date\s+of\s+birth|ssn|social\s+security|password|secret|token|api[_\s-]*key|database[_\s-]*url|connection\s+string|accountkey|sharedaccesssignature|healthmap|ward[_\s-]*crime|ward[_\s-]*311)\b/i;

const sensitiveValuePattern =
  /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}|https?:\/\/\S+|postgres(?:ql)?:\/\/\S+|AccountName=\S+|AccountKey=\S+|sig=[A-Za-z0-9%+/=_-]+)/i;

function context7Enabled() {
  return getOptionalEnv("CONTEXT7_ENABLED")?.toLowerCase() === "true" && Boolean(getOptionalEnv("CONTEXT7_API_KEY"));
}

function assertPublicDocsQuery(...values: string[]) {
  const combined = values.join("\n");

  if (sensitiveQueryPattern.test(combined) || sensitiveValuePattern.test(combined)) {
    throw new Error(
      "Context7 can only be used for generic public documentation lookups. Remove PHI, PII, credentials, private paths, project data, and controlled dataset details before querying docs.",
    );
  }
}

function getContext7Client() {
  return new Context7({
    apiKey: getOptionalEnv("CONTEXT7_API_KEY"),
  });
}

export function getContext7Tools() {
  if (!context7Enabled()) {
    return undefined;
  }

  return {
    resolveLibraryId: tool({
      description:
        "Resolve a public library or framework name to a Context7 library ID. Use only for generic documentation lookup. Do not include PHI, PII, credentials, private source code, file names, database URLs, or controlled data values.",
      inputSchema: z.object({
        query: z
          .string()
          .min(3)
          .max(500)
          .describe("A generic public documentation question or task. Do not include sensitive or project-specific details."),
        libraryName: z
          .string()
          .min(2)
          .max(100)
          .describe("The public library, framework, SDK, API, CLI, or cloud service name."),
      }),
      execute: async ({ query, libraryName }): Promise<string> => {
        assertPublicDocsQuery(query, libraryName);
        return getContext7Client().searchLibrary(query, libraryName, { type: "txt" });
      },
    }),
    queryDocs: tool({
      description:
        "Fetch current public documentation for a library using a Context7 library ID. Use only for generic library/API/framework docs. Do not include PHI, PII, credentials, private source code, file names, database URLs, or controlled data values.",
      inputSchema: z.object({
        libraryId: z
          .string()
          .regex(/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/)
          .describe("The exact Context7-compatible public library ID, such as /vercel/next.js."),
        query: z
          .string()
          .min(3)
          .max(500)
          .describe("A generic public documentation question or task. Do not include sensitive or project-specific details."),
      }),
      execute: async ({ libraryId, query }): Promise<string> => {
        assertPublicDocsQuery(libraryId, query);
        return getContext7Client().getContext(query, libraryId, { type: "txt" });
      },
    }),
  };
}

export function getContext7SystemPrompt() {
  if (!context7Enabled()) {
    return null;
  }

  return [
    "Context7 public documentation lookup is enabled server-side.",
    "Use resolveLibraryId and queryDocs only when current library, framework, SDK, API, CLI, or cloud-service documentation would materially improve the answer.",
    "Before using Context7, rewrite the lookup as a generic public documentation query. Never send PHI, PII, credentials, API keys, database URLs, private source code, private file names, Azure Blob paths, SAS URLs, HealthMap values, row-level records, or proprietary project details to Context7.",
    "If the user's request contains sensitive or project-specific details, answer from local context or ask for a generic library-only documentation question instead of using Context7.",
  ].join("\n");
}
