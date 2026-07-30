import { describe, expect, it } from "vitest";
import { parseReportDateRange } from "@/lib/report-date-range";

describe("parseReportDateRange", () => {
  it("không lọc khi không truyền khoảng ngày", () => {
    expect(parseReportDateRange(new URLSearchParams())).toEqual({ ok: true, range: null });
  });

  it("tạo khoảng bao gồm trọn ngày kết thúc", () => {
    const result = parseReportDateRange(
      new URLSearchParams({ dateFrom: "2026-07-01", dateTo: "2026-07-31" })
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.range) return;
    expect(result.range.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(result.range.endExclusive.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("từ chối ngày không tồn tại hoặc thứ tự sai", () => {
    expect(parseReportDateRange(
      new URLSearchParams({ dateFrom: "2026-02-30", dateTo: "2026-03-01" })
    ).ok).toBe(false);
    expect(parseReportDateRange(
      new URLSearchParams({ dateFrom: "2026-08-01", dateTo: "2026-07-31" })
    ).ok).toBe(false);
  });
});

