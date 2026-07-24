import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { validateUploadedFile } from "@/lib/file-security";
import { contentAddressedFileName } from "@/lib/file-storage-key";
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
