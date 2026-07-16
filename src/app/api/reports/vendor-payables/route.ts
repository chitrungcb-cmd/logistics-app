import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  VENDORLESS_COST_CATEGORIES,
} from "@/lib/shipment-cost-constants";

type DetailRow = {
  costId: string;
  shipmentId: string;
  declarationNo: string | null;
  declarationDate: Date | null;
  customerName: string;
  goodsName: string | null;
  category: string;
  categoryLabel: string;
  amount: number;
  invoiceNumber: string | null;
  accountingDate: Date;
};

type VendorGroup = {
  vendorId: string | null;
  vendorName: string;
  vendorType: string | null;
  shipmentIds: Set<string>;
  lineCount: number;
  totalPayable: number;
  details: DetailRow[];
};

// Gross payable report derived from confirmed cost rows. Payment reconciliation remains in the
// Công nợ module; this report answers which supplier served how many shipments and for how much.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem báo cáo phải trả.", 403);

  const month = request.nextUrl.searchParams.get("month") || "";
  const category = request.nextUrl.searchParams.get("category") || "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return apiError("Tháng báo cáo không hợp lệ.", 400);
  if (category && !COST_CATEGORY_OPTIONS.includes(category as (typeof COST_CATEGORY_OPTIONS)[number])) {
    return apiError("Hạng mục chi phí không hợp lệ.", 400);
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  const costs = await prisma.shipmentCost.findMany({
    where: {
      category: {
        ...(category ? { equals: category as (typeof COST_CATEGORY_OPTIONS)[number] } : {}),
        notIn: [...VENDORLESS_COST_CATEGORIES],
      },
      OR: [
        { shipment: { declarationDate: { gte: start, lt: end } } },
        { shipment: { declarationDate: null }, createdAt: { gte: start, lt: end } },
      ],
    },
    select: {
      id: true,
      category: true,
      costPrice: true,
      invoiceNumber: true,
      createdAt: true,
      vendorId: true,
      vendor: { select: { id: true, name: true, type: true } },
      shipment: {
        select: {
          id: true,
          declarationNo: true,
          declarationDate: true,
          customerName: true,
          goodsName: true,
        },
      },
    },
    orderBy: [{ vendor: { name: "asc" } }, { shipment: { declarationDate: "asc" } }, { createdAt: "asc" }],
  });

  const groups = new Map<string, VendorGroup>();
  const allShipmentIds = new Set<string>();
  for (const cost of costs) {
    const key = cost.vendorId || "__UNASSIGNED__";
    const group = groups.get(key) ?? {
      vendorId: cost.vendorId,
      vendorName: cost.vendor?.name || "Chưa gắn nhà cung cấp",
      vendorType: cost.vendor?.type || null,
      shipmentIds: new Set<string>(),
      lineCount: 0,
      totalPayable: 0,
      details: [],
    };
    group.shipmentIds.add(cost.shipment.id);
    allShipmentIds.add(cost.shipment.id);
    group.lineCount += 1;
    group.totalPayable += cost.costPrice;
    group.details.push({
      costId: cost.id,
      shipmentId: cost.shipment.id,
      declarationNo: cost.shipment.declarationNo,
      declarationDate: cost.shipment.declarationDate,
      customerName: cost.shipment.customerName,
      goodsName: cost.shipment.goodsName,
      category: cost.category,
      categoryLabel: COST_CATEGORY_LABELS[cost.category] ?? cost.category,
      amount: cost.costPrice,
      invoiceNumber: cost.invoiceNumber,
      accountingDate: cost.shipment.declarationDate || cost.createdAt,
    });
    groups.set(key, group);
  }

  const rows = [...groups.values()]
    .map((group) => ({
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      vendorType: group.vendorType,
      shipmentCount: group.shipmentIds.size,
      lineCount: group.lineCount,
      totalPayable: group.totalPayable,
      details: group.details,
    }))
    .sort((a, b) => {
      if (a.vendorId === null) return 1;
      if (b.vendorId === null) return -1;
      return b.totalPayable - a.totalPayable;
    });

  const unassigned = rows.find((row) => row.vendorId === null);
  return apiSuccess({
    month,
    rows,
    totals: {
      vendorCount: rows.filter((row) => row.vendorId !== null).length,
      shipmentCount: allShipmentIds.size,
      lineCount: costs.length,
      totalPayable: costs.reduce((sum, cost) => sum + cost.costPrice, 0),
      unassignedLineCount: unassigned?.lineCount ?? 0,
      unassignedAmount: unassigned?.totalPayable ?? 0,
    },
  });
}
