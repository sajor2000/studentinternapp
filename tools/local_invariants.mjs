#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(repoRoot, ".local-invariants-"));
let failed = 0;

function compileTargetModules() {
  const tsc = resolve(repoRoot, "node_modules/.bin/tsc");

  try {
    execFileSync(
      tsc,
      [
        "--target",
        "ES2022",
        "--module",
        "commonjs",
        "--moduleResolution",
        "node",
        "--esModuleInterop",
        "--skipLibCheck",
        "--strict",
        "--outDir",
        tempDir,
        "--rootDir",
        repoRoot,
        "app/lib/admin-usage.ts",
        "app/lib/artifacts.ts",
        "app/lib/sql-preview.ts",
        "app/lib/ai-model.ts",
        "app/lib/azure-upload.ts",
        "app/lib/ai-controls.ts",
        "app/lib/dataset-recipes.ts",
        "app/lib/env.ts",
        "app/lib/pii-guard.ts",
        "app/lib/rate-limit.ts",
        "app/lib/request-security.ts",
        "app/lib/request-size.ts",
        "app/lib/schema-context.ts",
        "app/lib/usage.ts",
        "app/lib/workspace-docs.ts",
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
  } catch (error) {
    process.stderr.write(error.stdout?.toString() ?? "");
    process.stderr.write(error.stderr?.toString() ?? "");
    throw error;
  }
}

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(name, assertion, expectedPattern) {
  try {
    assertion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    assert(expectedPattern.test(message), `${name} threw unexpected message: ${message}`);
    return;
  }

  throw new Error(`${name} did not throw.`);
}

function listRouteFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listRouteFiles(fullPath);
    }

    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

try {
  process.env.MAX_PREVIEW_ROWS = "50";
  compileTargetModules();

  const requireFromTemp = createRequire(join(tempDir, "runner.cjs"));
  const { buildBudgetWarnings } = requireFromTemp("./app/lib/admin-usage.js");
  const {
    sanitizeArtifactLabel,
    validateArtifactMetadataRequestContentLength,
    validateGeneratedHtmlArtifactSafety,
  } = requireFromTemp("./app/lib/artifacts.js");
  const { getQueryTimeoutMs, validatePreviewSql } = requireFromTemp("./app/lib/sql-preview.js");
  const { isAiChatEnabled, validateAiRequestContentLength, validateChatMessagesForAi } = requireFromTemp("./app/lib/ai-controls.js");
  const { chooseModelTier, chooseModelTierFromText, getModelRouteLabel } = requireFromTemp("./app/lib/ai-model.js");
  const {
    createAzureStoragePath,
    getUploadSasMinutes,
    getSafeStorageUsername,
    hasAzureControlledMetadata,
    isAzureStoragePathOwnedByUser,
    isAzureStoragePathForUser,
    normalizeContentType,
    validateUploadMetadataRequestContentLength,
    validateUploadRequest,
  } = requireFromTemp("./app/lib/azure-upload.js");
  const { sanitizeRecipeText } = requireFromTemp("./app/lib/dataset-recipes.js");
  const { inspectMessagesForPii, maskPiiText } = requireFromTemp("./app/lib/pii-guard.js");
  const { validateAppMetadataRequestContentLength, validateLoginRequestContentLength } = requireFromTemp("./app/lib/request-size.js");
  const { assertSameOriginRequest } = requireFromTemp("./app/lib/request-security.js");
  const {
    checkFixedWindowRateLimit,
    checkLoginRateLimit,
    clearLoginFailures,
    getAiRateLimitConfig,
    getLoginRateLimitConfig,
    getQueryPreviewRateLimitConfig,
    getUploadRateLimitConfig,
    recordLoginFailure,
  } = requireFromTemp("./app/lib/rate-limit.js");
  const { clearSchemaContextCache, getSchemaCacheTtlMs } = requireFromTemp("./app/lib/schema-context.js");
  const { estimateCostUsd, sanitizeSqlTextForActivityLog } = requireFromTemp("./app/lib/usage.js");
  const {
    normalizeWorkspaceDocType,
    normalizeWorkspaceDocVisibility,
    sanitizeWorkspaceText,
    sanitizeWorkspaceTitle,
    toWorkspaceDocRecord,
  } = requireFromTemp("./app/lib/workspace-docs.js");

  check("SQL preview allows one SELECT and caps limit", () => {
    const preview = validatePreviewSql("select ward_id from dim_aldermanic_wards;", 500);

    assert(preview.sql === "select ward_id from dim_aldermanic_wards", "Trailing semicolon should be removed.");
    assert(preview.limit === 50, "Preview limit should respect MAX_PREVIEW_ROWS.");
  });

  check("SQL preview allows semicolons and keywords inside strings", () => {
    const preview = validatePreviewSql("select 'drop table x; still text' as note", 10);

    assert(preview.sql.includes("drop table x"), "String literal should be preserved.");
    assert(preview.limit === 10, "Explicit safe limit should be retained.");
  });

  check("SQL preview blocks multi-statement input", () => {
    assertThrows(
      "multi-statement SQL",
      () => validatePreviewSql("select 1; select 2", 10),
      /one statement/i,
    );
  });

  check("SQL preview blocks write/admin statements", () => {
    assertThrows(
      "write SQL",
      () => validatePreviewSql("with deleted as (delete from users returning *) select * from deleted", 10),
      /only read data/i,
    );
  });

  check("SQL preview blocks comments and unsafe functions", () => {
    assertThrows("commented SQL", () => validatePreviewSql("select 1 -- hide", 10), /comments/i);
    assertThrows("unsafe SQL function", () => validatePreviewSql("select pg_sleep(1)", 10), /blocked database function/i);
  });

  check("SQL preview timeout is positive and capped", () => {
    const previousTimeout = process.env.QUERY_TIMEOUT_MS;

    try {
      delete process.env.QUERY_TIMEOUT_MS;
      assert(getQueryTimeoutMs() === 15000, "Default query timeout should be 15 seconds.");

      process.env.QUERY_TIMEOUT_MS = "2500";
      assert(getQueryTimeoutMs() === 2500, "Configured query timeout should be respected.");

      process.env.QUERY_TIMEOUT_MS = "60000";
      assert(getQueryTimeoutMs() === 30000, "Query timeout should be capped at 30 seconds.");

      process.env.QUERY_TIMEOUT_MS = "not-a-number";
      assert(getQueryTimeoutMs() === 15000, "Invalid query timeout should fall back to default.");
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.QUERY_TIMEOUT_MS;
      } else {
        process.env.QUERY_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  check("schema cache ttl defaults, caps, and can be disabled", () => {
    const previousTtl = process.env.SCHEMA_CACHE_TTL_SECONDS;

    try {
      delete process.env.SCHEMA_CACHE_TTL_SECONDS;
      assert(getSchemaCacheTtlMs() === 3600000, "Schema cache should default to one hour.");

      process.env.SCHEMA_CACHE_TTL_SECONDS = "0";
      assert(getSchemaCacheTtlMs() === 0, "Schema cache should be disabled when TTL is zero.");

      process.env.SCHEMA_CACHE_TTL_SECONDS = "5";
      assert(getSchemaCacheTtlMs() === 5000, "Configured schema cache TTL should be respected.");

      process.env.SCHEMA_CACHE_TTL_SECONDS = "999999";
      assert(getSchemaCacheTtlMs() === 86400000, "Schema cache TTL should be capped at 24 hours.");

      process.env.SCHEMA_CACHE_TTL_SECONDS = "invalid";
      assert(getSchemaCacheTtlMs() === 3600000, "Invalid schema cache TTL should fall back to default.");

      clearSchemaContextCache();
    } finally {
      if (previousTtl === undefined) {
        delete process.env.SCHEMA_CACHE_TTL_SECONDS;
      } else {
        process.env.SCHEMA_CACHE_TTL_SECONDS = previousTtl;
      }
    }
  });

  check("model routing keeps CE and code tasks on code tier", () => {
    assert(chooseModelTierFromText("/ce-work build the recipe") === "code", "CE work should route to code.");
    assert(chooseModelTierFromText("/lfg build the portal") === "code", "LFG autonomous workflow should route to code.");
    assert(chooseModelTierFromText("generate marimo and R code") === "code", "Notebook/code requests should route to code.");
    assert(chooseModelTierFromText("write SQL for a dataset recipe") === "code", "SQL recipe requests should route to code.");
  });

  check("CE plugin launchers stay aligned with chat prompt and model routing", () => {
    const guideSource = readFileSync(resolve(repoRoot, "app/data/student-agent-guide.ts"), "utf8");
    const chatRouteSource = readFileSync(resolve(repoRoot, "app/api/chat/route.ts"), "utf8");
    const aiModelSource = readFileSync(resolve(repoRoot, "app/lib/ai-model.ts"), "utf8");
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const commands = [...guideSource.matchAll(/command: "([^"]+)"/g)]
      .map((match) => match[1])
      .filter((command) => command.startsWith("/"));
    const uniqueCommands = new Set(commands);

    assert(commands.length === uniqueCommands.size, "CE plugin launcher commands should be unique.");
    assert(commands.length === 27, "The embedded CE plugin catalog should expose all 27 launchers.");
    assert(shellSource.includes("cePluginSkills.length"), "The UI should render the live CE launcher count.");

    for (const command of uniqueCommands) {
      assert(chatRouteSource.includes(command), `${command} should be advertised in the chat system prompt.`);
      assert(aiModelSource.includes(command), `${command} should be covered by model routing.`);
    }
  });

  check("model routing reserves premium for final review", () => {
    assert(chooseModelTierFromText("/ce-proof final QA this artifact") === "premium", "CE proof should route to premium.");
    assert(chooseModelTierFromText("summarize this note") === "cheap", "Summary should route to cheap.");
    assert(chooseModelTierFromText("complex multi-table statistical analysis plan") === "strong", "Complex analysis should route to strong.");
  });

  check("model tier cap limits server-side chat routing without changing raw intent detection", () => {
    const previousCap = process.env.AI_MAX_MODEL_TIER;
    const premiumMessage = [
      {
        id: "message-1",
        role: "user",
        parts: [{ type: "text", text: "/ce-proof final QA this artifact" }],
      },
    ];
    const codeMessage = [
      {
        id: "message-2",
        role: "user",
        parts: [{ type: "text", text: "generate marimo and R code" }],
      },
    ];

    try {
      process.env.AI_MAX_MODEL_TIER = "code";
      assert(chooseModelTierFromText("/ce-proof final QA this artifact") === "premium", "Raw intent should still classify premium work.");
      assert(chooseModelTier(premiumMessage) === "code", "Configured cap should downgrade premium chat routing to code.");
      assert(chooseModelTier(codeMessage) === "code", "Configured cap should leave code-tier CE/notebook work unchanged.");

      process.env.AI_MAX_MODEL_TIER = "cheap";
      assert(chooseModelTier(codeMessage) === "cheap", "Emergency cheap cap should downgrade code-tier work.");

      process.env.AI_MAX_MODEL_TIER = "not-a-tier";
      assert(chooseModelTier(premiumMessage) === "premium", "Invalid cap should be ignored by runtime routing.");
    } finally {
      if (previousCap === undefined) {
        delete process.env.AI_MAX_MODEL_TIER;
      } else {
        process.env.AI_MAX_MODEL_TIER = previousCap;
      }
    }
  });

  check("model route labels avoid concrete deployment names", () => {
    const previousProvider = process.env.AI_PROVIDER;
    const previousDeployment = process.env.AZURE_AI_CODE_DEPLOYMENT;
    const previousOpenAiCode = process.env.OPENAI_MODEL_CODE;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVercel = process.env.VERCEL;

    try {
      process.env.NODE_ENV = "test";
      delete process.env.VERCEL;
      process.env.AI_PROVIDER = "azure";
      process.env.AZURE_AI_CODE_DEPLOYMENT = "gpt-5.3-codex-prod";
      assert(getModelRouteLabel("code") === "Azure/Foundry code route", "Azure route labels should not persist deployment names.");
      assert(!getModelRouteLabel("code").includes("gpt-5.3-codex-prod"), "Azure route labels should hide concrete deployment names.");

      process.env.AI_PROVIDER = "openai";
      process.env.OPENAI_MODEL_CODE = "gpt-5.3-codex";
      assert(getModelRouteLabel("code") === "OpenAI code route", "OpenAI route labels should not persist concrete model names.");
      assert(!getModelRouteLabel("code").includes("gpt-5.3-codex"), "OpenAI route labels should hide concrete model names.");

      process.env.NODE_ENV = "production";
      let productionOpenAiRejected = false;
      try {
        getModelRouteLabel("code");
      } catch (error) {
        productionOpenAiRejected =
          error instanceof Error &&
          /Production deployments must use AI_PROVIDER=azure/.test(error.message);
      }
      assert(productionOpenAiRejected, "Production runtime should reject OpenAI provider routing.");

      delete process.env.AI_PROVIDER;
      process.env.OPENAI_API_KEY = "sk-local-fallback-only";
      assert(
        getModelRouteLabel("code") === "Azure/Foundry code route",
        "Production runtime should not infer OpenAI routing from a stray OpenAI key.",
      );
    } finally {
      if (previousProvider === undefined) {
        delete process.env.AI_PROVIDER;
      } else {
        process.env.AI_PROVIDER = previousProvider;
      }

      if (previousDeployment === undefined) {
        delete process.env.AZURE_AI_CODE_DEPLOYMENT;
      } else {
        process.env.AZURE_AI_CODE_DEPLOYMENT = previousDeployment;
      }

      if (previousOpenAiCode === undefined) {
        delete process.env.OPENAI_MODEL_CODE;
      } else {
        process.env.OPENAI_MODEL_CODE = previousOpenAiCode;
      }

      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }

      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }

      if (previousVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = previousVercel;
      }
    }
  });

  check("AI chat kill switch defaults on and recognizes disabled values", () => {
    const previousValue = process.env.AI_CHAT_ENABLED;

    try {
      delete process.env.AI_CHAT_ENABLED;
      assert(isAiChatEnabled(), "AI chat should default to enabled.");

      process.env.AI_CHAT_ENABLED = "true";
      assert(isAiChatEnabled(), "AI chat should accept true.");

      process.env.AI_CHAT_ENABLED = "off";
      assert(!isAiChatEnabled(), "AI chat should disable on off.");

      process.env.AI_CHAT_ENABLED = "0";
      assert(!isAiChatEnabled(), "AI chat should disable on 0.");

      process.env.AI_CHAT_ENABLED = "false";
      assert(!isAiChatEnabled(), "AI chat should disable on false.");
    } finally {
      if (previousValue === undefined) {
        delete process.env.AI_CHAT_ENABLED;
      } else {
        process.env.AI_CHAT_ENABLED = previousValue;
      }
    }
  });

  check("AI chat input limits reject oversized or malformed prompts", () => {
    const previousMaxMessages = process.env.AI_MAX_CHAT_MESSAGES;
    const previousMaxTextChars = process.env.AI_MAX_CHAT_TEXT_CHARS;
    const message = {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "short prompt" }],
    };

    try {
      delete process.env.AI_MAX_CHAT_MESSAGES;
      delete process.env.AI_MAX_CHAT_TEXT_CHARS;
      assert(validateChatMessagesForAi([message])[0] === message, "Valid small chat should pass with defaults.");

      process.env.AI_MAX_CHAT_MESSAGES = "1";
      assertThrows(
        "too many messages",
        () => validateChatMessagesForAi([message, { ...message, id: "message-2" }]),
        /Maximum messages: 1/i,
      );

      process.env.AI_MAX_CHAT_MESSAGES = "40";
      process.env.AI_MAX_CHAT_TEXT_CHARS = "10";
      assertThrows(
        "too much chat text",
        () => validateChatMessagesForAi([{ ...message, parts: [{ type: "text", text: "01234567890" }] }]),
        /Maximum text characters: 10/i,
      );

      assertThrows(
        "oversized AI request body",
        () =>
          validateAiRequestContentLength(
            new Request("https://example.test/api/chat", {
              method: "POST",
              headers: { "content-length": "100000" },
            }),
          ),
        /AI request body is too large/i,
      );

      assertThrows(
        "malformed chat message",
        () => validateChatMessagesForAi([{ id: "message-3", role: "user" }]),
        /array of parts/i,
      );
    } finally {
      if (previousMaxMessages === undefined) {
        delete process.env.AI_MAX_CHAT_MESSAGES;
      } else {
        process.env.AI_MAX_CHAT_MESSAGES = previousMaxMessages;
      }

      if (previousMaxTextChars === undefined) {
        delete process.env.AI_MAX_CHAT_TEXT_CHARS;
      } else {
        process.env.AI_MAX_CHAT_TEXT_CHARS = previousMaxTextChars;
      }
    }
  });

  check("login request body limit rejects oversized credential posts before parsing", () => {
    const previousLoginRequestMaxBytes = process.env.LOGIN_REQUEST_MAX_BYTES;
    const loginSource = readFileSync(resolve(repoRoot, "app/api/login/route.ts"), "utf8");
    const loginSizeCheckIndex = loginSource.indexOf("validateLoginRequestContentLength(request)");
    const loginJsonParseIndex = loginSource.indexOf("request.json");

    try {
      delete process.env.LOGIN_REQUEST_MAX_BYTES;
      validateLoginRequestContentLength(
        new Request("https://example.test/api/login", {
          method: "POST",
          headers: { "content-length": "4096" },
        }),
      );

      assertThrows(
        "oversized default login request",
        () =>
          validateLoginRequestContentLength(
            new Request("https://example.test/api/login", {
              method: "POST",
              headers: { "content-length": "4097" },
            }),
          ),
        /Login request is larger than the 4 KB limit/i,
      );

      process.env.LOGIN_REQUEST_MAX_BYTES = "128";
      assertThrows(
        "oversized configured login request",
        () =>
          validateLoginRequestContentLength(
            new Request("https://example.test/api/login", {
              method: "POST",
              headers: { "content-length": "129" },
            }),
          ),
        /Login request is larger than the 1 KB limit/i,
      );

      assert(loginSource.includes("validateLoginRequestContentLength"), "Login route should import the login request size guard.");
      assert(loginSizeCheckIndex >= 0 && loginSizeCheckIndex < loginJsonParseIndex, "Login route should validate request size before parsing JSON.");
    } finally {
      if (previousLoginRequestMaxBytes === undefined) {
        delete process.env.LOGIN_REQUEST_MAX_BYTES;
      } else {
        process.env.LOGIN_REQUEST_MAX_BYTES = previousLoginRequestMaxBytes;
      }
    }
  });

	  check("request rate limits use fixed windows and env-backed defaults", () => {
	    const previousLoginAttempts = process.env.LOGIN_MAX_FAILED_ATTEMPTS;
	    const previousLoginWindow = process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
	    const previousLoginLock = process.env.LOGIN_LOCK_SECONDS;
	    const previousAiLimit = process.env.AI_RATE_LIMIT_REQUESTS;
	    const previousAiWindow = process.env.AI_RATE_LIMIT_WINDOW_SECONDS;
	    const previousQueryLimit = process.env.QUERY_RATE_LIMIT_REQUESTS;
	    const previousQueryWindow = process.env.QUERY_RATE_LIMIT_WINDOW_SECONDS;
	    const previousUploadLimit = process.env.UPLOAD_RATE_LIMIT_REQUESTS;
	    const previousUploadWindow = process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS;
	    const key = `local-invariant:${Date.now()}:${Math.random()}`;
	    const loginRequest = new Request("https://example.test/api/login", {
	      headers: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 100)}` },
	    });
	    const loginUsername = `login-rate-${Date.now()}-${Math.random()}@example.test`;
	
	    try {
	      delete process.env.LOGIN_MAX_FAILED_ATTEMPTS;
	      delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
	      delete process.env.LOGIN_LOCK_SECONDS;
	      delete process.env.AI_RATE_LIMIT_REQUESTS;
	      delete process.env.AI_RATE_LIMIT_WINDOW_SECONDS;
	      delete process.env.QUERY_RATE_LIMIT_REQUESTS;
	      delete process.env.QUERY_RATE_LIMIT_WINDOW_SECONDS;
	      delete process.env.UPLOAD_RATE_LIMIT_REQUESTS;
	      delete process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS;
	
	      assert(getLoginRateLimitConfig().maxFailedAttempts === 5, "Login failures should default to five attempts.");
	      assert(getLoginRateLimitConfig().windowSeconds === 900, "Login failure window should default to 15 minutes.");
	      assert(getLoginRateLimitConfig().lockSeconds === 900, "Login lock duration should default to 15 minutes.");
	      assert(getAiRateLimitConfig().limit === 20, "AI request limit should default to 20.");
	      assert(getAiRateLimitConfig().windowSeconds === 60, "AI request window should default to 60 seconds.");
	      assert(getQueryPreviewRateLimitConfig().limit === 30, "Query preview limit should default to 30.");
	      assert(getQueryPreviewRateLimitConfig().windowSeconds === 60, "Query preview window should default to 60 seconds.");
	      assert(getUploadRateLimitConfig().limit === 20, "Upload request limit should default to 20.");
	      assert(getUploadRateLimitConfig().windowSeconds === 300, "Upload request window should default to 300 seconds.");
	
	      process.env.LOGIN_MAX_FAILED_ATTEMPTS = "2";
	      process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = "30";
	      process.env.LOGIN_LOCK_SECONDS = "45";
	      assert(getLoginRateLimitConfig().maxFailedAttempts === 2, "Configured login failure limit should be respected.");
	      assert(getLoginRateLimitConfig().windowSeconds === 30, "Configured login failure window should be respected.");
	      assert(getLoginRateLimitConfig().lockSeconds === 45, "Configured login lock duration should be respected.");
	      assert(checkLoginRateLimit(loginRequest, loginUsername).allowed, "Login should pass before failed attempts.");
	      recordLoginFailure(loginRequest, loginUsername);
	      assert(checkLoginRateLimit(loginRequest, loginUsername).allowed, "Login should pass before lock threshold.");
	      recordLoginFailure(loginRequest, loginUsername);
	      const lockedLogin = checkLoginRateLimit(loginRequest, loginUsername);
	      assert(!lockedLogin.allowed, "Login should be locked at the configured failure threshold.");
	      assert(lockedLogin.retryAfterSeconds > 0, "Locked login should include retry timing.");
	      clearLoginFailures(loginRequest, loginUsername);
	      assert(checkLoginRateLimit(loginRequest, loginUsername).allowed, "Successful login should clear failure counters.");
	
	      process.env.AI_RATE_LIMIT_REQUESTS = "2";
	      process.env.AI_RATE_LIMIT_WINDOW_SECONDS = "15";
	      assert(getAiRateLimitConfig().limit === 2, "Configured AI request limit should be respected.");
      assert(getAiRateLimitConfig().windowSeconds === 15, "Configured AI request window should be respected.");

      assert(checkFixedWindowRateLimit(key, { limit: 2, windowSeconds: 60 }).allowed, "First request should pass.");
      assert(checkFixedWindowRateLimit(key, { limit: 2, windowSeconds: 60 }).allowed, "Second request should pass.");
      const blocked = checkFixedWindowRateLimit(key, { limit: 2, windowSeconds: 60 });
      assert(!blocked.allowed, "Third request should be rate limited.");
      assert(blocked.retryAfterSeconds > 0, "Blocked request should include retry timing.");

      process.env.QUERY_RATE_LIMIT_REQUESTS = "not-a-number";
      process.env.QUERY_RATE_LIMIT_WINDOW_SECONDS = "-1";
      assert(getQueryPreviewRateLimitConfig().limit === 30, "Invalid query limit should fall back to default.");
      assert(getQueryPreviewRateLimitConfig().windowSeconds === 60, "Invalid query window should fall back to default.");

      process.env.UPLOAD_RATE_LIMIT_REQUESTS = "3";
	      process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS = "120";
	      assert(getUploadRateLimitConfig().limit === 3, "Configured upload request limit should be respected.");
	      assert(getUploadRateLimitConfig().windowSeconds === 120, "Configured upload window should be respected.");
	    } finally {
	      clearLoginFailures(loginRequest, loginUsername);
	
	      if (previousLoginAttempts === undefined) {
	        delete process.env.LOGIN_MAX_FAILED_ATTEMPTS;
	      } else {
	        process.env.LOGIN_MAX_FAILED_ATTEMPTS = previousLoginAttempts;
	      }
	
	      if (previousLoginWindow === undefined) {
	        delete process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS;
	      } else {
	        process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS = previousLoginWindow;
	      }
	
	      if (previousLoginLock === undefined) {
	        delete process.env.LOGIN_LOCK_SECONDS;
	      } else {
	        process.env.LOGIN_LOCK_SECONDS = previousLoginLock;
	      }
	
	      if (previousAiLimit === undefined) {
	        delete process.env.AI_RATE_LIMIT_REQUESTS;
	      } else {
        process.env.AI_RATE_LIMIT_REQUESTS = previousAiLimit;
      }

      if (previousAiWindow === undefined) {
        delete process.env.AI_RATE_LIMIT_WINDOW_SECONDS;
      } else {
        process.env.AI_RATE_LIMIT_WINDOW_SECONDS = previousAiWindow;
      }

      if (previousQueryLimit === undefined) {
        delete process.env.QUERY_RATE_LIMIT_REQUESTS;
      } else {
        process.env.QUERY_RATE_LIMIT_REQUESTS = previousQueryLimit;
      }

      if (previousQueryWindow === undefined) {
        delete process.env.QUERY_RATE_LIMIT_WINDOW_SECONDS;
      } else {
        process.env.QUERY_RATE_LIMIT_WINDOW_SECONDS = previousQueryWindow;
      }

      if (previousUploadLimit === undefined) {
        delete process.env.UPLOAD_RATE_LIMIT_REQUESTS;
      } else {
        process.env.UPLOAD_RATE_LIMIT_REQUESTS = previousUploadLimit;
      }

      if (previousUploadWindow === undefined) {
        delete process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS;
      } else {
        process.env.UPLOAD_RATE_LIMIT_WINDOW_SECONDS = previousUploadWindow;
      }
    }
	  });

  check("same-origin request guard rejects cross-site state changes", () => {
    assertSameOriginRequest(
      new Request("https://portal.example.test/api/files/upload-url", {
        method: "POST",
        headers: { origin: "https://portal.example.test" },
      }),
    );
    assertSameOriginRequest(
      new Request("https://portal.example.test/api/files/upload-url", {
        method: "POST",
      }),
    );
    assertThrows(
      "cross-site state change",
      () =>
        assertSameOriginRequest(
          new Request("https://portal.example.test/api/files/upload-url", {
            method: "POST",
            headers: { origin: "https://evil.example.test" },
          }),
        ),
      /Cross-site requests are not allowed/i,
    );
  });

  check("state-changing routes reject cross-site POST origins before body parsing", () => {
    const apiRouteFiles = listRouteFiles(resolve(repoRoot, "app/api"));
    const postRoutes = apiRouteFiles.filter((routePath) =>
      readFileSync(routePath, "utf8").includes("export async function POST"),
    );

    assert(postRoutes.length >= 10, "Expected the state-changing API route inventory to be populated.");

    for (const routePath of postRoutes) {
      const source = readFileSync(routePath, "utf8");
      const relativeRoutePath = routePath.replace(`${repoRoot}/`, "");
      const guardIndex = source.indexOf("rejectCrossSiteRequest(request)");
      const bodyParseIndex = source.indexOf("request.json");

      assert(guardIndex >= 0, `${relativeRoutePath} should reject cross-site POST origins.`);

      if (bodyParseIndex >= 0) {
        assert(guardIndex < bodyParseIndex, `${relativeRoutePath} should check request origin before parsing JSON.`);
      }
    }
  });

  check("API routes and private pages require per-user sessions", () => {
    const apiRouteFiles = listRouteFiles(resolve(repoRoot, "app/api"));
    const publicApiRoutes = new Set(["app/api/login/route.ts", "app/api/logout/route.ts"]);

    assert(apiRouteFiles.length >= 15, "Expected the API route inventory to be populated.");

    for (const routePath of apiRouteFiles) {
      const relativeRoutePath = routePath.replace(`${repoRoot}/`, "");
      const source = readFileSync(routePath, "utf8");

      if (publicApiRoutes.has(relativeRoutePath)) {
        continue;
      }

      assert(source.includes("getSession()"), `${relativeRoutePath} should require an authenticated session.`);
      assert(source.includes("Not authenticated."), `${relativeRoutePath} should return a clear unauthenticated error.`);
    }

    const pageSource = readFileSync(resolve(repoRoot, "app/page.tsx"), "utf8");
    const howToUseSource = readFileSync(resolve(repoRoot, "app/how-to-use/page.tsx"), "utf8");

    assert(pageSource.includes("const session = await getSession()"), "Main portal page should read the server session before rendering.");
    assert(pageSource.includes("session ? <ChatShell session={session} /> : <LoginShell />"), "Main portal page should render login shell when no session exists.");
    assert(howToUseSource.includes("const session = await getSession()"), "How-to-use page should read the server session before rendering.");
    assert(howToUseSource.includes("return <LoginShell />"), "How-to-use page should render login shell when no session exists.");
  });

  check("API routes return private no-store responses", () => {
    const apiRouteFiles = listRouteFiles(resolve(repoRoot, "app/api"));
    const noStorePatterns = ["\"Cache-Control\": \"no-store\"", "noStoreHeaders", "privateFileHeaders", "privateArtifactHeaders"];

    assert(apiRouteFiles.length >= 15, "Expected the API route inventory to be populated.");

    for (const routePath of apiRouteFiles) {
      const relativeRoutePath = routePath.replace(`${repoRoot}/`, "");
      const source = readFileSync(routePath, "utf8");

      assert(
        noStorePatterns.some((pattern) => source.includes(pattern)),
        `${relativeRoutePath} should return Cache-Control: no-store for private portal responses.`,
      );
    }
  });

  check("cost estimation uses deployment-configured tier prices", () => {
    process.env.AZURE_AI_CODE_INPUT_USD_PER_1M = "2";
    process.env.AZURE_AI_CODE_OUTPUT_USD_PER_1M = "20";
    const cost = estimateCostUsd({
      modelTier: "code",
      modelRouteLabel: "Azure/Foundry code route",
      usage: {
        inputTokens: 1000,
        outputTokens: 2000,
      },
    });

    assert(cost === 0.042, "Configured code-tier prices should drive estimated cost.");
  });

  check("cost estimation falls back to known model pricing when tier prices are absent", () => {
    delete process.env.AZURE_AI_CHEAP_INPUT_USD_PER_1M;
    delete process.env.AZURE_AI_CHEAP_OUTPUT_USD_PER_1M;
    const cost = estimateCostUsd({
      modelTier: "cheap",
      modelRouteLabel: "Azure/Foundry gpt-5.4-mini (cheap)",
      usage: {
        inputTokens: 1000,
        outputTokens: 1000,
      },
    });

    assert(cost === 0.00525, "Known model pricing should remain a fallback for local estimation.");
  });

  check("app metadata request size guard rejects oversized JSON before parsing", () => {
    assertThrows(
      "oversized app metadata request",
      () =>
        validateAppMetadataRequestContentLength(
          new Request("https://example.test/api/workspace-docs", {
            method: "POST",
            headers: { "content-length": "1000000" },
          }),
        ),
      /Metadata request is larger/i,
    );
  });

  check("admin usage budget warnings flag monthly and daily spend thresholds", () => {
    const warnings = buildBudgetWarnings({
      budgets: { perUserDailyUsd: 5, monthlyUsd: 100 },
      totals: { monthlyEstimatedCostUsd: 85 },
      users: [
        { displayName: "Intern 01", dailyEstimatedCostUsd: 4 },
        { displayName: "Intern 02", dailyEstimatedCostUsd: 6 },
        { displayName: "Intern 03", dailyEstimatedCostUsd: 1 },
      ],
    });

    assert(warnings.length === 3, "Expected one monthly warning and two per-user daily warnings.");
    assert(warnings[0].level === "warning", "Monthly spend below 100% should be a warning.");
    assert(warnings[0].message.includes("85%"), "Monthly warning should include budget percentage.");
    assert(warnings[1].message.includes("Intern 01"), "80% daily threshold should include the user.");
    assert(warnings[2].level === "critical", "Daily spend over 100% should be critical.");

    const noWarnings = buildBudgetWarnings({
      budgets: { perUserDailyUsd: 5, monthlyUsd: 100 },
      totals: { monthlyEstimatedCostUsd: 30 },
      users: [{ displayName: "Intern 04", dailyEstimatedCostUsd: 2 }],
    });

    assert(noWarnings.length === 0, "Spend below 80% should not produce budget warnings.");
  });

  check("upload validation accepts only supported controlled file types", () => {
    const csv = validateUploadRequest({ fileName: "ward-data.csv", sizeBytes: 128 });
    const notebook = validateUploadRequest({ fileName: "analysis.ipynb", sizeBytes: 128 });
    const python = validateUploadRequest({ fileName: "analysis.py", sizeBytes: 128 });
    const rScript = validateUploadRequest({ fileName: "analysis.R", sizeBytes: 128 });
    const quarto = validateUploadRequest({ fileName: "analysis.qmd", sizeBytes: 128 });

    assert(csv.extension === ".csv", "CSV extension should be accepted.");
    assert(notebook.extension === ".ipynb", "Jupyter notebooks should be accepted as private PHI-local file records.");
    assert(python.extension === ".py", "Python source files should be accepted as private PHI-local file records.");
    assert(rScript.extension === ".r", "R source files should normalize and be accepted as private PHI-local file records.");
    assert(quarto.extension === ".qmd", "Quarto source files should be accepted as private PHI-local file records.");
    assertThrows(
      "unsupported upload",
      () => validateUploadRequest({ fileName: "raw-export.exe", sizeBytes: 128 }),
      /supported uploads/i,
    );
    assertThrows(
      "empty upload",
      () => validateUploadRequest({ fileName: "empty.csv", sizeBytes: 0 }),
      /file size/i,
    );
    assertThrows(
      "oversized upload metadata request",
      () =>
        validateUploadMetadataRequestContentLength(
          new Request("https://example.test/api/files/upload-url", {
            method: "POST",
            headers: { "content-length": "100000" },
          }),
        ),
      /Upload metadata request is larger/i,
    );
  });

  check("upload content types are derived from allowed extensions", () => {
    assert(normalizeContentType(".csv") === "text/csv", "CSV should always use text/csv.");
    assert(normalizeContentType(".ipynb") === "application/x-ipynb+json", "Jupyter notebooks should use a notebook content type.");
    assert(normalizeContentType(".PY") === "text/x-python", "Python source should normalize by extension.");
    assert(normalizeContentType(".R") === "text/x-r-source", "R source should normalize by extension.");
    assert(normalizeContentType(".HTML") === "text/html", "HTML should normalize by extension.");
    assert(normalizeContentType(".unknown") === "application/octet-stream", "Unknown extensions should fall back to octet-stream.");
  });

  check("upload SAS expiry stays short-lived", () => {
    const previousSasMinutes = process.env.AZURE_UPLOAD_SAS_MINUTES;

    try {
      delete process.env.AZURE_UPLOAD_SAS_MINUTES;
      assert(getUploadSasMinutes() === 10, "Upload SAS expiry should default to 10 minutes.");

      process.env.AZURE_UPLOAD_SAS_MINUTES = "5";
      assert(getUploadSasMinutes() === 5, "Configured short SAS expiry should be respected.");

      process.env.AZURE_UPLOAD_SAS_MINUTES = "60";
      assert(getUploadSasMinutes() === 15, "Upload SAS expiry should be capped at 15 minutes.");

      process.env.AZURE_UPLOAD_SAS_MINUTES = "invalid";
      assert(getUploadSasMinutes() === 10, "Invalid SAS expiry should fall back to the default.");
    } finally {
      if (previousSasMinutes === undefined) {
        delete process.env.AZURE_UPLOAD_SAS_MINUTES;
      } else {
        process.env.AZURE_UPLOAD_SAS_MINUTES = previousSasMinutes;
      }
    }
  });

  check("Blob storage usernames are stable and per-user safe", () => {
    const safe = getSafeStorageUsername("Intern 01+Rush.Email@example.org");
    const sameLabelDifferentUser = getSafeStorageUsername("Intern 01 Rush Email@example.org");

    assert(safe === "intern-01-rush-email-example-org-9f6ee73b99ab", "Unsafe username characters should normalize with a stable hash suffix.");
    assert(sameLabelDifferentUser === "intern-01-rush-email-example-org-fb4608608273", "Hash suffix should distinguish usernames that share a sanitized label.");
    assert(safe !== sameLabelDifferentUser, "Distinct usernames should not share a Blob namespace after normalization.");
    assert(getSafeStorageUsername("A".repeat(120)).length <= 80, "Storage username should be bounded.");
  });

  check("Blob storage paths stay scoped by workflow prefix and safe username", () => {
    const date = new Date("2026-06-25T12:00:00.000Z");
    const uploadPath = createAzureStoragePath({
      prefix: "uploads",
      username: "Intern 01+Rush.Email@example.org",
      extension: "CSV",
      date,
      id: "upload-id",
    });
    const artifactPath = createAzureStoragePath({
      prefix: "artifacts",
      username: "Intern 01+Rush.Email@example.org",
      extension: ".HTML",
      date,
      id: "artifact-id",
    });

    assert(uploadPath === "uploads/intern-01-rush-email-example-org-9f6ee73b99ab/2026-06-25/upload-id.csv", "Upload path should use the per-user upload prefix.");
    assert(artifactPath === "artifacts/intern-01-rush-email-example-org-9f6ee73b99ab/2026-06-25/artifact-id.html", "Generated artifact path should use the per-user artifact prefix.");
  });

  check("Blob storage path ownership helper rejects normalized-username collisions", () => {
    const storagePath = createAzureStoragePath({
      prefix: "uploads",
      username: "Intern 01+Rush.Email@example.org",
      extension: ".csv",
      date: new Date("2026-06-25T12:00:00.000Z"),
      id: "upload-id",
    });

    assert(
      isAzureStoragePathForUser({
        storagePath,
        prefix: "uploads",
        username: "Intern 01+Rush.Email@example.org",
      }),
      "Owner should match their own generated storage path.",
    );
    assert(
      !isAzureStoragePathForUser({
        storagePath,
        prefix: "uploads",
        username: "Intern 01 Rush Email@example.org",
      }),
      "A distinct username with the same sanitized label should not match the path.",
    );
    assert(
      !isAzureStoragePathForUser({
        storagePath,
        prefix: "artifacts",
        username: "Intern 01+Rush.Email@example.org",
      }),
      "A matching user under the wrong workflow prefix should not match the path.",
    );
  });

  check("Blob storage owner helper accepts only controlled per-user namespaces", () => {
    const uploadPath = createAzureStoragePath({
      prefix: "uploads",
      username: "Intern 01+Rush.Email@example.org",
      extension: ".csv",
      date: new Date("2026-06-25T12:00:00.000Z"),
      id: "upload-id",
    });
    const artifactPath = createAzureStoragePath({
      prefix: "artifacts",
      username: "Intern 01+Rush.Email@example.org",
      extension: ".html",
      date: new Date("2026-06-25T12:00:00.000Z"),
      id: "artifact-id",
    });

    assert(
      isAzureStoragePathOwnedByUser({
        storagePath: uploadPath,
        username: "Intern 01+Rush.Email@example.org",
      }),
      "Upload path should be recognized as owned by the matching user.",
    );
    assert(
      isAzureStoragePathOwnedByUser({
        storagePath: artifactPath,
        username: "Intern 01+Rush.Email@example.org",
      }),
      "Generated artifact path should be recognized as owned by the matching user.",
    );
    assert(
      !isAzureStoragePathOwnedByUser({
        storagePath: "tmp/intern-01-rush-email-example-org-9f6ee73b99ab/2026-06-25/file.csv",
        username: "Intern 01+Rush.Email@example.org",
      }),
      "Unexpected prefixes should not be recognized as owned controlled Blob paths.",
    );
    assert(
      !isAzureStoragePathOwnedByUser({
        storagePath: artifactPath,
        username: "Intern 01 Rush Email@example.org",
      }),
      "Distinct usernames with the same readable slug should not share generated artifact access.",
    );
  });

  check("Blob storage requires portal-controlled metadata", () => {
    assert(
      hasAzureControlledMetadata({ app: "rheas-intern-ai-chat", controlleddata: "true" }),
      "Portal-generated Blob metadata should be accepted.",
    );
    assert(
      !hasAzureControlledMetadata({ app: "rheas-intern-ai-chat" }),
      "Missing controlled-data metadata should be rejected.",
    );
    assert(
      !hasAzureControlledMetadata({ app: "external-uploader", controlleddata: "true" }),
      "Non-portal Blob metadata should be rejected.",
    );
  });

  check("PII guard masks durable chat titles and all message-role text", () => {
    const title = maskPiiText("Review patient id R12345 for alex@example.org");
    const result = inspectMessagesForPii([
      {
        id: "message-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Build a notebook for MRN: A12345 and phone 312-555-1212.",
          },
        ],
      },
      {
        id: "message-2",
        role: "assistant",
        parts: [{ type: "text", text: "Prior assistant note included patient id B67890." }],
      },
    ]);

    assert(title.text.includes("[MASKED_PATIENT_IDENTIFIER]"), "Patient identifier in chat title should be masked.");
    assert(title.text.includes("[MASKED_EMAIL]"), "Email in chat title should be masked.");
    assert(result.masked, "User message should report masking.");
    assert(result.messages[0].parts[0].text.includes("[MASKED_PATIENT_IDENTIFIER]"), "MRN-like text should be masked in saved user message.");
    assert(result.messages[0].parts[0].text.includes("[MASKED_PHONE]"), "Phone should be masked in saved user message.");
    assert(result.messages[1].parts[0].text.includes("[MASKED_PATIENT_IDENTIFIER]"), "Assistant text should also be masked before durable storage.");
  });

  check("PII guard preserves pasted table shape while masking identifier columns", () => {
    const text = [
      "mrn,dob,measure",
      "ABC123,1960-01-01,12",
      "XYZ789,1970-02-02,14",
    ].join("\n");
    const masked = maskPiiText(text);

    assert(masked.text.includes("mrn,dob,measure"), "Header row should be preserved.");
    assert(masked.text.includes("[MASKED_PATIENT_IDENTIFIER],[MASKED_DOB],12"), "Identifier cells should be masked while values remain.");
    assert(masked.text.includes("[MASKED_PATIENT_IDENTIFIER],[MASKED_DOB],14"), "All pasted rows should be masked.");
  });

  check("CE workspace docs stay private by default and only safe doc types can be shared", () => {
    assert(normalizeWorkspaceDocType("brainstorm") === "brainstorm", "Known CE doc type should be preserved.");
    assert(normalizeWorkspaceDocType("unknown") === "work_log", "Unknown CE doc type should fall back to work log.");
    assert(
      normalizeWorkspaceDocVisibility({ value: undefined, docType: "compound_learning" }) === "private",
      "CE workspace docs should default to private.",
    );
    assert(
      normalizeWorkspaceDocVisibility({ value: "shared", docType: "compound_learning" }) === "shared",
      "Compound learnings should be promotable to shared cohort visibility.",
    );
    assertThrows(
      "sharing private CE plan",
      () => normalizeWorkspaceDocVisibility({ value: "shared", docType: "plan" }),
      /Only compound learnings and handoffs/i,
    );
    assert(sanitizeWorkspaceTitle("  A\tCE\nplan  ") === "A CE plan", "CE doc titles should collapse whitespace.");
    assert(sanitizeWorkspaceText("  line 1\n\nline 2  ", 50) === "line 1\n\nline 2", "Markdown body should preserve line breaks.");
    assert(
      sanitizeWorkspaceTitle("Handoff for MRN: A12345") === "Handoff for [MASKED_PATIENT_IDENTIFIER]",
      "CE workspace titles should mask direct identifiers before durable storage.",
    );
    assert(
      sanitizeWorkspaceText("Plan\n\npatient_id,result,value\nA12345,positive,7", 200) ===
        "Plan\n\npatient_id,result,value\n[MASKED_PATIENT_IDENTIFIER],positive,7",
      "CE workspace bodies should preserve markdown shape while masking identifier columns before durable storage.",
    );

    const record = toWorkspaceDocRecord(
      {
        id: "doc-1",
        username: "intern01",
        project_label: "Ward snapshot",
        doc_type: "compound_learning",
        title: "Learning",
        body_md: "Use /ce-review before publish.",
        source_command: "/ce-compound",
        visibility: "shared",
        created_at: "2026-06-25T12:00:00.000Z",
        updated_at: "2026-06-25T12:00:00.000Z",
      },
      "intern02",
      "intern",
    );

    assert(record.ownerUsername === "intern01", "CE workspace doc owner should be retained.");
    assert(record.canEdit === false, "Other interns should not be able to edit shared CE docs.");
  });

  check("dataset recipe metadata masks direct identifiers before durable storage", () => {
    assert(sanitizeRecipeText("  Ward\tvisit count\n ", 120) === "Ward visit count", "Recipe metadata should collapse whitespace.");
    assert(
      sanitizeRecipeText("Recipe for patient id R12345 and alex@example.org", 120) ===
        "Recipe for [MASKED_PATIENT_IDENTIFIER] and [MASKED_EMAIL]",
      "Recipe titles should mask direct identifiers before storage.",
    );
    assert(
      sanitizeRecipeText("patient_id,result,value\nA12345,positive,7", 120) ===
        "patient_id,result,value [MASKED_PATIENT_IDENTIFIER],positive,7",
      "Recipe requests should mask identifier-looking pasted rows before storage.",
    );
    assert(sanitizeRecipeText("x".repeat(150), 120)?.length === 120, "Recipe metadata should enforce the final length cap.");
  });

  check("private file starters include local aggregate summary scaffold", () => {
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");

    assert(shellSource.includes("local_analysis_summary.html"), "Private file starters should write an HTML summary scaffold.");
    assert(shellSource.includes("aggregate_tables = []"), "Python starters should require explicit aggregate tables.");
    assert(shellSource.includes("aggregate_tables <- list()"), "R starter should require explicit aggregate tables.");
    assert(shellSource.includes("function isNotebookOrSourceExtension(extension: string)"), "Private file starters should distinguish uploaded notebook/source records from tabular data files.");
    assert(shellSource.includes("function buildUploadedSourceStarterCode"), "Private notebook/source records should receive a source-review starter instead of a dataframe reader.");
    assert(shellSource.includes("Select a CSV, XLSX, or Parquet private file record for tabular PHI analysis."), "Source-review starters should direct tabular analysis to data file records.");
    assert(shellSource.includes("Do not print notebook/source contents or paste full source into chat"), "Source-review starters should avoid printing code contents by default.");
    assert(shellSource.includes("file_extension == '.ipynb'"), "Source-review starters should profile uploaded Jupyter notebooks structurally.");
    assert(shellSource.includes("isNotebookOrSourceExtension(normalizedExtension)"), "Private file starter generation should branch on source extensions before reader snippets.");
    assert(shellSource.includes("Do not upload or publish this row-level CSV as a reviewed artifact."), "Private file starters should label row-level CSV outputs as local-only.");
    assert(shellSource.includes("Do not add row-level extracts."), "Private file HTML summaries should reject row-level extracts.");
    assert(shellSource.includes("Source file path is retained locally outside this artifact."), "Private file HTML summaries should not embed local file paths.");
    assert(shellSource.includes("analysis_profile = {'rows': len(analysis_df), 'columns': list(analysis_df.columns)}"), "marimo private file starter should display only a profile by default.");
    assert(shellSource.includes("print({'rows': len(analysis_df), 'columns': list(analysis_df.columns)})"), "Python private file starters should print only a profile by default.");
    assert(shellSource.includes("print(dim(analysis_df))"), "R private file starter should print dimensions rather than row previews.");
    assert(shellSource.includes("direct_identifier_candidates"), "Private file starters should include default direct identifier column detection.");
    assert(shellSource.includes("'medical_record_number'"), "Private file starters should detect common MRN column names by default.");
    assert(shellSource.includes("'social_security_number'"), "Private file starters should detect high-risk direct identifier columns by default.");
    assert(shellSource.includes("Review this list before analysis; add project-specific identifier columns if needed."), "Private file starters should tell interns to review default identifier detection.");
    assert(shellSource.includes("normalize_column_name <- function(value)"), "R private file starter should normalize identifier column names before matching.");
    assert(shellSource.includes("def normalize_column_name(value):"), "Python private file starters should normalize identifier column names before matching.");
    assert(shellSource.includes("re.sub(r'[^a-z0-9]+'"), "Python private file starters should normalize punctuation in identifier column names.");
    assert(shellSource.includes("vapply(names(df), normalize_column_name, character(1))"), "R private file starter should normalize every column name before identifier matching.");
    assert(shellSource.includes("analysis_df = df.drop(columns=direct_identifier_columns, errors='ignore')"), "Python private file starters should drop detected identifier columns before local output.");
    assert(shellSource.includes("analysis_df <- df %>% select(-any_of(direct_identifier_columns))"), "R private file starter should drop detected identifier columns before local output.");
    assert(!shellSource.includes("print(analysis_df.head())"), "Python private file starters should not print row-level previews by default.");
    assert(!shellSource.includes("analysis_df.head()"), "marimo private file starter should not display row-level previews by default.");
    assert(!shellSource.includes("print(utils::head(analysis_df))"), "R private file starter should not print row-level previews by default.");
    assert(!shellSource.includes("Source file: {html.escape(local_path)}"), "Python starters should not write local paths into HTML summaries.");
    assert(!shellSource.includes("html_escape(local_path)"), "R starters should not write local paths into HTML summaries.");
    assert(shellSource.includes("for (index in seq_along(aggregate_tables))"), "R starter should append reviewed aggregate tables to HTML.");
    assert(shellSource.includes("data_frame_to_html(safe_table)"), "R starter should render only suppressed aggregate tables to HTML.");
    assert(shellSource.includes("return analysis_df, analysis_profile"), "marimo starter should pass analysis objects and profile into the summary cell.");
    assert(!shellSource.includes("return analysis_df, analysis_profile, df"), "marimo starter should not return the raw input data frame after identifier removal.");
    assert(shellSource.includes("def _(analysis_df, html, pd):"), "marimo summary cell should not receive the local path dependency.");
    assert(shellSource.includes("# Cell 4: write local-only CSV and aggregate-safe HTML summary"), "Jupyter starter should expose the summary output cell.");
  });

  check("dataset recipe starters keep local SQL read-only and capped", () => {
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");

    assert(shellSource.includes("require_readonly_select"), "Dataset recipe starters should validate saved SQL before local execution.");
    assert(shellSource.includes("Recipe SQL must stay read-only before local execution."), "Dataset recipe starters should return a clear local SQL safety error.");
    assert(shellSource.includes("LOCAL_ROW_LIMIT = 50000"), "Python recipe starter should cap local reads outside the portal preview route.");
    assert(shellSource.includes("local_row_limit <- 50000L"), "R recipe starter should cap local reads outside the portal preview route.");
    assert(shellSource.includes("SAFE_SQL = require_readonly_select(SQL)"), "Python starter should execute the locally validated SQL wrapper.");
    assert(shellSource.includes("safe_sql <- require_readonly_select(sql)"), "R starter should execute the locally validated SQL wrapper.");
    assert(shellSource.includes("Set READONLY_DATABASE_URL to the approved read-only Neon role before running this starter."), "Dataset recipe starters should reject likely owner/admin Neon URLs before local execution.");
    assert(shellSource.includes("urlparse(database_url).username"), "Python/Jupyter/marimo recipe starters should inspect the local Neon URL username.");
    assert(shellSource.includes("readonly_user <-"), "R recipe starter should inspect the local Neon URL username.");
    assert(shellSource.includes("'owner', 'admin', 'loader', 'write'"), "Python recipe starters should block likely write-capable local Neon roles.");
    assert(shellSource.includes("owner|admin|loader|write"), "R recipe starter should block likely write-capable local Neon roles.");
    assert(!shellSource.includes("pd.read_sql_query(text(SQL), conn)"), "Python recipe starter should not execute raw SQL directly.");
    assert(!shellSource.includes("dbGetQuery(con, sql)"), "R recipe starter should not execute raw SQL directly.");
    assert(shellSource.includes("recipe_profile = {'rows': len(df), 'columns': list(df.columns)}"), "marimo recipe starter should display a profile instead of row previews.");
    assert(shellSource.includes("print({'rows': len(df), 'columns': list(df.columns)})"), "Python/Jupyter recipe starters should print a profile instead of row previews.");
    assert(shellSource.includes("print(dim(df))"), "R recipe starter should print dimensions instead of row previews.");
    assert(!shellSource.includes("df.head()"), "Dataset recipe starters should not display row-level previews by default.");
    assert(!shellSource.includes("print(df.head())"), "Python recipe starter should not print row-level previews by default.");
    assert(!shellSource.includes("print(utils::head(df))"), "R recipe starter should not print row-level previews by default.");
    assert(shellSource.includes("Do not publish this row-level CSV as a reviewed artifact without approval."), "Dataset recipe starters should label local row-level CSV output as non-publishable by default.");
  });

  check("auth fallback honors active account status", () => {
    const authSource = readFileSync(resolve(repoRoot, "app/lib/auth.ts"), "utf8");
    const loginSource = readFileSync(resolve(repoRoot, "app/api/login/route.ts"), "utf8");
    const logoutSource = readFileSync(resolve(repoRoot, "app/api/logout/route.ts"), "utf8");

    assert(loginSource.includes("typeof body.username !== \"string\""), "Login should reject malformed usernames before auth work.");
    assert(loginSource.includes("typeof body.password !== \"string\""), "Login should reject malformed passwords before auth work.");
    assert(loginSource.includes("const username = body.username.trim();"), "Login should normalize usernames once before auth work.");
    assert(loginSource.includes("checkLoginRateLimit(request, username)"), "Login rate limiting should use the normalized username.");
    assert(loginSource.includes("verifyLogin(username, password)"), "Login verification should use normalized username and raw password.");
    assert(loginSource.includes("recordLoginFailure(request, username)"), "Login failure tracking should use the normalized username.");
    assert(loginSource.includes("clearLoginFailures(request, username)"), "Successful login should clear failures for the normalized username.");
    assert(authSource.includes("and is_active = true"), "Neon auth should reject disabled accounts.");
    assert(authSource.includes("user.isActive !== false"), "Env fallback auth should reject disabled accounts.");
    assert(authSource.includes("typeof user.isActive === \"boolean\""), "Env fallback auth should reject malformed active-account flags.");
    assert(authSource.includes("const fallbackUser = getFallbackUser(user.username);"), "Env fallback sessions should be revalidated against current configured active users.");
    assert(authSource.includes("envAuthFallbackExplicitlyEnabled"), "Env fallback login should require an explicit flag when DATABASE_URL is configured.");
    assert(authSource.includes("if (neonUser || !envAuthFallbackExplicitlyEnabled())"), "Env fallback login should only bypass a missing Neon user when fallback is explicitly enabled.");
    assert(authSource.includes("minimumSessionSecretLength = 32"), "Runtime auth should reject short session secrets.");
    assert(authSource.includes("placeholderSessionSecrets"), "Runtime auth should reject placeholder session secrets.");
    assert(authSource.includes("getSessionSecret()"), "Session signing should use the runtime secret quality gate.");
    assert(logoutSource.includes("getSessionCookieOptions"), "Logout should expire the session cookie with matching cookie options.");
    assert(logoutSource.includes("maxAge: 0"), "Logout should explicitly expire the session cookie.");
  });

  check("client workflow modes steer Neon and PHI-local affordances", () => {
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const howToUseSource = readFileSync(resolve(repoRoot, "app/how-to-use/page.tsx"), "utf8");

    assert(shellSource.includes("neonWorkflowEnabled"), "Client should derive Neon workflow access from the signed-in account.");
    assert(shellSource.includes("phiLocalWorkflowEnabled"), "Client should derive PHI-local workflow access from the signed-in account.");
    assert(shellSource.includes("Neon query preview is not enabled for this account."), "Client should guard stale Neon preview actions.");
    assert(shellSource.includes("Dataset recipes from Neon SQL are not enabled for this account."), "Client should guard stale Neon recipe saves.");
    assert(shellSource.includes("if (!neonWorkflowEnabled)"), "Client should avoid loading Neon recipe metadata for PHI-local-only accounts.");
    assert(shellSource.includes("Local files"), "PHI-local accounts should have a file-first sidebar affordance.");
    assert(shellSource.includes("vc-prompt-safety"), "Chat composer should keep the PHI/credential safety warning visible at the prompt.");
    assert(shellSource.includes("Do not paste names, MRNs, DOBs, contact info, credentials, re-identification keys, or full row extracts"), "PHI-local composer warning should name the sensitive inputs interns must not paste.");
    assert(shellSource.includes("Use de-identified HealthMap/Neon context only"), "Neon composer warning should keep de-identified-only workflow expectations visible.");
    assert(howToUseSource.includes("neonWorkflowEnabled"), "Onboarding guide should derive Neon setup visibility from the signed-in account.");
    assert(howToUseSource.includes("phiLocalWorkflowEnabled"), "Onboarding guide should derive PHI-local setup visibility from the signed-in account.");
    assert(howToUseSource.includes("visibleCommandBlocks"), "Onboarding guide should filter setup commands by workflow mode.");
    assert(howToUseSource.includes("!block.label.toLowerCase().includes(\"neon\")"), "PHI-local-only onboarding should hide Neon setup commands.");
    assert(howToUseSource.includes("Local/Rush notebook workflow"), "PHI-local onboarding should show local/Rush notebook guidance.");
    assert(howToUseSource.includes("server-side read-only Neon URL"), "Onboarding guide should keep Neon credentials server-side for portal work.");
    assert(howToUseSource.includes("approved read-only development workflows"), "Onboarding guide should limit local Neon MCP setup to approved read-only workflows.");
    assert(howToUseSource.includes("without receiving portal Foundry keys or model-route settings"), "Onboarding guide should not make local CE plugin use depend on portal model secrets.");
    assert(howToUseSource.includes("Model routing is automatic in the portal"), "Onboarding guide should tell interns that portal model routing is automatic.");
  });

  check("private file uploads require PHI-local workflow access", () => {
    const nextConfigSource = readFileSync(resolve(repoRoot, "next.config.ts"), "utf8");
    const uploadUrlSource = readFileSync(resolve(repoRoot, "app/api/files/upload-url/route.ts"), "utf8");
    const completeSource = readFileSync(resolve(repoRoot, "app/api/files/complete/route.ts"), "utf8");
    const filesSource = readFileSync(resolve(repoRoot, "app/api/files/route.ts"), "utf8");
    const fileOpenSource = readFileSync(resolve(repoRoot, "app/api/files/open/route.ts"), "utf8");
    const artifactsSource = readFileSync(resolve(repoRoot, "app/api/artifacts/route.ts"), "utf8");
    const artifactOpenSource = readFileSync(resolve(repoRoot, "app/api/artifacts/open/route.ts"), "utf8");
    const generatedArtifactSource = readFileSync(resolve(repoRoot, "app/api/artifacts/generated/route.ts"), "utf8");
    const artifactLibSource = readFileSync(resolve(repoRoot, "app/lib/artifacts.ts"), "utf8");
    const azureUploadSource = readFileSync(resolve(repoRoot, "app/lib/azure-upload.ts"), "utf8");
    const chatRouteSource = readFileSync(resolve(repoRoot, "app/api/chat/route.ts"), "utf8");
    const studentGuideSource = readFileSync(resolve(repoRoot, "app/data/student-agent-guide.ts"), "utf8");
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const uploadUrlMetadataSizeCheckIndex = uploadUrlSource.indexOf("validateUploadMetadataRequestContentLength(request)");
    const uploadUrlJsonParseIndex = uploadUrlSource.indexOf("request.json");
    const completeMetadataSizeCheckIndex = completeSource.indexOf("validateUploadMetadataRequestContentLength(request)");
    const completeJsonParseIndex = completeSource.indexOf("request.json");
    const artifactMetadataSizeCheckIndex = artifactsSource.indexOf("validateArtifactMetadataRequestContentLength(request)");
    const artifactJsonParseIndex = artifactsSource.indexOf("request.json");
    const generatedArtifactContentLengthCheckIndex = generatedArtifactSource.indexOf("validateGeneratedArtifactRequestContentLength(request)");
    const generatedArtifactJsonParseIndex = generatedArtifactSource.indexOf("request.json");

    assert(uploadUrlSource.includes("canUsePhiLocalWorkflow"), "Upload URL route should check PHI-local access.");
    assert(nextConfigSource.includes("Referrer-Policy"), "The app shell should set a global referrer policy for SAS-backed upload flows.");
    assert(nextConfigSource.includes("no-referrer"), "The app shell should avoid leaking page URLs through referrers.");
    assert(nextConfigSource.includes("X-Content-Type-Options"), "The app shell should set nosniff for portal responses.");
    assert(nextConfigSource.includes("Permissions-Policy"), "The app shell should disable unused browser capabilities.");
    assert(uploadUrlSource.includes("getArtifactKind(extension) === \"data_file\""), "Upload URL route should distinguish data files from artifacts.");
    assert(azureUploadSource.includes("\".ipynb\""), "Private upload validation should accept Jupyter notebooks for local/Rush workflows.");
    assert(azureUploadSource.includes("\".py\""), "Private upload validation should accept Python source files for local/Rush workflows.");
    assert(azureUploadSource.includes("\".r\""), "Private upload validation should accept R source files for local/Rush workflows.");
    assert(azureUploadSource.includes("\".qmd\""), "Private upload validation should accept Quarto source files for local/Rush workflows.");
    assert(uploadUrlSource.includes("File metadata database is not configured."), "Upload URL route should require metadata before issuing SAS targets.");
    assert(uploadUrlMetadataSizeCheckIndex >= 0 && uploadUrlMetadataSizeCheckIndex < uploadUrlJsonParseIndex, "Upload URL route should validate metadata request size before parsing JSON.");
    assert(!uploadUrlSource.includes("contentType?: unknown"), "Upload URL route should not accept client-supplied content type metadata.");
    assert(!uploadUrlSource.includes("body.contentType"), "Upload URL route should not pass client-supplied content types into Blob target generation.");
    assert(completeSource.includes("artifactKind === \"data_file\""), "Upload completion should re-check data file workflow access.");
    assert(completeSource.includes("Private file uploads are enabled for PHI-local workflow accounts."), "Upload completion should return a clear PHI-local access error.");
    assert(completeSource.includes("deleteAzureBlobIfExists"), "Upload completion should remove owned blobs when metadata cannot be recorded.");
    assert(completeSource.includes("checkUploadRequestRateLimit"), "Upload completion should rate-limit authenticated Blob property and metadata work.");
    assert(completeSource.includes("Too many upload completion requests."), "Upload completion rate-limit responses should be explicit.");
    assert(completeMetadataSizeCheckIndex >= 0 && completeMetadataSizeCheckIndex < completeJsonParseIndex, "Upload completion should validate metadata request size before parsing JSON.");
    assert(completeSource.includes("hasAzureControlledMetadata"), "Upload completion should require portal-controlled Blob metadata.");
    assert(completeSource.includes("Upload metadata does not match the portal-controlled Blob policy."), "Upload completion should return a clear controlled-metadata error.");
    assert(completeSource.includes("File metadata database is not configured."), "Upload completion should require the metadata database.");
    assert(completeSource.includes("Upload metadata insert did not return a file record."), "Upload completion should require a persisted metadata row.");
    assert(completeSource.includes("where app_private.file_uploads.username = excluded.username"), "Upload completion should only update metadata rows owned by the signed-in user.");
    assert(completeSource.includes("normalizeContentType(extension)"), "Upload completion should derive persisted content type from the allowed extension.");
    assert(!completeSource.includes("${blobProperties.contentType}"), "Upload completion should not persist client-controlled Blob content type metadata.");
    assert(filesSource.includes("File metadata database is not configured."), "Private file listing should fail closed without the metadata database.");
    assert(filesSource.includes("canUsePhiLocalWorkflow"), "Private file listing should enforce PHI-local workflow access server-side.");
    assert(filesSource.includes("Private file records are enabled for PHI-local workflow accounts."), "Private file listing should return a clear PHI-local access error.");
    assert(filesSource.includes("where artifact_kind = 'data_file'"), "Admin private file listing should exclude publishable artifacts.");
    assert(filesSource.includes("and artifact_kind = 'data_file'"), "Owner private file listing should return only data file records.");
    assert(fileOpenSource.includes("artifact_kind"), "Private file opening should read artifact kind before streaming.");
    assert(fileOpenSource.includes("and artifact_kind = 'data_file'"), "Private file opening should fetch only data file records.");
    assert(fileOpenSource.includes("file.artifact_kind !== \"data_file\""), "Private file opening should defensively distinguish data files from artifacts.");
    assert(fileOpenSource.includes("canUsePhiLocalWorkflow"), "Private data file opening should enforce PHI-local workflow access server-side.");
    assert(fileOpenSource.includes("Private file records are enabled for PHI-local workflow accounts."), "Private file opening should return a clear PHI-local access error.");
    assert(artifactsSource.includes("Artifact metadata database is not configured."), "Artifact listing should fail closed without the metadata database.");
    assert(artifactMetadataSizeCheckIndex >= 0 && artifactMetadataSizeCheckIndex < artifactJsonParseIndex, "Artifact publishing should validate metadata request size before parsing JSON.");
    assert(artifactsSource.includes("assertAzureBlobOwner"), "Artifact publishing should verify Blob ownership before cohort visibility.");
    assert(artifactsSource.includes("Artifact Blob ownership could not be verified."), "Artifact publishing should return a clear Blob ownership error.");
    assert(artifactsSource.includes("downloadAzureBlob"), "HTML artifact publishing should inspect Blob content before cohort visibility.");
    assert(artifactsSource.includes("validateGeneratedHtmlArtifactSafety(html)"), "HTML artifact publishing should run the shared privacy guard before cohort visibility.");
    assert(artifactsSource.includes("HTML artifact privacy check could not be completed."), "HTML artifact publishing should fail closed when privacy checks cannot run.");
    assert(artifactsSource.includes("reviewConfirmed !== true"), "Cohort artifact publishing should require explicit reviewed-output confirmation.");
    assert(shellSource.includes("reviewConfirmed: visibility === \"cohort\""), "Client publish actions should send reviewed-output confirmation only for cohort publishing.");
    assert(shellSource.includes("setSelectedArtifactId(data.artifact.id)"), "Client publish actions should keep the persisted artifact selected after metadata updates.");
    assert(artifactsSource.includes("existing.artifact_kind === \"data_file\""), "Artifact publishing should reject private data files.");
    assert(artifactsSource.includes("Private file records cannot be managed through artifact publishing."), "Artifact publishing should return a clear private-file route error.");
    assert(generatedArtifactSource.includes("validateGeneratedHtmlArtifactSafety(html)"), "Generated HTML artifacts should be privacy-checked before Blob storage.");
    assert(generatedArtifactSource.includes("request.headers.get(\"content-length\")"), "Generated HTML artifact saves should inspect request size before parsing JSON.");
    assert(generatedArtifactContentLengthCheckIndex >= 0, "Generated HTML artifact saves should run a content-length guard.");
    assert(
      generatedArtifactContentLengthCheckIndex < generatedArtifactJsonParseIndex,
      "Generated HTML artifact saves should validate request size before parsing JSON.",
    );
    assert(artifactOpenSource.includes("sandbox; default-src 'none'"), "Uploaded HTML artifacts should be CSP-sandboxed.");
    assert(artifactOpenSource.includes("\"Referrer-Policy\": \"no-referrer\""), "Uploaded artifact responses should not leak artifact URLs through referrers.");
    assert(artifactOpenSource.includes("\"Cross-Origin-Resource-Policy\": \"same-origin\""), "Uploaded artifact responses should be isolated to the same origin.");
    assert(fileOpenSource.includes("\"Referrer-Policy\": \"no-referrer\""), "Private file downloads should not leak file URLs through referrers.");
    assert(fileOpenSource.includes("\"Cross-Origin-Resource-Policy\": \"same-origin\""), "Private file downloads should be isolated to the same origin.");
    assert(shellSource.includes("dataFileUploadAccept"), "Client upload accept list should separate data files from artifacts.");
    assert(shellSource.includes(".ipynb,.py,.r,.rmd,.qmd"), "Client upload accept list should include private notebook and code files.");
    assert(shellSource.includes("Uploaded data, notebook, and code files stay scoped to you and admins."), "Private files pane should describe notebook/code privacy.");
    assert(shellSource.includes("function formatPrivateFileKind(extension: string)"), "Private files pane should label notebook and code records by extension.");
    assert(shellSource.includes("return \"Jupyter notebook\""), "Private files pane should label Jupyter notebook records.");
    assert(shellSource.includes("return \"Python code\""), "Private files pane should label Python source records.");
    assert(shellSource.includes("return \"R code\""), "Private files pane should label R source records.");
    assert(shellSource.includes("formatPrivateFileKind(file.extension)"), "Private file rows should show the extension-aware private file kind.");
    assert(shellSource.includes("uploadAccept = phiLocalWorkflowEnabled"), "Client should expose data file picker only to PHI-local-capable accounts.");
    assert(shellSource.includes("privateDataFileExtensions"), "Client stale-upload guards should share the private data file extension set.");
    assert(shellSource.includes("\".ipynb\", \".py\", \".r\", \".rmd\", \".qmd\""), "Client stale-upload guards should include notebook and source private file extensions.");
    assert(shellSource.includes("function isPrivateDataUploadName(fileName: string)"), "Client should detect private file uploads before requesting SAS targets.");
    assert(shellSource.includes("selectedFiles.some((file) => isPrivateDataUploadName(file.name))"), "Non-PHI accounts should be blocked client-side from all private file upload types.");
    assert(shellSource.includes("setSelectedPrivateFileId(latestPrivateFile.uploadId ?? latestPrivateFile.id)"), "Completed private uploads should become the selected starter-code file.");
    assert(shellSource.includes("setSelectedArtifactId(latestPublishableArtifact.uploadId ?? latestPublishableArtifact.id)"), "Completed artifact uploads should become the selected draft artifact.");
    assert(shellSource.includes("credentials: \"omit\""), "Direct Azure Blob uploads should omit portal credentials.");
    assert(shellSource.includes("referrerPolicy: \"no-referrer\""), "Direct Azure Blob uploads should not send portal referrers.");
    assert(azureUploadSource.includes("maxSasMinutes = 15"), "Upload helper should cap direct-upload SAS expiry.");
    assert(azureUploadSource.includes("const sasMinutes = getUploadSasMinutes()"), "Upload target generation should use the capped SAS expiry.");
    assert(shellSource.includes("private file record"), "Uploaded file prompt context should use metadata record labels.");
    assert(!shellSource.includes("private storage path ${file.storagePath}"), "Uploaded file prompt context should not send private Blob paths to the model.");
    assert(chatRouteSource.includes("portal private file record"), "Chat system prompt should direct PHI uploads through private file records.");
    assert(!chatRouteSource.includes("approved private Azure Blob path"), "Chat system prompt should not ask interns for private Blob paths.");
    assert(!chatRouteSource.includes("approved private Azure Blob storage"), "Chat system prompt should not ask interns to analyze from private Blob storage paths.");
    assert(!chatRouteSource.includes("Model route selected for this turn"), "Chat system prompt should not expose model route labels to interns.");
    assert(chatRouteSource.includes("The server has already selected the appropriate Foundry route"), "Chat prompt should treat model routing as already handled server-side.");
    assert(!chatRouteSource.includes("Use the cheap route only"), "Chat prompt should not expose internal cheap route behavior to interns.");
    assert(!chatRouteSource.includes("Use the default/code route"), "Chat prompt should not expose internal code route behavior to interns.");
    assert(!chatRouteSource.includes("Use the strong route"), "Chat prompt should not expose internal strong route behavior to interns.");
    assert(!chatRouteSource.includes("Use the premium route"), "Chat prompt should not expose internal premium route behavior to interns.");
    assert(!chatRouteSource.includes("OpenAI or Azure"), "Chat configuration errors should not steer deployment setup toward OpenAI.");
    assert(chatRouteSource.includes("server-side Azure/Foundry model values"), "Chat configuration errors should keep Foundry/Azure setup server-side.");
    assert(studentGuideSource.includes("portal private file record"), "Student guide should direct PHI uploads through private file records.");
    assert(studentGuideSource.includes("Portal-managed routing"), "Student guide should include a portal-managed model routing setup card.");
    assert(studentGuideSource.includes("does not require interns to configure Foundry keys, model names, or route tiers"), "Student guide should keep local CE plugin setup separate from portal model secrets.");
    assert(studentGuideSource.includes("Never use owner, admin, loader, write, or service-role URLs"), "Student guide should warn Neon-enabled interns away from write-capable database URLs.");
		assert(!studentGuideSource.includes("model: \"gpt-"), "Client-side student guide data should not embed concrete model deployment names.");
    assert(!studentGuideSource.includes("approved private Azure Blob path"), "Student guide should not ask interns for private Blob paths.");
    assert(!studentGuideSource.includes("private Azure Blob storage"), "Student guide should not ask interns to analyze from private Blob storage paths.");
    assert(shellSource.includes("Approved portal private file record references"), "Uploaded file prompt context should label files as portal records.");
    assert(!shellSource.includes("id: `${target.upload.storagePath}"), "Completed upload references should not use Blob paths as local ids.");
    assert(!shellSource.includes("storagePath: target.upload.storagePath,\n      uploadedAt"), "Completed upload references should not retain Blob paths in chat state.");
    assert(!shellSource.includes("extension: target.upload.extension"), "Completed upload references should use persisted metadata, not upload-target metadata.");
    assert(!shellSource.includes("contentType: target.upload.contentType"), "Completed upload references should use persisted content type metadata.");
    assert(!shellSource.includes("contentType: file.type"), "Upload target requests should not send client-observed MIME types.");
    assert(shellSource.includes("function getSafeUploadName(file: File)"), "Upload target requests should derive a safe synthetic filename client-side.");
    assert(shellSource.includes("fileName: getSafeUploadName(file)"), "Upload target requests should send only a synthetic extension-bearing filename.");
    assert(!shellSource.includes("fileName: file.name"), "Upload target requests should not send original local filenames to the server.");
    assert(shellSource.includes("displayLabel: completedFile.displayName"), "Completed upload references should use generated metadata display labels.");
    assert(!shellSource.includes("displayLabel: file.name"), "Completed upload references should not retain original local filenames in chat state.");
    assert(!shellSource.includes("{file.fileName}"), "Upload chips should not display original local filenames after upload completion.");
    assert(!shellSource.includes("Azure private blob"), "Upload chips should avoid storage-internal Blob wording.");
    assert(!artifactLibSource.includes("storagePath: canEdit"), "Artifact records should not expose private Blob paths in list responses.");
    assert(!artifactsSource.includes("storagePath: canEdit"), "Artifact list responses should not expose private Blob paths.");
    assert(!completeSource.includes("storagePath: canEdit"), "Upload completion responses should not expose private Blob paths.");
    assert(!completeSource.includes("extension?: unknown"), "Upload completion should not trust client-supplied extension metadata.");
    assert(!completeSource.includes("contentType?: unknown"), "Upload completion should not trust client-supplied content type metadata.");
    assert(!completeSource.includes("sizeBytes?: unknown"), "Upload completion should not trust client-supplied size metadata.");
  });

  check("chat transcripts persist only through authenticated server storage", () => {
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const chatSessionSource = readFileSync(resolve(repoRoot, "app/api/chat-sessions/route.ts"), "utf8");

    assert(shellSource.includes("fetch(\"/api/chat-sessions\""), "Client should use the authenticated chat-session API.");
    assert(!shellSource.includes("healthmap-codex:chat-sessions"), "Client should not persist chat transcripts in localStorage.");
    assert(!shellSource.includes("loadLocalSessions"), "Client should not load fallback chat transcripts from localStorage.");
    assert(!shellSource.includes("localStorage.setItem(chatStorageKey"), "Client should not write chat transcripts to localStorage.");
    assert(shellSource.includes("healthmap-codex:theme"), "Theme preference may remain local-only.");
    assert(chatSessionSource.includes("inspectMessagesForPii(messages)"), "Server chat sessions should mask identifiers before durable storage.");
    assert(chatSessionSource.includes("where username = ${user.username}"), "Chat session listing should be scoped to the signed-in user.");
  });

  check("generated artifacts reject identifier-bearing HTML before storage", () => {
    validateGeneratedHtmlArtifactSafety("<html><body><table><tr><th>Ward</th><th>Respondents, %</th></tr><tr><td>1</td><td>42</td></tr></table></body></html>");
    assertThrows(
      "oversized artifact metadata request",
      () =>
        validateArtifactMetadataRequestContentLength(
          new Request("https://example.test/api/artifacts", {
            method: "POST",
            headers: { "content-length": "100000" },
          }),
        ),
      /Artifact metadata request is larger/i,
    );
    assert(
      sanitizeArtifactLabel("Ward summary for patient id R12345") === "Ward summary for [MASKED_PATIENT_IDENTIFIER]",
      "Artifact metadata labels should mask direct identifiers before durable storage.",
    );
    assertThrows(
      "direct identifier generated HTML",
      () => validateGeneratedHtmlArtifactSafety("<html><body>Contact alex@example.org for this patient.</body></html>"),
      /aggregate summaries/i,
    );
    assertThrows(
      "identifier table generated HTML",
      () => validateGeneratedHtmlArtifactSafety("<table><tr><th>patient_id</th><th>result</th></tr><tr><td>A12345</td><td>positive</td></tr></table>"),
      /aggregate summaries/i,
    );
  });

  check("metadata-backed list routes fail closed when app database is missing", () => {
    const datasetRecipesSource = readFileSync(resolve(repoRoot, "app/api/dataset-recipes/route.ts"), "utf8");
    const workspaceDocsSource = readFileSync(resolve(repoRoot, "app/api/workspace-docs/route.ts"), "utf8");
    const chatSessionsSource = readFileSync(resolve(repoRoot, "app/api/chat-sessions/route.ts"), "utf8");
    const queryPreviewSource = readFileSync(resolve(repoRoot, "app/api/query-preview/route.ts"), "utf8");
    const datasetRecipeSizeCheckIndex = datasetRecipesSource.indexOf("validateAppMetadataRequestContentLength(request)");
    const datasetRecipeJsonParseIndex = datasetRecipesSource.indexOf("request.json");
    const workspaceDocSizeCheckIndex = workspaceDocsSource.indexOf("validateAppMetadataRequestContentLength(request)");
    const workspaceDocJsonParseIndex = workspaceDocsSource.indexOf("request.json");
    const chatSessionSizeCheckIndex = chatSessionsSource.indexOf("validateAppMetadataRequestContentLength(request)");
    const chatSessionJsonParseIndex = chatSessionsSource.indexOf("request.json");
    const queryPreviewSizeCheckIndex = queryPreviewSource.indexOf("validateAppMetadataRequestContentLength(request)");
    const queryPreviewJsonParseIndex = queryPreviewSource.indexOf("request.json");

    assert(datasetRecipesSource.includes("if (!canAccessNeon(user))"), "Dataset recipe listing should enforce Neon workflow access server-side.");
    assert(datasetRecipesSource.includes("Dataset recipes are enabled for Neon workflow accounts."), "Dataset recipe listing should return a clear workflow access error.");
    assert(datasetRecipesSource.includes("Recipe metadata database is not configured."), "Dataset recipe listing should fail closed without metadata DB.");
    assert(workspaceDocsSource.includes("Workspace document database is not configured."), "CE workspace doc listing should fail closed without metadata DB.");
    assert(chatSessionsSource.includes("Chat session database is not configured."), "Saved chat session listing should fail closed without metadata DB.");
    assert(datasetRecipeSizeCheckIndex >= 0 && datasetRecipeSizeCheckIndex < datasetRecipeJsonParseIndex, "Dataset recipe saves should validate metadata request size before parsing JSON.");
    assert(workspaceDocSizeCheckIndex >= 0 && workspaceDocSizeCheckIndex < workspaceDocJsonParseIndex, "Workspace document saves should validate metadata request size before parsing JSON.");
    assert(chatSessionSizeCheckIndex >= 0 && chatSessionSizeCheckIndex < chatSessionJsonParseIndex, "Chat session saves should validate metadata request size before parsing JSON.");
    assert(queryPreviewSizeCheckIndex >= 0 && queryPreviewSizeCheckIndex < queryPreviewJsonParseIndex, "Query previews should validate metadata request size before parsing JSON.");
    assert(!datasetRecipesSource.includes("ok: true, recipes: []"), "Dataset recipe listing should not silently hide missing metadata DB.");
    assert(!workspaceDocsSource.includes("ok: true, docs: []"), "CE workspace doc listing should not silently hide missing metadata DB.");
    assert(!chatSessionsSource.includes("ok: true, sessions: []"), "Saved chat session listing should not silently hide missing metadata DB.");
  });

  check("query preview records blocked and failed query activity", () => {
    const queryPreviewSource = readFileSync(resolve(repoRoot, "app/api/query-preview/route.ts"), "utf8");
    const usageSource = readFileSync(resolve(repoRoot, "app/lib/usage.ts"), "utf8");
    const adminUsageSource = readFileSync(resolve(repoRoot, "app/api/admin/usage/route.ts"), "utf8");
    const smokeSource = readFileSync(resolve(repoRoot, "tools/runtime_smoke.mjs"), "utf8");
    const loggedSql = sanitizeSqlTextForActivityLog(
      "select * from encounters where patient_id = 'R12345' and email = 'alex@example.org' -- manual review\n/* call 312-555-1212 */",
    );

    assert(queryPreviewSource.includes("[blocked before SQL parsing: Neon workflow access required]"), "PHI-local query-preview attempts should be logged without storing submitted SQL.");
    assert(queryPreviewSource.includes("[blocked before SQL parsing: query preview rate limit]"), "Rate-limited query-preview attempts should be logged without storing submitted SQL.");
    assert(queryPreviewSource.includes("status: \"blocked\""), "Query preview should record blocked query activity.");
    assert(usageSource.includes("sanitizeSqlTextForActivityLog(input.sqlText)"), "Query activity logging should sanitize SQL text centrally before persistence.");
    assert(loggedSql.includes("'[MASKED_SQL_LITERAL]'"), "Query activity logs should mask SQL string literal values.");
    assert(loggedSql.includes("-- [MASKED_SQL_COMMENT]"), "Query activity logs should mask line comments.");
    assert(loggedSql.includes("/* [MASKED_SQL_COMMENT] */"), "Query activity logs should mask block comments.");
    assert(!loggedSql.includes("R12345") && !loggedSql.includes("alex@example.org") && !loggedSql.includes("312-555-1212"), "Query activity logs should not retain direct identifiers from SQL text.");
    assert(adminUsageSource.includes("failed_query_count"), "Admin usage should summarize failed and blocked query activity.");
    assert(smokeSource.includes("failedQueryCount") && smokeSource.includes("query activity"), "Runtime smoke should verify admin-visible query activity counts.");
  });

  check("AI routes record blocked usage activity", () => {
    const usageSource = readFileSync(resolve(repoRoot, "app/lib/usage.ts"), "utf8");
    const chatRouteSource = readFileSync(resolve(repoRoot, "app/api/chat/route.ts"), "utf8");
    const aiRouteSource = readFileSync(resolve(repoRoot, "app/api/ai/route.ts"), "utf8");
    const adminUsageSource = readFileSync(resolve(repoRoot, "app/api/admin/usage/route.ts"), "utf8");
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const chatRateLimitIndex = chatRouteSource.indexOf("checkAiRequestRateLimit(user.username)");
    const chatBudgetIndex = chatRouteSource.indexOf("checkAiBudget(user.username)");
    const chatBodySizeCheckIndex = chatRouteSource.indexOf("validateAiRequestContentLength(request)");
    const chatJsonParseIndex = chatRouteSource.indexOf("request.json");
    const aiRateLimitIndex = aiRouteSource.indexOf("checkAiRequestRateLimit(user.username)");
    const aiBudgetIndex = aiRouteSource.indexOf("checkAiBudget(user.username)");
    const aiBodySizeCheckIndex = aiRouteSource.indexOf("validateAiRequestContentLength(request)");
    const aiJsonParseIndex = aiRouteSource.indexOf("request.json");

    assert(usageSource.includes("\"success\" | \"blocked\" | \"error\""), "AI usage logs should accept blocked statuses.");
    assert(usageSource.includes("recordAiPreRoutingBlock"), "AI usage logging should expose a pre-routing blocked helper.");
    assert(usageSource.includes("modelRouteLabel: \"blocked before routing\""), "Pre-routing blocked AI usage should not pretend a Foundry route was selected.");
    assert(usageSource.includes("status: \"blocked\""), "Pre-routing AI usage should record blocked status.");
    assert(chatRouteSource.includes("recordAiPreRoutingBlock(user.username)"), "Chat route should record rate-limit and budget blocks before route selection.");
    assert(aiRouteSource.includes("recordAiPreRoutingBlock(user.username)"), "Non-chat AI route should record rate-limit and budget blocks before route selection.");
    assert(chatRateLimitIndex >= 0 && chatRateLimitIndex < chatJsonParseIndex, "Chat route should rate-limit before parsing JSON.");
    assert(chatBudgetIndex >= 0 && chatBudgetIndex < chatJsonParseIndex, "Chat route should check budget before parsing JSON.");
    assert(aiRateLimitIndex >= 0 && aiRateLimitIndex < aiJsonParseIndex, "Non-chat AI route should rate-limit before parsing JSON.");
    assert(aiBudgetIndex >= 0 && aiBudgetIndex < aiJsonParseIndex, "Non-chat AI route should check budget before parsing JSON.");
    assert(chatBodySizeCheckIndex >= 0 && chatBodySizeCheckIndex < chatJsonParseIndex, "Chat route should validate request body size before parsing JSON.");
    assert(aiBodySizeCheckIndex >= 0 && aiBodySizeCheckIndex < aiJsonParseIndex, "Non-chat AI route should validate request body size before parsing JSON.");
    assert(usageSource.includes("usage: undefined"), "Blocked AI usage rows should not invent token usage.");
    assert(adminUsageSource.includes("failed_request_count"), "Admin usage API should summarize blocked and failed AI request counts.");
    assert(shellSource.includes("failedRequestCount"), "Admin usage panel should show blocked and failed AI request counts.");
  });

  check("intern UI does not expose model route choices", () => {
    const shellSource = readFileSync(resolve(repoRoot, "components/chat/shell.tsx"), "utf8");
    const modelRoutingSection = shellSource.slice(shellSource.indexOf("<h2>Model routing</h2>") - 500, shellSource.indexOf("<h2>Model routing</h2>") + 900);

    assert(shellSource.includes("session.role === \"admin\" ?"), "Model routing details should be gated to admins.");
    assert(modelRoutingSection.includes("session.role === \"admin\" ?"), "The model-routing panel should live inside the admin-only branch.");
    assert(shellSource.includes("<h2>Automatic routing</h2>"), "Intern UI should describe automatic routing without model choices.");
    assert(shellSource.includes("Interns do not need model names, API"), "Intern UI should say interns do not manage model names or keys.");
  });

  check("non-chat AI route honors workflow-mode boundaries", () => {
    const aiRouteSource = readFileSync(resolve(repoRoot, "app/api/ai/route.ts"), "utf8");

    assert(aiRouteSource.includes("canAccessNeon"), "Non-chat AI route should evaluate Neon access server-side.");
    assert(aiRouteSource.includes("canUsePhiLocalWorkflow"), "Non-chat AI route should evaluate PHI-local access server-side.");
    assert(aiRouteSource.includes("do not use or invent HealthMap/Neon table details"), "PHI-local AI generation should not invent Neon context.");
    assert(aiRouteSource.includes("approved local or Rush machine"), "PHI-local AI generation should steer code to approved local execution.");
    assert(aiRouteSource.includes("routeManaged: true"), "Non-chat AI route should expose that model routing is server-managed.");
    assert(!aiRouteSource.includes("modelTier,\n          routeManaged"), "Non-chat AI route should not expose selected model tier to intern-facing clients.");
    assert(!aiRouteSource.includes("Model route selected for this request"), "Non-chat AI prompt should not expose model route labels to interns.");
  });

  check("runtime smoke reports complete credential requirements", () => {
    const smokeSource = readFileSync(resolve(repoRoot, "tools/runtime_smoke.mjs"), "utf8");

    assert(smokeSource.includes("requiredSmokeEnvVars"), "Runtime smoke should centralize required credential env vars.");
    assert(smokeSource.includes("Missing runtime smoke env vars"), "Runtime smoke should report all missing credential env vars together.");
    assert(smokeSource.includes("npm run generate-users -- --smoke-env"), "Runtime smoke missing-credential error should point admins to smoke credential generation.");
    assert(smokeSource.includes("run npm run seed-users"), "Runtime smoke missing-credential error should remind admins to seed generated accounts before smoke.");
    assert(smokeSource.includes("SMOKE_NEON_USERNAME"), "Runtime smoke should require a Neon smoke account.");
    assert(smokeSource.includes("SMOKE_PHI_USERNAME"), "Runtime smoke should require a PHI-local smoke account.");
    assert(smokeSource.includes("SMOKE_ADMIN_USERNAME"), "Runtime smoke should require an admin smoke account.");
    assert(smokeSource.includes("SMOKE_TEST_PUBLIC"), "Runtime smoke should expose a credential-free public auth-boundary mode.");
    assert(smokeSource.includes("assertPublicAuthBoundaries"), "Runtime smoke should implement public unauthenticated auth-boundary checks.");
    assert(smokeSource.includes("assertUnauthenticatedGetBlocked"), "Runtime smoke public mode should share a helper for authenticated GET route barriers.");
    assert(smokeSource.includes("assertUnauthenticatedPostBlocked"), "Runtime smoke public mode should share a helper for authenticated POST route barriers.");
    assert(smokeSource.includes("oversized login body blocked"), "Runtime smoke public mode should verify oversized login rejection.");
    assert(smokeSource.includes("unauthenticated upload target blocked"), "Runtime smoke public mode should verify upload target authentication.");
    assert(smokeSource.includes("unauthenticated query preview blocked"), "Runtime smoke public mode should verify query preview authentication.");
    assert(smokeSource.includes("unauthenticated chat blocked"), "Runtime smoke public mode should verify chat requires auth.");
    assert(smokeSource.includes("unauthenticated ai route blocked"), "Runtime smoke public mode should verify non-chat AI generation requires auth.");
    assert(smokeSource.includes("unauthenticated upload completion blocked"), "Runtime smoke public mode should verify upload completion requires auth.");
    assert(smokeSource.includes("unauthenticated artifact update blocked"), "Runtime smoke public mode should verify artifact metadata updates require auth.");
    assert(smokeSource.includes("unauthenticated chat session save blocked"), "Runtime smoke public mode should verify chat session saves require auth.");
    assert(smokeSource.includes("unauthenticated dataset recipe save blocked"), "Runtime smoke public mode should verify dataset recipe saves require auth.");
    assert(smokeSource.includes("unauthenticated workspace doc save blocked"), "Runtime smoke public mode should verify workspace document saves require auth.");
    assert(smokeSource.includes("unauthenticated wards blocked"), "Runtime smoke public mode should verify ward summaries require auth.");
    assert(smokeSource.includes("unauthenticated private file list blocked"), "Runtime smoke public mode should verify private file listings require auth.");
    assert(smokeSource.includes("unauthenticated artifact list blocked"), "Runtime smoke public mode should verify artifact listings require auth.");
    assert(smokeSource.includes("unauthenticated chat session list blocked"), "Runtime smoke public mode should verify saved chat session listings require auth.");
    assert(smokeSource.includes("unauthenticated dataset recipe list blocked"), "Runtime smoke public mode should verify dataset recipe listings require auth.");
    assert(smokeSource.includes("unauthenticated workspace doc list blocked"), "Runtime smoke public mode should verify workspace document listings require auth.");
    assert(smokeSource.includes("unauthenticated admin usage blocked"), "Runtime smoke public mode should verify admin usage summaries require auth.");
    assert(smokeSource.includes("cross-site login blocked"), "Runtime smoke public mode should verify login rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site upload target blocked"), "Runtime smoke public mode should verify upload target creation rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site generated artifact save blocked"), "Runtime smoke public mode should verify generated artifact saves reject cross-site POST origins.");
    assert(smokeSource.includes("cross-site chat blocked"), "Runtime smoke public mode should verify chat rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site logout blocked"), "Runtime smoke public mode should verify logout rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site query preview blocked"), "Runtime smoke public mode should verify query preview rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site ai route blocked"), "Runtime smoke public mode should verify AI generation rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site upload completion blocked"), "Runtime smoke public mode should verify upload completion rejects cross-site POST origins.");
    assert(smokeSource.includes("cross-site artifact update blocked"), "Runtime smoke public mode should verify artifact metadata updates reject cross-site POST origins.");
    assert(smokeSource.includes("cross-site chat session save blocked"), "Runtime smoke public mode should verify chat session saves reject cross-site POST origins.");
    assert(smokeSource.includes("cross-site dataset recipe save blocked"), "Runtime smoke public mode should verify dataset recipe saves reject cross-site POST origins.");
    assert(smokeSource.includes("cross-site workspace doc save blocked"), "Runtime smoke public mode should verify workspace document saves reject cross-site POST origins.");
    assert(smokeSource.includes("data file artifact route blocked"), "Runtime smoke should verify data files cannot be managed through artifact publishing.");
    assert(smokeSource.includes("does not expose Blob paths"), "Runtime smoke should verify upload metadata responses hide private Blob paths.");
    assert(smokeSource.includes("recipe list blocked"), "Runtime smoke should verify PHI-local accounts cannot list Neon dataset recipes.");
    assert(smokeSource.includes("unauthenticated file download blocked"), "Runtime smoke should verify unauthenticated private file downloads are blocked.");
    assert(smokeSource.includes("file download headers"), "Runtime smoke should verify private file download isolation headers.");
    assert(smokeSource.includes("unauthenticated generated artifact blocked"), "Runtime smoke should verify unauthenticated generated artifact opens are blocked.");
    assert(smokeSource.includes("generated artifact headers"), "Runtime smoke should verify generated HTML artifact sandbox/isolation headers.");
    assert(smokeSource.includes("generated artifact review gate"), "Runtime smoke should verify cohort publishing requires reviewed-output confirmation.");
    assert(smokeSource.includes("unauthenticated generated artifact save blocked"), "Runtime smoke should verify unauthenticated generated artifact saves are blocked.");
    assert(smokeSource.includes("Generated HTML artifact is saved as an owner-private Blob-backed draft without exposing the private Blob path."), "Runtime smoke should verify generated artifact save responses hide Blob paths.");
    assert(smokeSource.includes("generated artifact private list"), "Runtime smoke should verify owner private generated artifact listings.");
    assert(smokeSource.includes("generated artifact list isolation"), "Runtime smoke should verify other interns cannot list private generated artifacts.");
    assert(smokeSource.includes("admin generated artifact list"), "Runtime smoke should verify admins can list private generated artifact metadata.");
    assert(smokeSource.includes("admin generated artifact open"), "Runtime smoke should verify admins can open private generated artifacts.");
    assert(smokeSource.includes("generated artifact cohort list"), "Runtime smoke should verify published generated artifacts become cohort-listed without Blob paths.");
  });

  check("seed-users provisions runtime metadata tables", () => {
    const initSource = readFileSync(resolve(repoRoot, "tools/init_app_private.mjs"), "utf8");
    const seedSource = readFileSync(resolve(repoRoot, "tools/seed_neon_users.mjs"), "utf8");
    const neonSyncSource = readFileSync(resolve(repoRoot, "tools/neon_healthmap_sync.py"), "utf8");
    const preflightSource = readFileSync(resolve(repoRoot, "tools/preflight_check.mjs"), "utf8");

    assert(initSource.includes("file_uploads_artifact_kind_check"), "init-app-db should constrain upload artifact kinds on upgraded metadata tables.");
    assert(initSource.includes("file_uploads_visibility_check"), "init-app-db should constrain upload visibility on upgraded metadata tables.");
    assert(initSource.includes("file_uploads_status_check"), "init-app-db should constrain upload status values.");
    assert(initSource.includes("file_uploads_size_bytes_check"), "init-app-db should constrain upload sizes to positive values.");
    assert(seedSource.includes("validatedUsers"), "seed-users should validate and normalize users before upsert.");
    assert(seedSource.includes("bcrypt passwordHash"), "seed-users should reject non-bcrypt password hashes.");
    assert(seedSource.includes("bcryptHashPattern.test(passwordHash)"), "seed-users should require full bcrypt-shaped hashes, not only a prefix.");
    assert(preflightSource.includes("bcryptHashPattern.test(passwordHash)"), "preflight should reject malformed bcrypt placeholder hashes.");
    assert(seedSource.includes("plaintext password"), "seed-users should reject plaintext password fields.");
    assert(seedSource.includes("activeInterns.length < 6"), "seed-users should require six active interns.");
    assert(seedSource.includes("hasNeonIntern"), "seed-users should require at least one Neon-enabled intern.");
    assert(seedSource.includes("hasPhiLocalIntern"), "seed-users should require at least one PHI-local intern.");
    assert(seedSource.includes("activeAdmins.length < 1"), "seed-users should require an active admin.");
    assert(seedSource.includes("isActive to be a boolean"), "seed-users should reject malformed isActive account flags.");
    assert(preflightSource.includes("activeInterns"), "preflight should validate active intern counts, not disabled placeholders.");
    assert(preflightSource.includes("activeAdmins"), "preflight should validate active admin accounts, not disabled placeholders.");
    assert(preflightSource.includes("hasReadonlyDatabaseUsername"), "preflight should inspect READONLY_DATABASE_URL usernames before deployment.");
    assert(preflightSource.includes("owner|admin|loader|write|root|super|service"), "preflight should reject obvious write-capable read-only database URL usernames.");
    assert(neonSyncSource.includes("DEFAULT_NEON_FREE_DATABASE_LIMIT_BYTES"), "Neon verification should enforce the default free-tier database size gate.");
    assert(neonSyncSource.includes("--max-database-bytes"), "Neon verification should expose an explicit database size limit override.");
    assert(neonSyncSource.includes("database size exceeds configured limit"), "Neon verification should fail when the restored database is too large for the selected plan.");
    assert(seedSource.includes("app_private.chat_sessions"), "seed-users should provision saved chat session storage.");
    assert(seedSource.includes("chat_sessions_username_updated_idx"), "seed-users should create the chat session lookup index.");
    assert(seedSource.includes("app_private.workspace_docs"), "seed-users should provision CE workspace document storage.");
    assert(seedSource.includes("workspace_docs_shared_updated_idx"), "seed-users should create the shared workspace document lookup index.");
  });

  check("preflight rejects disabled accounts as deployment-ready placeholders", () => {
    const validBcryptHash = "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0";
    const users = [
      {
        username: "admin",
        displayName: "Admin",
        role: "admin",
        workflowMode: "dual",
        passwordHash: validBcryptHash,
      },
      {
        username: "intern01",
        displayName: "Intern 01",
        role: "intern",
        workflowMode: "neon",
        passwordHash: validBcryptHash,
        isActive: false,
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        username: `intern${String(index + 2).padStart(2, "0")}`,
        displayName: `Intern ${String(index + 2).padStart(2, "0")}`,
        role: "intern",
        workflowMode: "phi_local",
        passwordHash: validBcryptHash,
      })),
    ];
    const output = execFileSync(
      process.execPath,
      [resolve(repoRoot, "tools/preflight_check.mjs"), "--json", "--allow-missing-secrets"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, INTERN_USERS_JSON: JSON.stringify(users) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result = JSON.parse(output);
    const checksByName = new Map(result.checks.map((check) => [check.name, check]));

    assert(checksByName.get("intern users")?.ok === true, "Disabled accounts with boolean isActive should remain structurally valid.");
    assert(checksByName.get("six interns")?.ok === false, "Preflight should not count disabled interns toward the six-intern deployment requirement.");
    assert(checksByName.get("workflow modes")?.ok === false, "Preflight should not count disabled interns toward the Neon workflow requirement.");
  });

  check("preflight rejects malformed bcrypt placeholder hashes", () => {
    const users = [
      {
        username: "admin",
        displayName: "Admin",
        role: "admin",
        workflowMode: "dual",
        passwordHash: "$2b$12$example",
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        username: `intern${String(index + 1).padStart(2, "0")}`,
        displayName: `Intern ${String(index + 1).padStart(2, "0")}`,
        role: "intern",
        workflowMode: index === 0 ? "neon" : "phi_local",
        passwordHash: "$2b$12$example",
      })),
    ];
    const output = execFileSync(
      process.execPath,
      [resolve(repoRoot, "tools/preflight_check.mjs"), "--json", "--allow-missing-secrets"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, INTERN_USERS_JSON: JSON.stringify(users) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result = JSON.parse(output);
    const checksByName = new Map(result.checks.map((check) => [check.name, check]));

    assert(checksByName.get("intern users")?.ok === false, "Preflight should reject short bcrypt-looking placeholder hashes.");
  });

  check("preflight rejects likely write-capable readonly database urls", () => {
    const validBcryptHash = "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0";
    const users = [
      {
        username: "admin",
        displayName: "Admin",
        role: "admin",
        workflowMode: "dual",
        passwordHash: validBcryptHash,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        username: `intern${String(index + 1).padStart(2, "0")}`,
        displayName: `Intern ${String(index + 1).padStart(2, "0")}`,
        role: "intern",
        workflowMode: index === 0 ? "neon" : "phi_local",
        passwordHash: validBcryptHash,
      })),
    ];
    const output = execFileSync(
      process.execPath,
      [resolve(repoRoot, "tools/preflight_check.mjs"), "--json", "--allow-missing-secrets"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          INTERN_USERS_JSON: JSON.stringify(users),
          DATABASE_URL: "postgresql://app_owner:secret@example.neon.tech/neondb",
          READONLY_DATABASE_URL: "postgresql://app_owner:secret@example-pooler.neon.tech/neondb",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result = JSON.parse(output);
    const checksByName = new Map(result.checks.map((check) => [check.name, check]));

    assert(checksByName.get("readonly database role")?.ok === false, "Preflight should reject owner/admin/write-like usernames in READONLY_DATABASE_URL.");
  });

  check("deployment env docs include request body guard knobs", () => {
    const envExampleSource = readFileSync(resolve(repoRoot, ".env.example"), "utf8");
    const readmeSource = readFileSync(resolve(repoRoot, "README.md"), "utf8");
    const architectureSource = readFileSync(resolve(repoRoot, "docs/architecture/system-architecture.md"), "utf8");
    const freeTierResearchSource = readFileSync(resolve(repoRoot, "docs/architecture/free-tier-tech-stack-research.md"), "utf8");
    const tokenCostSource = readFileSync(resolve(repoRoot, "docs/planning/token-cost-control.md"), "utf8");
    const deploymentSource = readFileSync(resolve(repoRoot, "docs/runbooks/deployment.md"), "utf8");
    const preflightSource = readFileSync(resolve(repoRoot, "tools/preflight_check.mjs"), "utf8");
    const packageSource = readFileSync(resolve(repoRoot, "package.json"), "utf8");
    const vercelConfigSource = readFileSync(resolve(repoRoot, "vercel.json"), "utf8");
    const packageConfig = JSON.parse(packageSource);
    const vercelConfig = JSON.parse(vercelConfigSource);
    const normalizedReadmeSource = readmeSource.replace(/\s+/g, " ");
    const normalizedDeploymentSource = deploymentSource.replace(/\s+/g, " ");

    for (const envName of [
      "LOGIN_REQUEST_MAX_BYTES",
      "APP_METADATA_MAX_BYTES",
      "ARTIFACT_METADATA_MAX_BYTES",
      "AZURE_UPLOAD_METADATA_MAX_BYTES",
    ]) {
      assert(envExampleSource.includes(envName), `.env.example should document ${envName}.`);
      assert(readmeSource.includes(envName), `README should document ${envName}.`);
      assert(deploymentSource.includes(envName), `Deployment runbook should document ${envName}.`);
      assert(preflightSource.includes(envName), `Preflight should validate ${envName}.`);
    }

    assert(
      architectureSource.includes("Server-side Microsoft Foundry/Azure provider configuration"),
      "Architecture docs should describe Foundry/Azure as the deployment provider configuration.",
    );
    assert(
      architectureSource.includes("production/Vercel deployments reject OpenAI routing"),
      "Architecture docs should make OpenAI unavailable for production/Vercel routing.",
    );
    assert(
      !architectureSource.includes("OpenAI or Foundry/Azure provider configuration"),
      "Architecture docs should not present OpenAI as a deployment provider choice.",
    );
    assert(
      !architectureSource.includes("configured OpenAI or Microsoft Foundry/Azure provider"),
      "Architecture docs should not describe chat as using a configured OpenAI provider in deployment.",
    );
    assert(
      freeTierResearchSource.includes("## Microsoft Foundry/Azure AI cost notes"),
      "Free-tier research should frame current AI cost planning around Microsoft Foundry/Azure.",
    );
    assert(
      !freeTierResearchSource.includes("## OpenAI or Microsoft Foundry/Azure AI cost notes"),
      "Free-tier research should not present OpenAI as a current deployment cost path.",
    );
    assert(
      tokenCostSource.includes("OpenAI configuration is local-development fallback only"),
      "Token cost plan should explicitly keep OpenAI out of production/Vercel routing.",
    );
    assert(
      !tokenCostSource.includes("OpenAI or Microsoft Foundry/Azure AI usage is variable token cost"),
      "Token cost plan should not frame OpenAI as a production variable-cost route.",
    );
    assert(envExampleSource.includes("approved read-only role"), ".env.example should document the approved read-only role for READONLY_DATABASE_URL.");
    assert(readmeSource.includes("preflight rejects obvious owner/admin/loader/write/service-role usernames"), "README should document READONLY_DATABASE_URL username preflight protection.");
    assert(readmeSource.includes("500 MB Neon Free fit check"), "README should document the default Neon database size gate.");
    assert(deploymentSource.includes("Do not set it to owner, admin, loader, write, root, superuser"), "Deployment runbook should document disallowed READONLY_DATABASE_URL role classes.");
    assert(deploymentSource.includes("fits the selected Neon plan"), "Deployment runbook should require restored database size verification.");
    assert(packageConfig.scripts?.build === "next build", "Local build should remain a plain Next.js build for no-secret local verification.");
    assert(packageConfig.scripts?.["build:next"] === "next build", "Package scripts should expose a reusable Next.js build command.");
    assert(
      packageConfig.scripts?.["build:vercel"] === "npm run preflight && npm run build:next",
      "Vercel build script should run strict preflight before Next.js build.",
    );
    assert(vercelConfig.buildCommand === "npm run build:vercel", "vercel.json should force deployed builds through preflight.");
    assert(readmeSource.includes("Vercel uses `npm run build:vercel`"), "README should document the Vercel preflight build command.");
    assert(deploymentSource.includes("`npm run build:vercel`, so strict preflight runs before `next build`"), "Deployment runbook should document the Vercel preflight build command.");

    for (const publicSmokeDocNeedle of [
      "unauthenticated GET and POST blocks",
      "upload target/completion",
      "artifact save/open/list/update",
      "chat, non-chat AI",
      "CE workspace docs",
      "admin usage",
    ]) {
      assert(normalizedReadmeSource.includes(publicSmokeDocNeedle), `README should document public smoke coverage for ${publicSmokeDocNeedle}.`);
      assert(normalizedDeploymentSource.includes(publicSmokeDocNeedle), `Deployment runbook should document public smoke coverage for ${publicSmokeDocNeedle}.`);
    }

    for (const uploadSmokeDocNeedle of [
      "generated HTML artifact private owner/admin access",
      "cross-intern list/open blocking",
      "cohort publish/list isolation",
    ]) {
      assert(normalizedReadmeSource.includes(uploadSmokeDocNeedle), `README should document upload smoke coverage for ${uploadSmokeDocNeedle}.`);
      assert(normalizedDeploymentSource.includes(uploadSmokeDocNeedle), `Deployment runbook should document upload smoke coverage for ${uploadSmokeDocNeedle}.`);
    }

    const invalidOutput = execFileSync(
      process.execPath,
      [resolve(repoRoot, "tools/preflight_check.mjs"), "--json", "--allow-missing-secrets"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          LOGIN_REQUEST_MAX_BYTES: "0",
          APP_METADATA_MAX_BYTES: "0",
          ARTIFACT_METADATA_MAX_BYTES: "not-a-number",
          AZURE_UPLOAD_METADATA_MAX_BYTES: "-1",
          AZURE_UPLOAD_SAS_MINUTES: "60",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result = JSON.parse(invalidOutput);
    const checksByName = new Map(result.checks.map((check) => [check.name, check]));

    assert(checksByName.get("login request body limit")?.ok === false, "Preflight should reject invalid login body size limits.");
    assert(checksByName.get("app metadata body limit")?.ok === false, "Preflight should reject invalid app metadata size limits.");
    assert(checksByName.get("artifact metadata body limit")?.ok === false, "Preflight should reject invalid artifact metadata size limits.");
    assert(checksByName.get("upload metadata body limit")?.ok === false, "Preflight should reject invalid upload metadata size limits.");
    assert(checksByName.get("sas expiry")?.ok === false, "Preflight should reject long-lived upload SAS expiries.");
  });

  check("account generator automates hashed intern setup", () => {
    const generatorSource = readFileSync(resolve(repoRoot, "tools/generate_intern_users.mjs"), "utf8");
    const packageSource = readFileSync(resolve(repoRoot, "package.json"), "utf8");
    let invalidCountsOutput = "";
    let invalidSplitOutput = "";

    try {
      execFileSync(
        process.execPath,
        [
          resolve(repoRoot, "tools/generate_intern_users.mjs"),
          "--neon-count",
          "0",
          "--phi-count",
          "0",
          "--json-only",
        ],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      invalidCountsOutput = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    }

    try {
      execFileSync(
        process.execPath,
        [
          resolve(repoRoot, "tools/generate_intern_users.mjs"),
          "--neon-count",
          "0",
          "--phi-count",
          "6",
          "--json-only",
        ],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      invalidSplitOutput = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    }

    assert(packageSource.includes("\"generate-users\""), "package.json should expose the account generator.");
    assert(generatorSource.includes("bcrypt.hash"), "Account generator should create bcrypt hashes.");
    assert(generatorSource.includes("temporaryPassword"), "Account generator should print one-time temporary credentials separately.");
    assert(generatorSource.includes("passwordHash"), "Generated INTERN_USERS_JSON should use passwordHash values.");
    assert(generatorSource.includes("workflowMode: \"neon\""), "Generator should create Neon workflow interns.");
    assert(generatorSource.includes("workflowMode: \"phi_local\""), "Generator should create PHI-local workflow interns.");
    assert(generatorSource.includes("workflowMode: \"dual\""), "Generator should create a dual-mode admin.");
    assert(generatorSource.includes("validateDeploymentShape"), "Generator should validate the deployment account shape before printing secrets.");
    assert(generatorSource.includes("--smoke-env"), "Generator should offer runtime smoke env export output.");
    assert(generatorSource.includes("Use after setting INTERN_USERS_JSON and running npm run seed-users"), "Generator smoke output should explain that generated accounts must be seeded before smoke.");
    assert(generatorSource.includes("SMOKE_NEON_USERNAME"), "Generator should print Neon smoke credential exports when requested.");
    assert(generatorSource.includes("SMOKE_PHI_USERNAME"), "Generator should print PHI-local smoke credential exports when requested.");
    assert(generatorSource.includes("SMOKE_ADMIN_USERNAME"), "Generator should print admin smoke credential exports when requested.");
    assert(
      invalidCountsOutput.includes("generate-users requires at least six active intern accounts."),
      "Generator should reject invalid custom counts before printing INTERN_USERS_JSON.",
    );
    assert(
      invalidSplitOutput.includes("generate-users requires at least one Neon-enabled intern and one PHI-local intern."),
      "Generator should reject custom counts without both workflow groups.",
    );
    assert(!/password:\s*temporaryPassword/.test(generatorSource), "Generated user JSON must not contain plaintext password fields.");
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed > 0) {
  process.exit(1);
}
