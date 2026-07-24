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
