import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  cellContainsFormula,
  coerceHysCellValue,
  normalizeHysCellChanges,
  parseHysCellAddress,
} from "@/lib/hys-workbook";
import { prisma } from "@/lib/prisma";
import { readStoredFile } from "@/lib/private-storage";
import { saveUploadedFile } from "@/lib/save-upload";
import { isHysAttachment, type Attachment } from "@/lib/shipment-constants";
import { UnsafeUploadError } from "@/lib/file-security";

const MAX_HYS_BYTES = 20 * 1024 * 1024;

export const runtime = "nodejs";

function attachmentsFromJson(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    if (!attachment || typeof attachment !== "object") return [];
    const record = attachment as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.url !== "string") return [];
    return [{
      name: record.name,
      url: record.url,
      uploadedAt: typeof record.uploadedAt === "string" ? record.uploadedAt : "",
    }];
  });
}

function isEditableHysAttachment(attachment: Attachment) {
  return isHysAttachment(attachment.name) &&
    attachment.name.toLowerCase().endsWith(".xlsx");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const body = await request.json();
    const attachmentUrl = typeof body.attachmentUrl === "string" ? body.attachmentUrl : "";
    if (!attachmentUrl) return apiError("Không xác định được tệp HYS cần sửa.", 400);

    let changes;
    try {
      changes = normalizeHysCellChanges(body.changes);
    } catch (validationError) {
      return apiError(
        validationError instanceof Error ? validationError.message : "Dữ liệu chỉnh sửa không hợp lệ.",
        400
      );
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id },
      select: { id: true, attachments: true },
    });
    if (!shipment) return apiError("Không tìm thấy lô hàng.", 404);

    const attachments = attachmentsFromJson(shipment.attachments);
    const currentAttachment = attachments.find((attachment) => attachment.url === attachmentUrl);
    if (!currentAttachment || !isEditableHysAttachment(currentAttachment)) {
      return apiError("Tệp HYS không còn thuộc lô hàng hoặc không phải định dạng XLSX.", 409);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await readStoredFile(currentAttachment.url, MAX_HYS_BYTES)) as never
    );

    for (const change of changes) {
      const parsedAddress = parseHysCellAddress(change.address);
      const worksheet = workbook.getWorksheet(change.sheetName);
      if (!worksheet || !parsedAddress) {
        return apiError(`Không tìm thấy ô ${change.address} trong trang ${change.sheetName}.`, 400);
      }

      const cell = worksheet.getCell(parsedAddress.address);
      if (cell.isMerged && cell.master !== cell) {
        return apiError(`Ô ${change.address} thuộc vùng gộp và không thể sửa riêng.`, 400);
      }
      if (cellContainsFormula(cell)) {
        return apiError(`Ô ${change.address} chứa công thức và được bảo vệ.`, 400);
      }

      try {
        cell.value = coerceHysCellValue(cell, change.value);
      } catch (cellError) {
        return apiError(
          cellError instanceof Error ? cellError.message : `Giá trị ô ${change.address} không hợp lệ.`,
          400
        );
      }
    }

    const output = Buffer.from(await workbook.xlsx.writeBuffer());
    const saved = await saveUploadedFile(currentAttachment.name, output);
    const replacement: Attachment = {
      name: currentAttachment.name,
      url: saved.url,
      uploadedAt: new Date().toISOString(),
    };

    await prisma.$transaction(async (transaction) => {
      const latest = await transaction.shipment.findUnique({
        where: { id },
        select: { attachments: true },
      });
      if (!latest) throw new Error("SHIPMENT_NOT_FOUND");

      const latestAttachments = attachmentsFromJson(latest.attachments);
      const targetIndex = latestAttachments.findIndex(
        (attachment) => attachment.url === currentAttachment.url
      );
      if (targetIndex < 0) throw new Error("HYS_CHANGED");

      // Replace the current reference in place. The old version is not appended, so the shipment
      // always displays only the latest HYS and no edit-history row is created.
      latestAttachments[targetIndex] = replacement;
      await transaction.shipment.update({
        where: { id },
        data: { attachments: latestAttachments },
      });
    });

    return apiSuccess({ attachment: replacement });
  } catch (error) {
    if (error instanceof UnsafeUploadError) return apiError(error.message, 400);
    if (error instanceof Error && error.message === "SHIPMENT_NOT_FOUND") {
      return apiError("Không tìm thấy lô hàng.", 404);
    }
    if (error instanceof Error && error.message === "HYS_CHANGED") {
      return apiError("Tệp HYS vừa được thay đổi ở nơi khác. Hãy mở lại tệp mới nhất.", 409);
    }
    console.error("POST /api/shipments/[id]/attachments/hys failed:", error);
    return apiError("Không thể lưu thay đổi vào tệp HYS.", 500);
  }
}
