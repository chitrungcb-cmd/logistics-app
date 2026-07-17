const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "docx", "doc", "png", "jpg", "jpeg", "xml"]);

export class UnsafeUploadError extends Error {}

function startsWith(buffer: Buffer, signature: number[]) {
  return signature.every((value, index) => buffer[index] === value);
}

function isZip(buffer: Buffer) {
  return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]);
}

function containsZipEntry(buffer: Buffer, entry: string) {
  return buffer.includes(Buffer.from(entry, "utf8"));
}

export function uploadedFileExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/** Validate both the extension and the real file signature before storing a same-origin file. */
export function validateUploadedFile(filename: string, buffer: Buffer) {
  const extension = uploadedFileExtension(filename);
  if (!filename || filename.length > 180 || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new UnsafeUploadError(`Loại tệp ".${extension}" không được hỗ trợ.`);
  }
  if (buffer.length === 0 || buffer.length > MAX_UPLOAD_BYTES) {
    throw new UnsafeUploadError("Tệp trống hoặc vượt quá dung lượng tối đa 20MB.");
  }

  const valid = (() => {
    if (extension === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
    if (extension === "png") return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (extension === "jpg" || extension === "jpeg") return startsWith(buffer, [0xff, 0xd8, 0xff]);
    if (extension === "xls" || extension === "doc") {
      return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    }
    if (extension === "xlsx") {
      return isZip(buffer) && containsZipEntry(buffer, "[Content_Types].xml") && containsZipEntry(buffer, "xl/");
    }
    if (extension === "docx") {
      return isZip(buffer) && containsZipEntry(buffer, "[Content_Types].xml") && containsZipEntry(buffer, "word/");
    }
    // XML is imported only by the Gmail invoice sync (the public upload endpoint does not allow it)
    // and is always served with nosniff + attachment disposition by the authenticated file route.
    if (extension === "xml") {
      const prefix = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trimStart();
      return prefix.startsWith("<?xml") || /^<[A-Za-z_][\w:.-]*(?:\s|>)/.test(prefix);
    }
    return false;
  })();

  if (!valid) {
    throw new UnsafeUploadError("Nội dung tệp không khớp với phần mở rộng hoặc tệp đã bị hỏng.");
  }
}
