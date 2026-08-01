import { describe, expect, it } from "vitest";
import { removeAttachmentsFromDeletedMessages, type Attachment } from "@/lib/shipment-constants";

function att(name: string, extra: Partial<Attachment> = {}): Attachment {
  return { name, url: `/u/${name}`, uploadedAt: "2026-01-01T00:00:00.000Z", ...extra };
}

describe("removeAttachmentsFromDeletedMessages — chỉ gỡ đính kèm của email đã xóa", () => {
  it("gỡ đính kèm có nguồn nằm trong tập email đã xóa", () => {
    const attachments = [
      att("tokhai.xlsx", { gmailMessageId: "m1" }),
      att("hoadon.pdf", { gmailMessageId: "m2" }),
    ];
    const { kept, removed } = removeAttachmentsFromDeletedMessages(attachments, new Set(["m1"]));
    expect(removed.map((a) => a.name)).toEqual(["tokhai.xlsx"]);
    expect(kept.map((a) => a.name)).toEqual(["hoadon.pdf"]);
  });

  it("KHÔNG BAO GIỜ gỡ file tự upload (không có gmailMessageId), kể cả khi id trùng rỗng", () => {
    const attachments = [
      att("tay-upload.pdf"), // không nguồn
      att("tu-gmail.xlsx", { gmailMessageId: "m9" }),
    ];
    const { kept, removed } = removeAttachmentsFromDeletedMessages(attachments, new Set(["m9"]));
    expect(kept.map((a) => a.name)).toEqual(["tay-upload.pdf"]);
    expect(removed.map((a) => a.name)).toEqual(["tu-gmail.xlsx"]);
  });

  it("tập rỗng = không gỡ gì", () => {
    const attachments = [att("a.pdf", { gmailMessageId: "m1" }), att("b.pdf")];
    const { kept, removed } = removeAttachmentsFromDeletedMessages(attachments, new Set());
    expect(removed).toHaveLength(0);
    expect(kept).toHaveLength(2);
  });
});
