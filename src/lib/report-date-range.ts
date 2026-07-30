export type ReportDateRange = {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
};

type ReportDateRangeResult =
  | { ok: true; range: ReportDateRange | null }
  | { ok: false; error: string };

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Đổi khoảng ngày người dùng chọn thành [đầu ngày từ, đầu ngày sau ngày đến). */
export function parseReportDateRange(searchParams: URLSearchParams): ReportDateRangeResult {
  const from = searchParams.get("dateFrom")?.trim() ?? "";
  const to = searchParams.get("dateTo")?.trim() ?? "";

  if (!from && !to) return { ok: true, range: null };
  if (!from || !to) return { ok: false, error: "Hãy chọn đầy đủ ngày bắt đầu và ngày kết thúc." };

  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return { ok: false, error: "Khoảng thời gian tra cứu không hợp lệ." };
  if (start.getTime() > end.getTime()) {
    return { ok: false, error: "Ngày bắt đầu không được sau ngày kết thúc." };
  }

  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { ok: true, range: { from, to, start, endExclusive } };
}

