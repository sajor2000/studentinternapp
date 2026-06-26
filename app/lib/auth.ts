import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getAppSql } from "./db";
import { getOptionalEnv, getRequiredEnv } from "./env";

export type UserRole = "intern" | "admin";
export type WorkflowMode = "neon" | "phi_local" | "dual";

export type InternUser = {
  username: string;
  displayName: string;
  role: UserRole;
  workflowMode: WorkflowMode;
  passwordHash: string;
  isActive?: boolean;
};

export type SessionUser = Omit<InternUser, "passwordHash">;

type SessionPayload = SessionUser & {
  exp: number;
};

export const sessionCookieName = "summer_intern_session";

const minimumSessionSecretLength = 32;
const sessionMaxAgeSeconds = 60 * 60 * 12;
const defaultWorkflowMode: WorkflowMode = "dual";
const placeholderSessionSecrets = new Set(["replace-with-long-random-secret"]);

function normalizeWorkflowMode(value: unknown): WorkflowMode {
  return value === "neon" || value === "phi_local" || value === "dual" ? value : defaultWorkflowMode;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function getSessionSecret(): string {
  const secret = getRequiredEnv("SESSION_SECRET");

  if (secret.length < minimumSessionSecretLength || placeholderSessionSecrets.has(secret)) {
    throw new Error("SESSION_SECRET must be set to a long random value.");
  }

  return secret;
}

function parseUsers(): InternUser[] {
  const rawUsers = process.env.INTERN_USERS_JSON?.trim();

  if (!rawUsers) {
    return [];
  }

  const users = JSON.parse(rawUsers) as InternUser[];

  return users.filter(
    (user) =>
      user.username &&
      user.displayName &&
      (user.role === "intern" || user.role === "admin") &&
      user.passwordHash &&
      user.isActive !== false &&
      (user.isActive === undefined || typeof user.isActive === "boolean"),
  ).map((user) => ({
    ...user,
    workflowMode: normalizeWorkflowMode(user.workflowMode),
  }));
}

export function getConfiguredUsers(): InternUser[] {
  return parseUsers();
}

function allowEnvAuthFallback(): boolean {
  return !getOptionalEnv("DATABASE_URL") || envAuthFallbackExplicitlyEnabled();
}

function envAuthFallbackExplicitlyEnabled(): boolean {
  return getOptionalEnv("AUTH_ALLOW_ENV_FALLBACK") === "true";
}

function getFallbackUser(username: string): InternUser | null {
  if (!allowEnvAuthFallback()) {
    return null;
  }

  return (
    getConfiguredUsers().find(
      (candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase(),
    ) ?? null
  );
}

async function getNeonUser(username: string): Promise<InternUser | null | undefined> {
  const sql = getAppSql();

  if (!sql) {
    return undefined;
  }

  const workflowModeColumnRows = (await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'app_private'
        and table_name = 'intern_users'
        and column_name = 'workflow_mode'
    ) as has_workflow_mode
  `) as Array<{ has_workflow_mode: boolean }>;
  const hasWorkflowModeColumn = workflowModeColumnRows[0]?.has_workflow_mode === true;
  const rows = (hasWorkflowModeColumn
    ? await sql`
        select
          username,
          display_name,
          role,
          workflow_mode,
          password_hash
        from app_private.intern_users
        where lower(username) = lower(${username.trim()})
          and is_active = true
        limit 1
      `
    : await sql`
        select
          username,
          display_name,
          role,
          null::text as workflow_mode,
          password_hash
        from app_private.intern_users
        where lower(username) = lower(${username.trim()})
          and is_active = true
        limit 1
      `) as Array<{
    username: string;
    display_name: string;
    role: UserRole;
    workflow_mode: WorkflowMode | null;
    password_hash: string;
  }>;

  const user = rows[0];

  if (!user || (user.role !== "intern" && user.role !== "admin")) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    workflowMode: normalizeWorkflowMode(user.workflow_mode),
    passwordHash: user.password_hash,
  };
}

async function findUser(username: string): Promise<InternUser | null> {
  try {
    const neonUser = await getNeonUser(username);

    if (neonUser !== undefined) {
      if (neonUser || !envAuthFallbackExplicitlyEnabled()) {
        return neonUser;
      }

      return getFallbackUser(username);
    }
  } catch (error) {
    if (!allowEnvAuthFallback() || getConfiguredUsers().length === 0) {
      throw error;
    }
  }

  return getFallbackUser(username);
}

async function revalidateSessionUser(user: SessionUser): Promise<SessionUser | null> {
  if (!getOptionalEnv("DATABASE_URL")) {
    const fallbackUser = getFallbackUser(user.username);

    return fallbackUser
      ? {
          username: fallbackUser.username,
          displayName: fallbackUser.displayName,
          role: fallbackUser.role,
          workflowMode: fallbackUser.workflowMode,
        }
      : null;
  }

  try {
    const neonUser = await getNeonUser(user.username);

    if (neonUser === undefined) {
      return user;
    }

    if (neonUser) {
      return {
        username: neonUser.username,
        displayName: neonUser.displayName,
        role: neonUser.role,
        workflowMode: neonUser.workflowMode,
      };
    }

    if (!allowEnvAuthFallback()) {
      return null;
    }
  } catch {
    if (!allowEnvAuthFallback()) {
      return null;
    }
  }

  const fallbackUser = getFallbackUser(user.username);

  return fallbackUser
    ? {
        username: fallbackUser.username,
        displayName: fallbackUser.displayName,
        role: fallbackUser.role,
        workflowMode: fallbackUser.workflowMode,
      }
    : null;
}

export async function verifyLogin(username: string, password: string): Promise<SessionUser | null> {
  const user = await findUser(username);

  if (!user) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workflowMode: user.workflowMode,
  };
}

export function createSessionToken(user: SessionUser): string {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySessionToken(token: string | undefined): SessionUser | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  let payload: SessionPayload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    username: payload.username,
    displayName: payload.displayName,
    role: payload.role,
    workflowMode: normalizeWorkflowMode(payload.workflowMode),
  };
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!user) {
    return null;
  }

  return revalidateSessionUser(user);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  };
}

export function canAccessNeon(user: SessionUser): boolean {
  return user.role === "admin" || user.workflowMode === "neon" || user.workflowMode === "dual";
}

export function canUsePhiLocalWorkflow(user: SessionUser): boolean {
  return user.role === "admin" || user.workflowMode === "phi_local" || user.workflowMode === "dual";
}
