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
