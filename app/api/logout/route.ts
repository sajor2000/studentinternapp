import { NextResponse } from "next/server";
import { getSessionCookieOptions, sessionCookieName } from "../../lib/auth";
import { rejectCrossSiteRequest } from "../../lib/request-security";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  const crossSiteResponse = rejectCrossSiteRequest(request);

  if (crossSiteResponse) {
    return crossSiteResponse;
  }

  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });

  response.cookies.set(sessionCookieName, "", {
    ...getSessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}
