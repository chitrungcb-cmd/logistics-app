export const CHANNEL_OPTIONS = ["Xanh", "Vàng", "Đỏ"] as const;

export const STATUS_OPTIONS = [
  "Đang làm thủ tục",
  "Thông quan",
  "Hoàn thành",
  "Đưa hàng về bảo quản",
  "Giải phóng hàng",
  "Hủy",
] as const;

export const CUSTOMS_TYPE_OPTIONS = ["Nhập khẩu", "Xuất khẩu", "Tạm nhập tái xuất", "Chuyển cửa khẩu"] as const;

export function generateShipmentCode() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // Millisecond timestamp tail + random pair: a 4-digit-only random suffix collided under bulk
  // Gmail sync (hundreds of shipments created within the same day/second — birthday-paradox territory).
  const uniquePart = Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
  return `LH${datePart}-${uniquePart}`;
}

export function channelBadgeClass(channel: string | null | undefined) {
  switch (channel) {
    case "Xanh":
      return "bg-green-100 text-green-700";
    case "Vàng":
      return "bg-yellow-100 text-yellow-700";
    case "Đỏ":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case "Thông quan":
    case "Hoàn thành":
      return "bg-green-100 text-green-700";
    case "Đang làm thủ tục":
      return "bg-blue-100 text-blue-700";
    case "Đưa hàng về bảo quản":
    case "Giải phóng hàng":
      return "bg-orange-100 text-orange-700";
    case "Hủy":
      return "bg-gray-200 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export type Attachment = {
  name: string;
  url: string;
  uploadedAt: string;
};

function normalizeDocumentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d")
    .replaceAll("Đ", "D")
    .toLowerCase();
}

/**
 * HYS chỉ được theo dõi cho lô ô tô. Tên hàng từ tờ khai không đồng nhất, nên nhận cả cách viết
 * "ô tô"/"oto" và những nhóm xe đường bộ thường gặp, nhưng không coi mọi tên bắt đầu bằng "xe"
 * (ví dụ xe nâng, xe máy chuyên dùng) là ô tô.
 */
export function shipmentRequiresHys(goodsName: string | null | undefined) {
  if (!goodsName) return false;
  const normalized = normalizeDocumentText(goodsName);
  return [
    /(^|[^a-z0-9])o\s*to([^a-z0-9]|$)/,
    /(^|[^a-z0-9])automobile([^a-z0-9]|$)/,
    /(^|[^a-z0-9])dau\s+keo([^a-z0-9]|$)/,
    /(^|[^a-z0-9])xe\s+(tai|ben|tron|khach|con)([^a-z0-9]|$)/,
    /^\s*\d*\s*tron([^a-z0-9]|$)/,
  ].some((pattern) => pattern.test(normalized));
}

export function isHysAttachment(filename: string) {
  return /hys/i.test(filename);
}

export function hasHysAttachment(attachments: Attachment[] | null | undefined) {
  return Boolean(attachments?.some((attachment) => isHysAttachment(attachment.name)));
}

function attachmentIdentity(attachment: Attachment) {
  // Content-addressed private URLs may carry a display-name query. The path is the stored object.
  return attachment.url.split(/[?#]/, 1)[0];
}

/** Keeps the first reference to each stored object, preventing duplicate attachment rows. */
export function mergeUniqueAttachments(...groups: Attachment[][]) {
  const merged: Attachment[] = [];
  const seen = new Set<string>();
  for (const attachment of groups.flat()) {
    const identity = attachmentIdentity(attachment);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(attachment);
  }
  return merged;
}

/** Extracts VNACCS declaration numbers embedded in attachment names. */
export function declarationNumbersFromFilename(filename: string) {
  return [...filename.matchAll(/(?<!\d)\d{12}(?!\d)/g)].map((match) => match[0]);
}

/**
 * Chooses which files from a multi-declaration Gmail message belong to one declaration.
 * Parsed declaration workbooks are authoritative. Other files are matched by the 12-digit
 * declaration number in their filename; an unnumbered file is only safe when the email contains
 * exactly one declaration.
 */
export function attachmentMatchesDeclaration(input: {
  filename: string;
  parsedDeclarationNo?: string | null;
  targetDeclarationNo: string;
  declarationCount: number;
}) {
  if (input.parsedDeclarationNo) {
    return input.parsedDeclarationNo === input.targetDeclarationNo;
  }

  const numbers = declarationNumbersFromFilename(input.filename);
  if (numbers.length > 0) return numbers.includes(input.targetDeclarationNo);
  return input.declarationCount === 1;
}

/**
 * Removes declaration files that were historically attached to an unrelated shipment. Revisions
 * of the same declaration share the first 11 digits and stay together; genuinely different
 * declaration families are detached during the versioned Gmail re-sync.
 */
export function attachmentBelongsToDeclarationFamilies(
  filename: string,
  declarationNumbers: string[]
) {
  const fileNumbers = declarationNumbersFromFilename(filename);
  if (fileNumbers.length === 0) return true;

  const allowedFamilies = new Set(
    declarationNumbers.filter(Boolean).map((number) => declarationFamily(number))
  );
  return fileNumbers.some((number) => allowedFamilies.has(declarationFamily(number)));
}

/** VNACCS clearance-decision workbooks use names such as ToKhaiHQ7N_QDTQ_….xlsx. */
export function isClearanceDecisionFilename(filename: string) {
  return filename.toLowerCase().includes("qdtq");
}

/**
 * Gmail returns newest messages first, so an older storage-instruction email can be processed after
 * a newer clearance decision in the same sync. Once cleared, that older email must not move the
 * shipment backwards to bonded storage.
 */
export function resolveSyncedShipmentStatus(
  currentStatus: string,
  result: { isCleared: boolean; hasStorageInstruction: boolean }
) {
  if (result.isCleared) return "Thông quan";
  if (result.hasStorageInstruction && currentStatus !== "Thông quan") {
    return "Đưa hàng về bảo quản";
  }
  return currentStatus;
}

function declarationFamily(number: string) {
  return number.length >= 11 ? number.slice(0, 11) : number;
}

/**
 * True khi `newDeclarationNo` là bản sửa/nộp lại của một tờ khai đã có trên lô (cùng prefix 11 số với
 * `declarationNo` hoặc một nhánh bất kỳ). Dùng để siết việc khớp theo số invoice: một invoice thương
 * mại có thể phủ nhiều tờ khai HOÀN TOÀN riêng biệt (khác prefix, không có "số tờ khai đầu tiên") —
 * những cái đó phải là lô riêng, không được gộp chỉ vì trùng invoice.
 */
export function sharesDeclarationFamily(
  shipment: { declarationNo: string | null; declarationBranches: unknown },
  newDeclarationNo: string
): boolean {
  const family = declarationFamily(newDeclarationNo);
  const branches = Array.isArray(shipment.declarationBranches)
    ? (shipment.declarationBranches as unknown[]).filter((b): b is string => typeof b === "string")
    : [];
  const existing = [shipment.declarationNo, ...branches].filter((n): n is string => Boolean(n));
  return existing.some((n) => declarationFamily(n) === family);
}

/**
 * Collapses legacy amendment numbers that were previously stored as separate branches. VNACCS uses
 * the same first 11 digits for revisions of one declaration; only unrelated prefixes are real
 * branches. The latest number seen for each family is retained for future sync updates.
 */
export function normalizeDeclarationBranches(branches: string[]) {
  const normalized: string[] = [];
  const familyIndexes = new Map<string, number>();

  for (const rawNumber of branches) {
    const number = rawNumber.trim();
    if (!number) continue;

    const family = declarationFamily(number);
    const existingIndex = familyIndexes.get(family);
    if (existingIndex === undefined) {
      familyIndexes.set(family, normalized.length);
      normalized.push(number);
    } else {
      normalized[existingIndex] = number;
    }
  }

  return normalized;
}

/**
 * Declarations amended/split via Gmail sync keep their full number history in `declarationBranches`,
 * in the order each was first seen. Returns null when there's only one (i.e. nothing to label as a
 * branch) so callers can fall back to plain `declarationNo` display.
 */
export function getDeclarationBranches(branches: string[] | null | undefined) {
  if (!branches) return null;
  const normalized = normalizeDeclarationBranches(branches);
  if (normalized.length <= 1) return null;
  return normalized.map((number, index) => ({ label: `Nhánh ${index + 1}`, number }));
}

/**
 * Adds a declaration number to a shipment's branch history — but only as a *new* branch if it's a
 * genuinely different declaration. VNACCS resubmits/amends a declaration under the same 11-digit
 * prefix with just the trailing digit changed; that's still the same declaration, so it replaces the
 * existing entry in place rather than appending. A real branch (different invoice-sharing declaration,
 * or a >50-line split referencing a different original) has an unrelated prefix and gets appended.
 */
export function mergeDeclarationBranch(branches: string[], newDeclarationNo: string): string[] {
  const normalized = normalizeDeclarationBranches(branches);
  const prefix = newDeclarationNo.length >= 11 ? newDeclarationNo.slice(0, 11) : newDeclarationNo;
  const sameFamilyIndex = normalized.findIndex(
    (b) => b.length >= 11 && b.slice(0, 11) === prefix
  );

  if (sameFamilyIndex === -1) return [...normalized, newDeclarationNo];
  if (normalized[sameFamilyIndex] === newDeclarationNo) return normalized;

  const updated = [...normalized];
  updated[sameFamilyIndex] = newDeclarationNo;
  return updated;
}

/** True once `date` is within `daysAhead` days of now, or already past — used to flag upcoming deadlines. */
export function isDateApproaching(date: string | Date | null | undefined, daysAhead = 7) {
  if (!date) return false;
  const target = new Date(date).getTime();
  const threshold = Date.now() + daysAhead * 24 * 60 * 60 * 1000;
  return target <= threshold;
}
