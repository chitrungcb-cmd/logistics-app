import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, apiSuccess } from "@/lib/api-response";
import { generateShipmentCode } from "@/lib/shipment-constants";

export async function GET() {
  try {
    // Only the columns the /shipments list table actually renders — trims payload size
    // meaningfully now that the mailbox sync has populated hundreds of rows. The detail page
    // fetches the full record separately via GET /api/shipments/[id].
    const shipments = await prisma.shipment.findMany({
      orderBy: [{ declarationDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      select: {
        id: true,
        shipmentCode: true,
        customerName: true,
        customerId: true,
        declarationNo: true,
        declarationBranches: true,
        declarationDate: true,
        consultationDate: true,
        customsType: true,
        invoiceNo: true,
        port: true,
        goodsName: true,
        channel: true,
        status: true,
        customsOffice: true,
        attachments: true,
      },
    });
    return apiSuccess(shipments);
  } catch (error) {
    console.error("GET /api/shipments failed:", error);
    return apiError("Không thể tải danh sách lô hàng.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    let customerName = body.customerName;
    const customerId: string | null = body.customerId || null;
    if (customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) return apiError("Khách hàng không hợp lệ.", 400);
      customerName = customer.companyName;
    }
    if (!customerName || typeof customerName !== "string") {
      return apiError("Thiếu thông tin khách hàng.", 400);
    }

    const shipment = await prisma.shipment.create({
      data: {
        shipmentCode: generateShipmentCode(),
        customerName,
        customerId,
        taxCode: body.taxCode || null,
        declarationNo: body.declarationNo || null,
        declarationDate: body.declarationDate ? new Date(body.declarationDate) : null,
        invoiceNo: body.invoiceNo || null,
        customsType: body.customsType || null,
        port: body.port || null,
        goodsName: body.goodsName || null,
        channel: body.channel || null,
        status: body.status || undefined,
        customsOffice: body.customsOffice || null,
        note: body.note || null,
      },
    });

    return apiSuccess(shipment, 201);
  } catch (error) {
    console.error("POST /api/shipments failed:", error);
    return apiError("Không thể tạo lô hàng mới.", 500);
  }
}
