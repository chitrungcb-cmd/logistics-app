export type DebtSummaryRow = {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  splitBreakdown: {
    invoiceAmount: number;
    noInvoiceAmount: number;
    paidInvoice: number;
    paidNoInvoice: number;
    remainingInvoice: number;
    remainingNoInvoice: number;
  } | null;
};

export type DebtSummary = {
  count: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  splitCount: number;
  invoiceAmount: number;
  noInvoiceAmount: number;
  paidInvoice: number;
  paidNoInvoice: number;
  remainingInvoice: number;
  remainingNoInvoice: number;
};

export type ShipmentDebtMarginRow = {
  shipmentId: string | null;
  type: "RECEIVABLE" | "PAYABLE";
  totalAmount: number;
};

/**
 * Chênh lệch dòng tiền GỒM VAT theo lô = tổng phải thu − tổng phải trả. Đây không phải lợi nhuận
 * kế toán trước VAT; báo cáo lãi/lỗ riêng mới trừ VAT đầu ra và VAT đầu vào đã khớp.
 */
export function buildShipmentDebtMarginMap(rows: readonly ShipmentDebtMarginRow[]) {
  const totals = new Map<string, {
    receivable: number;
    payable: number;
    hasReceivable: boolean;
    hasPayable: boolean;
  }>();

  for (const row of rows) {
    if (!row.shipmentId) continue;
    const current = totals.get(row.shipmentId) ?? {
      receivable: 0,
      payable: 0,
      hasReceivable: false,
      hasPayable: false,
    };
    if (row.type === "RECEIVABLE") {
      current.receivable += row.totalAmount;
      current.hasReceivable = true;
    } else {
      current.payable += row.totalAmount;
      current.hasPayable = true;
    }
    totals.set(row.shipmentId, current);
  }

  return new Map(
    [...totals.entries()]
      .filter(([, value]) => value.hasReceivable && value.hasPayable)
      .map(([shipmentId, value]) => [shipmentId, value.receivable - value.payable])
  );
}

export function summarizeDebts(rows: readonly DebtSummaryRow[]): DebtSummary {
  return rows.reduce<DebtSummary>(
    (summary, row) => {
      summary.count += 1;
      summary.totalAmount += row.totalAmount;
      summary.paidAmount += row.paidAmount;
      summary.remainingAmount += row.remainingAmount;

      if (row.splitBreakdown) {
        summary.splitCount += 1;
        summary.invoiceAmount += row.splitBreakdown.invoiceAmount;
        summary.noInvoiceAmount += row.splitBreakdown.noInvoiceAmount;
        summary.paidInvoice += row.splitBreakdown.paidInvoice;
        summary.paidNoInvoice += row.splitBreakdown.paidNoInvoice;
        summary.remainingInvoice += row.splitBreakdown.remainingInvoice;
        summary.remainingNoInvoice += row.splitBreakdown.remainingNoInvoice;
      }

      return summary;
    },
    {
      count: 0,
      totalAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      splitCount: 0,
      invoiceAmount: 0,
      noInvoiceAmount: 0,
      paidInvoice: 0,
      paidNoInvoice: 0,
      remainingInvoice: 0,
      remainingNoInvoice: 0,
    }
  );
}
