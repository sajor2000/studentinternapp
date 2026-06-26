export function assertSameOriginRequest(request: Request): void {
  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    return;
  }

  let requestOrigin: string;
  let origin: string;

  try {
    requestOrigin = new URL(request.url).origin;
    origin = new URL(originHeader).origin;
  } catch {
    throw new Error("Request origin could not be verified.");
  }

  if (origin !== requestOrigin) {
    throw new Error("Cross-site requests are not allowed.");
  }
}

export function rejectCrossSiteRequest(request: Request): Response | null {
  try {
    assertSameOriginRequest(request);
    return null;
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Cross-site requests are not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
}
