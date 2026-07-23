import { describe, expect, it } from "vitest";
import { readApiResponse } from "@/lib/client-api";

describe("readApiResponse", () => {
  it("reads a valid JSON API response", async () => {
    const response = new Response(JSON.stringify({ success: true, data: ["ok"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readApiResponse(response, "Không thể tải dữ liệu.")).resolves.toEqual({
      success: true,
      data: ["ok"],
    });
  });

  it("turns an HTML 404 page into a friendly message", async () => {
    const response = new Response("<!DOCTYPE html><html><body>Not found</body></html>", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });

    await expect(readApiResponse(response, "Không thể tải tiến trình.")).rejects.toThrow(
      "Chức năng này chưa sẵn sàng. Vui lòng tải lại trang."
    );
  });

  it("does not expose JSON parsing errors", async () => {
    const response = new Response("not-json", { status: 502 });

    await expect(readApiResponse(response, "Không thể tải dữ liệu.")).rejects.not.toThrow(
      /Unexpected token|JSON/
    );
  });
});
