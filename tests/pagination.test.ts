import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, paginationMeta, parsePagination } from "@/lib/pagination";

describe("pagination", () => {
  it("uses safe defaults", () => {
    expect(parsePagination(new URLSearchParams())).toEqual({ page: 1, pageSize: 50, skip: 0 });
  });

  it("clamps invalid and oversized values", () => {
    expect(parsePagination(new URLSearchParams("page=-2&pageSize=999"))).toEqual({
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      skip: 0,
    });
  });

  it("computes metadata and never returns zero pages", () => {
    expect(paginationMeta(2, 50, 125)).toEqual({
      page: 2,
      pageSize: 50,
      total: 125,
      totalPages: 3,
    });
    expect(paginationMeta(1, 50, 0).totalPages).toBe(1);
  });
});
