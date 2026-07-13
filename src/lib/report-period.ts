export type ReportPeriod = "day" | "week" | "month" | "quarter" | "half" | "year";

export const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: "day", label: "Theo ngày" },
  { value: "week", label: "Theo tuần" },
  { value: "month", label: "Theo tháng" },
  { value: "quarter", label: "Theo quý" },
  { value: "half", label: "Theo nửa năm" },
  { value: "year", label: "Theo năm" },
];

export type Bucket = {
  key: string;
  label: string;
  start: Date;
  end: Date; // exclusive
};

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}

// A plain 7-day-bucket "week" reset every Jan 1 — not ISO 8601 (Monday-start) since this is an
// internal report, not a payroll/legal calendar, and it avoids the year-boundary edge cases ISO
// week numbering has (a week can belong to a different year than the date itself).
function simpleWeekNumber(date: Date): number {
  return Math.ceil(dayOfYear(date) / 7);
}

export function bucketKeyFor(date: Date, period: ReportPeriod): string {
  const y = date.getFullYear();
  switch (period) {
    case "day":
      return `${y}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    case "week":
      return `${y}-W${String(simpleWeekNumber(date)).padStart(2, "0")}`;
    case "month":
      return `${y}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    case "quarter":
      return `${y}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case "half":
      return `${y}-H${date.getMonth() < 6 ? 1 : 2}`;
    case "year":
      return `${y}`;
  }
}

export function bucketLabelFor(key: string, period: ReportPeriod): string {
  switch (period) {
    case "day": {
      const [y, m, d] = key.split("-");
      return `${d}/${m}/${y}`;
    }
    case "week": {
      const [y, w] = key.split("-W");
      return `Tuần ${Number(w)}/${y}`;
    }
    case "month": {
      const [y, m] = key.split("-");
      return `Tháng ${Number(m)}/${y}`;
    }
    case "quarter": {
      const [y, q] = key.split("-Q");
      return `Quý ${q}/${y}`;
    }
    case "half": {
      const [y, h] = key.split("-H");
      return `Nửa năm ${h}/${y}`;
    }
    case "year":
      return `Năm ${key}`;
  }
}

/** Every bucket in `year` for the year-scoped periods (all except "year" itself, which spans all years present in the data). */
export function generateBucketsForYear(period: ReportPeriod, year: number): Bucket[] {
  const buckets: Bucket[] = [];

  if (period === "day") {
    const d = new Date(year, 0, 1);
    while (d.getFullYear() === year) {
      const start = new Date(d);
      const end = new Date(d);
      end.setDate(end.getDate() + 1);
      const key = bucketKeyFor(start, period);
      buckets.push({ key, label: bucketLabelFor(key, period), start, end });
      d.setDate(d.getDate() + 1);
    }
  } else if (period === "week") {
    for (let w = 1; w <= 53; w++) {
      const start = new Date(year, 0, 1 + (w - 1) * 7);
      if (start.getFullYear() > year) break;
      const end = new Date(year, 0, 1 + w * 7);
      const key = `${year}-W${String(w).padStart(2, "0")}`;
      buckets.push({ key, label: bucketLabelFor(key, period), start, end });
    }
  } else if (period === "month") {
    for (let m = 0; m < 12; m++) {
      const start = new Date(year, m, 1);
      const end = new Date(year, m + 1, 1);
      const key = bucketKeyFor(start, period);
      buckets.push({ key, label: bucketLabelFor(key, period), start, end });
    }
  } else if (period === "quarter") {
    for (let q = 0; q < 4; q++) {
      const start = new Date(year, q * 3, 1);
      const end = new Date(year, q * 3 + 3, 1);
      const key = `${year}-Q${q + 1}`;
      buckets.push({ key, label: bucketLabelFor(key, period), start, end });
    }
  } else if (period === "half") {
    for (let h = 0; h < 2; h++) {
      const start = new Date(year, h * 6, 1);
      const end = new Date(year, h * 6 + 6, 1);
      const key = `${year}-H${h + 1}`;
      buckets.push({ key, label: bucketLabelFor(key, period), start, end });
    }
  }

  return buckets;
}
