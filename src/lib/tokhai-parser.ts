import * as XLSX from "xlsx";

export type ParsedDeclaration = {
  declarationNo: string;
  firstDeclarationNo: string | null;
  channel: string | null;
  customsType: string | null;
  customsOffice: string | null;
  declarationDate: Date | null;
  customerName: string | null;
  taxCode: string | null;
  address: string | null;
  phone: string | null;
  port: string | null;
  invoiceNo: string | null;
  goodsName: string | null;
  consultationDate: Date | null;
  hasStorageInstruction: boolean;
};

const CHANNEL_CODE_MAP: Record<string, string> = {
  "1": "Xanh",
  "2": "Vàng",
  "3": "Đỏ",
};

// Known "Tên cơ quan Hải quan tiếp nhận tờ khai" codes -> readable border-gate names.
// Extend this as new customs office codes show up in synced declarations.
const CUSTOMS_OFFICE_MAP: Record<string, { short: string; full: string }> = {
  HQHUUNGHI: { short: "Hữu Nghị", full: "Chi cục Hải quan cửa khẩu Hữu Nghị" },
  HQTANTHANH: { short: "Tân Thanh", full: "Chi cục Hải quan cửa khẩu Tân Thanh" },
  HQTALUNG: { short: "Tà Lùng", full: "Chi cục Hải quan cửa khẩu Tà Lùng" },
  HQTRALINH: { short: "Trà Lĩnh", full: "Chi cục Hải quan cửa khẩu Trà Lĩnh" },
};

// "Địa điểm lưu kho" (bonded storage) code prefixes -> border gate, used when the customs office
// code above isn't recognized (declaration registered elsewhere but goods stored at this depot).
const STORAGE_LOCATION_PORT_MAP: Record<string, string> = {
  "15BB": "Hữu Nghị",
};

type Rows = string[][];

function cellsToRows(sheet: XLSX.WorkSheet): Rows {
  return XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  });
}

/** Finds a cell matching `label` exactly, returns up to `count` non-empty cells after it in the same row. */
function findLabelValues(rows: Rows, label: string, count = 1): string[] {
  for (const row of rows) {
    const idx = row.findIndex((cell) => (cell || "").trim() === label);
    if (idx === -1) continue;
    const values: string[] = [];
    for (let i = idx + 1; i < row.length && values.length < count; i++) {
      const v = (row[i] || "").trim();
      if (v) values.push(v);
    }
    if (values.length > 0) return values;
  }
  return [];
}

function findLabelValue(rows: Rows, label: string): string | null {
  return findLabelValues(rows, label, 1)[0] ?? null;
}

/** For sectioned fields, e.g. "Người nhập khẩu" section containing a "Tên"/"Mã" sub-row a few rows below. */
function findSectionValue(rows: Rows, sectionLabel: string, subLabel: string, maxRowsAhead = 8): string | null {
  const sectionRowIdx = rows.findIndex((row) => row.some((cell) => (cell || "").trim() === sectionLabel));
  if (sectionRowIdx === -1) return null;
  const end = Math.min(rows.length, sectionRowIdx + 1 + maxRowsAhead);
  for (let r = sectionRowIdx + 1; r < end; r++) {
    const row = rows[r];
    const idx = row.findIndex((cell) => (cell || "").trim() === subLabel);
    if (idx === -1) continue;
    for (let i = idx + 1; i < row.length; i++) {
      const v = (row[i] || "").trim();
      if (v) return v;
    }
  }
  return null;
}

function findDocumentDirection(rows: Rows): "Nhập khẩu" | "Xuất khẩu" | null {
  for (const row of rows) {
    for (const cell of row) {
      const text = (cell || "").toLowerCase();
      if (text.includes("hàng hóa nhập khẩu")) return "Nhập khẩu";
      if (text.includes("hàng hóa xuất khẩu")) return "Xuất khẩu";
    }
  }
  return null;
}

function parseVnDateTime(raw: string): Date | null {
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const date = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    hh ? Number(hh) : 0,
    mi ? Number(mi) : 0,
    ss ? Number(ss) : 0
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Raw "Địa điểm dỡ hàng"/"Địa điểm xếp hàng" text — verbose fallback when no code lookup matches. */
function parseRawPortText(rows: Rows): string | null {
  const values =
    findLabelValues(rows, "Địa điểm dỡ hàng", 2).length > 0
      ? findLabelValues(rows, "Địa điểm dỡ hàng", 2)
      : findLabelValues(rows, "Địa điểm xếp hàng", 2);
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  const [code, name] = values;
  return `${name} (${code})`;
}

function parsePortValue(rows: Rows, customsOfficeCode: string | null): string | null {
  if (customsOfficeCode && CUSTOMS_OFFICE_MAP[customsOfficeCode]) {
    return CUSTOMS_OFFICE_MAP[customsOfficeCode].short;
  }

  const storageLocation = findLabelValue(rows, "Địa điểm lưu kho");
  if (storageLocation) {
    const match = Object.entries(STORAGE_LOCATION_PORT_MAP).find(([prefix]) =>
      storageLocation.startsWith(prefix)
    );
    if (match) return match[1];
  }

  return parseRawPortText(rows);
}

function parseCustomsType(rows: Rows): string | null {
  const direction = findDocumentDirection(rows);
  const rawType = findLabelValue(rows, "Mã loại hình");
  const codeMatch = rawType?.match(/^([A-Z]\d+)/);
  const code = codeMatch?.[1] ?? null;
  if (direction && code) return `${direction} (${code})`;
  return direction ?? code;
}

/** Strips the leading "A - " sequence indicator VNACCS prints in front of the invoice number. */
function cleanInvoiceNo(raw: string | null): string | null {
  return raw ? raw.replace(/^[A-Z]\s*-\s*/, "").trim() || raw : raw;
}

/**
 * VNACCS auto-splits a declaration once it has more than 50 line items — each split-off part gets
 * its own declaration number, but records the original in "Số tờ khai đầu tiên" ("first declaration
 * number"). When there's no split, this cell is just a "-" placeholder — except a merged-cell quirk
 * in these exports bleeds the current declaration's own number into that cell too (observed on every
 * non-split sample file as "<own declarationNo>  -"), so the placeholder alone isn't a reliable "no
 * branch" signal. Strip the current declaration number and surrounding punctuation first; whatever
 * (if anything) is left over is the real reference, if there is one.
 */
function parseFirstDeclarationNo(rows: Rows, currentDeclarationNo: string): string | null {
  const raw = findLabelValue(rows, "Số tờ khai đầu tiên");
  if (!raw) return null;
  const stripped = raw.split(currentDeclarationNo).join("").replace(/[-\s]/g, "");
  return /^\d{8,}$/.test(stripped) ? stripped : null;
}

/**
 * Reads the "Phân loại chỉ thị của Hải quan" section — a free-text log of customs instructions/events
 * (numbered rows 1-10 with Ngày/Tên/Nội dung columns). Detects two signals staff care about:
 * - a "TGTV: dd/mm/yyyy" marker (Thời gian tham vấn — price-consultation appointment date), and
 * - a "bảo quản" / "MHVBQ" keyword (goods released to the importer's own bonded storage while
 *   pending inspection results).
 * Column layout varies between broker software exports, so this scans all non-empty cells in the
 * section as one blob of text rather than relying on fixed positions.
 */
function parseInstructions(rows: Rows): { consultationDate: Date | null; hasStorageInstruction: boolean } {
  const sectionIdx = rows.findIndex((row) =>
    row.some((cell) => (cell || "").trim() === "Phân loại chỉ thị của Hải quan")
  );
  if (sectionIdx === -1) return { consultationDate: null, hasStorageInstruction: false };

  const end = Math.min(rows.length, sectionIdx + 12);
  let content = "";
  for (let r = sectionIdx + 1; r < end; r++) {
    const cells = rows[r].map((c) => (c || "").trim()).filter(Boolean);
    if (cells.length === 0 || cells[0] === "Ngày") continue; // skip blank rows and the column header
    content += ` ${cells.join(" | ")}`;
  }

  const tgtvMatch = content.match(/TGTV\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);

  return {
    consultationDate: tgtvMatch ? parseVnDateTime(tgtvMatch[1]) : null,
    hasStorageInstruction: /mhvbq|bảo quản/i.test(content),
  };
}

/**
 * Parses a VNACCS "Tờ khai hàng hóa nhập/xuất khẩu (thông báo kết quả phân luồng)" print export.
 * Returns null if the file doesn't contain a "Số tờ khai" (declaration number) — i.e. it isn't
 * actually a declaration printout, so callers shouldn't trust it as a match/creation source.
 */
export function parseTokhaiExcel(buffer: Buffer): ParsedDeclaration | null {
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true });

  for (const sheetName of workbook.SheetNames) {
    const rows = cellsToRows(workbook.Sheets[sheetName]);
    const declarationNo = findLabelValue(rows, "Số tờ khai");
    if (!declarationNo) continue;

    const channelCode = findLabelValue(rows, "Mã phân loại kiểm tra");
    const declarationDateRaw = findLabelValue(rows, "Ngày đăng ký");
    const customsOfficeCode = findLabelValue(rows, "Tên cơ quan Hải quan tiếp nhận tờ khai");
    const instructions = parseInstructions(rows);

    return {
      declarationNo,
      firstDeclarationNo: parseFirstDeclarationNo(rows, declarationNo),
      channel: channelCode ? CHANNEL_CODE_MAP[channelCode] ?? null : null,
      customsType: parseCustomsType(rows),
      customsOffice: customsOfficeCode
        ? CUSTOMS_OFFICE_MAP[customsOfficeCode]?.full ?? customsOfficeCode
        : null,
      declarationDate: declarationDateRaw ? parseVnDateTime(declarationDateRaw) : null,
      customerName: findSectionValue(rows, "Người nhập khẩu", "Tên")?.toUpperCase() ?? null,
      taxCode: findSectionValue(rows, "Người nhập khẩu", "Mã"),
      address: findSectionValue(rows, "Người nhập khẩu", "Địa chỉ"),
      phone: findSectionValue(rows, "Người nhập khẩu", "Số điện thoại"),
      port: parsePortValue(rows, customsOfficeCode),
      invoiceNo: cleanInvoiceNo(findLabelValue(rows, "Số hóa đơn")),
      goodsName: findLabelValue(rows, "Mô tả hàng hóa"),
      consultationDate: instructions.consultationDate,
      hasStorageInstruction: instructions.hasStorageInstruction,
    };
  }

  return null;
}
