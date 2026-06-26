import { canUsePhiLocalWorkflow, getSession } from "@/app/lib/auth";
import { createAzureUploadTarget, validateUploadMetadataRequestContentLength, validateUploadRequest } from "@/app/lib/azure-upload";
import { getArtifactKind } from "@/app/lib/artifacts";
import { getAppSql } from "@/app/lib/db";
import { checkUploadRequestRateLimit } from "@/app/lib/rate-limit";
import { rejectCrossSiteRequest } from "@/app/lib/request-security";

export const runtime = "nodejs";

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

type UploadUrlRequest = {
  fileName?: unknown;
  sizeBytes?: unknown;
};

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

    if (!getAppSql()) {
      return Response.json({ ok: false, error: "File metadata database is not configured." }, { status: 503, headers: noStoreHeaders });
    }

    const rateLimit = checkUploadRequestRateLimit(user.username);

    if (!rateLimit.allowed) {
      return Response.json(
        { ok: false, error: "Too many upload requests. Try again shortly.", retryAfterSeconds: rateLimit.retryAfterSeconds },
        {
          status: 429,
          headers: {
            ...noStoreHeaders,
            "retry-after": String(rateLimit.retryAfterSeconds ?? 60),
          },
        },
      );
    }

    validateUploadMetadataRequestContentLength(request);

    const body = (await request.json()) as UploadUrlRequest;

    if (typeof body.fileName !== "string" || typeof body.sizeBytes !== "number") {
      return Response.json(
        { ok: false, error: "fileName and sizeBytes are required." },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const { extension } = validateUploadRequest({
      fileName: body.fileName,
      sizeBytes: body.sizeBytes,
    });

    if (getArtifactKind(extension) === "data_file" && !canUsePhiLocalWorkflow(user)) {
      return Response.json(
        { ok: false, error: "Private file uploads are enabled for PHI-local workflow accounts." },
        { status: 403, headers: noStoreHeaders },
      );
    }

    const upload = await createAzureUploadTarget({
      username: user.username,
      fileName: body.fileName,
      sizeBytes: body.sizeBytes,
    });

    return Response.json({ ok: true, upload }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Azure Blob upload is not configured.";
    const status = message.includes("configured") || message.includes("AZURE_STORAGE") ? 503 : 400;

    return Response.json({ ok: false, error: message }, { status, headers: noStoreHeaders });
  }
}
