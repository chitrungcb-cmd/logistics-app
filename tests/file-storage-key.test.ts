import { describe, expect, it } from "vitest";
import { contentAddressedFileName } from "@/lib/file-storage-key";

describe("content-addressed attachment storage", () => {
  it("reuses the same key for identical bytes", () => {
    const content = Buffer.from("same attachment");
    expect(contentAddressedFileName("invoice.PDF", content)).toBe(
      contentAddressedFileName("renamed.pdf", content)
    );
  });

  it("uses a different key when file content changes", () => {
    expect(contentAddressedFileName("invoice.pdf", Buffer.from("first"))).not.toBe(
      contentAddressedFileName("invoice.pdf", Buffer.from("second"))
    );
  });
});
