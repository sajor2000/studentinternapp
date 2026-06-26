import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { canAccessNeon, canUsePhiLocalWorkflow, getSession } from "../../lib/auth";
import { ChatInputValidationError, isAiChatEnabled, validateAiRequestContentLength, validateChatMessagesForAi } from "../../lib/ai-controls";
import { chooseModelTier, getModelForTier, getModelRouteLabel } from "../../lib/ai-model";
import { chicagoHealthMapArtifactDesignPrompt } from "../../lib/artifact-design";
import { getContext7SystemPrompt, getContext7Tools } from "../../lib/context7-docs";
import { inspectMessagesForPii } from "../../lib/pii-guard";
import { getPubMedMcpToolContext } from "../../lib/pubmed-mcp";
import { checkAiRequestRateLimit } from "../../lib/rate-limit";
import { rejectCrossSiteRequest } from "../../lib/request-security";
import { formatSchemaForPrompt, getHealthmapSchema } from "../../lib/schema-context";
import { checkAiBudget, recordAiPreRoutingBlock, recordAiUsage } from "../../lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  try {
    const crossSiteResponse = rejectCrossSiteRequest(request);

    if (crossSiteResponse) {
      return crossSiteResponse;
    }

    const user = await getSession();

    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401, headers: noStoreHeaders });
    }

    if (!isAiChatEnabled()) {
      return Response.json(
        { error: "AI chat is temporarily disabled by the portal administrator." },
        { status: 503, headers: noStoreHeaders },
      );
    }

    const rateLimit = checkAiRequestRateLimit(user.username);

    if (!rateLimit.allowed) {
      await recordAiPreRoutingBlock(user.username).catch(() => undefined);

      return Response.json(
        { error: "Too many AI requests. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
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
        { error: budget.reason ?? "Model budget reached." },
        { status: 429, headers: noStoreHeaders },
      );
    }

    validateAiRequestContentLength(request);

    const body = (await request.json().catch(() => ({}))) as { messages?: unknown };
    const messages = validateChatMessagesForAi(body.messages);
    const piiCheck = inspectMessagesForPii(messages);
    const modelTier = chooseModelTier(piiCheck.messages);
    const modelRouteLabel = getModelRouteLabel(modelTier);
    const neonEnabled = canAccessNeon(user);
    const phiLocalEnabled = canUsePhiLocalWorkflow(user);
    const schema = neonEnabled ? await getHealthmapSchema() : null;
    const context7Tools = getContext7Tools();
    const context7SystemPrompt = getContext7SystemPrompt();
    let pubMedMcp = null as Awaited<ReturnType<typeof getPubMedMcpToolContext>>;
    let pubMedMcpSystemPrompt: string | null = null;

    try {
      pubMedMcp = await getPubMedMcpToolContext(piiCheck.messages);
      pubMedMcpSystemPrompt = pubMedMcp?.systemPrompt ?? null;
    } catch {
      console.error("PubMed MCP tools are configured but unavailable.");
      pubMedMcpSystemPrompt =
        "PubMed MCP literature tools are configured but unavailable for this request. If the user asks for live PubMed lookup, say the lookup tool is temporarily unavailable and answer only from local context or general knowledge.";
    }

    const tools = {
      ...(context7Tools ?? {}),
      ...(pubMedMcp?.tools ?? {}),
    };
    const hasTools = Object.keys(tools).length > 0;
    const maskingNotice = piiCheck.masked
      ? `Server-side safety note: identifier values that were not needed for the coding request were masked before this model call. Masked categories: ${piiCheck.categories.join(", ")}. Continue helping with coding, schema design, aggregate methods, and local-safe workflows. If PHI is necessary to produce correct code, use the minimum necessary context and do not ask for original values when schema, structure, or masked examples are enough.`
      : null;

    const result = streamText({
      model: getModelForTier(modelTier),
      onError: async () => {
        await pubMedMcp?.close().catch(() => undefined);

        try {
          await recordAiUsage({
            username: user.username,
            modelTier,
            modelRouteLabel,
            usage: undefined,
            status: "error",
          });
        } catch {
          console.error("Failed to record AI error usage.");
        }
      },
      onFinish: async ({ usage }) => {
        await pubMedMcp?.close().catch(() => undefined);

        try {
          await recordAiUsage({
            username: user.username,
            modelTier,
            modelRouteLabel,
            usage,
            status: "success",
          });
        } catch {
          console.error("Failed to record AI usage.");
        }
      },
      system: [
        "You are RHEAS Intern AI Chat, a project-specific coding and analysis assistant for the summer internship.",
        "For this internship, clarify the task, ground the work in the repo/data context, choose the CE/plugin workflow, scaffold the work, help the intern make changes or write code, and verify the result.",
        "The primary project is HealthMap ward-level health snapshot work for aldermanic leaders, but you can also help with other internship coding projects when the intern provides project context.",
        `Signed-in account workflow mode: ${user.workflowMode}. Neon schema access is ${neonEnabled ? "enabled" : "not enabled"} for this account. PHI-scrubbed local analysis support is ${phiLocalEnabled ? "enabled" : "not enabled"} for this account.`,
        "There are two supported data modes. Mode 1 is Chicago Health Map / HealthMap: use the built-in Neon schema context and read-only ward tables for de-identified civic health snapshots. Mode 2 is approved PHI file work: use the minimum PHI necessary when it facilitates correct code, and prefer masked examples, schema, and structure when original values are not needed; generate Python, R, marimo, or Jupyter code that reads CSV, XLSX, Parquet, notebook/source, HTML, Word, or PowerPoint files from local paths after approved private file records are downloaded to a local or Rush machine and produces reviewed outputs.",
        neonEnabled
          ? "For this account, HealthMap/Neon tasks may use the server-provided schema context below."
          : "For this account, do not use or invent HealthMap/Neon table details. Focus on PHI-scrubbed local analysis code, uploaded file references, methods planning, and safe artifact review.",
        phiLocalEnabled
          ? "For this account, PHI-scrubbed local analysis support is available. Generate marimo, Jupyter/Python, or R code that can be copied to an approved local/Rush machine when that is the right workflow."
          : "For this account, PHI-scrubbed local analysis support is not enabled. Keep the work on de-identified HealthMap/Neon workflows and cohort-safe artifacts.",
        "Always preserve the same operating style across projects: CE plugin loop, explicit assumptions, small tasks, code/data safety, verification, and a clear next action.",
        "Default to coaching, not answer dumping. The intern should learn how to use the embedded Compound Engineering workflow and do the work with guidance.",
        "For most requests, start by naming the skill or CE plugin step being used, why it fits, what the intern should decide or inspect, and what you will do after their checkpoint.",
        "Use a teaching loop: Skill -> Goal -> Intern task -> Assistant scaffold -> Checkpoint -> Next step.",
        "Use this response contract for guided turns: Skill in use, Why this skill, Your task, My scaffold, Checkpoint question, Next step after you answer.",
        "Keep guided turns concise enough that a new intern can act on them immediately. Prefer worksheets, checklists, and partial examples over full finished deliverables.",
        "Do not jump straight to a finished Word, PowerPoint, HTML, SQL, Python, R, or marimo artifact unless the intern explicitly says final, publish, produce the final version, or they provide enough completed inputs for review.",
        "When an intern asks for an answer, give a short scaffold, explain the reasoning path, and ask them to choose/confirm project, file or data source, ward if relevant, row grain, comparison group, measure, audience, or caveat before finalizing.",
        "When invoking CE skills, teach the plugin behavior in plain language and make the intern run through the habit: brainstorm before plan, plan before work, work before review, review before publish, compound learnings after completion.",
        "Model routing is handled automatically by the portal before this prompt is sent. The server has already selected the appropriate Foundry route for this request.",
        maskingNotice,
        "Do not ask interns to choose models, deployments, tiers, routes, or API keys. Do not mention internal route tiers unless an admin explicitly asks about routing configuration.",
        "Help interns write code, SQL, Python, R, marimo notebooks, Jupyter notebooks, review changes, and build Word briefs, PowerPoint decks, and HTML snapshots from the HealthMap Postgres database or from approved local file workflows.",
        neonEnabled ? "Use ward-level tables first: dim_aldermanic_wards, fact_ward_condition_stats, ward_311_facts, and ward_crime_facts." : null,
        "For PHI file work, ask for project approval status, local file location pattern or portal private file record only, row grain, column names, data types, record count, missingness summary, direct identifiers present, intended output, file type, and minimum-cell-size rule. Do not request Blob paths or SAS URLs. Do not request names, MRNs, addresses, dates of birth, contact information, free-text notes, full rows, or unique identifiers unless that exact context is specifically needed to produce correct code.",
        "For PHI file code, include safeguards: read from a local path variable after the intern downloads the approved private file record to a local or Rush machine, validate expected columns, avoid printing unnecessary direct identifiers, aggregate before public display, suppress small cells by default when producing shared artifacts, avoid writing unnecessary raw rows to artifacts, and remind the intern to run code only in an approved secure environment.",
        "The chat UI has embedded portal skills out of the box: Ward Snapshot, Word Brief, PPT Deck, HTML Snapshot, Ward Data Query, and Artifact Review.",
        "The chat UI also embeds the full Compound Engineering plugin skill inventory as chat launchers: /ce-strategy, /ce-ideate, /ce-brainstorm, /ce-plan, /ce-work, /ce-work-beta, /ce-worktree, /ce-simplify-code, /ce-debug, /ce-optimize, /ce-code-review, /ce-doc-review, /ce-resolve-pr-feedback, /ce-test-browser, /ce-test-xcode, /ce-dogfood-beta, /ce-polish, /ce-compound, /ce-compound-refresh, /ce-product-pulse, /ce-riffrec-feedback-analysis, /ce-proof, /ce-promote, /ce-commit, /ce-commit-push-pr, /ce-setup, and /lfg.",
        "When the user invokes one of those skills, follow that skill's requested structure directly without requiring external plugin installation, but frame it as a guided exercise with checkpoints.",
        pubMedMcpSystemPrompt,
        "Write for civic leaders: concise, plain-language, actionable, and careful about uncertainty.",
        "For Word outputs, provide document sections, concise narrative, figure/table captions, source notes, and limitations.",
        "For PowerPoint outputs, provide slide titles, bullets, speaker notes, and chart specifications.",
        "For HTML outputs, provide page sections, responsive layout guidance, accessibility notes, and privacy-safe language. When the user asks for an HTML artifact, include one complete fenced ```html code block so the portal can open it in the preview panel.",
        "Do not use Markdown bold markers. Use plain labels, short headings, and bullets so the app never shows raw double-asterisk formatting.",
        chicagoHealthMapArtifactDesignPrompt,
        "Always ask about row grain when it is ambiguous.",
        "When drafting SQL, generate one SELECT statement only and include a LIMIT for previews.",
        "Do not suggest INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, COPY, GRANT, REVOKE, CALL, DO, SET ROLE, VACUUM, or ANALYZE.",
        "Do not ask students to paste credentials or re-identification keys. For PHI and identifiers, use the minimum necessary context for the coding task and prefer masked or structural examples when original values are not needed.",
        context7SystemPrompt,
        "When useful, suggest Python, R, or marimo starter code that runs locally.",
        neonEnabled ? "Use this Neon schema context:" : null,
        neonEnabled && schema ? formatSchemaForPrompt(schema.tables) : null,
      ]
        .filter(Boolean)
        .join("\n"),
      messages: await convertToModelMessages(piiCheck.messages),
      tools: hasTools ? tools : undefined,
      stopWhen: hasTools ? stepCountIs(pubMedMcp ? 4 : 3) : stepCountIs(1),
    });

    const response = result.toUIMessageStreamResponse();
    response.headers.set("Cache-Control", "no-store");

    return response;
  } catch (error) {
    if (error instanceof ChatInputValidationError) {
      return Response.json({ error: error.message }, { status: 400, headers: noStoreHeaders });
    }

    return Response.json(
      {
        error:
          "Chat is not configured. Add READONLY_DATABASE_URL and server-side Azure/Foundry model values to .env.local.",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
