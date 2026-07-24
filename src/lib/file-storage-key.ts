import { createHash } from "crypto";

/** Stable storage identity: equal bytes with the same file type always resolve to one object. */
export function contentAddressedFileName(originalName: string, buffer: Buffer) {
  const extension = originalName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const hash = createHash("sha256").update(buffer).digest("hex");
  return `${hash}.${extension}`;
}
