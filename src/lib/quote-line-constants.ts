export const QUOTE_LINE_OPTIONS = [
  "THU_TUC_HAI_QUAN",
  "VAN_TAI",
  "DANG_KIEM",
  "PHAT_SINH",
] as const;

export const QUOTE_LINE_LABELS: Record<(typeof QUOTE_LINE_OPTIONS)[number], string> = {
  THU_TUC_HAI_QUAN: "Thủ tục hải quan",
  VAN_TAI: "Vận tải",
  DANG_KIEM: "Đăng kiểm",
  PHAT_SINH: "Chi phí phát sinh",
};
