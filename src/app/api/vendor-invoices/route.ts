import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

const STATUSES = new Set(["MATCHED", "UNMATCHED", "NEEDS_REVIEW"]);

function getMonthRange(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) return null;
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem hóa đơn đối tác.", 403);

    const search = request.nextUrl.searchParams.get("search")?.trim() || null;
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus && STATUSES.has(rawStatus) ? rawStatus as "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW" : null;
    const monthRange = getMonthRange(request.nextUrl.searchParams.get("month"));
    const nq = request.nextUrl.searchParams.get("nq");

    const where: Prisma.VendorInvoiceWhereInput = {
      status: status ?? undefined,
      invoiceDate: monthRange ?? undefined,
      isIssuedToNq: nq === "true" ? true : nq === "false" ? false : undefined,
      OR: search
        ? [
            { sellerName: { contains: search, mode: "insensitive" } },
            { sellerTaxCode: { contains: search, mode: "insensitive" } },
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { emailSubject: { contains: search, mode: "insensitive" } },
            { vendor: { name: { contains: search, mode: "insensitive" } } },
            { shipmentCost: { shipment: { declarationNo: { contains: search, mode: "insensitive" } } } },
            { shipmentCost: { shipment: { goodsName: { contains: search, mode: "insensitive" } } } },
          ]
        : undefined,
    };

    const [invoices, partners] = await Promise.all([
      prisma.vendorInvoice.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, taxCode: true, type: true } },
          shipmentCost: {
            select: {
              id: true,
              category: true,
              costPrice: true,
              invoiceNumber: true,
              shipment: {
                select: {
                  id: true,
                  declarationNo: true,
                  declarationDate: true,
                  goodsName: true,
                  customerName: true,
                },
              },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.vendor.findMany({
        where: { invoices: { some: {} } },
        include: {
          invoices: {
            select: { totalAmount: true, status: true, isIssuedToNq: true },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const totals = invoices.reduce(
      (acc, invoice) => {
        acc.count++;
        if (invoice.status === "MATCHED") acc.matched++;
        else if (invoice.status === "UNMATCHED") acc.unmatched++;
        else acc.needsReview++;
        if (invoice.isIssuedToNq !== false) acc.totalAmount += invoice.totalAmount ?? 0;
        return acc;
      },
      { count: 0, matched: 0, unmatched: 0, needsReview: 0, totalAmount: 0 }
    );

    const partnerRows = partners.map(({ invoices: partnerInvoices, ...partner }) => ({
      ...partner,
      invoiceCount: partnerInvoices.length,
      matchedCount: partnerInvoices.filter((invoice) => invoice.status === "MATCHED").length,
      totalAmount: partnerInvoices.reduce(
        (total, invoice) => total + (invoice.isIssuedToNq === false ? 0 : invoice.totalAmount ?? 0),
        0
      ),
    }));

    return apiSuccess({ invoices, totals, partners: partnerRows });
  } catch (error) {
    console.error("GET /api/vendor-invoices failed:", error);
    return apiError("Không thể tải danh sách hóa đơn đối tác.", 500);
  }
}
