import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  sessionCookieName,
  verifyLogin,
} from "../../lib/auth";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from "../../lib/rate-limit";
import { rejectCrossSiteRequest } from "../../lib/request-security";
import { validateLoginRequestContentLength } from "../../lib/request-size";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  const crossSiteResponse = rejectCrossSiteRequest(request);

  if (crossSiteResponse) {
    return crossSiteResponse;
  }

  try {
    validateLoginRequestContentLength(request);

    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const username = body.username.trim();
    const password = body.password;

    if (!username || !password) {
      return NextResponse.json(
        { ok: false, error: "Username and password are required." },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const rateLimit = checkLoginRateLimit(request, username);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many sign-in attempts. Try again later." },
        {
          status: 429,
          headers: rateLimit.retryAfterSeconds
            ? { ...noStoreHeaders, "retry-after": String(rateLimit.retryAfterSeconds) }
            : noStoreHeaders,
        },
      );
    }

    const user = await verifyLogin(username, password);

    if (!user) {
      recordLoginFailure(request, username);
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401, headers: noStoreHeaders },
      );
    }

    clearLoginFailures(request, username);

    const response = NextResponse.json({ ok: true, user }, { headers: noStoreHeaders });

    response.cookies.set(sessionCookieName, createSessionToken(user), getSessionCookieOptions());

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Login request")) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 400, headers: noStoreHeaders },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Login is not configured." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
