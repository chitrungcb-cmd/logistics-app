import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { validateUploadedFile } from "@/lib/file-security";
import { contentAddressedFileName } from "@/lib/file-storage-key";
import {
  isPrivateStorageConfigured,
  overwritePrivateObject,
  privateFileUrl,
  privateObjectKeyFromUrl,
  uploadPrivateObject,
} from "@/lib/private-storage";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/**
 * Saves production files in a private Supabase Storage bucket. Local disk remains a development-only
 * fallback so contributors can run the app before provisioning Supabase; production fails closed.
 */
export async function saveUploadedFile(originalName: string, buffer: Buffer) {
  validateUploadedFile(originalName, buffer);

  if (isPrivateStorageConfigured()) {
    const saved = await uploadPrivateObject(originalName, buffer);
    return { name: originalName, url: saved.url };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Private attachment storage is required in production.");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const fileName = contentAddressedFileName(originalName, buffer);
  try {
    await writeFile(path.join(UPLOAD_DIR, fileName), buffer, { flag: "wx" });
  } catch (error) {
    // A deterministic filename means EEXIST is the expected duplicate-upload path.
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }

  return { name: originalName, url: `/uploads/${fileName}` };
}

function editableStorageKey(originalName: string, currentUrl: string, scopeId: string) {
  const safeScope = scopeId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeScope || safeScope.length > 128) {
    throw new Error("Phạm vi tệp chỉnh sửa không hợp lệ.");
  }
  const extension =
    originalName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const slot = createHash("sha256")
    .update(`${scopeId}\u0000${currentUrl}`)
    .digest("hex")
    .slice(0, 32);
  return `attachments/editable/${safeScope}/${slot}.${extension}`;
}

/**
 * Keeps one mutable attachment slot for an editable workbook. The first edit migrates a legacy
 * immutable upload into that slot; later saves overwrite the same object instead of creating
 * versions.
 */
export async function saveEditableUploadedFile(
  originalName: string,
  currentUrl: string,
  scopeId: string,
  buffer: Buffer
) {
  validateUploadedFile(originalName, buffer);

  if (isPrivateStorageConfigured()) {
    const currentKey = privateObjectKeyFromUrl(currentUrl);
    const editableKey = currentKey?.startsWith("attachments/editable/")
      ? currentKey
      : editableStorageKey(originalName, currentUrl, scopeId);
    await overwritePrivateObject(editableKey, originalName, buffer);
    return { name: originalName, url: privateFileUrl(editableKey, originalName) };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Private attachment storage is required in production.");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const currentFileName = currentUrl.split(/[?#]/, 1)[0].split("/").pop() || "";
  const existingEditable = currentFileName.startsWith("editable-")
    ? currentFileName
    : "";
  const editableName = existingEditable || `editable-${editableStorageKey(
    originalName,
    currentUrl,
    scopeId
  ).split("/").pop()}`;
  await writeFile(path.join(UPLOAD_DIR, editableName), buffer);
  return { name: originalName, url: `/uploads/${editableName}` };
}
