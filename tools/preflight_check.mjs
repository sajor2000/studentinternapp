#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const envFileNames = [".env.local", ".env"];
const workflowModes = new Set(["neon", "phi_local", "dual"]);
const deploymentTiers = ["CHEAP", "DEFAULT", "CODE", "STRONG", "PREMIUM"];
const modelTiers = new Set(["cheap", "default", "code", "strong", "premium"]);
const bcryptHashPattern = /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const strictMode = !args.has("--allow-missing-secrets");

const env = { ...process.env };
const checks = [];

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return key ? [key, value] : null;
}

for (const fileName of envFileNames) {
  const filePath = path.resolve(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);

    if (parsed && !env[parsed[0]]) {
      env[parsed[0]] = parsed[1];
    }
  }
}

function getEnv(name) {
  const value = env[name]?.trim();
  return value || "";
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function hasSecret(name) {
  const value = getEnv(name);
  return Boolean(value) && !/^replace-|^example|^postgresql:\/\/[^:]+:password@/i.test(value);
}

function isValidContainerName(containerName) {
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(containerName) && !containerName.includes("--");
}

function hasNonnegativeNumberEnv(name) {
  const value = Number(getEnv(name));

  return Number.isFinite(value) && value >= 0;
}

function hasOptionalBooleanEnv(name) {
  const value = getEnv(name).toLowerCase();

  return !value || ["true", "false", "1", "0", "on", "off"].includes(value);
}

function hasOptionalPositiveIntegerEnv(name) {
  const value = getEnv(name);

  if (!value) {
    return true;
  }

  return /^\d+$/.test(value) && Number.parseInt(value, 10) > 0;
}

function hasPositiveIntegerInRangeEnv(name, maxValue) {
  const value = getEnv(name);

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const parsed = Number.parseInt(value, 10);

  return parsed > 0 && parsed <= maxValue;
}

function getUrlUsername(value) {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(new URL(value).username).toLowerCase();
  } catch {
    return "";
  }
}

function hasReadonlyDatabaseUsername() {
  const username = getUrlUsername(getEnv("READONLY_DATABASE_URL"));

  return Boolean(username) && username.includes("read") && !/(owner|admin|loader|write|root|super|service)/i.test(username);
}

function hasOptionalNonnegativeIntegerEnv(name) {
  const value = getEnv(name);

  if (!value) {
    return true;
  }

  return /^\d+$/.test(value);
}

function parseUsers() {
  const rawUsers = getEnv("INTERN_USERS_JSON");

  if (!rawUsers) {
    return null;
  }

  try {
    const users = JSON.parse(rawUsers);
    return Array.isArray(users) ? users : null;
  } catch {
    return null;
  }
}

function checkUsers() {
  const users = parseUsers();

  if (!users) {
    addCheck("intern users", false, "INTERN_USERS_JSON must be a JSON array.");
    return;
  }

  const usernames = new Set();
  const activeUsers = users.filter((user) => user?.isActive !== false);
  const activeAdmins = activeUsers.filter((user) => user?.role === "admin");
  const activeInterns = activeUsers.filter((user) => user?.role === "intern");
  const invalidUsers = users.filter((user) => {
    const username = typeof user?.username === "string" ? user.username.trim().toLowerCase() : "";
    const mode = user?.workflowMode ?? "dual";
    const passwordHash = typeof user?.passwordHash === "string" ? user.passwordHash : "";
    const hasPlaintextPassword = Object.hasOwn(user ?? {}, "password");
    const hasInvalidActiveFlag = user?.isActive !== undefined && typeof user.isActive !== "boolean";
    const duplicate = username ? usernames.has(username) : false;

    if (username) {
      usernames.add(username);
    }

    return (
      !username ||
      duplicate ||
      typeof user?.displayName !== "string" ||
      !["intern", "admin"].includes(user?.role) ||
      !workflowModes.has(mode) ||
      !bcryptHashPattern.test(passwordHash) ||
      hasPlaintextPassword ||
      hasInvalidActiveFlag
    );
  });

  addCheck("intern users", invalidUsers.length === 0, "Users need unique usernames, bcrypt passwordHash values, valid roles, valid workflowMode values, and boolean isActive values.");
  addCheck("admin account", activeAdmins.length >= 1, "At least one active admin account is required.");
  addCheck("six interns", activeInterns.length >= 6, "Seed at least six active intern accounts.");
  addCheck(
    "workflow modes",
    activeInterns.some((user) => user.workflowMode === "neon" || user.workflowMode === "dual") &&
      activeInterns.some((user) => user.workflowMode === "phi_local" || user.workflowMode === "dual"),
    "At least one active intern should be Neon-enabled and at least one should support PHI-local workflows.",
  );
}

function checkRequiredEnv() {
  addCheck("session secret", hasSecret("SESSION_SECRET") && getEnv("SESSION_SECRET").length >= 32, "SESSION_SECRET must be set to a long random value.");
  addCheck("env auth fallback", getEnv("AUTH_ALLOW_ENV_FALLBACK") !== "true", "AUTH_ALLOW_ENV_FALLBACK must not be true for deployment.");
  addCheck("database url", hasSecret("DATABASE_URL"), "DATABASE_URL must be set server-side.");
  addCheck("readonly database url", hasSecret("READONLY_DATABASE_URL"), "READONLY_DATABASE_URL must be set server-side.");
  addCheck("separate db roles", getEnv("DATABASE_URL") !== getEnv("READONLY_DATABASE_URL"), "DATABASE_URL and READONLY_DATABASE_URL should not be identical.");
  addCheck("readonly database role", hasReadonlyDatabaseUsername(), "READONLY_DATABASE_URL should use an approved read-only role such as intern_reader, not owner/admin/loader/write/service roles.");
  addCheck("schema cache ttl", hasOptionalNonnegativeIntegerEnv("SCHEMA_CACHE_TTL_SECONDS"), "SCHEMA_CACHE_TTL_SECONDS is optional; use a nonnegative integer, or 0 to disable caching.");
  addCheck("login failure limit", hasOptionalPositiveIntegerEnv("LOGIN_MAX_FAILED_ATTEMPTS") && Boolean(getEnv("LOGIN_MAX_FAILED_ATTEMPTS")), "LOGIN_MAX_FAILED_ATTEMPTS must be a positive integer.");
  addCheck("login rate window", hasOptionalPositiveIntegerEnv("LOGIN_RATE_LIMIT_WINDOW_SECONDS") && Boolean(getEnv("LOGIN_RATE_LIMIT_WINDOW_SECONDS")), "LOGIN_RATE_LIMIT_WINDOW_SECONDS must be a positive integer.");
  addCheck("login lock duration", hasOptionalPositiveIntegerEnv("LOGIN_LOCK_SECONDS") && Boolean(getEnv("LOGIN_LOCK_SECONDS")), "LOGIN_LOCK_SECONDS must be a positive integer.");
  addCheck("login request body limit", hasOptionalPositiveIntegerEnv("LOGIN_REQUEST_MAX_BYTES"), "LOGIN_REQUEST_MAX_BYTES is optional; when set, use a positive integer.");
  addCheck("budget controls", Boolean(getEnv("PER_USER_DAILY_BUDGET_USD")) && Boolean(getEnv("MONTHLY_TOKEN_BUDGET_USD")), "Set per-user daily and portal monthly budget env vars.");
  addCheck("ai request rate limit", hasOptionalPositiveIntegerEnv("AI_RATE_LIMIT_REQUESTS") && Boolean(getEnv("AI_RATE_LIMIT_REQUESTS")), "AI_RATE_LIMIT_REQUESTS must be a positive integer.");
  addCheck("ai rate window", hasOptionalPositiveIntegerEnv("AI_RATE_LIMIT_WINDOW_SECONDS") && Boolean(getEnv("AI_RATE_LIMIT_WINDOW_SECONDS")), "AI_RATE_LIMIT_WINDOW_SECONDS must be a positive integer.");
  addCheck("preview row cap", hasOptionalPositiveIntegerEnv("MAX_PREVIEW_ROWS") && Boolean(getEnv("MAX_PREVIEW_ROWS")), "MAX_PREVIEW_ROWS must be a positive integer.");
  addCheck("query preview rate limit", hasOptionalPositiveIntegerEnv("QUERY_RATE_LIMIT_REQUESTS") && Boolean(getEnv("QUERY_RATE_LIMIT_REQUESTS")), "QUERY_RATE_LIMIT_REQUESTS must be a positive integer.");
  addCheck("query preview rate window", hasOptionalPositiveIntegerEnv("QUERY_RATE_LIMIT_WINDOW_SECONDS") && Boolean(getEnv("QUERY_RATE_LIMIT_WINDOW_SECONDS")), "QUERY_RATE_LIMIT_WINDOW_SECONDS must be a positive integer.");
  addCheck("query timeout", hasOptionalPositiveIntegerEnv("QUERY_TIMEOUT_MS") && Boolean(getEnv("QUERY_TIMEOUT_MS")), "QUERY_TIMEOUT_MS must be a positive integer.");
  addCheck("upload rate limit", hasOptionalPositiveIntegerEnv("UPLOAD_RATE_LIMIT_REQUESTS") && Boolean(getEnv("UPLOAD_RATE_LIMIT_REQUESTS")), "UPLOAD_RATE_LIMIT_REQUESTS must be a positive integer.");
  addCheck("upload rate window", hasOptionalPositiveIntegerEnv("UPLOAD_RATE_LIMIT_WINDOW_SECONDS") && Boolean(getEnv("UPLOAD_RATE_LIMIT_WINDOW_SECONDS")), "UPLOAD_RATE_LIMIT_WINDOW_SECONDS must be a positive integer.");
  addCheck("app metadata body limit", hasOptionalPositiveIntegerEnv("APP_METADATA_MAX_BYTES"), "APP_METADATA_MAX_BYTES is optional; when set, use a positive integer.");
  addCheck("artifact metadata body limit", hasOptionalPositiveIntegerEnv("ARTIFACT_METADATA_MAX_BYTES"), "ARTIFACT_METADATA_MAX_BYTES is optional; when set, use a positive integer.");
  addCheck("upload metadata body limit", hasOptionalPositiveIntegerEnv("AZURE_UPLOAD_METADATA_MAX_BYTES"), "AZURE_UPLOAD_METADATA_MAX_BYTES is optional; when set, use a positive integer.");
}

function checkAzureFoundry() {
  const provider = getEnv("AI_PROVIDER") || "azure";
  const maxModelTier = getEnv("AI_MAX_MODEL_TIER").toLowerCase();

  addCheck("ai provider", provider === "azure", "Deployment should use AI_PROVIDER=azure for Foundry routing.");
  addCheck(
    "ai chat kill switch",
    hasOptionalBooleanEnv("AI_CHAT_ENABLED"),
    "AI_CHAT_ENABLED is optional; use true/false, 1/0, or on/off.",
  );
  addCheck(
    "ai chat message limit",
    hasOptionalPositiveIntegerEnv("AI_MAX_CHAT_MESSAGES"),
    "AI_MAX_CHAT_MESSAGES is optional; when set, use a positive integer.",
  );
  addCheck(
    "ai chat text limit",
    hasOptionalPositiveIntegerEnv("AI_MAX_CHAT_TEXT_CHARS"),
    "AI_MAX_CHAT_TEXT_CHARS is optional; when set, use a positive integer.",
  );
  addCheck(
    "model tier cap",
    !maxModelTier || modelTiers.has(maxModelTier),
    "AI_MAX_MODEL_TIER is optional; when set, use cheap, default, code, strong, or premium.",
  );
  addCheck("azure endpoint", /^https:\/\/.+\.cognitiveservices\.azure\.com\/?/.test(getEnv("AZURE_AI_ENDPOINT")), "AZURE_AI_ENDPOINT should be the Azure AI resource endpoint.");
  addCheck("azure api key", hasSecret("AZURE_AI_API_KEY") || hasSecret("AZURE_API_KEY"), "AZURE_AI_API_KEY or AZURE_API_KEY must be set server-side.");

  for (const tier of deploymentTiers) {
    addCheck(
      `azure ${tier.toLowerCase()} deployment`,
      Boolean(getEnv(`AZURE_AI_${tier}_DEPLOYMENT`) || getEnv(`AZURE_AI_${tier}_MODEL`)),
      `Set AZURE_AI_${tier}_DEPLOYMENT for automatic model routing.`,
    );
  }

  for (const tier of deploymentTiers) {
    addCheck(
      `azure ${tier.toLowerCase()} input price`,
      hasNonnegativeNumberEnv(`AZURE_AI_${tier}_INPUT_USD_PER_1M`),
      `Set AZURE_AI_${tier}_INPUT_USD_PER_1M from account-specific Foundry/Azure pricing.`,
    );
    addCheck(
      `azure ${tier.toLowerCase()} output price`,
      hasNonnegativeNumberEnv(`AZURE_AI_${tier}_OUTPUT_USD_PER_1M`),
      `Set AZURE_AI_${tier}_OUTPUT_USD_PER_1M from account-specific Foundry/Azure pricing.`,
    );
  }

  const publicSecretNames = Object.keys(env).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && /(KEY|SECRET|TOKEN|DATABASE_URL|CONNECTION_STRING)/i.test(name),
  );

  addCheck("no public secrets", publicSecretNames.length === 0, "Do not expose keys, tokens, DB URLs, or connection strings in NEXT_PUBLIC_* env vars.");
}

function checkAzureBlob() {
  const connectionString = getEnv("AZURE_STORAGE_CONNECTION_STRING");
  const containerName = getEnv("AZURE_STORAGE_CONTAINER") || "summer-intern-uploads";

  addCheck(
    "azure storage connection",
    hasSecret("AZURE_STORAGE_CONNECTION_STRING") &&
      connectionString.includes("AccountName=") &&
      connectionString.includes("AccountKey="),
    "AZURE_STORAGE_CONNECTION_STRING must include AccountName and AccountKey.",
  );
  addCheck("azure storage container", isValidContainerName(containerName), "AZURE_STORAGE_CONTAINER must be a valid private container name.");
  addCheck("upload size limit", Number.parseInt(getEnv("AZURE_UPLOAD_MAX_BYTES") || "0", 10) > 0, "AZURE_UPLOAD_MAX_BYTES must be a positive integer.");
  addCheck("sas expiry", hasPositiveIntegerInRangeEnv("AZURE_UPLOAD_SAS_MINUTES", 15), "AZURE_UPLOAD_SAS_MINUTES must be a positive integer no greater than 15.");
}

function checkContext7() {
  const enabled = getEnv("CONTEXT7_ENABLED").toLowerCase() === "true";

  addCheck(
    "context7 docs lookup",
    !enabled || hasSecret("CONTEXT7_API_KEY"),
    enabled
      ? "Context7 server-side docs lookup requires CONTEXT7_API_KEY in Vercel/server env."
      : "Context7 server-side docs lookup is disabled by default.",
  );
}

checkRequiredEnv();
checkUsers();
checkAzureFoundry();
checkAzureBlob();
checkContext7();

const failedChecks = checks.filter((check) => !check.ok);
const result = {
  ok: failedChecks.length === 0 || !strictMode,
  strictMode,
  checks,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const check of checks) {
    const label = check.ok ? "PASS" : strictMode ? "FAIL" : "WARN";

    console.log(`${label} ${check.name}: ${check.detail}`);
  }
}

if (strictMode && failedChecks.length > 0) {
  process.exit(1);
}
