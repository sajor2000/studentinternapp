import { getOptionalEnv } from "./env";

const defaultMaxAppMetadataBytes = 512 * 1024;
const defaultMaxLoginRequestBytes = 4 * 1024;

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(getOptionalEnv(name) ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function validateAppMetadataRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  const maxBytes = getPositiveIntegerEnv("APP_METADATA_MAX_BYTES", defaultMaxAppMetadataBytes);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("Metadata request size is invalid.");
  }

  if (contentLength > maxBytes) {
    throw new Error(`Metadata request is larger than the ${Math.round(maxBytes / 1024)} KB limit.`);
  }
}

export function validateLoginRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  const maxBytes = getPositiveIntegerEnv("LOGIN_REQUEST_MAX_BYTES", defaultMaxLoginRequestBytes);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("Login request size is invalid.");
  }

  if (contentLength > maxBytes) {
    throw new Error(`Login request is larger than the ${Math.max(1, Math.ceil(maxBytes / 1024))} KB limit.`);
  }
}
