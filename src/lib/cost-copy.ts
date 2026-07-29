type CostCopyIdentity = {
  category: string;
  customLabel?: string | null;
  vendorId?: string | null;
  unitPrice: number;
  quantity: number;
  unit?: string | null;
  paidByUserId?: string | null;
  paidFromCompanyAccountId?: string | null;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeNumber(value: number) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "0.0000";
}

/**
 * Dùng để nhận diện một khoản đã có ở lô đích. Không dùng số hóa đơn/tệp đính kèm vì hai dữ liệu
 * này luôn thuộc riêng lô nguồn và tuyệt đối không được sao chép sang lô mới.
 */
export function costCopySignature(cost: CostCopyIdentity) {
  return [
    cost.category,
    normalizeText(cost.customLabel),
    cost.vendorId ?? "",
    normalizeNumber(cost.unitPrice),
    normalizeNumber(cost.quantity),
    normalizeText(cost.unit),
    cost.paidFromCompanyAccountId ? `ACCOUNT:${cost.paidFromCompanyAccountId}` : `USER:${cost.paidByUserId ?? ""}`,
  ].join("|");
}

/**
 * Sao chép phần cấu hình nhập liệu, nhưng đặt lại toàn bộ dữ liệu giao dịch của lô cũ.
 */
export function buildCopiedCostData<T extends CostCopyIdentity & {
  note?: string | null;
}>(source: T, shipmentId: string) {
  return {
    shipmentId,
    category: source.category,
    unitPrice: source.unitPrice,
    quantity: source.quantity,
    costPrice: source.unitPrice * source.quantity,
    sellPrice: 0,
    isAdditional: false,
    isActual: true,
    invoiceNumber: null,
    attachmentUrl: null,
    unit: source.unit?.trim() || null,
    customLabel: source.customLabel?.trim() || null,
    note: source.note?.trim() || null,
    vendorId: source.vendorId || null,
    paidByUserId: source.paidFromCompanyAccountId ? null : source.paidByUserId || null,
    paidFromCompanyAccountId: source.paidFromCompanyAccountId || null,
    isPaid: false,
    paidAt: null,
    paidConfirmedByUserId: null,
    presetId: null,
  };
}
