import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { readFile, stat } from "fs/promises";
import path from "path";
import { contentAddressedFileName } from "@/lib/file-storage-key";

const PRIVATE_FILE_PREFIX = "/api/attachments/file/";
const OBJECT_ROOT = "attachments";

type SupabaseStorageConfig = {
  baseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

type R2StorageConfig = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const REQUIRED_R2_VARIABLES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

let cachedR2Client: { signature: string; client: S3Client } | null = null;

export class PrivateStorageError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string
  ) {
    super(
      `Private storage request failed (${status}): ${responseBody || "Unknown storage error"}`
    );
    this.name = "PrivateStorageError";
  }
}

export class PrivateStorageConfigurationError extends Error {
  constructor(public readonly missingVariables: readonly string[]) {
    super(
      `Cloudflare R2 chưa được cấu hình đầy đủ. Thiếu: ${missingVariables.join(", ")}.`
    );
    this.name = "PrivateStorageConfigurationError";
  }
}

export function isPrivateStorageConfigurationError(error: unknown) {
  return error instanceof PrivateStorageConfigurationError;
}

export function isPrivateStorageRestrictedError(error: unknown) {
  return (
    error instanceof PrivateStorageError &&
    (error.status === 402 ||
      /exceed_egress_quota|service for this project is restricted|spend caps/i.test(
        error.responseBody
      ))
  );
}

function r2StorageConfig(): R2StorageConfig | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const values = {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucket,
  };
  const configuredValues = Object.values(values).filter(Boolean).length;

  if (configuredValues === 0) return null;
  if (configuredValues !== 4) {
    throw new PrivateStorageConfigurationError(
      REQUIRED_R2_VARIABLES.filter((key) => !values[key])
    );
  }

  const customEndpoint = process.env.R2_ENDPOINT?.trim().replace(/\/$/, "");
  return {
    endpoint: customEndpoint || `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
  };
}

function supabaseStorageConfig(): SupabaseStorageConfig | null {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) return null;

  return {
    baseUrl,
    serviceRoleKey,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "logistics-attachments",
  };
}

function r2Client(config: R2StorageConfig) {
  const signature = `${config.endpoint}\u0000${config.accessKeyId}`;
  if (cachedR2Client?.signature === signature) return cachedR2Client.client;

  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedR2Client = { signature, client };
  return client;
}

export function isPrivateStorageConfigured() {
  return r2StorageConfig() !== null;
}

/** True only when Cloudflare R2 is the primary private attachment store. */
export function isR2StorageConfigured() {
  return r2StorageConfig() !== null;
}

/**
 * Checks R2 directly, deliberately without the legacy Supabase read fallback. The one-time Gmail
 * recovery uses this to find provider-neutral attachment URLs whose bytes still exist only in the
 * old bucket.
 */
export async function privateObjectExistsInR2(key: string) {
  if (!isSafeObjectKey(key)) throw new Error("Invalid private storage object key.");
  const config = r2StorageConfig();
  if (!config) throw new Error("Cloudflare R2 is not configured.");

  try {
    await r2Client(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (isR2NotFound(error)) return false;
    throw error;
  }
}

function requireSupabaseStorageConfig() {
  const config = supabaseStorageConfig();
  if (!config) {
    throw new Error(
      "Private storage is not configured. Set the Cloudflare R2 variables or the legacy " +
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY variables."
    );
  }
  return config;
}

function requireR2StorageConfig() {
  const config = r2StorageConfig();
  if (!config) throw new PrivateStorageConfigurationError(REQUIRED_R2_VARIABLES);
  return config;
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function isSafeObjectKey(key: string) {
  if (!key.startsWith(`${OBJECT_ROOT}/`) || key.length > 1_024 || key.includes("\\")) return false;
  const segments = key.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !/[\u0000-\u001f\u007f]/.test(segment)
  );
}

export function privateObjectKeyFromUrl(url: string) {
  if (!url.startsWith(PRIVATE_FILE_PREFIX)) return null;
  const encodedKey = url.slice(PRIVATE_FILE_PREFIX.length).split(/[?#]/, 1)[0];
  try {
    const key = encodedKey.split("/").map(decodeURIComponent).join("/");
    return isSafeObjectKey(key) ? key : null;
  } catch {
    return null;
  }
}

export function privateFileUrl(key: string, displayName?: string) {
  if (!isSafeObjectKey(key)) throw new Error("Invalid private storage object key.");
  const baseUrl = `${PRIVATE_FILE_PREFIX}${encodePath(key)}`;
  return displayName ? `${baseUrl}?name=${encodeURIComponent(displayName)}` : baseUrl;
}

export function fileNameFromObjectKey(key: string) {
  const storedName = key.split("/").pop() || "attachment";
  return (
    storedName.replace(/^\d+-[0-9a-f]{32}-/, "").replace(/^[0-9a-f]{64}-/, "") ||
    "attachment"
  );
}

export function contentTypeForFileName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: "application/pdf",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    xml: "application/xml",
  };
  return (extension && types[extension]) || "application/octet-stream";
}

function storageHeaders(config: SupabaseStorageConfig) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

async function storageError(response: Response) {
  const message = (await response.text()).slice(0, 500);
  return new PrivateStorageError(response.status, message || response.statusText);
}

function r2ErrorStatus(error: unknown) {
  if (error instanceof S3ServiceException) return error.$metadata.httpStatusCode;
  if (error && typeof error === "object" && "$metadata" in error) {
    const metadata = error.$metadata;
    if (metadata && typeof metadata === "object" && "httpStatusCode" in metadata) {
      return metadata.httpStatusCode;
    }
  }
  return undefined;
}

function isR2NotFound(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  return r2ErrorStatus(error) === 404 || name === "NoSuchKey" || name === "NotFound";
}

function isR2PreconditionFailure(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  return r2ErrorStatus(error) === 412 || name === "PreconditionFailed";
}

async function uploadR2Object(
  config: R2StorageConfig,
  key: string,
  fileName: string,
  buffer: Buffer,
  overwrite: boolean
) {
  const client = r2Client(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentTypeForFileName(fileName),
        CacheControl: "private, no-store",
        ...(overwrite ? {} : { IfNoneMatch: "*" }),
      })
    );
  } catch (error) {
    if (overwrite || !isR2PreconditionFailure(error)) throw error;
    // A content-addressed key can legitimately be uploaded concurrently. Confirm that the
    // existing object is present before treating the duplicate as a successful idempotent write.
    await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  }
}

export async function uploadPrivateObject(fileName: string, buffer: Buffer) {
  const storedName = contentAddressedFileName(fileName, buffer);
  const key = [OBJECT_ROOT, "sha256", storedName.slice(0, 2), storedName].join("/");
  // New and edited files must never silently fall back to the legacy Supabase bucket. A missing
  // R2 configuration is an operational error that the hosting panel must surface explicitly.
  await uploadR2Object(requireR2StorageConfig(), key, fileName, buffer, false);
  return { key, url: privateFileUrl(key, fileName) };
}

/** Replaces the bytes at an existing private object key without creating another attachment URL. */
export async function overwritePrivateObject(key: string, fileName: string, buffer: Buffer) {
  if (!isSafeObjectKey(key) || !key.startsWith(`${OBJECT_ROOT}/editable/`)) {
    throw new Error("Invalid editable private storage object key.");
  }
  await uploadR2Object(requireR2StorageConfig(), key, fileName, buffer, true);
}

async function fetchSupabaseObject(
  config: SupabaseStorageConfig,
  key: string,
  range?: string | null
) {
  const response = await fetch(
    `${config.baseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodePath(key)}`,
    {
      headers: {
        ...storageHeaders(config),
        ...(range ? { Range: range } : {}),
      },
      cache: "no-store",
    }
  );
  if (!response.ok) throw await storageError(response);
  return response;
}

async function fetchR2Object(config: R2StorageConfig, key: string, range?: string | null) {
  const object = await r2Client(config).send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ...(range ? { Range: range } : {}),
    })
  );
  if (!object.Body) throw new Error("R2 returned an empty object body.");

  const headers = new Headers({ "accept-ranges": "bytes" });
  if (object.ContentType) headers.set("content-type", object.ContentType);
  if (object.ContentLength !== undefined) headers.set("content-length", String(object.ContentLength));
  if (object.ContentRange) headers.set("content-range", object.ContentRange);
  if (object.ETag) headers.set("etag", object.ETag);
  if (object.LastModified) headers.set("last-modified", object.LastModified.toUTCString());

  return new Response(object.Body.transformToWebStream(), {
    status: object.ContentRange ? 206 : 200,
    headers,
  });
}

export async function fetchPrivateObject(key: string, range?: string | null) {
  if (!isSafeObjectKey(key)) throw new Error("Invalid private storage object key.");
  const r2 = r2StorageConfig();
  if (!r2) return fetchSupabaseObject(requireSupabaseStorageConfig(), key, range);

  try {
    return await fetchR2Object(r2, key, range);
  } catch (error) {
    const legacy = supabaseStorageConfig();
    if (!isR2NotFound(error) || !legacy) throw error;
    // Existing database URLs are provider-neutral. During migration, an object missing in R2 is
    // transparently read from the old private Supabase bucket without changing any database row.
    return fetchSupabaseObject(legacy, key, range);
  }
}

/** Reads either a new private-storage URL or a legacy local upload for authenticated previews. */
export async function readStoredFile(url: string, maxBytes: number) {
  const objectKey = privateObjectKeyFromUrl(url);
  if (objectKey) {
    const response = await fetchPrivateObject(objectKey);
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && (declaredSize <= 0 || declaredSize > maxBytes)) {
      throw new Error("Tệp trống hoặc vượt quá giới hạn xem trước.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length <= 0 || buffer.length > maxBytes) {
      throw new Error("Tệp trống hoặc vượt quá giới hạn xem trước.");
    }
    return buffer;
  }

  // Backward compatibility while existing /uploads records are migrated to private storage.
  if (!url.startsWith("/uploads/") || url.includes("..")) {
    throw new Error("Đường dẫn tệp không hợp lệ.");
  }
  const uploadRoot = path.resolve(process.cwd(), "public", "uploads");
  const filePath = path.resolve(process.cwd(), "public", `.${url}`);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error("Đường dẫn tệp không hợp lệ.");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxBytes) {
    throw new Error("Tệp trống hoặc vượt quá giới hạn xem trước.");
  }
  return readFile(filePath);
}
