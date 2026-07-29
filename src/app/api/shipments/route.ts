import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { generateShipmentCode } from "@/lib/shipment-constants";
import { applyCostPresetsToShipment } from "@/lib/cost-presets";
import { ensureShipmentWorkflowTasks } from "@/lib/shipment-workflow";
import { notifyNewShipmentAssignees } from "@/lib/notifications";
import { paginationMeta, parsePagination } from "@/lib/pagination";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";
import { normalizeShipmentVehicles } from "@/lib/shipment-vehicles";
import { backfillShipmentVehicleIndex } from "@/lib/shipment-vehicle-index";

const SHIPMENT_LIST_SELECT = {
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
  vehicles: {
    select: {
      id: true,
      chassisNo: true,
      engineNo: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

const SHIPMENT_LIST_ORDER: Prisma.ShipmentOrderByWithRelationInput[] = [
  { declarationDate: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const params = request.nextUrl.searchParams;
    const paginated = params.has("page") || params.has("pageSize");

    // Existing comboboxes and finance screens intentionally request the compact full collection.
    // The high-traffic /shipments table opts into server pagination with page/pageSize.
    if (!paginated) {
      const shipments = await prisma.shipment.findMany({
        orderBy: SHIPMENT_LIST_ORDER,
        select: SHIPMENT_LIST_SELECT,
      });
      return apiSuccess(shipments);
    }

    const search = params.get("search")?.trim();
    const status = params.get("status")?.trim();
    const channel = params.get("channel")?.trim();
    const normalizedIdentifierSearch = search?.replace(/\s+/g, "") ?? "";
    if (
      normalizedIdentifierSearch.length >= 6 &&
      /[a-z]/i.test(normalizedIdentifierSearch) &&
      /\d/.test(normalizedIdentifierSearch)
    ) {
      await backfillShipmentVehicleIndex(20);
    }
    const where: Prisma.ShipmentWhereInput = {
      ...(status ? { status } : {}),
      ...(channel ? { channel } : {}),
      ...(search
        ? {
            OR: [
              { customerName: { contains: search, mode: "insensitive" } },
              { declarationNo: { contains: search, mode: "insensitive" } },
              { goodsName: { contains: search, mode: "insensitive" } },
              { invoiceNo: { contains: search, mode: "insensitive" } },
              {
                vehicles: {
                  some: {
                    OR: [
                      { chassisNo: { contains: normalizedIdentifierSearch, mode: "insensitive" } },
                      { engineNo: { contains: normalizedIdentifierSearch, mode: "insensitive" } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const { page, pageSize, skip } = parsePagination(params);
    const [shipments, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        orderBy: SHIPMENT_LIST_ORDER,
        select: SHIPMENT_LIST_SELECT,
        skip,
        take: pageSize,
      }),
      prisma.shipment.count({ where }),
    ]);

    const shipmentIds = shipments.map((shipment) => shipment.id);
    const tasks = shipmentIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: {
            relatedShipmentId: { in: shipmentIds },
            title: { in: [...SHIPMENT_TASK_STEPS] },
          },
          select: { relatedShipmentId: true, title: true, status: true },
        });
    const statusByShipment = new Map<string, Record<string, string>>();
    for (const task of tasks) {
      const shipmentId = task.relatedShipmentId!;
      const byTitle = statusByShipment.get(shipmentId) ?? {};
      byTitle[task.title] = task.status;
      statusByShipment.set(shipmentId, byTitle);
    }
    const taskStepsSummary = Object.fromEntries(
      shipmentIds.map((shipmentId) => {
        const byTitle = statusByShipment.get(shipmentId) ?? {};
        return [shipmentId, SHIPMENT_TASK_STEPS.map((title) => byTitle[title] ?? null)];
      })
    );

    return apiSuccess({
      items: shipments,
      taskStepsSummary,
      pagination: paginationMeta(page, pageSize, total),
    });
  } catch (error) {
    console.error("GET /api/shipments failed:", error);
    return apiError("Không thể tải danh sách lô hàng.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

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

    let vehicles;
    try {
      vehicles = normalizeShipmentVehicles(body.vehicles ?? []);
    } catch (vehicleError) {
      return apiError(
        vehicleError instanceof Error ? vehicleError.message : "Thông tin số khung, số máy không hợp lệ.",
        400
      );
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
        vehicles: vehicles.length > 0 ? { create: vehicles } : undefined,
      },
      include: {
        vehicles: {
          select: { id: true, chassisNo: true, engineNo: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await Promise.all([
      applyCostPresetsToShipment({ shipmentId: shipment.id, userId: user.id }),
      ensureShipmentWorkflowTasks({ shipmentId: shipment.id, createdByUserId: user.id }),
    ]);
    await notifyNewShipmentAssignees({ shipmentId: shipment.id, actorUserId: user.id });

    return apiSuccess(shipment, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Số khung hoặc số máy đã thuộc một lô hàng khác.", 409);
    }
    console.error("POST /api/shipments failed:", error);
    return apiError("Không thể tạo lô hàng mới.", 500);
  }
}
