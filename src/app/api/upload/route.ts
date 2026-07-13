import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { saveUploadedFile } from "@/lib/save-upload";

// Whitelist, not blacklist: files land in public/uploads and are served as-is, so anything a
// browser will execute (.html, .svg, .js, ...) must never get through — an uploaded .html on this
// domain would be stored XSS. This list covers what staff actually attach: customs declarations
// (.xls/.xlsx), official decisions/invoices (.pdf, .doc/.docx), photos of documents (.png/.jpg).
const ALLOWED_EXTENSIONS = ["pdf", "xls", "xlsx", "doc", "docx", "png", "jpg", "jpeg"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return apiError("Không có tệp nào được gửi lên.", 400);
    }

    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return apiError(
        `Loại tệp ".${extension}" không được hỗ trợ. Chỉ chấp nhận: ${ALLOWED_EXTENSIONS.join(", ")}.`,
        400
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiError("Tệp vượt quá dung lượng tối đa 20MB.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveUploadedFile(file.name, buffer);

    return apiSuccess(saved, 201);
  } catch (error) {
    console.error("POST /api/upload failed:", error);
    return apiError("Không thể tải lên tệp đính kèm.", 500);
  }
}
