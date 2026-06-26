type RateLimitEntry = {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
};

type FixedWindowEntry = {
  count: number;
  firstAttemptAt: number;
};

export type FixedWindowRateLimitConfig = {
  limit: number;
  windowSeconds: number;
};

export type LoginRateLimitConfig = {
  maxFailedAttempts: number;
  windowSeconds: number;
  lockSeconds: number;
};

export type FixedWindowRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds?: number;
  resetAt: number;
};

const failedLoginAttempts = new Map<string, RateLimitEntry>();
const fixedWindowAttempts = new Map<string, FixedWindowEntry>();

const defaultLoginWindowSeconds = 15 * 60;
const defaultLoginLockSeconds = 15 * 60;
const defaultMaxFailedLoginAttempts = 5;
const defaultAiRateLimitRequests = 20;
const defaultAiRateLimitWindowSeconds = 60;
const defaultQueryRateLimitRequests = 30;
const defaultQueryRateLimitWindowSeconds = 60;
const defaultUploadRateLimitRequests = 20;
const defaultUploadRateLimitWindowSeconds = 300;

function nowMs() {
  return Date.now();
}

function readPositiveIntegerEnv(name: string, fallback: number, maxValue: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);

  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(value, maxValue);
}

function getEntry(key: string, config: LoginRateLimitConfig): RateLimitEntry {
  const existing = failedLoginAttempts.get(key);
  const now = nowMs();
  const windowMs = config.windowSeconds * 1000;

  if (!existing || now - existing.firstAttemptAt > windowMs) {
    return {
      count: 0,
      firstAttemptAt: now,
      lockedUntil: 0,
    };
  }

  return existing;
}

function normalizeLimitKey(prefix: string, username: string): string {
  return `${prefix}:${username.trim().toLowerCase() || "unknown"}`;
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return (
    forwardedFor ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function loginKeys(request: Request, username: string): string[] {
  const normalizedUsername = username.trim().toLowerCase();
  const ip = getClientIp(request);

  return [`ip:${ip}`, `user:${normalizedUsername}`];
}

export function getLoginRateLimitConfig(): LoginRateLimitConfig {
  return {
    maxFailedAttempts: readPositiveIntegerEnv("LOGIN_MAX_FAILED_ATTEMPTS", defaultMaxFailedLoginAttempts, 100),
    windowSeconds: readPositiveIntegerEnv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", defaultLoginWindowSeconds, 24 * 60 * 60),
    lockSeconds: readPositiveIntegerEnv("LOGIN_LOCK_SECONDS", defaultLoginLockSeconds, 24 * 60 * 60),
  };
}

export function checkLoginRateLimit(request: Request, username: string): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const now = nowMs();
  const config = getLoginRateLimitConfig();

  for (const key of loginKeys(request, username)) {
    const entry = getEntry(key, config);

    if (entry.lockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      };
    }
  }

  return { allowed: true };
}

export function recordLoginFailure(request: Request, username: string): void {
  const now = nowMs();
  const config = getLoginRateLimitConfig();
  const lockMs = config.lockSeconds * 1000;

  for (const key of loginKeys(request, username)) {
    const entry = getEntry(key, config);
    const nextCount = entry.count + 1;

    failedLoginAttempts.set(key, {
      count: nextCount,
      firstAttemptAt: entry.firstAttemptAt,
      lockedUntil: nextCount >= config.maxFailedAttempts ? now + lockMs : entry.lockedUntil,
    });
  }
}

export function clearLoginFailures(request: Request, username: string): void {
  for (const key of loginKeys(request, username)) {
    failedLoginAttempts.delete(key);
  }
}

export function getAiRateLimitConfig(): FixedWindowRateLimitConfig {
  return {
    limit: readPositiveIntegerEnv("AI_RATE_LIMIT_REQUESTS", defaultAiRateLimitRequests, 500),
    windowSeconds: readPositiveIntegerEnv("AI_RATE_LIMIT_WINDOW_SECONDS", defaultAiRateLimitWindowSeconds, 3600),
  };
}

export function getQueryPreviewRateLimitConfig(): FixedWindowRateLimitConfig {
  return {
    limit: readPositiveIntegerEnv("QUERY_RATE_LIMIT_REQUESTS", defaultQueryRateLimitRequests, 1000),
    windowSeconds: readPositiveIntegerEnv("QUERY_RATE_LIMIT_WINDOW_SECONDS", defaultQueryRateLimitWindowSeconds, 3600),
  };
}

export function getUploadRateLimitConfig(): FixedWindowRateLimitConfig {
  return {
    limit: readPositiveIntegerEnv("UPLOAD_RATE_LIMIT_REQUESTS", defaultUploadRateLimitRequests, 500),
    windowSeconds: readPositiveIntegerEnv("UPLOAD_RATE_LIMIT_WINDOW_SECONDS", defaultUploadRateLimitWindowSeconds, 3600),
  };
}

export function checkFixedWindowRateLimit(
  key: string,
  config: FixedWindowRateLimitConfig,
): FixedWindowRateLimitResult {
  const now = nowMs();
  const windowMs = config.windowSeconds * 1000;
  const existing = fixedWindowAttempts.get(key);
  const entry =
    !existing || now - existing.firstAttemptAt >= windowMs
      ? { count: 0, firstAttemptAt: now }
      : existing;
  const nextCount = entry.count + 1;
  const resetAt = entry.firstAttemptAt + windowMs;

  fixedWindowAttempts.set(key, {
    count: nextCount,
    firstAttemptAt: entry.firstAttemptAt,
  });

  if (nextCount > config.limit) {
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      resetAt,
    };
  }

  return {
    allowed: true,
    limit: config.limit,
    remaining: Math.max(0, config.limit - nextCount),
    resetAt,
  };
}

export function checkAiRequestRateLimit(username: string): FixedWindowRateLimitResult {
  return checkFixedWindowRateLimit(normalizeLimitKey("ai", username), getAiRateLimitConfig());
}

export function checkQueryPreviewRateLimit(username: string): FixedWindowRateLimitResult {
  return checkFixedWindowRateLimit(normalizeLimitKey("query-preview", username), getQueryPreviewRateLimitConfig());
}

export function checkUploadRequestRateLimit(username: string): FixedWindowRateLimitResult {
  return checkFixedWindowRateLimit(normalizeLimitKey("upload", username), getUploadRateLimitConfig());
}
