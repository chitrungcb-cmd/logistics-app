export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize = DEFAULT_PAGE_SIZE
) {
  const page = positiveInteger(searchParams.get("page"), 1);
  const requestedPageSize = positiveInteger(searchParams.get("pageSize"), defaultPageSize);
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    page: Math.min(page, totalPages),
    pageSize,
    total,
    totalPages,
  };
}

export type PaginationMeta = ReturnType<typeof paginationMeta>;
