export const OTHER_EXPENSE_CATEGORY_OPTIONS = [
  "TIEP_KHACH",
  "AN_UONG",
  "VAN_PHONG_PHAM",
  "DI_LAI",
  "DIEN_NUOC_INTERNET",
  "THUE_VAN_PHONG",
  "SUA_CHUA_BAO_TRI",
  "PHI_NGAN_HANG",
  "KHAC",
] as const;

export type OtherExpenseCategory = (typeof OTHER_EXPENSE_CATEGORY_OPTIONS)[number];

export function isOtherExpenseCategory(value: unknown): value is OtherExpenseCategory {
  return typeof value === "string" && OTHER_EXPENSE_CATEGORY_OPTIONS.some((item) => item === value);
}

export const OTHER_EXPENSE_CATEGORY_LABELS: Record<OtherExpenseCategory, string> = {
  TIEP_KHACH: "Tiếp khách",
  AN_UONG: "Ăn uống",
  VAN_PHONG_PHAM: "Văn phòng phẩm",
  DI_LAI: "Đi lại",
  DIEN_NUOC_INTERNET: "Điện, nước, Internet",
  THUE_VAN_PHONG: "Thuê văn phòng",
  SUA_CHUA_BAO_TRI: "Sửa chữa, bảo trì",
  PHI_NGAN_HANG: "Phí ngân hàng",
  KHAC: "Khác",
};

export const OTHER_EXPENSE_CATEGORY_STYLES: Record<OtherExpenseCategory, string> = {
  TIEP_KHACH: "bg-purple-100 text-purple-700",
  AN_UONG: "bg-orange-100 text-orange-700",
  VAN_PHONG_PHAM: "bg-blue-100 text-blue-700",
  DI_LAI: "bg-cyan-100 text-cyan-700",
  DIEN_NUOC_INTERNET: "bg-amber-100 text-amber-700",
  THUE_VAN_PHONG: "bg-indigo-100 text-indigo-700",
  SUA_CHUA_BAO_TRI: "bg-rose-100 text-rose-700",
  PHI_NGAN_HANG: "bg-emerald-100 text-emerald-700",
  KHAC: "bg-gray-100 text-gray-700",
};

export const OTHER_EXPENSE_PAYMENT_METHODS = [
  "Tiền mặt",
  "Chuyển khoản",
  "Thẻ công ty",
] as const;

// Chiều của một khoản: THU (tiền vào) hay CHI (tiền ra).
export const OTHER_ENTRY_TYPES = ["CHI", "THU"] as const;
export type OtherEntryType = (typeof OTHER_ENTRY_TYPES)[number];

export function isOtherEntryType(value: unknown): value is OtherEntryType {
  return value === "THU" || value === "CHI";
}

export const OTHER_ENTRY_TYPE_LABELS: Record<OtherEntryType, string> = {
  CHI: "Chi",
  THU: "Thu",
};

// Khoản THU chỉ có một nhóm chung "Thu khác" (lưu category = KHAC), nên hiển thị nhãn nhóm theo chiều:
// THU → "Thu khác"; CHI → nhãn nhóm chi tương ứng.
export const OTHER_INCOME_CATEGORY_LABEL = "Thu khác";
export function otherEntryCategoryLabel(type: OtherEntryType, category: OtherExpenseCategory) {
  return type === "THU" ? OTHER_INCOME_CATEGORY_LABEL : OTHER_EXPENSE_CATEGORY_LABELS[category];
}
export const OTHER_INCOME_CATEGORY_STYLE = "bg-emerald-100 text-emerald-700";
export function otherEntryCategoryStyle(type: OtherEntryType, category: OtherExpenseCategory) {
  return type === "THU" ? OTHER_INCOME_CATEGORY_STYLE : OTHER_EXPENSE_CATEGORY_STYLES[category];
}
