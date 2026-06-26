#!/usr/bin/env node
import process from "node:process";

const checks = [];
const args = new Set(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(process.env.APP_BASE_URL ?? "http://localhost:3000");
const runUpload = process.env.SMOKE_TEST_UPLOAD === "1" || args.has("--upload");
const runChat = process.env.SMOKE_TEST_CHAT === "1" || args.has("--chat");
const runPublicOnly = process.env.SMOKE_TEST_PUBLIC === "1" || args.has("--public");
const requiredSmokeEnvVars = [
  "SMOKE_NEON_USERNAME",
  "SMOKE_NEON_PASSWORD",
  "SMOKE_PHI_USERNAME",
  "SMOKE_PHI_PASSWORD",
  "SMOKE_ADMIN_USERNAME",
  "SMOKE_ADMIN_PASSWORD",
];

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function addCheck(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function validateRequiredSmokeEnv() {
  const missing = requiredSmokeEnvVars.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(
      [
        `Missing runtime smoke env vars: ${missing.join(", ")}.`,
        "Set seeded SMOKE_NEON_*, SMOKE_PHI_*, and SMOKE_ADMIN_* credentials before running npm run smoke:runtime.",
        "For newly generated accounts, run npm run generate-users -- --smoke-env, set INTERN_USERS_JSON, run npm run seed-users, then reuse the printed SMOKE_* exports.",
      ].join(" "),
    );
  }
}

function getCookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const cookies = typeof getSetCookie === "function" ? getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);

  return cookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

function headerIncludes(response, name, expectedValue) {
  return response.headers.get(name)?.toLowerCase().includes(expectedValue.toLowerCase()) ?? false;
}

async function login({ username, password, expectedMode }) {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(response);
  const cookie = getCookieHeader(response);
  const ok = response.ok && body.ok === true && cookie.includes("summer_intern_session=");

  addCheck(`${username} login`, ok, "Authenticated session cookie is returned.");

  if (!ok) {
    throw new Error(`${username} login failed`);
  }

  if (expectedMode) {
    addCheck(
      `${username} workflow mode`,
      body.user?.workflowMode === expectedMode,
      `Expected workflowMode ${expectedMode}.`,
    );
  }

  return { username, cookie };
}

async function getWithCookie(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "application/json",
      cookie,
    },
  });
  const body = await readJson(response);

  return { response, body };
}

async function postJsonWithCookie(path, cookie, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);

  return { response, body };
}

async function postRawJsonWithCookie(path, cookie, payload, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(payload),
    ...init,
  });
}

function finishSmokeChecks() {
  const failures = checks.filter((check) => !check.ok);

  if (failures.length > 0) {
    process.exit(1);
  }
}

async function assertCrossSitePostBlocked({ name, path, payload, detail }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://cross-site-smoke.invalid",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);

  addCheck(
    name,
    response.status === 403 &&
      body.ok === false &&
      /Cross-site requests are not allowed/i.test(String(body.error ?? "")),
    detail,
  );
}

async function assertUnauthenticatedGetBlocked({ name, path, detail }) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { accept: "application/json" },
  });
  const body = await readJson(response);

  addCheck(
    name,
    response.status === 401 && body.ok === false,
    detail,
  );
}

async function assertUnauthenticatedPostBlocked({ name, path, payload, detail }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);

  addCheck(
    name,
    response.status === 401 &&
      (body.ok === false || /not authenticated/i.test(String(body.error ?? ""))),
    detail,
  );
}

async function assertPublicAuthBoundaries() {
  const oversizedLoginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      username: "oversized",
      password: "x".repeat(5000),
    }),
  });
  const oversizedLoginBody = await readJson(oversizedLoginResponse);

  addCheck(
    "oversized login body blocked",
    oversizedLoginResponse.status === 400 &&
      oversizedLoginBody.ok === false &&
      /Login request is larger/i.test(String(oversizedLoginBody.error ?? "")),
    "Login rejects oversized credential JSON before parsing or password verification.",
  );

  const unauthMe = await fetch(`${baseUrl}/api/me`, {
    headers: { accept: "application/json" },
  });
  const unauthMeBody = await readJson(unauthMe);

  addCheck(
    "unauthenticated session check blocked",
    unauthMe.status === 401 && unauthMeBody.ok === false,
    "Session route requires an authenticated cookie.",
  );

  const unauthSchema = await fetch(`${baseUrl}/api/schema`, {
    headers: { accept: "application/json" },
  });
  const unauthSchemaBody = await readJson(unauthSchema);

  addCheck(
    "unauthenticated Neon schema blocked",
    unauthSchema.status === 401 && unauthSchemaBody.ok === false,
    "Neon schema summaries require an authenticated workflow account.",
  );

  const unauthQueryPreview = await fetch(`${baseUrl}/api/query-preview`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sql: "select 1",
      limit: 1,
    }),
  });
  const unauthQueryPreviewBody = await readJson(unauthQueryPreview);

  addCheck(
    "unauthenticated query preview blocked",
    unauthQueryPreview.status === 401 && unauthQueryPreviewBody.ok === false,
    "Read-only SQL preview requires an authenticated Neon-enabled account.",
  );

  const unauthUploadTarget = await fetch(`${baseUrl}/api/files/upload-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      fileName: "smoke.csv",
      sizeBytes: 16,
    }),
  });
  const unauthUploadTargetBody = await readJson(unauthUploadTarget);

  addCheck(
    "unauthenticated upload target blocked",
    unauthUploadTarget.status === 401 && unauthUploadTargetBody.ok === false,
    "Blob upload targets require an authenticated workflow account.",
  );

  const crossSiteLogin = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://cross-site-smoke.invalid",
    },
    body: JSON.stringify({
      username: "cross-site",
      password: "cross-site",
    }),
  });
  const crossSiteLoginBody = await readJson(crossSiteLogin);

  addCheck(
    "cross-site login blocked",
    crossSiteLogin.status === 403 &&
      crossSiteLoginBody.ok === false &&
      /Cross-site requests are not allowed/i.test(String(crossSiteLoginBody.error ?? "")),
    "Login rejects cross-site POST origins before credential processing.",
  );

  const crossSiteUploadTarget = await fetch(`${baseUrl}/api/files/upload-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://cross-site-smoke.invalid",
    },
    body: JSON.stringify({
      fileName: "cross-site.csv",
      sizeBytes: 16,
    }),
  });
  const crossSiteUploadTargetBody = await readJson(crossSiteUploadTarget);

  addCheck(
    "cross-site upload target blocked",
    crossSiteUploadTarget.status === 403 &&
      crossSiteUploadTargetBody.ok === false &&
      /Cross-site requests are not allowed/i.test(String(crossSiteUploadTargetBody.error ?? "")),
    "Blob upload target creation rejects cross-site POST origins before auth or SAS work.",
  );

  const unauthGeneratedArtifact = await fetch(`${baseUrl}/api/artifacts/generated`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      html: "<!doctype html><html><body><h1>Smoke</h1></body></html>",
      displayName: "Public smoke artifact",
    }),
  });
  const unauthGeneratedArtifactBody = await readJson(unauthGeneratedArtifact);

  addCheck(
    "unauthenticated generated artifact save blocked",
    unauthGeneratedArtifact.status === 401 && unauthGeneratedArtifactBody.ok === false,
    "Generated artifacts cannot be saved to Blob storage without an authenticated session.",
  );

  const remainingAuthenticatedPostChecks = [
    {
      name: "unauthenticated chat blocked",
      path: "/api/chat",
      payload: {
        messages: [
          {
            id: "unauth-chat-smoke",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      },
      detail: "Chat route requires authentication before prompt or model work.",
    },
    {
      name: "unauthenticated ai route blocked",
      path: "/api/ai",
      payload: { purpose: "Unauthenticated smoke", prompt: "hello" },
      detail: "Non-chat AI generation requires authentication before prompt or model work.",
    },
    {
      name: "unauthenticated upload completion blocked",
      path: "/api/files/complete",
      payload: { storagePath: "uploads/unauth-smoke/file.csv" },
      detail: "Upload completion requires authentication before Blob metadata checks.",
    },
    {
      name: "unauthenticated artifact update blocked",
      path: "/api/artifacts",
      payload: { fileId: "unauth-smoke", visibility: "cohort", reviewConfirmed: true },
      detail: "Artifact metadata updates require authentication before ownership checks.",
    },
    {
      name: "unauthenticated chat session save blocked",
      path: "/api/chat-sessions",
      payload: { id: "unauth-smoke", title: "Unauthenticated smoke", messages: [] },
      detail: "Chat session persistence requires authentication before workspace writes.",
    },
    {
      name: "unauthenticated dataset recipe save blocked",
      path: "/api/dataset-recipes",
      payload: {
        title: "Unauthenticated smoke",
        naturalLanguageRequest: "Unauthenticated smoke",
        sqlText: "select 1",
        rowGrain: "One row",
      },
      detail: "Dataset recipe persistence requires authentication before recipe writes.",
    },
    {
      name: "unauthenticated workspace doc save blocked",
      path: "/api/workspace-docs",
      payload: { docType: "plan", title: "Unauthenticated smoke", bodyMd: "Unauthenticated smoke" },
      detail: "CE workspace document persistence requires authentication before doc writes.",
    },
  ];

  for (const check of remainingAuthenticatedPostChecks) {
    await assertUnauthenticatedPostBlocked(check);
  }

  const crossSiteGeneratedArtifact = await fetch(`${baseUrl}/api/artifacts/generated`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://cross-site-smoke.invalid",
    },
    body: JSON.stringify({
      html: "<!doctype html><html><body><h1>Smoke</h1></body></html>",
      displayName: "Cross-site smoke artifact",
    }),
  });
  const crossSiteGeneratedArtifactBody = await readJson(crossSiteGeneratedArtifact);

  addCheck(
    "cross-site generated artifact save blocked",
    crossSiteGeneratedArtifact.status === 403 &&
      crossSiteGeneratedArtifactBody.ok === false &&
      /Cross-site requests are not allowed/i.test(String(crossSiteGeneratedArtifactBody.error ?? "")),
    "Generated artifact saves reject cross-site POST origins before Blob writes.",
  );

  const crossSiteChat = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://cross-site-smoke.invalid",
    },
    body: JSON.stringify({
      messages: [
        {
          id: "cross-site-smoke",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    }),
  });
  const crossSiteChatBody = await readJson(crossSiteChat);

  addCheck(
    "cross-site chat blocked",
    crossSiteChat.status === 403 &&
      crossSiteChatBody.ok === false &&
      /Cross-site requests are not allowed/i.test(String(crossSiteChatBody.error ?? "")),
    "Chat route rejects cross-site POST origins before prompt or model work.",
  );

  const remainingCrossSitePostChecks = [
    {
      name: "cross-site logout blocked",
      path: "/api/logout",
      payload: {},
      detail: "Logout rejects cross-site POST origins before session-cookie mutation.",
    },
    {
      name: "cross-site query preview blocked",
      path: "/api/query-preview",
      payload: { sql: "select 1", limit: 1 },
      detail: "Query preview rejects cross-site POST origins before auth or SQL parsing.",
    },
    {
      name: "cross-site ai route blocked",
      path: "/api/ai",
      payload: { purpose: "Cross-site smoke", prompt: "hello" },
      detail: "Non-chat AI generation rejects cross-site POST origins before prompt or model work.",
    },
    {
      name: "cross-site upload completion blocked",
      path: "/api/files/complete",
      payload: { storagePath: "uploads/cross-site-smoke/file.csv" },
      detail: "Upload completion rejects cross-site POST origins before Blob metadata checks.",
    },
    {
      name: "cross-site artifact update blocked",
      path: "/api/artifacts",
      payload: { fileId: "cross-site-smoke", visibility: "cohort", reviewConfirmed: true },
      detail: "Artifact publishing rejects cross-site POST origins before metadata changes.",
    },
    {
      name: "cross-site chat session save blocked",
      path: "/api/chat-sessions",
      payload: { id: "cross-site-smoke", title: "Cross-site smoke", messages: [] },
      detail: "Chat session persistence rejects cross-site POST origins before workspace writes.",
    },
    {
      name: "cross-site dataset recipe save blocked",
      path: "/api/dataset-recipes",
      payload: {
        title: "Cross-site smoke",
        naturalLanguageRequest: "Cross-site smoke",
        sqlText: "select 1",
        rowGrain: "One row",
      },
      detail: "Dataset recipe persistence rejects cross-site POST origins before recipe writes.",
    },
    {
      name: "cross-site workspace doc save blocked",
      path: "/api/workspace-docs",
      payload: { docType: "plan", title: "Cross-site smoke", bodyMd: "Cross-site smoke" },
      detail: "CE workspace document persistence rejects cross-site POST origins before doc writes.",
    },
  ];

  for (const check of remainingCrossSitePostChecks) {
    await assertCrossSitePostBlocked(check);
  }

  const unauthFileOpen = await fetch(`${baseUrl}/api/files/open?id=public-smoke`, {
    headers: { accept: "application/json" },
  });
  const unauthFileOpenBody = await readJson(unauthFileOpen);

  addCheck(
    "unauthenticated private file open blocked",
    unauthFileOpen.status === 401 && unauthFileOpenBody.ok === false,
    "Private Blob-backed files cannot be opened without an authenticated session.",
  );

  const unauthArtifactOpen = await fetch(`${baseUrl}/api/artifacts/open?id=public-smoke`, {
    headers: { accept: "application/json" },
  });
  const unauthArtifactOpenBody = await readJson(unauthArtifactOpen);

  addCheck(
    "unauthenticated artifact open blocked",
    unauthArtifactOpen.status === 401 && unauthArtifactOpenBody.ok === false,
    "Artifact open routes require authentication before metadata or Blob access.",
  );

  const remainingAuthenticatedGetChecks = [
    {
      name: "unauthenticated wards blocked",
      path: "/api/wards",
      detail: "Ward summaries require an authenticated Neon-enabled account.",
    },
    {
      name: "unauthenticated private file list blocked",
      path: "/api/files",
      detail: "Private file listings require an authenticated workflow account.",
    },
    {
      name: "unauthenticated artifact list blocked",
      path: "/api/artifacts",
      detail: "Artifact listings require an authenticated workflow account.",
    },
    {
      name: "unauthenticated chat session list blocked",
      path: "/api/chat-sessions",
      detail: "Saved chat session listings require an authenticated workflow account.",
    },
    {
      name: "unauthenticated dataset recipe list blocked",
      path: "/api/dataset-recipes",
      detail: "Dataset recipe listings require an authenticated Neon-enabled account.",
    },
    {
      name: "unauthenticated workspace doc list blocked",
      path: "/api/workspace-docs",
      detail: "CE workspace document listings require an authenticated workflow account.",
    },
    {
      name: "unauthenticated admin usage blocked",
      path: "/api/admin/usage",
      detail: "Admin usage summaries require an authenticated admin session.",
    },
  ];

  for (const check of remainingAuthenticatedGetChecks) {
    await assertUnauthenticatedGetBlocked(check);
  }
}

async function assertMe(session, expectedMode) {
  const { response, body } = await getWithCookie("/api/me", session.cookie);

  addCheck(
    `${session.username} /api/me`,
    response.ok && body.ok === true && body.user?.username === session.username,
    "Session revalidates through the app.",
  );

  if (expectedMode) {
    addCheck(
      `${session.username} /api/me mode`,
      body.user?.workflowMode === expectedMode,
      `Expected workflowMode ${expectedMode}.`,
    );
  }
}

async function assertNeonEnabled(session) {
  const { response, body } = await getWithCookie("/api/schema", session.cookie);

  addCheck(
    `${session.username} Neon schema`,
    response.ok && body.ok === true && Number.isInteger(body.tableCount) && body.tableCount > 0,
    "Neon-enabled account can read schema summaries.",
  );
}

async function assertNeonBlocked(session) {
  const { response, body } = await getWithCookie("/api/schema", session.cookie);

  addCheck(
    `${session.username} Neon blocked`,
    response.status === 403 && body.ok === false,
    "PHI-local account cannot read Neon schema summaries.",
  );
}

async function assertQueryPreview(neonSession, phiSession) {
  const preview = await postJsonWithCookie("/api/query-preview", neonSession.cookie, {
    sql: "select ward_id, ward_name from dim_aldermanic_wards order by ward_id::int",
    limit: 5,
  });

  addCheck(
    `${neonSession.username} query preview`,
      preview.response.ok &&
      preview.body.ok === true &&
      preview.body.rowCount <= 5 &&
      Number.isInteger(preview.body.timeoutMs) &&
      preview.body.timeoutMs > 0 &&
      Array.isArray(preview.body.rows) &&
      preview.body.columns?.includes("ward_id"),
    "Neon-enabled account can run a limited read-only SELECT preview with a query timeout.",
  );

  const blockedPreview = await postJsonWithCookie("/api/query-preview", phiSession.cookie, {
    sql: "select ward_id from dim_aldermanic_wards",
    limit: 5,
  });

  addCheck(
    `${phiSession.username} query preview blocked`,
    blockedPreview.response.status === 403 && blockedPreview.body.ok === false,
    "PHI-local account cannot run Neon query previews.",
  );

  const unsafePreview = await postJsonWithCookie("/api/query-preview", neonSession.cookie, {
    sql: "drop table dim_aldermanic_wards",
    limit: 5,
  });

  addCheck(
    `${neonSession.username} unsafe SQL blocked`,
    unsafePreview.response.status === 400 && unsafePreview.body.ok === false,
    "App-level SQL safety blocks non-SELECT statements before execution.",
  );
}

async function assertDatasetRecipes(neonSession, phiSession, adminSession) {
  const saveRecipe = await postJsonWithCookie("/api/dataset-recipes", neonSession.cookie, {
    title: "Smoke ward recipe",
    naturalLanguageRequest: "Create a ward-level smoke-test dataset.",
    sqlText: "select ward_id, ward_name from dim_aldermanic_wards order by ward_id::int",
    rowGrain: "One row per aldermanic ward",
    status: "ready",
  });
  const recipeId = saveRecipe.body.recipe?.id;

  addCheck(
    `${neonSession.username} save recipe`,
    saveRecipe.response.ok && saveRecipe.body.ok === true && saveRecipe.body.recipe?.ownerUsername === neonSession.username,
    "Neon-enabled account can save a reusable dataset recipe with safe SQL.",
  );

  const ownerList = await getWithCookie("/api/dataset-recipes", neonSession.cookie);

  addCheck(
    `${neonSession.username} recipe list`,
    ownerList.response.ok &&
      ownerList.body.ok === true &&
      ownerList.body.recipes?.some((recipe) => recipe.id === recipeId),
    "Owner can list saved dataset recipes.",
  );

  const blockedSave = await postJsonWithCookie("/api/dataset-recipes", phiSession.cookie, {
    title: "Blocked recipe",
    naturalLanguageRequest: "This PHI-local account should not save Neon SQL.",
    sqlText: "select ward_id from dim_aldermanic_wards",
    rowGrain: "One row per ward",
  });

  addCheck(
    `${phiSession.username} save recipe blocked`,
    blockedSave.response.status === 403 && blockedSave.body.ok === false,
    "PHI-local account cannot save Neon dataset recipes.",
  );

  const blockedList = await getWithCookie("/api/dataset-recipes", phiSession.cookie);

  addCheck(
    `${phiSession.username} recipe list blocked`,
    blockedList.response.status === 403 && blockedList.body.ok === false,
    "PHI-local account cannot list Neon dataset recipes.",
  );

  const adminList = await getWithCookie("/api/dataset-recipes", adminSession.cookie);

  addCheck(
    `${adminSession.username} admin recipe list`,
    adminList.response.ok &&
      adminList.body.ok === true &&
      adminList.body.recipes?.some((recipe) => recipe.id === recipeId && recipe.ownerUsername === neonSession.username),
    "Admin can list dataset recipes across users.",
  );
}

async function assertChatSessions(ownerSession, otherInternSession, adminSession) {
  const sessionId = `smoke-chat-${Date.now()}`;
  const saveSession = await postJsonWithCookie("/api/chat-sessions", ownerSession.cookie, {
    id: sessionId,
    title: "Smoke CE workflow chat",
    messages: [
      {
        id: `${sessionId}-user`,
        role: "user",
        parts: [
          {
            type: "text",
            text: "Use /ce-plan to outline a safe intern workflow.",
          },
        ],
      },
    ],
  });

  addCheck(
    `${ownerSession.username} save chat session`,
    saveSession.response.ok &&
      saveSession.body.ok === true &&
      saveSession.body.session?.id === sessionId &&
      saveSession.body.session?.ownerUsername === ownerSession.username,
    "Intern can save a durable private chat workspace.",
  );

  const ownerList = await getWithCookie("/api/chat-sessions", ownerSession.cookie);

  addCheck(
    `${ownerSession.username} chat session list`,
    ownerList.response.ok &&
      ownerList.body.ok === true &&
      ownerList.body.sessions?.some((session) => session.id === sessionId),
    "Intern can list their own saved chat sessions.",
  );

  const otherList = await getWithCookie("/api/chat-sessions", otherInternSession.cookie);

  addCheck(
    `${otherInternSession.username} chat session isolation`,
    otherList.response.ok &&
      otherList.body.ok === true &&
      !otherList.body.sessions?.some((session) => session.id === sessionId),
    "A different intern cannot list another intern's private chat sessions.",
  );

  const adminList = await getWithCookie("/api/chat-sessions?scope=admin", adminSession.cookie);

  addCheck(
    `${adminSession.username} admin chat session list`,
    adminList.response.ok &&
      adminList.body.ok === true &&
      adminList.body.sessions?.some((session) => session.id === sessionId && session.ownerUsername === ownerSession.username),
    "Admin can list saved chat sessions across users for accountability.",
  );
}

async function assertWorkspaceDocs(ownerSession, otherInternSession, adminSession) {
  const privateDoc = await postJsonWithCookie("/api/workspace-docs", ownerSession.cookie, {
    docType: "plan",
    title: "Smoke private CE plan",
    bodyMd: "Private /ce-plan notes for the owner only.",
    sourceCommand: "/ce-plan",
    projectLabel: "Runtime smoke",
  });
  const privateDocId = privateDoc.body.doc?.id;

  addCheck(
    `${ownerSession.username} save private CE doc`,
    privateDoc.response.ok &&
      privateDoc.body.ok === true &&
      privateDoc.body.doc?.ownerUsername === ownerSession.username &&
      privateDoc.body.doc?.visibility === "private",
    "Intern can save a private CE workspace document.",
  );

  if (!privateDocId) {
    throw new Error("Private CE workspace doc save did not return an id");
  }

  const blockedShare = await postJsonWithCookie("/api/workspace-docs", ownerSession.cookie, {
    docType: "plan",
    title: "Unsafe shared CE plan",
    bodyMd: "Plans stay private by default.",
    visibility: "shared",
  });

  addCheck(
    `${ownerSession.username} private CE plan sharing blocked`,
    blockedShare.response.status === 400 && blockedShare.body.ok === false,
    "Only cohort-safe compound learnings or handoffs can be shared.",
  );

  const sharedLearning = await postJsonWithCookie("/api/workspace-docs", ownerSession.cookie, {
    docType: "compound_learning",
    title: "Smoke shared CE learning",
    bodyMd: "Use /ce-review before publishing final artifacts.",
    sourceCommand: "/ce-compound",
    projectLabel: "Runtime smoke",
    visibility: "shared",
  });
  const sharedDocId = sharedLearning.body.doc?.id;

  addCheck(
    `${ownerSession.username} save shared CE learning`,
    sharedLearning.response.ok &&
      sharedLearning.body.ok === true &&
      sharedLearning.body.doc?.visibility === "shared",
    "Intern can explicitly promote a cohort-safe compound learning.",
  );

  if (!sharedDocId) {
    throw new Error("Shared CE workspace doc save did not return an id");
  }

  const ownerList = await getWithCookie("/api/workspace-docs", ownerSession.cookie);

  addCheck(
    `${ownerSession.username} CE doc list`,
    ownerList.response.ok &&
      ownerList.body.ok === true &&
      ownerList.body.docs?.some((doc) => doc.id === privateDocId) &&
      ownerList.body.docs?.some((doc) => doc.id === sharedDocId),
    "Owner can list private and shared CE workspace documents.",
  );

  const otherList = await getWithCookie("/api/workspace-docs", otherInternSession.cookie);

  addCheck(
    `${otherInternSession.username} CE doc isolation`,
    otherList.response.ok &&
      otherList.body.ok === true &&
      !otherList.body.docs?.some((doc) => doc.id === privateDocId) &&
      otherList.body.docs?.some((doc) => doc.id === sharedDocId && doc.canEdit === false),
    "A different intern cannot list private CE docs but can read shared cohort learnings.",
  );

  const otherUpdate = await postJsonWithCookie("/api/workspace-docs", otherInternSession.cookie, {
    docId: sharedDocId,
    docType: "compound_learning",
    title: "Tampered shared learning",
    bodyMd: "This should not update another intern's learning.",
    visibility: "shared",
  });

  addCheck(
    `${otherInternSession.username} CE doc update blocked`,
    otherUpdate.response.status === 403 && otherUpdate.body.ok === false,
    "A different intern cannot edit shared CE docs owned by another intern.",
  );

  const adminList = await getWithCookie("/api/workspace-docs?scope=admin", adminSession.cookie);

  addCheck(
    `${adminSession.username} admin CE doc list`,
    adminList.response.ok &&
      adminList.body.ok === true &&
      adminList.body.docs?.some((doc) => doc.id === privateDocId && doc.ownerUsername === ownerSession.username) &&
      adminList.body.docs?.some((doc) => doc.id === sharedDocId && doc.ownerUsername === ownerSession.username),
    "Admin can list CE workspace documents across users for mentoring and accountability.",
  );
}

async function assertAdminUsage(adminSession, expectedUsernames) {
  const internUsage = await getWithCookie("/api/admin/usage", expectedUsernames[0].cookie);

  addCheck(
    `${expectedUsernames[0].username} admin usage blocked`,
    internUsage.response.status === 403 && internUsage.body.ok === false,
    "Intern account cannot read admin usage summaries.",
  );

  const adminUsage = await getWithCookie("/api/admin/usage", adminSession.cookie);
  const users = Array.isArray(adminUsage.body.users) ? adminUsage.body.users : [];
  const hasAllExpectedUsers = expectedUsernames.every((session) =>
    users.some((user) => user.username === session.username && typeof user.workflowMode === "string"),
  );

  addCheck(
    `${adminSession.username} admin usage`,
    adminUsage.response.ok &&
      adminUsage.body.ok === true &&
      Number.isInteger(adminUsage.body.windowDays) &&
      adminUsage.body.totals &&
      typeof adminUsage.body.totals.monthlyEstimatedCostUsd === "number" &&
      Number.isInteger(adminUsage.body.totals.failedRequestCount) &&
      Number.isInteger(adminUsage.body.totals.queryCount) &&
      adminUsage.body.totals.queryCount >= 3 &&
      Number.isInteger(adminUsage.body.totals.failedQueryCount) &&
      adminUsage.body.totals.failedQueryCount >= 2 &&
      Array.isArray(adminUsage.body.budgetWarnings) &&
      users.every((user) => Number.isInteger(user.failedRequestCount)) &&
      hasAllExpectedUsers,
    "Admin account can read usage, AI block/error counts, budget warnings, upload, query activity, and workflow summaries for active users.",
  );
}

async function assertBlobUpload(ownerSession, otherInternSession, adminSession) {
  const csv = `metric,value\nsmoke,${Date.now()}\n`;
  const bytes = Buffer.byteLength(csv);
  const blockedDataTarget = await postJsonWithCookie("/api/files/upload-url", otherInternSession.cookie, {
    fileName: "blocked-smoke.csv",
    contentType: "text/csv",
    sizeBytes: bytes,
  });

  addCheck(
    `${otherInternSession.username} data upload target blocked`,
    blockedDataTarget.response.status === 403 && blockedDataTarget.body.ok === false,
    "Neon-only account cannot request data-file Blob upload targets.",
  );

  const uploadTarget = await postJsonWithCookie("/api/files/upload-url", ownerSession.cookie, {
    fileName: "smoke.csv",
    contentType: "text/html",
    sizeBytes: bytes,
  });

  addCheck(
    `${ownerSession.username} upload target`,
    uploadTarget.response.ok && uploadTarget.body.ok === true && uploadTarget.body.upload?.uploadUrl,
    "Authenticated route returns one private Blob upload target.",
  );

  if (!uploadTarget.response.ok || uploadTarget.body.ok !== true) {
    throw new Error("Upload target request failed");
  }

  const upload = uploadTarget.body.upload;
  const putResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.requiredHeaders,
    body: csv,
  });

  addCheck(`${ownerSession.username} blob PUT`, putResponse.ok, "Browser-equivalent PUT to Azure Blob succeeds.");

  if (!putResponse.ok) {
    throw new Error("Azure Blob PUT failed");
  }

  const complete = await postJsonWithCookie("/api/files/complete", ownerSession.cookie, {
    storagePath: upload.storagePath,
  });

  addCheck(
    `${ownerSession.username} upload complete`,
    complete.response.ok &&
      complete.body.ok === true &&
      complete.body.file?.ownerUsername === ownerSession.username &&
      (complete.body.file?.storagePath === null || complete.body.file?.storagePath === undefined),
    "Completion verifies Blob ownership, records per-user metadata, and does not expose the private Blob path.",
  );

  const fileList = await getWithCookie("/api/files", ownerSession.cookie);
  const uploadedFileId = complete.body.file?.id;
  const uploadedFileMetadata = Array.isArray(fileList.body.files)
    ? fileList.body.files.find((file) => file.id === uploadedFileId)
    : null;

  addCheck(
    `${ownerSession.username} file list`,
    fileList.response.ok &&
      fileList.body.ok === true &&
      uploadedFileMetadata?.artifactKind === "data_file",
    "Per-user file listing includes the uploaded data file metadata.",
  );

  addCheck(
    `${ownerSession.username} file metadata`,
    uploadedFileMetadata?.extension === ".csv" &&
      uploadedFileMetadata?.contentType === "text/csv" &&
      uploadedFileMetadata?.storagePath === null,
    "Private file metadata derives safe content type and does not expose Blob paths for local starter generation.",
  );

  if (!uploadedFileId) {
    throw new Error("Completed upload did not return a file id");
  }

  const blockedDataArtifactUpdate = await postJsonWithCookie("/api/artifacts", ownerSession.cookie, {
    fileId: uploadedFileId,
    visibility: "private",
    displayName: "Should stay a private file record",
    projectLabel: "Runtime smoke",
  });

  addCheck(
    `${ownerSession.username} data file artifact route blocked`,
    blockedDataArtifactUpdate.response.status === 400 &&
      blockedDataArtifactUpdate.body.ok === false &&
      /Private file records cannot be managed through artifact publishing/i.test(String(blockedDataArtifactUpdate.body.error ?? "")),
    "Private file records cannot be repurposed through artifact publishing routes.",
  );

  const openResponse = await fetch(`${baseUrl}/api/files/open?id=${encodeURIComponent(uploadedFileId)}`, {
    headers: {
      cookie: ownerSession.cookie,
    },
  });
  const openedCsv = await openResponse.text();

  addCheck(
    `${ownerSession.username} file download`,
    openResponse.ok && openedCsv === csv,
    "Owner can download the private data file through the authenticated app route.",
  );

  addCheck(
    `${ownerSession.username} file download headers`,
    headerIncludes(openResponse, "cache-control", "no-store") &&
      headerIncludes(openResponse, "content-disposition", "attachment") &&
      headerIncludes(openResponse, "referrer-policy", "no-referrer") &&
      headerIncludes(openResponse, "cross-origin-resource-policy", "same-origin"),
    "Private file downloads are no-store attachments with no-referrer and same-origin resource isolation.",
  );

  const unauthFileOpenResponse = await fetch(`${baseUrl}/api/files/open?id=${encodeURIComponent(uploadedFileId)}`, {
    headers: {
      accept: "application/json",
    },
  });
  const unauthFileOpenBody = await readJson(unauthFileOpenResponse);

  addCheck(
    "unauthenticated file download blocked",
    unauthFileOpenResponse.status === 401 && unauthFileOpenBody.ok === false,
    "Private Blob-backed files cannot be downloaded without an authenticated session.",
  );

  const otherList = await getWithCookie("/api/files", otherInternSession.cookie);

  addCheck(
    `${otherInternSession.username} file list isolation`,
    otherList.response.ok &&
      otherList.body.ok === true &&
      !otherList.body.files?.some((file) => file.id === uploadedFileId),
    "A different intern does not see the owner's private upload metadata.",
  );

  const otherOpenResponse = await fetch(`${baseUrl}/api/files/open?id=${encodeURIComponent(uploadedFileId)}`, {
    headers: {
      cookie: otherInternSession.cookie,
      accept: "application/json",
    },
  });
  const otherOpenBody = await readJson(otherOpenResponse);

  addCheck(
    `${otherInternSession.username} file download blocked`,
    otherOpenResponse.status === 403 && otherOpenBody.ok === false,
    "A different intern cannot download the owner's private Blob-backed file.",
  );

  const adminList = await getWithCookie("/api/files", adminSession.cookie);

  addCheck(
    `${adminSession.username} admin file list`,
    adminList.response.ok &&
      adminList.body.ok === true &&
      adminList.body.files?.some(
        (file) => file.id === uploadedFileId && file.ownerUsername === ownerSession.username && file.storagePath === null,
      ),
    "Admin can see private upload metadata across users without receiving private Blob paths.",
  );

  const adminOpenResponse = await fetch(`${baseUrl}/api/files/open?id=${encodeURIComponent(uploadedFileId)}`, {
    headers: {
      cookie: adminSession.cookie,
    },
  });
  const adminOpenedCsv = await adminOpenResponse.text();

  addCheck(
    `${adminSession.username} admin file download`,
    adminOpenResponse.ok && adminOpenedCsv === csv,
    "Admin can download private uploads through the authenticated app route.",
  );

  const html = `<!doctype html><html><head><title>Smoke artifact</title></head><body><h1>Smoke ${Date.now()}</h1></body></html>`;
  const unauthGenerated = await fetch(`${baseUrl}/api/artifacts/generated`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      html,
      displayName: "Unauthenticated smoke artifact",
    }),
  });
  const unauthGeneratedBody = await readJson(unauthGenerated);

  addCheck(
    "unauthenticated generated artifact save blocked",
    unauthGenerated.status === 401 && unauthGeneratedBody.ok === false,
    "Generated HTML artifacts cannot be saved to Blob storage without an authenticated session.",
  );

  const generated = await postJsonWithCookie("/api/artifacts/generated", ownerSession.cookie, {
    html,
    displayName: "Smoke generated HTML artifact",
    projectLabel: "Runtime smoke",
  });
  const generatedArtifactId = generated.body.artifact?.id;

  addCheck(
    `${ownerSession.username} generated artifact save`,
    generated.response.ok &&
      generated.body.ok === true &&
      generated.body.artifact?.ownerUsername === ownerSession.username &&
      generated.body.artifact?.artifactKind === "html_artifact" &&
      generated.body.artifact?.visibility === "private" &&
      generated.body.artifact?.storagePath === null,
    "Generated HTML artifact is saved as an owner-private Blob-backed draft without exposing the private Blob path.",
  );

  if (!generatedArtifactId) {
    throw new Error("Generated artifact save did not return an artifact id");
  }

  const ownerArtifactList = await getWithCookie("/api/artifacts", ownerSession.cookie);
  const ownerArtifactMetadata = Array.isArray(ownerArtifactList.body.artifacts)
    ? ownerArtifactList.body.artifacts.find((artifact) => artifact.id === generatedArtifactId)
    : null;

  addCheck(
    `${ownerSession.username} generated artifact private list`,
    ownerArtifactList.response.ok &&
      ownerArtifactList.body.ok === true &&
      ownerArtifactMetadata?.ownerUsername === ownerSession.username &&
      ownerArtifactMetadata?.visibility === "private" &&
      ownerArtifactMetadata?.storagePath === null,
    "Owner artifact listing includes private generated artifact metadata without exposing Blob paths.",
  );

  const unauthPrivateArtifactOpen = await fetch(`${baseUrl}/api/artifacts/open?id=${encodeURIComponent(generatedArtifactId)}`, {
    headers: {
      accept: "application/json",
    },
  });
  const unauthPrivateArtifactBody = await readJson(unauthPrivateArtifactOpen);

  addCheck(
    "unauthenticated generated artifact blocked",
    unauthPrivateArtifactOpen.status === 401 && unauthPrivateArtifactBody.ok === false,
    "Private generated artifacts cannot be opened without an authenticated session.",
  );

  const otherPrivateArtifactOpen = await fetch(`${baseUrl}/api/artifacts/open?id=${encodeURIComponent(generatedArtifactId)}`, {
    headers: {
      cookie: otherInternSession.cookie,
      accept: "application/json",
    },
  });
  const otherPrivateArtifactBody = await readJson(otherPrivateArtifactOpen);

  addCheck(
    `${otherInternSession.username} generated artifact private`,
    otherPrivateArtifactOpen.status === 403 && otherPrivateArtifactBody.ok === false,
    "A different intern cannot open the generated artifact before it is published.",
  );

  const otherArtifactList = await getWithCookie("/api/artifacts", otherInternSession.cookie);

  addCheck(
    `${otherInternSession.username} generated artifact list isolation`,
    otherArtifactList.response.ok &&
      otherArtifactList.body.ok === true &&
      !otherArtifactList.body.artifacts?.some((artifact) => artifact.id === generatedArtifactId),
    "A different intern cannot see another intern's private generated artifact metadata before cohort publish.",
  );

  const adminArtifactList = await getWithCookie("/api/artifacts", adminSession.cookie);

  addCheck(
    `${adminSession.username} admin generated artifact list`,
    adminArtifactList.response.ok &&
      adminArtifactList.body.ok === true &&
      adminArtifactList.body.artifacts?.some(
        (artifact) =>
          artifact.id === generatedArtifactId &&
          artifact.ownerUsername === ownerSession.username &&
          artifact.visibility === "private" &&
          artifact.storagePath === null,
      ),
    "Admin can see private generated artifact metadata across users without receiving private Blob paths.",
  );

  const adminPrivateArtifactOpen = await fetch(`${baseUrl}/api/artifacts/open?id=${encodeURIComponent(generatedArtifactId)}`, {
    headers: {
      cookie: adminSession.cookie,
    },
  });
  const adminPrivateArtifactHtml = await adminPrivateArtifactOpen.text();

  addCheck(
    `${adminSession.username} admin generated artifact open`,
    adminPrivateArtifactOpen.ok && adminPrivateArtifactHtml === html,
    "Admin can open private generated artifacts through the authenticated app route before cohort publish.",
  );

  const publishWithoutReview = await postJsonWithCookie("/api/artifacts", ownerSession.cookie, {
    fileId: generatedArtifactId,
    visibility: "cohort",
    displayName: "Smoke generated HTML artifact",
    projectLabel: "Runtime smoke",
  });

  addCheck(
    `${ownerSession.username} generated artifact review gate`,
    publishWithoutReview.response.status === 400 &&
      publishWithoutReview.body.ok === false &&
      /reviewed before publishing/i.test(String(publishWithoutReview.body.error ?? "")),
    "Cohort artifact publishing requires an explicit reviewed-output confirmation.",
  );

  const publishGenerated = await postJsonWithCookie("/api/artifacts", ownerSession.cookie, {
    fileId: generatedArtifactId,
    visibility: "cohort",
    displayName: "Smoke generated HTML artifact",
    projectLabel: "Runtime smoke",
    reviewConfirmed: true,
  });

  addCheck(
    `${ownerSession.username} generated artifact publish`,
    publishGenerated.response.ok &&
      publishGenerated.body.ok === true &&
      publishGenerated.body.artifact?.visibility === "cohort",
    "Owner can explicitly publish a generated artifact to cohort visibility.",
  );

  const otherPublishedArtifactOpen = await fetch(`${baseUrl}/api/artifacts/open?id=${encodeURIComponent(generatedArtifactId)}`, {
    headers: {
      cookie: otherInternSession.cookie,
    },
  });
  const otherPublishedArtifactHtml = await otherPublishedArtifactOpen.text();

  addCheck(
    `${otherInternSession.username} generated artifact cohort open`,
    otherPublishedArtifactOpen.ok && otherPublishedArtifactHtml === html,
    "A different intern can open the generated artifact only after cohort publish.",
  );

  const otherPublishedArtifactList = await getWithCookie("/api/artifacts", otherInternSession.cookie);

  addCheck(
    `${otherInternSession.username} generated artifact cohort list`,
    otherPublishedArtifactList.response.ok &&
      otherPublishedArtifactList.body.ok === true &&
      otherPublishedArtifactList.body.artifacts?.some(
        (artifact) => artifact.id === generatedArtifactId && artifact.visibility === "cohort" && artifact.storagePath === null,
      ),
    "A different intern sees generated artifact metadata only after cohort publish and still does not receive Blob paths.",
  );

  addCheck(
    `${otherInternSession.username} generated artifact headers`,
    headerIncludes(otherPublishedArtifactOpen, "cache-control", "no-store") &&
      headerIncludes(otherPublishedArtifactOpen, "content-security-policy", "sandbox") &&
      headerIncludes(otherPublishedArtifactOpen, "referrer-policy", "no-referrer") &&
      headerIncludes(otherPublishedArtifactOpen, "cross-origin-resource-policy", "same-origin"),
    "Published HTML artifacts are served no-store with sandbox, no-referrer, and same-origin resource isolation.",
  );
}

async function assertChatRoute(session) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  const response = await postRawJsonWithCookie(
    "/api/chat",
    session.cookie,
    {
      messages: [
        {
          id: `smoke-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Summarize in one short sentence how this portal helps interns use the CE workflow safely.",
            },
          ],
        },
      ],
    },
    { signal: controller.signal },
  ).catch((error) => {
    clearTimeout(timeout);
    throw error;
  });

  clearTimeout(timeout);

  addCheck(
    `${session.username} chat route`,
    response.ok,
    "Authenticated server-side Foundry/Azure chat route accepts a tiny request.",
  );

  if (!response.ok) {
    throw new Error("Chat route request failed");
  }

  const reader = response.body?.getReader();

  if (!reader) {
    addCheck(`${session.username} chat stream`, false, "Chat response did not include a readable stream.");
    return;
  }

  const firstChunk = await reader.read();

  reader.cancel().catch(() => undefined);

  addCheck(
    `${session.username} chat stream`,
    !firstChunk.done && firstChunk.value.byteLength > 0,
    "Foundry/Azure response stream starts without exposing keys to the browser.",
  );
}

async function assertAiRoute(session) {
  const response = await postJsonWithCookie("/api/ai", session.cookie, {
    purpose: "Runtime smoke test",
    prompt: "Return exactly one short sentence explaining that CE workflows guide safer intern analysis.",
  });

  addCheck(
    `${session.username} ai route`,
      response.response.ok &&
      response.body.ok === true &&
      typeof response.body.text === "string" &&
      response.body.text.trim().length > 0 &&
      response.body.routeManaged === true &&
      response.body.modelTier === undefined,
    "Authenticated server-side Foundry/Azure generation route returns text while keeping routing server-managed and hidden from interns.",
  );
}

async function main() {
  console.log(`Runtime smoke target: ${baseUrl}`);

  if (runPublicOnly) {
    await assertPublicAuthBoundaries();
    finishSmokeChecks();
    return;
  }

  validateRequiredSmokeEnv();

  const neonSession = await login({
    username: getRequiredEnv("SMOKE_NEON_USERNAME"),
    password: getRequiredEnv("SMOKE_NEON_PASSWORD"),
    expectedMode: process.env.SMOKE_NEON_WORKFLOW_MODE ?? "neon",
  });
  const phiSession = await login({
    username: getRequiredEnv("SMOKE_PHI_USERNAME"),
    password: getRequiredEnv("SMOKE_PHI_PASSWORD"),
    expectedMode: process.env.SMOKE_PHI_WORKFLOW_MODE ?? "phi_local",
  });
  const adminSession = await login({
    username: getRequiredEnv("SMOKE_ADMIN_USERNAME"),
    password: getRequiredEnv("SMOKE_ADMIN_PASSWORD"),
    expectedMode: process.env.SMOKE_ADMIN_WORKFLOW_MODE ?? "dual",
  });

  await assertMe(neonSession, process.env.SMOKE_NEON_WORKFLOW_MODE ?? "neon");
  await assertMe(phiSession, process.env.SMOKE_PHI_WORKFLOW_MODE ?? "phi_local");
  await assertMe(adminSession, process.env.SMOKE_ADMIN_WORKFLOW_MODE ?? "dual");
  await assertNeonEnabled(neonSession);
  await assertNeonBlocked(phiSession);
  await assertQueryPreview(neonSession, phiSession);
  await assertDatasetRecipes(neonSession, phiSession, adminSession);
  await assertChatSessions(phiSession, neonSession, adminSession);
  await assertWorkspaceDocs(phiSession, neonSession, adminSession);
  await assertAdminUsage(adminSession, [neonSession, phiSession, adminSession]);

  if (runUpload) {
    await assertBlobUpload(phiSession, neonSession, adminSession);
  } else {
    addCheck("blob upload skipped", true, "Set SMOKE_TEST_UPLOAD=1 or pass --upload to test Azure Blob upload/complete and owner/admin access.");
  }

  if (runChat) {
    await assertChatRoute(phiSession);
    await assertAiRoute(phiSession);
  } else {
    addCheck("chat smoke skipped", true, "Set SMOKE_TEST_CHAT=1 or pass --chat to test the server-side Foundry/Azure chat and generation routes.");
  }

  finishSmokeChecks();
}

main().catch((error) => {
  console.error(`FAIL runtime smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
