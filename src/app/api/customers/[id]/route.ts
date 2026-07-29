import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  ensureShipmentWorkflowTasks,
  reassignOpenShipmentWorkflowTasks,
} from "@/lib/shipment-workflow";

const UPDATABLE_FIELDS = [
  "companyName",
  "taxCode",
  "address",
  "legalRepName",
  "legalRepIdNumber",
  "phone",
  "email",
  "notes",
  "assignedUserId",
] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      assignedUser: { select: { id: true, name: true, email: true } },
      shipments: {
        orderBy: [
          { declarationDate: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        select: {
          id: true,
          declarationNo: true,
          declarationDate: true,
          goodsName: true,
          status: true,
        },
      },
    },
  });
  if (!customer) return apiError("Không tìm thấy khách hàng.", 404);

  return apiSuccess(customer);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") {
      return apiError("Bạn không có quyền sửa khách hàng.", 403);
    }

    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    if ("assignedUserId" in data && !data.assignedUserId) data.assignedUserId = null;

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const customer = await prisma.customer.update({
      where: { id },
      data,
      include: { shipments: { select: { id: true } } },
    });
    if ("assignedUserId" in data && customer.assignedUserId) {
      await Promise.all(
        customer.shipments.map((shipment) =>
          ensureShipmentWorkflowTasks({ shipmentId: shipment.id, createdByUserId: user.id })
        )
      );
      await reassignOpenShipmentWorkflowTasks({
        customerId: customer.id,
        assignedToUserId: customer.assignedUserId,
        actorUserId: user.id,
      });
    }
    return apiSuccess(customer);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "P2025") return apiError("Không tìm thấy khách hàng.", 404);
      if (error.code === "P2002") return apiError("Mã số thuế này đã tồn tại.", 409);
    }
    console.error("PATCH /api/customers/[id] failed:", error);
    return apiError("Không thể cập nhật khách hàng.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") {
      return apiError("Bạn không có quyền xóa khách hàng.", 403);
    }

    const { id } = await params;
    await prisma.customer.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy khách hàng.", 404);
    }
    console.error("DELETE /api/customers/[id] failed:", error);
    return apiError("Không thể xóa khách hàng.", 500);
  }
}
