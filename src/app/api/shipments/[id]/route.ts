import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/api-response";

const UPDATABLE_FIELDS = [
  "totalAmount",
  "transport",
  "status",
  "note",
  "attachments",
  "customerId",
  "customerName",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shipment = await prisma.shipment.findUnique({ where: { id } });

    if (!shipment) {
      return apiError("Không tìm thấy lô hàng.", 404);
    }

    return apiSuccess(shipment);
  } catch (error) {
    console.error("GET /api/shipments/[id] failed:", error);
    return apiError("Không thể tải chi tiết lô hàng.", 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    if ("totalAmount" in data) {
      data.totalAmount = Number(data.totalAmount) || 0;
    }

    // customerId is the source of truth when linked — always re-derive customerName from the
    // Customer record rather than trusting whatever text the client sent alongside it, so the two
    // can't drift apart. Clearing the link (customerId: null) falls back to the free-typed name.
    if ("customerId" in data) {
      if (data.customerId) {
        const customer = await prisma.customer.findUnique({ where: { id: data.customerId as string } });
        if (!customer) return apiError("Khách hàng không hợp lệ.", 400);
        data.customerName = customer.companyName;
      } else {
        data.customerId = null;
      }
    }

    const shipment = await prisma.shipment.update({ where: { id }, data });
    return apiSuccess(shipment);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy lô hàng.", 404);
    }
    console.error("PATCH /api/shipments/[id] failed:", error);
    return apiError("Không thể cập nhật lô hàng.", 500);
  }
}
