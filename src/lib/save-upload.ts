import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { validateUploadedFile } from "@/lib/file-security";
import { isPrivateStorageConfigured, uploadPrivateObject } from "@/lib/private-storage";

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

  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniquePrefix = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
  const fileName = `${uniquePrefix}-${safeName}`;

  await writeFile(path.join(UPLOAD_DIR, fileName), buffer);

  return { name: originalName, url: `/uploads/${fileName}` };
}
