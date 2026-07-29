import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { applyCostPresetsToShipment } from "@/lib/cost-presets";
import { mergeUniqueAttachments, type Attachment } from "@/lib/shipment-constants";
import { normalizeShipmentVehicles, type ShipmentVehicleInput } from "@/lib/shipment-vehicles";

// totalAmount deliberately NOT here (audit 3.1) — the legacy per-shipment cost field is vestigial;
// real costs live in ShipmentCost / the /costs page. The DB column is kept for historical reference
// but nothing in the app reads or writes it anymore.
const UPDATABLE_FIELDS = [
  "transport",
  "transportRoute",
  "vehiclePlate",
  "status",
  "note",
  "attachments",
  "customerId",
  "customerName",
  "taxCode",
  "declarationNo",
  "declarationDate",
  "invoiceNo",
  "customsType",
  "port",
  "goodsName",
  "channel",
  "customsOffice",
  "consultationDate",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const shipment = await prisma.shipment.findUnique({
      where: { id },
      include: {
        vehicles: {
          select: { id: true, chassisNo: true, engineNo: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

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
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    let vehicles: ShipmentVehicleInput[] | undefined;
    if ("vehicles" in body) {
      try {
        vehicles = normalizeShipmentVehicles(body.vehicles);
      } catch (vehicleError) {
        return apiError(
          vehicleError instanceof Error ? vehicleError.message : "Thông tin số khung, số máy không hợp lệ.",
          400
        );
      }
    }

    if (Object.keys(data).length === 0 && vehicles === undefined) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
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

    for (const dateField of ["declarationDate", "consultationDate"] as const) {
      if (dateField in data) data[dateField] = data[dateField] ? new Date(data[dateField] as string) : null;
    }
    if ("attachments" in data) {
      if (!Array.isArray(data.attachments)) return apiError("Danh sách chứng từ không hợp lệ.", 400);
      data.attachments = mergeUniqueAttachments(data.attachments as Attachment[]);
    }

    const nullableTextFields = [
      "transport", "transportRoute", "vehiclePlate", "note", "taxCode", "declarationNo", "invoiceNo",
      "customsType", "port", "goodsName", "channel", "customsOffice",
    ];
    for (const field of nullableTextFields) {
      if (field in data && data[field] === "") data[field] = null;
    }

    const shipment = await prisma.$transaction(async (transaction) => {
      await transaction.shipment.update({ where: { id }, data });
      if (vehicles !== undefined) {
        await transaction.shipmentVehicle.deleteMany({ where: { shipmentId: id } });
        if (vehicles.length > 0) {
          await transaction.shipmentVehicle.createMany({
            data: vehicles.map((vehicle) => ({ ...vehicle, shipmentId: id })),
          });
        }
      }
      return transaction.shipment.findUniqueOrThrow({
        where: { id },
        include: {
          vehicles: {
            select: { id: true, chassisNo: true, engineNo: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
    });
    if (shipment.declarationNo && ("declarationNo" in data || "goodsName" in data)) {
      await applyCostPresetsToShipment({ shipmentId: shipment.id, userId: user.id });
    }
    return apiSuccess(shipment);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy lô hàng.", 404);
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Số khung hoặc số máy đã thuộc một lô hàng khác.", 409);
    }
    console.error("PATCH /api/shipments/[id] failed:", error);
    return apiError("Không thể cập nhật lô hàng.", 500);
  }
}
