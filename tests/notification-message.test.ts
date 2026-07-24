import { describe, expect, it } from "vitest";
import { notificationMessageForDisplay } from "@/lib/notification-message";

describe("notificationMessageForDisplay", () => {
  it("hides a legacy internal shipment code suffix", () => {
    expect(
      notificationMessageForDisplay(
        "Dung đã cập nhật Khai 119 sang Hoàn thành - Lô hàng LH20260723-22052037"
      )
    ).toBe("Dung đã cập nhật Khai 119 sang Hoàn thành");
  });

  it("leaves notifications without a shipment code unchanged", () => {
    const message = "⚠ Quá 3 ngày chưa có chi phí thực tế · TK 108435522640";
    expect(notificationMessageForDisplay(message)).toBe(message);
  });
});
