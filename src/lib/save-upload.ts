import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/** Saves a buffer into public/uploads under a collision-safe name; returns the display name + public URL. */
export async function saveUploadedFile(originalName: string, buffer: Buffer) {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniquePrefix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const fileName = `${uniquePrefix}-${safeName}`;

  await writeFile(path.join(UPLOAD_DIR, fileName), buffer);

  return { name: originalName, url: `/uploads/${fileName}` };
}
