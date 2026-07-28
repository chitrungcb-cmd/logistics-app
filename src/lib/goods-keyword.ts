/**
 * Shipment goods names are free text. This deliberately small normalizer gives us a stable,
 * explainable product-group key without pretending to be a full product classifier.
 */
export function getGoodsKeyword(goodsName: string | null | undefined): string | null {
  if (!goodsName) return null;
  const withoutQty = goodsName.replace(/^\d+\s+/, "").trim();
  const words = withoutQty.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(" ").toUpperCase();
}

/**
 * Số lượng đơn vị (máy/xe/...) suy từ số đứng đầu tên hàng, vd "10 MÁY NGHIỀN ĐÁ" → 10,
 * "20 ĐẦU KÉO" → 20. Không có số đầu → 1.
 */
export function getGoodsQuantity(goodsName: string | null | undefined): number {
  const match = (goodsName ?? "").trim().match(/^(\d+)\b/);
  const n = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Đơn vị tính "cho cả lô" (không nhân theo số lượng hàng): để trống hoặc "Lô". Các đơn vị khác
 * (máy, xe, cái...) được tính theo số lượng trong tên hàng.
 */
export function isPerLotUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim();
  if (u === "") return true;
  return normalizeCustomsGate(u) === "LO";
}

/**
 * Chuẩn hóa tên cửa khẩu về chuỗi chỉ gồm chữ/số IN HOA (bỏ dấu, bỏ khoảng trắng/ký tự đặc biệt) để
 * so khớp bảng giá theo cửa khẩu với `Shipment.port` (là chuỗi tự do như "CUA KHAU TRA LINH (CAO BANG)").
 */
export function normalizeCustomsGate(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/**
 * Một bộ giá theo cửa khẩu áp cho lô khi: cửa khẩu preset rỗng ("" = mọi cửa khẩu), hoặc `port` của lô
 * chứa tên cửa khẩu của preset (sau chuẩn hóa).
 */
export function presetGateMatchesPort(presetGate: string, shipmentPort: string | null | undefined): boolean {
  const gate = normalizeCustomsGate(presetGate);
  if (!gate) return true;
  return normalizeCustomsGate(shipmentPort).includes(gate);
}
