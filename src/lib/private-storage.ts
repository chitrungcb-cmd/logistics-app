import { readFile, stat } from "fs/promises";
import path from "path";
import { contentAddressedFileName } from "@/lib/file-storage-key";

const PRIVATE_FILE_PREFIX = "/api/attachments/file/";
const OBJECT_ROOT = "attachments";

type StorageConfig = {
  baseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

function storageConfig(): StorageConfig | null {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) return null;

  return {
    baseUrl,
    serviceRoleKey,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "logistics-attachments",
  };
}

export function isPrivateStorageConfigured() {
  return storageConfig() !== null;
}

function requireStorageConfig() {
  const config = storageConfig();
  if (!config) {
    throw new Error(
      "Private storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return config;
}

function encodePath(value: string) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function isSafeObjectKey(key: string) {
  if (!key.startsWith(`${OBJECT_ROOT}/`) || key.length > 1_024 || key.includes("\\")) return false;
  const segments = key.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".." && !/[\u0000-\u001f\u007f]/.test(segment)
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
  return storedName
    .replace(/^\d+-[0-9a-f]{32}-/, "")
    .replace(/^[0-9a-f]{64}-/, "") || "attachment";
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

function storageHeaders(config: StorageConfig) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

async function storageError(response: Response) {
  const message = (await response.text()).slice(0, 500);
  return new Error(`Private storage request failed (${response.status}): ${message || response.statusText}`);
}

export async function uploadPrivateObject(fileName: string, buffer: Buffer) {
  const config = requireStorageConfig();
  const storedName = contentAddressedFileName(fileName, buffer);
  const key = [
    OBJECT_ROOT,
    "sha256",
    storedName.slice(0, 2),
    storedName,
  ].join("/");
  const objectUrl =
    `${config.baseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodePath(key)}`;

  const response = await fetch(
    objectUrl,
    {
      method: "POST",
      headers: {
        ...storageHeaders(config),
        "Content-Type": contentTypeForFileName(fileName),
        "Cache-Control": "private, no-store",
        "x-upsert": "false",
      },
      body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    // Supabase rejects an existing object when x-upsert=false. Verify that the deterministic key
    // already exists; this also resolves concurrent uploads of the same bytes without overwriting.
    const existing = await fetch(objectUrl, {
      headers: { ...storageHeaders(config), Range: "bytes=0-0" },
      cache: "no-store",
    });
    if (!existing.ok) throw await storageError(response);
    await existing.body?.cancel();
  }
  return { key, url: privateFileUrl(key, fileName) };
}

/** Replaces the bytes at an existing private object key without creating another attachment URL. */
export async function overwritePrivateObject(key: string, fileName: string, buffer: Buffer) {
  if (!isSafeObjectKey(key) || !key.startsWith(`${OBJECT_ROOT}/editable/`)) {
    throw new Error("Invalid editable private storage object key.");
  }
  const config = requireStorageConfig();
  const response = await fetch(
    `${config.baseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodePath(key)}`,
    {
      method: "POST",
      headers: {
        ...storageHeaders(config),
        "Content-Type": contentTypeForFileName(fileName),
        "Cache-Control": "private, no-store",
        "x-upsert": "true",
      },
      body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      cache: "no-store",
    }
  );
  if (!response.ok) throw await storageError(response);
}

export async function fetchPrivateObject(key: string, range?: string | null) {
  if (!isSafeObjectKey(key)) throw new Error("Invalid private storage object key.");
  const config = requireStorageConfig();
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
