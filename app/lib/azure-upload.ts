import type { Readable } from "stream";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import { createHash, randomUUID } from "crypto";
import { getOptionalEnv, getRequiredEnv } from "./env";

const defaultContainerName = "summer-intern-uploads";
const defaultMaxUploadBytes = 100 * 1024 * 1024;
const defaultMaxUploadMetadataBytes = 16 * 1024;
const defaultSasMinutes = 10;
const maxSasMinutes = 15;

const allowedExtensions = new Set([
  ".csv",
  ".xlsx",
  ".parquet",
  ".ipynb",
  ".py",
  ".r",
  ".rmd",
  ".qmd",
  ".html",
  ".htm",
  ".docx",
  ".pptx",
]);
const portalBlobAppMetadata = "rheas-intern-ai-chat";
const controlledDataMetadata = "true";

const contentTypeByExtension: Record<string, string> = {
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".parquet": "application/vnd.apache.parquet",
  ".ipynb": "application/x-ipynb+json",
  ".py": "text/x-python",
  ".r": "text/x-r-source",
  ".rmd": "text/markdown",
  ".qmd": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

type ParsedConnectionString = {
  accountName: string;
  accountKey: string;
  blobEndpoint: string;
};

type StoragePathPrefix = "uploads" | "artifacts";

export type AzureUploadTarget = {
  uploadUrl: string;
  storagePath: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
  contentType: string;
  extension: string;
  maxBytes: number;
};

export type AzureBlobDownload = {
  readableStreamBody: Readable;
  contentType: string;
  contentLength?: number;
};

export type AzureBlobProperties = {
  contentType: string;
  contentLength: number;
  metadata: Record<string, string>;
};

export type AzureStoredBlob = {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  extension: string;
};

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(getOptionalEnv(name) ?? "", 10);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getUploadSasMinutes(): number {
  return Math.min(parsePositiveIntegerEnv("AZURE_UPLOAD_SAS_MINUTES", defaultSasMinutes), maxSasMinutes);
}

function parseStorageConnectionString(connectionString: string): ParsedConnectionString {
  const parts = Object.fromEntries(
    connectionString
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
      }),
  );
  const accountName = parts.AccountName;
  const accountKey = parts.AccountKey;

  if (!accountName || !accountKey) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING must include AccountName and AccountKey.");
  }

  return {
    accountName,
    accountKey,
    blobEndpoint: parts.BlobEndpoint ?? `https://${accountName}.blob.${parts.EndpointSuffix ?? "core.windows.net"}`,
  };
}

function getFileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");

  return lastDotIndex >= 0 ? normalized.slice(lastDotIndex) : "";
}

export function normalizeContentType(extension: string): string {
  return contentTypeByExtension[extension.toLowerCase()] ?? "application/octet-stream";
}

function assertValidContainerName(containerName: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(containerName) || containerName.includes("--")) {
    throw new Error("AZURE_STORAGE_CONTAINER must be a valid Azure Blob container name.");
  }
}

export function getSafeStorageUsername(username: string): string {
  const normalizedUsername = username.trim().toLowerCase();
  const readableLabel =
    normalizedUsername
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "user";
  const digest = createHash("sha256")
    .update(normalizedUsername)
    .digest("hex")
    .slice(0, 12);

  return `${readableLabel}-${digest}`;
}

export function isAzureStoragePathForUser({
  storagePath,
  prefix,
  username,
}: {
  storagePath: string;
  prefix: StoragePathPrefix;
  username: string;
}): boolean {
  return storagePath.startsWith(`${prefix}/${getSafeStorageUsername(username)}/`);
}

export function isAzureStoragePathOwnedByUser({
  storagePath,
  username,
}: {
  storagePath: string;
  username: string;
}): boolean {
  return (
    isAzureStoragePathForUser({ storagePath, prefix: "uploads", username }) ||
    isAzureStoragePathForUser({ storagePath, prefix: "artifacts", username })
  );
}

export function createAzureStoragePath({
  prefix,
  username,
  extension,
  date = new Date(),
  id = randomUUID(),
}: {
  prefix: StoragePathPrefix;
  username: string;
  extension: string;
  date?: Date;
  id?: string;
}): string {
  const normalizedExtension = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  const dateLabel = date.toISOString().slice(0, 10);

  return `${prefix}/${getSafeStorageUsername(username)}/${dateLabel}/${id}${normalizedExtension}`;
}

export function hasAzureControlledMetadata(metadata: Record<string, string>): boolean {
  return metadata.app === portalBlobAppMetadata && metadata.controlleddata === controlledDataMetadata;
}

function getAzureBlobContext() {
  const parsed = parseStorageConnectionString(getRequiredEnv("AZURE_STORAGE_CONNECTION_STRING"));
  const containerName = getOptionalEnv("AZURE_STORAGE_CONTAINER") ?? defaultContainerName;

  assertValidContainerName(containerName);

  const credential = new StorageSharedKeyCredential(parsed.accountName, parsed.accountKey);
  const blobServiceClient = new BlobServiceClient(parsed.blobEndpoint, credential);

  return {
    containerClient: blobServiceClient.getContainerClient(containerName),
    containerName,
    credential,
  };
}

export function validateUploadRequest({
  fileName,
  sizeBytes,
}: {
  fileName: string;
  sizeBytes: number;
}): { extension: string; maxBytes: number } {
  const extension = getFileExtension(fileName);
  const maxBytes = parsePositiveIntegerEnv("AZURE_UPLOAD_MAX_BYTES", defaultMaxUploadBytes);

  if (!allowedExtensions.has(extension)) {
    throw new Error("Supported uploads are CSV, XLSX, Parquet, Jupyter notebooks, Python, R, Quarto, HTML, Word, and PowerPoint files.");
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error("File size is required.");
  }

  if (sizeBytes > maxBytes) {
    throw new Error(`File is larger than the configured ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  }

  return { extension, maxBytes };
}

export function validateUploadMetadataRequestContentLength(request: Request): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);
  const maxBytes = parsePositiveIntegerEnv("AZURE_UPLOAD_METADATA_MAX_BYTES", defaultMaxUploadMetadataBytes);

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("Upload metadata request size is invalid.");
  }

  if (contentLength > maxBytes) {
    throw new Error(`Upload metadata request is larger than the ${Math.round(maxBytes / 1024)} KB limit.`);
  }
}

export async function createAzureUploadTarget({
  username,
  fileName,
  sizeBytes,
}: {
  username: string;
  fileName: string;
  sizeBytes: number;
}): Promise<AzureUploadTarget> {
  const { extension, maxBytes } = validateUploadRequest({ fileName, sizeBytes });
  const sasMinutes = getUploadSasMinutes();
  const { containerClient, containerName, credential } = getAzureBlobContext();

  await containerClient.createIfNotExists();

  const safeUsername = getSafeStorageUsername(username);
  const storagePath = createAzureStoragePath({ prefix: "uploads", username, extension });
  const blobClient = containerClient.getBlockBlobClient(storagePath);
  const expiresOn = new Date(Date.now() + sasMinutes * 60 * 1000);
  const normalizedContentType = normalizeContentType(extension);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: storagePath,
      contentType: normalizedContentType,
      expiresOn,
      permissions: BlobSASPermissions.parse("cw"),
      protocol: SASProtocol.Https,
      startsOn: new Date(Date.now() - 60 * 1000),
    },
    credential,
  ).toString();

  return {
    uploadUrl: `${blobClient.url}?${sas}`,
    storagePath,
    expiresAt: expiresOn.toISOString(),
    requiredHeaders: {
      "x-ms-blob-type": "BlockBlob",
      "x-ms-meta-owner": safeUsername,
      "x-ms-meta-app": portalBlobAppMetadata,
      "x-ms-meta-controlleddata": controlledDataMetadata,
      "Content-Type": normalizedContentType,
    },
    contentType: normalizedContentType,
    extension,
    maxBytes,
  };
}

export async function uploadAzureGeneratedArtifact({
  username,
  html,
}: {
  username: string;
  html: string;
}): Promise<AzureStoredBlob> {
  const content = Buffer.from(html, "utf8");
  const { extension } = validateUploadRequest({ fileName: "artifact.html", sizeBytes: content.byteLength });
  const { containerClient } = getAzureBlobContext();

  await containerClient.createIfNotExists();

  const safeUsername = getSafeStorageUsername(username);
  const storagePath = createAzureStoragePath({ prefix: "artifacts", username, extension });
  const blobClient = containerClient.getBlockBlobClient(storagePath);
  const contentType = contentTypeByExtension[extension] ?? "text/html";

  await blobClient.uploadData(content, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
    metadata: {
      owner: safeUsername,
      app: portalBlobAppMetadata,
      controlleddata: controlledDataMetadata,
      artifactkind: "html_artifact",
    },
  });

  return {
    storagePath,
    contentType,
    sizeBytes: content.byteLength,
    extension,
  };
}

export async function downloadAzureBlob(storagePath: string): Promise<AzureBlobDownload> {
  const { containerClient } = getAzureBlobContext();
  const blobClient = containerClient.getBlockBlobClient(storagePath);
  const response = await blobClient.download(0);

  if (!response.readableStreamBody) {
    throw new Error("Azure Blob did not return a readable stream.");
  }

  return {
    readableStreamBody: response.readableStreamBody as Readable,
    contentType: response.contentType ?? "application/octet-stream",
    contentLength: response.contentLength,
  };
}

export async function getAzureBlobProperties(storagePath: string): Promise<AzureBlobProperties> {
  const { containerClient } = getAzureBlobContext();
  const blobClient = containerClient.getBlockBlobClient(storagePath);
  const response = await blobClient.getProperties();

  if (typeof response.contentLength !== "number" || response.contentLength <= 0) {
    throw new Error("Uploaded blob is empty or unavailable.");
  }

  return {
    contentType: response.contentType ?? "application/octet-stream",
    contentLength: response.contentLength,
    metadata: response.metadata ?? {},
  };
}

export async function assertAzureBlobOwner({
  storagePath,
  username,
}: {
  storagePath: string;
  username: string;
}): Promise<void> {
  if (!isAzureStoragePathOwnedByUser({ storagePath, username })) {
    throw new Error("Blob path does not match the recorded owner.");
  }

  const properties = await getAzureBlobProperties(storagePath);

  if (properties.metadata.owner !== getSafeStorageUsername(username)) {
    throw new Error("Blob owner metadata does not match the recorded owner.");
  }

  if (!hasAzureControlledMetadata(properties.metadata)) {
    throw new Error("Blob metadata does not match the portal-controlled policy.");
  }
}

export async function deleteAzureBlobIfExists(storagePath: string): Promise<void> {
  const { containerClient } = getAzureBlobContext();
  const blobClient = containerClient.getBlockBlobClient(storagePath);

  await blobClient.deleteIfExists();
}
