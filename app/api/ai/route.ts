import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { canAccessNeon, canUsePhiLocalWorkflow, getSession } from "@/app/lib/auth";
import { ChatInputValidationError, isAiChatEnabled, validateAiRequestContentLength, validateChatMessagesForAi } from "@/app/lib/ai-controls";
import { chooseModelTier, getModelForTier, getModelRouteLabel } from "@/app/lib/ai-model";
import { inspectMessagesForPii } from "@/app/lib/pii-guard";
import { checkAiRequestRateLimit } from "@/app/lib/rate-limit";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";
import { checkAiBudget, recordAiPreRoutingBlock, recordAiUsage } from "@/app/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type AiGenerateRequest = {
  prompt?: unknown;
  purpose?: unknown;
};

function asOptionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().slice(0, maxLength);

  return text || null;
}

function buildMessages({ prompt, purpose }: { prompt: unknown; purpose: unknown }): UIMessage[] {
  const promptText = asOptionalText(prompt, 20_000);

  if (!promptText) {
    throw new ChatInputValidationError("Prompt is required.");
  }

  const purposeText = asOptionalText(purpose, 500);
  const text = purposeText ? `Purpose: ${purposeText}\n\n${promptText}` : promptText;

  return validateChatMessagesForAi([
    {
      id: `ai-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
    },
  ]);
}

export async function POST(request: Request) {
  try {
    const crossSiteResponse = rejectCrossSiteRequest(request);

    if (crossSiteResponse) {
      return crossSiteResponse;
    }

    const user = await getSession();

    if (!user) {
      return Response.json({ ok: false, error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
    }

    if (!isAiChatEnabled()) {
      return Response.json(
        { ok: false, error: "AI generation is temporarily disabled by the portal administrator." },
        { status: 503, headers: noStoreHeaders },
      );
    }

    const rateLimit = checkAiRequestRateLimit(user.username);

    if (!rateLimit.allowed) {
      await recordAiPreRoutingBlock(user.username).catch(() => undefined);

      return Response.json(
        { ok: false, error: "Too many AI requests. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            "retry-after": String(rateLimit.retryAfterSeconds ?? 60),
          },
        },
      );
    }

    const budget = await checkAiBudget(user.username);

    if (!budget.allowed) {
      await recordAiPreRoutingBlock(user.username).catch(() => undefined);

      return Response.json(
        { ok: false, error: budget.reason ?? "Model budget reached." },
        { status: 429, headers: noStoreHeaders },
      );
    }

    validateAiRequestContentLength(request);

    const body = (await request.json().catch(() => ({}))) as AiGenerateRequest;
    const messages = buildMessages({ prompt: body.prompt, purpose: body.purpose });
    const piiCheck = inspectMessagesForPii(messages);
    const modelTier = chooseModelTier(piiCheck.messages);
    const modelRouteLabel = getModelRouteLabel(modelTier);
    const neonEnabled = canAccessNeon(user);
    const phiLocalEnabled = canUsePhiLocalWorkflow(user);
    const systemText = [
      "You are RHEAS Intern AI Chat server-side automation.",
      "Use the configured model route; never ask the intern for API keys, model names, database URLs, credentials, or Blob storage keys.",
      "Prefer CE workflow habits, safe SQL, and copyable local Python, R, Jupyter, or marimo code when coding help is requested.",
      "For PHI-local work, use schema and masked examples when possible, avoid unnecessary direct identifiers, and remind users to run code only in an approved local or Rush environment.",
    ].join("\n");

    try {
      const result = await generateText({
        model: getModelForTier(modelTier),
        system: [
          systemText,
          `Signed-in account workflow mode: ${user.workflowMode}. Neon schema access is ${neonEnabled ? "enabled" : "not enabled"} for this account. PHI-scrubbed local analysis support is ${phiLocalEnabled ? "enabled" : "not enabled"} for this account.`,
          neonEnabled
            ? "For this account, Neon work must use the portal's server-side read-only paths and safe SELECT-only SQL patterns."
            : "For this account, do not use or invent HealthMap/Neon table details. Focus on PHI-scrubbed local analysis code, safe methods planning, and artifact review.",
          phiLocalEnabled
            ? "For this account, PHI-local work may generate marimo, Jupyter/Python, or R code that can be copied to an approved local or Rush machine."
            : "For this account, PHI-local analysis is not enabled. Keep outputs to de-identified Neon workflows and cohort-safe artifacts.",
          "Model routing is handled automatically by the portal. Do not ask interns to choose models, deployments, or API keys.",
          piiCheck.masked
            ? `Server-side safety note: identifier values were masked before this model call. Masked categories: ${piiCheck.categories.join(", ")}.`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        messages: await convertToModelMessages(piiCheck.messages),
      });

      await recordAiUsage({
        username: user.username,
        modelTier,
        modelRouteLabel,
        usage: result.totalUsage ?? result.usage,
        status: "success",
      }).catch(() => undefined);

      return Response.json(
        {
          ok: true,
          text: result.text,
          routeManaged: true,
          masked: piiCheck.masked,
          maskedCategories: piiCheck.categories,
        },
        { headers: noStoreHeaders },
      );
    } catch {
      await recordAiUsage({
        username: user.username,
        modelTier,
        modelRouteLabel,
        usage: undefined,
        status: "error",
      }).catch(() => undefined);

      return Response.json(
        { ok: false, error: "AI generation failed. Check server-side Foundry/Azure configuration." },
        { status: 503, headers: noStoreHeaders },
      );
    }
  } catch (error) {
    if (error instanceof ChatInputValidationError) {
      return Response.json({ ok: false, error: error.message }, { status: 400, headers: noStoreHeaders });
    }

    return Response.json(
      { ok: false, error: "AI generation is not configured." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
