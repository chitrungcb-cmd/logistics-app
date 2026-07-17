import { describe, expect, it } from "vitest";
import { UnsafeUploadError, validateUploadedFile } from "@/lib/file-security";

describe("upload validation", () => {
  it("accepts matching PDF and XLSX signatures", () => {
    expect(() => validateUploadedFile("invoice.pdf", Buffer.from("%PDF-1.7\n"))).not.toThrow();
    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("[Content_Types].xml xl/workbook.xml"),
    ]);
    expect(() => validateUploadedFile("declaration.xlsx", xlsx)).not.toThrow();
  });

  it("rejects executable extensions and spoofed content", () => {
    expect(() => validateUploadedFile("payload.html", Buffer.from("<script>"))).toThrow(UnsafeUploadError);
    expect(() => validateUploadedFile("payload.pdf", Buffer.from("<script>"))).toThrow(UnsafeUploadError);
  });

  it("rejects empty files", () => {
    expect(() => validateUploadedFile("empty.pdf", Buffer.alloc(0))).toThrow(UnsafeUploadError);
  });
});
